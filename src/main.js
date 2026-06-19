import unicornUrl from "./assets/unicorn.webp";
import wowUrl from "./assets/wow.mp3";
import { COLS, MASK, ROWS } from "./mask.js";
import {
  clamp,
  DARK_BG,
  heatColor,
  hslColor,
  iceColor,
  LIGHT_BG,
  mix,
  smoothstep,
} from "./util.js";

const CORE = ["+", "·", "*", "◦"];
const CRYSTAL = ["❆", "❅", "✦", "✳"];
// magma rendered in the same cell grid as the ice — a density ramp of
// shade blocks so vents read as molten matter welling up, by heat.
const MAGMA = ["░", "▒", "▓"];
const magmaGlyph = (heat) => MAGMA[heat > 0.7 ? 2 : heat > 0.5 ? 1 : 0];

// One entry per lit cell: grid pos, normalized polar coords in the square
// display space, a stable random, glyphs, and a relief height (the frost
// domes toward the viewer) used for the pseudo-3D projection.
const cells = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (MASK[r][c] !== "1") continue;
    const dx = (c + 0.5) / COLS - 0.5;
    const dy = (r + 0.5) / ROWS - 0.5;
    const rN = clamp(Math.hypot(dx, dy) / 0.5, 0, 1);
    let ang = Math.atan2(dy, dx) / (Math.PI * 2);
    if (ang < 0) ang += 1;
    let h = (c * 73856093) ^ (r * 19349663);
    h = (h ^ (h >>> 13)) >>> 0;
    const rnd = (h % 1000) / 1000;
    // hemisphere normal for the frost dome: pole (+z) faces the viewer at
    // the centre, tilting radially outward toward the rim. Drives specular.
    const phi = rN * Math.PI * 0.5;
    const sinPhi = Math.sin(phi);
    const a2 = ang * Math.PI * 2;
    // crystalline fingers: frost reaches inward faster at some angles, so
    // the freeze front is ragged rather than a clean radial ring
    const fingers =
      0.5 * Math.sin(a2 * 9) +
      0.28 * Math.sin(a2 * 23 + 1.7) +
      0.22 * Math.sin(a2 * 5 - 0.6);
    cells.push({
      c,
      r,
      rN,
      ang,
      rnd,
      u: ((c + 0.5) / COLS + (r + 0.5) / ROWS) / 2, // diagonal sweep coord
      reveal: 1 - rN + (rnd - 0.5) * 0.14 - fingers * 0.09, // tips inward
      relief: Math.cos(phi), // 1 at centre → 0 at rim
      nx: sinPhi * Math.cos(a2),
      ny: sinPhi * Math.sin(a2),
      nz: Math.cos(phi),
      phase: rnd * Math.PI * 2,
      core: CORE[h % CORE.length],
      crystal: CRYSTAL[(h >>> 3) % CRYSTAL.length],
    });
  }
}

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Phones are fill-rate bound: the soft vapour sprites are big and blended,
// and a retina canvas multiplies every blended pixel. On touch devices cap
// the canvas resolution lower and thin the particle budget.
const coarse = window.matchMedia("(pointer: coarse)").matches;
const DPR_CAP = coarse ? 1.25 : 1.5;
const PQ = coarse ? 0.4 : 0.6; // vapour budget multiplier

// Soft vapour sprites (cryo fog) pre-rendered once — a cool one for the
// dark theme and a neutral grey one that reads as mist on the light theme.
function makeVapor(stops) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const vc = cv.getContext("2d");
  const vg = vc.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) vg.addColorStop(o, col);
  vc.fillStyle = vg;
  vc.fillRect(0, 0, 64, 64);
  return cv;
}
const vapor = makeVapor([
  [0, "rgba(214,236,255,0.9)"],
  [0.4, "rgba(180,212,250,0.35)"],
  [1, "rgba(150,190,240,0)"],
]);
const vaporLight = makeVapor([
  [0, "rgba(150,150,170,0.6)"],
  [0.4, "rgba(140,140,165,0.25)"],
  [1, "rgba(140,140,165,0)"],
]);

// Cold bloom sprite — a tight bright halo drawn additively over the
// brightest crystals.
const bloom = document.createElement("canvas");
bloom.width = bloom.height = 48;
{
  const bc = bloom.getContext("2d");
  const bg = bc.createRadialGradient(24, 24, 0, 24, 24, 24);
  bg.addColorStop(0, "rgba(222,240,255,0.95)");
  bg.addColorStop(0.5, "rgba(170,205,250,0.25)");
  bg.addColorStop(1, "rgba(150,190,240,0)");
  bc.fillStyle = bg;
  bc.fillRect(0, 0, 48, 48);
}
const puffs = [];
const shards = []; // bright ice bits that sparkle off and fall away
let poke = null; // pending {x,y} tap — knocks flakes off the mark nearby
let rainbow = false; // press R — recolour the ice with a swirling rainbow
// rapid repeated hits spin the gear: each combo hit adds spin velocity,
// which damps out — so a quick flurry whips it around 360°+ and settles.
let spin = 0,
  spinVel = 0,
  lastHit = -10,
  combo = 0;
let eruptStart = -100; // Konami code → whole mark erupts, then settles
let konamiAt = 0; // progress through the code
let unicornStart = -100; // Konami in rainbow mode → unicorn jumps the mark
const unicornImg = new Image();
unicornImg.src = unicornUrl;
const userVents = []; // double-tap drills a magma vent at that spot
let lastTap = -10,
  lastTapX = 0,
  lastTapY = 0;
// magma seeds for the current cycle — a few random points the lava pools
// grow out from; re-rolled each cycle so the pattern moves around.
let magmaCycle = -1;
let seeds = [];
let seedOff = 0;
let seedsPrev = []; // last cycle's seeds — the not-yet-swept rim still uses
let seedOffPrev = 0; // them until the sweep front reaches it

let vw = 0,
  vh = 0,
  cellW = 0,
  cellH = 0,
  cx = 0,
  cy = 0,
  fontSize = 0,
  focal = 0,
  dome = 0,
  glowR = 0,
  G = 0,
  glowGrad = null,
  frame = 0; // render counter — used to throttle the painter sort

// parallax: pointer/tilt offset from centre (-1..1) and the eased camera
// angles actually fed to the projection each frame.
let pnx = 0,
  pny = 0,
  yawC = 0,
  pitchC = 0;

function layout() {
  vw = window.innerWidth;
  vh = window.innerHeight;
  const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  canvas.style.width = vw + "px";
  canvas.style.height = vh + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  G = Math.min(vw, vh) * 0.62;
  cellW = G / COLS;
  cellH = G / ROWS;
  fontSize = cellH * 1.04;
  cx = vw / 2;
  cy = vh / 2;
  focal = G * 1.5; // perspective strength (larger = subtler)
  dome = G * 0.16; // how far the frost bulges toward the camera
  glowR = G * 0.8;
  glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  glowGrad.addColorStop(0, "rgba(70,130,210,0.16)");
  glowGrad.addColorStop(0.5, "rgba(40,80,150,0.08)");
  glowGrad.addColorStop(1, "rgba(20,40,80,0)");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  frame = 0; // force a re-sort next frame (depth order changed)
}
layout();
window.addEventListener("resize", layout);

const INTRO = 3.2; // frost-in seconds
const SWEEP = 14.0; // light-orbit seconds
const LIGHT_EL = 1.0; // light elevation from the view axis (rad)
const SHINE = 18; // specular tightness — higher = tighter glint
const BLOOM_TH = 0.5; // sparkle above this gets an additive halo

// freeze cycle: the surface slowly degrades — magma veins grow up through
// the ice (driving steam + flaking) — then a fast sweep lays down fresh ice
// and quenches them. A cell is refreshed when the sweep front passes its
// `u`; the longer since, the higher the magma floods (see the draw loop).
const EV_PERIOD = 22; // full degrade → refresh cycle (s)
const EV_DUR = 4.5; // fast refresh sweep crossing time (s)
const EV_FIRST = 3; // grace after intro before the first cycle
const HEAT_DELAY = 2; // fresh ice stays cold this long after a refresh (s)
const EV_FLASH = 0.7; // crystallization sparkle as the fresh ice forms (s)
const MAGMA_R = 11; // pool radius (in cells) magma reaches by end of cycle
const MAGMA_EDGE = 4; // soft falloff width at a pool's edge (cells)
const MAGMA_SEEDS = 4; // how many pools per cycle
const VENT_R = 6; // radius (cells) of a hand-drilled (double-tap) vent
const UNICORN_DUR = 2.2; // seconds for the unicorn to arc across the screen

// Project a point (centred gear space, z toward camera = negative) through
// a yaw/pitch camera + perspective. Returns screen pos, scale and depth.
function project(px, py, z, sinA, cosA, sinP, cosP) {
  const x1 = px * cosA + z * sinA;
  const z1 = -px * sinA + z * cosA;
  const y2 = py * cosP - z1 * sinP;
  const z2 = py * sinP + z1 * cosP;
  const s = focal / (focal + z2);
  return { sx: cx + x1 * s, sy: cy + y2 * s, s, z2 };
}

const order = cells.map((_, i) => i); // reused draw-order buffer

function render(t, dt) {
  const cov = reduced ? 1 : smoothstep(0, 1, clamp(t / INTRO, 0, 1));
  const sweep = (t / SWEEP) % 1;
  const breathe = 0.85 + 0.15 * Math.sin(t * 0.9);

  // freeze cycle: local time within the current cycle, plus a one-off
  // ramp so the magma eases in over the first cycle rather than popping.
  const cyc = !reduced && t > INTRO + EV_FIRST;
  const ct = t - INTRO - EV_FIRST;
  const lt = cyc ? ct % EV_PERIOD : 0;
  const ramp = cyc ? clamp(ct / 5, 0, 1) : 0; // ease in over first ~5s

  // Konami eruption time (applied per-cell, frozen back by the sweep).
  // Prune drilled vents once fully quenched — a sweep reaches any cell
  // within one cycle, so anything older than EV_PERIOD is frozen over.
  const eAge = t - eruptStart;
  for (let i = userVents.length - 1; i >= 0; i--)
    if (t - userVents[i].t0 > EV_PERIOD) userVents.splice(i, 1);

  // re-roll the magma seeds at the start of each cycle so the pools grow
  // somewhere new. Warp the seed coords by a low-freq field (shared with
  // the cells) so pools finger out organically instead of as clean discs.
  if (cyc) {
    const cycle = Math.floor(ct / EV_PERIOD);
    if (cycle !== magmaCycle) {
      magmaCycle = cycle;
      seedsPrev = seeds; // keep last cycle's pattern for the unswept rim
      seedOffPrev = seedOff;
      seedOff = cycle * 2.4;
      seeds = [];
      for (let k = 0; k < MAGMA_SEEDS; k++) {
        const s = cells[(Math.random() * cells.length) | 0];
        seeds.push({
          wc: s.c + 3 * Math.sin(s.r * 0.4 + seedOff),
          wr: s.r + 3 * Math.sin(s.c * 0.4 + seedOff),
        });
      }
    }
  }

  // camera = gentle autonomous drift + pointer/tilt parallax, eased so it
  // glides rather than snaps. ease factor is dt-based → frame-rate stable.
  const tgtYaw = reduced ? 0 : Math.sin(t * 0.45) * 0.12 + pnx * 0.33;
  const tgtPitch = reduced ? 0 : Math.sin(t * 0.33) * 0.04 + pny * 0.16;
  const ease = 1 - Math.exp(-dt * 6);
  yawC += (tgtYaw - yawC) * ease;
  pitchC += (tgtPitch - pitchC) * ease;
  const yaw = yawC,
    pitch = pitchC;
  // spin (from rapid hits) adds to yaw → the gear turns about the vertical
  const sinA = Math.sin(yaw + spin),
    cosA = Math.cos(yaw + spin);
  const sinP = Math.sin(pitch),
    cosP = Math.cos(pitch);

  // directional specular: a light orbits the dome and the glint is its
  // half-vector highlight (V = +z toward viewer), so the bright spot rakes
  // across the 3-D surface. Coupled to yaw so parallax nudges the glint.
  const Laz = sweep * Math.PI * 2 + yaw * 0.6;
  const sinEl = Math.sin(LIGHT_EL);
  let Hx = sinEl * Math.cos(Laz),
    Hy = sinEl * Math.sin(Laz),
    Hz = Math.cos(LIGHT_EL) + 1; // + view vector (0,0,1)
  const Hlen = Math.hypot(Hx, Hy, Hz) || 1;
  Hx /= Hlen;
  Hy /= Hlen;
  Hz /= Hlen;

  // spin decays each frame; once slow, a spring eases it to the nearest
  // full turn so the gear never rests edge-on (added into yaw below)
  spinVel *= Math.exp(-dt * 1.8);
  const spinTarget = Math.round(spin / (Math.PI * 2)) * (Math.PI * 2);
  if (Math.abs(spinVel) < 2) spinVel += (spinTarget - spin) * dt * 5;
  spin += spinVel * dt;
  if (Math.abs(spinVel) < 0.05 && Math.abs(spin - spinTarget) < 0.02) {
    spin = 0; // settled — reset to exact front (a multiple of 2π)
    spinVel = 0;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // cached cold glow, modulated by coverage + breathing via globalAlpha
  // (skipped in light/rainbow mode — a dark blue glow looks wrong on white)
  if (!rainbow) {
    ctx.globalAlpha = cov * breathe;
    ctx.fillStyle = glowGrad;
    ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    ctx.globalAlpha = 1;
  }

  // project cells onto themselves (no per-frame allocations), sort far→near
  for (const cell of cells) {
    const px = (cell.c + 0.5 - COLS / 2) * cellW;
    const py = (cell.r + 0.5 - ROWS / 2) * cellH;
    const z = -cell.relief * dome + (cell.rnd - 0.5) * cellW * 0.6;
    const x1 = px * cosA + z * sinA;
    const z1 = -px * sinA + z * cosA;
    const y2 = py * cosP - z1 * sinP;
    const z2 = py * sinP + z1 * cosP;
    const s = focal / (focal + z2);
    cell.sx = cx + x1 * s;
    cell.sy = cy + y2 * s;
    cell.s = s;
    cell.z2 = z2;
  }
  // depth order drifts slowly with the gentle yaw/pitch, so re-sort every
  // few frames instead of every frame — imperceptible, ~85% less sort work
  if (frame++ % 8 === 0) order.sort((a, b) => cells[b].z2 - cells[a].z2);

  // one font for the whole frame — per-glyph ctx.font is very costly
  ctx.font = `${fontSize}px ui-monospace, Menlo, monospace`;
  ctx.lineWidth = Math.max(1, fontSize * 0.09); // glyph outline in rainbow
  ctx.lineJoin = "round";

  for (const i of order) {
    const cell = cells[i];
    if (cov < cell.reveal) {
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "rgb(46,78,130)";
      ctx.fillText(cell.core, cell.sx, cell.sy);
      cell.bloom = 0;
      cell.heat = 0;
      continue;
    }
    const appear = clamp((cov - cell.reveal) / 0.08, 0, 1);
    const ndH = cell.nx * Hx + cell.ny * Hy + cell.nz * Hz;
    const glint = reduced || ndH <= 0 ? 0 : Math.pow(ndH, SHINE);
    const tw = reduced
      ? 0
      : Math.pow(Math.max(0, Math.sin(t * 1.7 + cell.phase)), 14) * 0.7;
    // degrade/refresh: `since` is seconds since the sweep last refroze
    // this cell. Magma pools grow outward from the cycle's seed points as
    // `since` rises (radius expands); flash is the brief crystallization
    // as fresh ice forms right after the front passes.
    let heat = 0,
      flash = 0;
    if (cyc) {
      let since = lt - cell.u * EV_DUR;
      if (since < 0) since += EV_PERIOD;
      flash = smoothstep(EV_FLASH, 0, since); // crystallization at refresh
      const radius = smoothstep(HEAT_DELAY, EV_PERIOD * 0.85, since) * MAGMA_R;
      // use the seed set from the cycle this cell was last refreshed in —
      // the switch lands at the sweep front, where radius is ~0, so the
      // pattern never visibly jumps on the still-glowing rim
      const sameCycle = Math.floor((ct - since) / EV_PERIOD) === magmaCycle;
      const sset = sameCycle ? seeds : seedsPrev;
      const soff = sameCycle ? seedOff : seedOffPrev;
      if (radius > 0 && sset.length) {
        const wc = cell.c + 3 * Math.sin(cell.r * 0.4 + soff);
        const wr = cell.r + 3 * Math.sin(cell.c * 0.4 + soff);
        let best = 1e9;
        for (let k = 0; k < sset.length; k++) {
          const dx = wc - sset[k].wc,
            dy = wr - sset[k].wr;
          const dd = dx * dx + dy * dy;
          if (dd < best) best = dd;
        }
        const dist = Math.sqrt(best);
        if (dist < radius)
          heat = clamp((radius - dist) / MAGMA_EDGE, 0, 1) * ramp;
      }
      // hand-drilled vents (double-tap): glow from when drilled until the
      // sweep next reaches this cell (age >= since), which freezes them
      // over like the rest of the magma — no independent self-heal
      for (let v = 0; v < userVents.length; v++) {
        const uv = userVents[v];
        const age = t - uv.t0;
        if (age >= since) continue; // cell already refrozen since drilled
        const d = Math.hypot(cell.c - uv.c, cell.r - uv.r);
        if (d >= VENT_R) continue;
        const hv = smoothstep(0, 0.5, age) * clamp(1 - d / VENT_R, 0, 1);
        if (hv > heat) heat = hv;
      }
      // Konami eruption: floods every cell (textured by rnd), then the
      // sweep freezes it back over — same age < since rule as the vents
      if (eAge >= 0 && eAge < since)
        heat = Math.max(
          heat,
          smoothstep(0, 0.4, eAge) * (0.6 + cell.rnd * 0.4),
        );
    }
    const sparkle = Math.max(glint, tw) * (1 - heat * 0.8) + flash * 0.9;
    cell.bloom = sparkle > BLOOM_TH ? sparkle - BLOOM_TH : 0; // cold halo
    cell.heat = heat; // also sourced by the steam + flaking spawners
    // depth shading: nearer (s>1) brighter, farther dimmer
    const depth = clamp((cell.s - 0.9) * 1.4, 0, 1);
    const lp = clamp(
      (0.26 +
        cell.rN * 0.2 +
        (cell.rnd - 0.5) * 0.1 +
        sparkle * 0.65 +
        depth * 0.12) *
        (1 - heat * 0.35), // ice base dims as the crust melts away
      0,
      1,
    );
    // base surface colour — frost palette, or a swirling pastel rainbow in
    // the R-mode easter egg (hue sweeps around the gear + over time)
    const hue = (cell.ang + cell.rN * 0.25 + t * 0.12) % 1;
    const base = rainbow
      ? hslColor(hue, 0.5, clamp(0.46 + lp * 0.28, 0, 0.74))
      : iceColor(lp);
    let rr, gg, bb;
    if (heat > 0.001) {
      // magma follows the theme: red normally, but a vivid same-hue flare
      // in rainbow mode so the hot streaks stay on-palette
      const [hr, hg, hb] = rainbow
        ? hslColor(hue, 0.95, clamp(0.5 + heat * 0.12, 0, 0.66))
        : heatColor(clamp(0.18 + heat * 0.8, 0, 1));
      const m = clamp(heat * 1.6, 0, 1); // crust → magma reveal (eager)
      rr = mix(base[0], hr, m) | 0;
      gg = mix(base[1], hg, m) | 0;
      bb = mix(base[2], hb, m) | 0;
    } else {
      [rr, gg, bb] = base;
    }
    // in light/rainbow mode the refresh sweep reads as a gold crystallizing
    // front (tint toward gold by the flash, strongest right at the front)
    if (rainbow && flash > 0.001) {
      rr = mix(rr, 247, flash) | 0;
      gg = mix(gg, 197, flash) | 0;
      bb = mix(bb, 74, flash) | 0;
    }
    let alpha =
      appear * (0.78 + 0.22 * breathe) * (0.7 + 0.3 * depth) + heat * 0.35;
    if (rainbow) alpha *= 1.5; // pastels need to be more opaque on light bg
    ctx.globalAlpha = Math.min(1, alpha);
    const glyph =
      heat > 0.28
        ? magmaGlyph(heat)
        : sparkle > 0.42
          ? cell.crystal
          : cell.core;
    // a dark outline gives the pastel glyphs definition against light bg
    if (rainbow) {
      ctx.strokeStyle = "rgba(34,26,52,0.5)";
      ctx.strokeText(glyph, cell.sx, cell.sy);
    }
    ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
    ctx.fillText(glyph, cell.sx, cell.sy);
  }

  // additive bloom: a cold halo over the brightest crystals
  ctx.globalCompositeOperation = "lighter";
  for (const i of order) {
    const cell = cells[i];
    const b = cell.bloom;
    if (!b) continue;
    const d = fontSize * (0.8 + b * 0.7);
    ctx.globalAlpha = Math.min(0.5, b * 0.7);
    ctx.drawImage(bloom, cell.sx - d, cell.sy - d, d * 2, d * 2);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // --- cryo vapour: spills off the cold surface, drifts and sinks ---
  if (!reduced && cov > 0.35) {
    const want = 36 * PQ * dt; // puffs/sec (thinned on touch devices)
    for (let n = 0; n < want || Math.random() < want - Math.floor(want); n++) {
      if (n >= 200) break;
      // bias toward the upper surface — vapour rises off the top
      const a = cells[(Math.random() * cells.length) | 0];
      const b = cells[(Math.random() * cells.length) | 0];
      const src = a.r < b.r ? a : b;
      const px = (src.c + 0.5 - COLS / 2) * cellW;
      const py = (src.r + 0.5 - ROWS / 2) * cellH;
      puffs.push({
        x: px,
        y: py,
        z: -src.relief * dome - 6,
        vx:
          Math.sign(px || 1) * (5 + Math.random() * 16) +
          (Math.random() - 0.5) * 10,
        vy: -(6 + Math.random() * 16), // slight initial rise
        life: 1,
        ttl: 2.2 + Math.random() * 2,
        size: G * 0.018,
        sway: Math.random() * Math.PI * 2,
        fade: 0,
      });
      if (puffs.length > 260 * PQ) puffs.shift();
    }
  }

  // hot steam: magma vents boil off vapour that rises fast — sourced from
  // whichever cells are currently glowing (cell.heat set in the draw pass)
  if (cyc && cov > 0.35) {
    const want = 90 * PQ * dt;
    for (let n = 0; n < want || Math.random() < want - Math.floor(want); n++) {
      if (n >= 60) break;
      const src = cells[(Math.random() * cells.length) | 0];
      if (src.heat < 0.3 || cov < src.reveal) continue;
      const px = (src.c + 0.5 - COLS / 2) * cellW;
      const py = (src.r + 0.5 - ROWS / 2) * cellH;
      puffs.push({
        x: px,
        y: py,
        z: -src.relief * dome - 6,
        vx: (Math.random() - 0.5) * 22,
        vy: -(26 + Math.random() * 30) * src.heat, // hotter → rises faster
        life: 1,
        ttl: 1.6 + Math.random() * 1.4,
        size: G * 0.016,
        sway: Math.random() * Math.PI * 2,
        fade: 0,
      });
      if (puffs.length > 320 * PQ) puffs.shift();
    }
  }

  const vsprite = rainbow ? vaporLight : vapor;
  for (let i = puffs.length - 1; i >= 0; i--) {
    const q = puffs[i];
    q.vy += 26 * dt; // gravity — CO₂ fog is heavy, it pours down
    q.sway += dt * 1.5;
    q.x += (q.vx + Math.sin(q.sway) * 8) * dt;
    q.y += q.vy * dt;
    q.size += G * 0.05 * dt; // billow outward
    q.life -= dt / q.ttl;
    q.fade = Math.min(1, q.fade + dt * 4); // fade-in
    if (q.life <= 0) {
      puffs.splice(i, 1);
      continue;
    }
    const p = project(q.x, q.y, q.z, sinA, cosA, sinP, cosP);
    // cap radius — late puffs billow large and a few big soft sprites
    // dominate the fill cost
    const d = Math.min(q.size, G * 0.12) * p.s;
    ctx.globalAlpha = clamp(q.life, 0, 1) * q.fade * 0.4;
    ctx.drawImage(vsprite, p.sx - d, p.sy - d, d * 2, d * 2);
  }

  // --- frost shards: the crust cracks and flakes, much more so over the
  // magma vents (chance scales with the cell's heat) ---
  if (!reduced && cov > 0.5 && shards.length < 180) {
    const tries = 1 + (4 * dt) / FRAME; // a few attempts per frame
    for (let n = 0; n < tries; n++) {
      const src = cells[(Math.random() * cells.length) | 0];
      if (cov < src.reveal) continue;
      if (Math.random() > 0.04 + src.heat * 0.9) continue;
      const hot = src.heat > 0.3;
      shards.push({
        x: src.sx,
        y: src.sy,
        vx: (Math.random() - 0.5) * (hot ? 60 : 45),
        vy: -(hot ? 16 : 10) - Math.random() * 28, // chip up, then falls
        phase: Math.random() * Math.PI * 2,
        glyph: src.crystal,
      });
      if (shards.length >= 180) break;
    }
  }
  // poke: a tap/click knocks a burst of flakes off the mark near the cursor
  if (poke && !reduced && cov > 0.3) {
    const R = G * 0.2;
    const near = [];
    for (let k = 0; k < cells.length; k++) {
      const cell = cells[k];
      if (cov < cell.reveal) continue;
      if (Math.hypot(cell.sx - poke.x, cell.sy - poke.y) <= R) near.push(k);
    }
    const burst = Math.min(30, near.length);
    for (let m = 0; m < burst && shards.length < 250; m++) {
      const cell = cells[near[(Math.random() * near.length) | 0]];
      const ddx = cell.sx - poke.x,
        ddy = cell.sy - poke.y;
      const dist = Math.hypot(ddx, ddy) || 1;
      const spd = 70 + (1 - dist / R) * 240 + Math.random() * 60;
      shards.push({
        x: cell.sx,
        y: cell.sy,
        vx: (ddx / dist) * spd + (Math.random() - 0.5) * 40,
        vy: (ddy / dist) * spd - 70 - Math.random() * 90, // out + pop up
        phase: Math.random() * Math.PI * 2,
        glyph: cell.crystal,
      });
    }
    poke = null;
  }

  ctx.font = `${fontSize * 0.72}px ui-monospace, Menlo, monospace`;
  // bright ice on dark; a slate tint so flakes still read on the light bg
  ctx.fillStyle = rainbow ? "rgb(120,128,160)" : "rgb(226,242,255)";
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.vy += 210 * dt; // gravity
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.y > vh + 24) {
      shards.splice(i, 1);
      continue;
    }
    const twk = 0.25 + 0.75 * Math.abs(Math.sin(t * 9 + s.phase)); // sparkle
    ctx.globalAlpha = twk;
    ctx.fillText(s.glyph, s.x, s.y);
  }
  ctx.globalAlpha = 1;

  // unicorn easter egg: Konami while in rainbow mode → a cartoon unicorn
  // leaps over the mark on a parabolic arc (left→right, tilting with the arc)
  if (rainbow && unicornImg.complete && unicornImg.naturalWidth) {
    const up = (t - unicornStart) / UNICORN_DUR;
    if (up >= 0 && up <= 1) {
      const uw = G * 0.5;
      const uh = (uw * unicornImg.naturalHeight) / unicornImg.naturalWidth;
      const ux = mix(-uw, vw + uw, up); // enters left, exits right
      const uy = cy + G * 0.25 - G * 0.85 * Math.sin(up * Math.PI); // arcs over
      ctx.save();
      ctx.translate(ux, uy);
      ctx.rotate(-Math.cos(up * Math.PI) * 0.25); // nose up rising, down falling
      ctx.drawImage(unicornImg, -uw / 2, -uh / 2, uw, uh);
      ctx.restore();
    }
  }
}

// Throttle to a fixed frame rate — uncapped rAF burns CPU on 120Hz panels.
const FPS = 30;
const FRAME = 1 / FPS;
let prevT = 0;
let acc = 0;
let animT = 0; // animation clock — only advances while we render
let rafId = 0;
function loop(ms) {
  rafId = requestAnimationFrame(loop);
  const now = ms / 1000;
  const dt = Math.min(0.05, now - prevT);
  prevT = now;
  animT += dt;
  acc += dt;
  if (acc < FRAME) return;
  render(animT, acc);
  acc = 0;
}
function start() {
  // resume from where the clock paused — prevT reset avoids a dt spike,
  // animT persists so sweep/twinkle/event phase doesn't jump
  cancelAnimationFrame(rafId);
  prevT = performance.now() / 1000;
  acc = 0;
  rafId = requestAnimationFrame(loop);
}

// Click anywhere → anime "wow" (meme easter egg). The mp3 is imported so the
// bundler inlines it into the single-file build.
let wowWarm = null;
// R → toggle rainbow mode (re-render once if motion is paused/reduced)
const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];
window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    rainbow = !rainbow;
    document.body.style.background = rainbow ? LIGHT_BG : DARK_BG;
    if (reduced) render(INTRO, 0);
  }
  // Konami code → erupt the whole mark
  konamiAt =
    e.key === KONAMI[konamiAt] ? konamiAt + 1 : e.key === KONAMI[0] ? 1 : 0;
  if (konamiAt === KONAMI.length) {
    konamiAt = 0;
    eruptStart = animT;
    if (rainbow) unicornStart = animT; // rainbow mode → a unicorn leaps over
    if (reduced) render(INTRO, 0);
  }
});

window.addEventListener("pointerdown", (e) => {
  const a = new Audio(wowUrl);
  a.volume = 0.7;
  a.play().catch(() => {});
  poke = { x: e.clientX, y: e.clientY }; // released as flakes next frame
  // rapid-hit combo → spin: 3rd+ quick hit adds spin velocity
  combo = animT - lastHit < 0.6 ? combo + 1 : 1;
  lastHit = animT;
  if (combo >= 3) spinVel += 14;
  // double-tap → drill a magma vent at the nearest cell to the tap
  if (
    animT - lastTap < 0.32 &&
    Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40
  ) {
    let best = (G * 0.3) ** 2,
      bc = null;
    for (const cell of cells) {
      const dx = cell.sx - e.clientX,
        dy = cell.sy - e.clientY;
      const dd = dx * dx + dy * dy;
      if (dd < best) {
        best = dd;
        bc = cell;
      }
    }
    if (bc && userVents.length < 12)
      userVents.push({ c: bc.c, r: bc.r, t0: animT });
    lastTap = -10; // consume so the next tap starts a fresh pair
  } else {
    lastTap = animT;
    lastTapX = e.clientX;
    lastTapY = e.clientY;
  }
  // iOS gates deviceorientation behind a user-gesture permission prompt
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    DOE.requestPermission()
      .then((s) => {
        if (s === "granted")
          window.addEventListener("deviceorientation", onTilt);
      })
      .catch(() => {});
  }
});

// --- parallax input: the gear leans toward the pointer (or device tilt) ---
if (!reduced) {
  window.addEventListener("pointermove", (e) => {
    pnx = clamp((e.clientX / vw - 0.5) * 2, -1, 1);
    pny = clamp((e.clientY / vh - 0.5) * 2, -1, 1);
  });
  // ease back to centre when the cursor leaves the window
  document.addEventListener("pointerleave", () => {
    pnx = pny = 0;
  });
  // non-iOS browsers fire deviceorientation without a permission prompt
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission !== "function")
    window.addEventListener("deviceorientation", onTilt);
}
function onTilt(e) {
  if (e.gamma == null) return;
  pnx = clamp(e.gamma / 35, -1, 1); // left↔right tilt
  pny = clamp((e.beta - 45) / 35, -1, 1); // front↔back, 45° = neutral hold
}
// warm the audio cache after first paint so the first click is snappy
const preloadWow = () => {
  wowWarm = new Audio(wowUrl);
  wowWarm.preload = "auto";
};
if ("requestIdleCallback" in window)
  requestIdleCallback(preloadWow, { timeout: 2500 });
else setTimeout(preloadWow, 1500);

// pause when the tab/window isn't visible — no CPU in the background
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelAnimationFrame(rafId);
  else if (!reduced) start();
});

if (reduced) {
  layout();
  render(INTRO, 0);
} else {
  start();
}
