import cottonUrl from "./assets/cotton.webp";
import spiralUrl from "./assets/spiral.webp";
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
  PASTELS,
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
// light-theme vapour reads as soft white clouds (grey mist looked dirty on the
// pastel wash), with a faint warm tint
const vaporLight = makeVapor([
  [0, "rgba(255,255,255,0.85)"],
  [0.45, "rgba(252,244,255,0.4)"],
  [1, "rgba(250,240,255,0)"],
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

// drifting pastel background blobs (light/rainbow theme) — one soft sprite per
// Unicorn-palette colour, pre-rendered once, then a handful drift + pulse.
const blobSprites = PASTELS.map((col) => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  const r = parseInt(col.slice(1, 3), 16),
    gr = parseInt(col.slice(3, 5), 16),
    b = parseInt(col.slice(5, 7), 16);
  g.addColorStop(0, `rgba(${r},${gr},${b},0.5)`);
  g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  return cv;
});
const blobs = []; // {nx,ny,vx,vy,r,sprite,ph} in normalized 0..1 coords
for (let i = 0; i < 6; i++)
  blobs.push({
    nx: Math.random(),
    ny: Math.random(),
    vx: (Math.random() - 0.5) * 0.03, // slow drift, screens/sec
    vy: (Math.random() - 0.5) * 0.03,
    r: 0.42 + Math.random() * 0.5, // radius in units of G
    sprite: blobSprites[(Math.random() * blobSprites.length) | 0],
    ph: Math.random() * Math.PI * 2,
  });
const puffs = [];
const shards = []; // bright ice bits that sparkle off and fall away
let poke = null; // pending {x,y} tap — knocks flakes off the mark nearby
const trail = []; // recent pointer path {x,y,t} — fading draw-gesture affordance
let rainbow = false; // press R — recolour the ice with a swirling rainbow
// rapid repeated hits spin the gear: each combo hit adds spin velocity,
// which damps out — so a quick flurry whips it around 360°+ and settles.
let spin = 0,
  spinVel = 0,
  lastHit = -10,
  combo = 0;
let eruptStart = -100; // Konami code → whole mark erupts, then settles
let konamiAt = 0; // progress through the code
let rage = 0, // frantic smashing builds rage → screen shake → meltdown
  lastMelt = -10;
let unicornStart = -100; // Konami in rainbow mode → unicorn jumps the mark
const unicornImg = new Image();
unicornImg.src = unicornUrl;
// rainbow-mode shards render as these candies (cotton candy + spiral marshmallow)
const candyImgs = [new Image(), new Image()];
candyImgs[0].src = cottonUrl;
candyImgs[1].src = spiralUrl;
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
// Tunables below are `let` so the hidden settings panel (press S / pull-down
// gesture) can tweak them live; defaults are the shipped values.
let SWEEP = 14.0; // light-orbit seconds
const LIGHT_EL = 1.0; // light elevation from the view axis (rad)
let SHINE = 18; // specular tightness — higher = tighter glint
let BLOOM_TH = 0.5; // sparkle above this gets an additive halo
let MAX_SHARDS = coarse ? 90 : 160; // live flake cap (lower on touch)

// freeze cycle: the surface slowly degrades — magma veins grow up through
// the ice (driving steam + flaking) — then a fast sweep lays down fresh ice
// and quenches them. A cell is refreshed when the sweep front passes its
// `u`; the longer since, the higher the magma floods (see the draw loop).
let EV_PERIOD = 22; // full degrade → refresh cycle (s)
let EV_DUR = 4.5; // fast refresh sweep crossing time (s)
const EV_FIRST = 3; // grace after intro before the first cycle
let HEAT_DELAY = 2; // fresh ice stays cold this long after a refresh (s)
const EV_FLASH = 0.7; // crystallization sparkle as the fresh ice forms (s)
let MAGMA_R = 11; // pool radius (in cells) magma reaches by end of cycle
let MAGMA_EDGE = 4; // soft falloff width at a pool's edge (cells)
let MAGMA_SEEDS = 4; // how many pools per cycle
const VENT_R = 6; // radius (cells) of a hand-drilled (double-tap) vent
let UNICORN_DUR = 2.2; // seconds for the unicorn to arc across the screen
// fun-tier feel knobs (also panel-tweakable)
let SPIN_IMPULSE = 14; // yaw velocity added per rapid-hit
let SPIN_DAMP = 1.8; // spin decay rate
let RAGE_BUILD = 0.14; // rage gained per frantic tap
let RAGE_DECAY = 0.4; // rage cooled per second
let SHAKE_AMP = 34; // max screen-shake amplitude (px)
let PQ_MUL = 1; // extra vapour budget multiplier on top of the device PQ

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

  // smash rage cools when you stop; drives an escalating screen shake
  rage = Math.max(0, rage - dt * RAGE_DECAY);
  const shAmp = rage * rage * SHAKE_AMP;
  const shx = shAmp > 0.5 ? (Math.random() - 0.5) * shAmp : 0;
  const shy = shAmp > 0.5 ? (Math.random() - 0.5) * shAmp : 0;

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
  spinVel *= Math.exp(-dt * SPIN_DAMP);
  const spinTarget = Math.round(spin / (Math.PI * 2)) * (Math.PI * 2);
  if (Math.abs(spinVel) < 2) spinVel += (spinTarget - spin) * dt * 5;
  spin += spinVel * dt;
  if (Math.abs(spinVel) < 0.05 && Math.abs(spin - spinTarget) < 0.02) {
    spin = 0; // settled — reset to exact front (a multiple of 2π)
    spinVel = 0;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // light/rainbow theme: soft pastel blobs drift behind everything (drawn
  // before the shake translate so the background stays calm while the mark
  // shudders). The pale page bg shows through the gaps.
  if (rainbow) {
    for (const bl of blobs) {
      bl.nx += bl.vx * dt;
      bl.ny += bl.vy * dt;
      if (bl.nx < -0.3) bl.nx = 1.3;
      else if (bl.nx > 1.3) bl.nx = -0.3;
      if (bl.ny < -0.3) bl.ny = 1.3;
      else if (bl.ny > 1.3) bl.ny = -0.3;
      const rad = bl.r * G * (1 + 0.12 * Math.sin(t * 0.4 + bl.ph));
      ctx.drawImage(
        bl.sprite,
        bl.nx * vw - rad,
        bl.ny * vh - rad,
        rad * 2,
        rad * 2,
      );
    }
  }

  if (shAmp > 0.5) ctx.translate(shx, shy); // screen shake while smashing

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
    const want = 36 * PQ * PQ_MUL * dt; // puffs/sec (thinned on touch devices)
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
    const want = 90 * PQ * PQ_MUL * dt;
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
  if (!reduced && cov > 0.5 && shards.length < MAX_SHARDS) {
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
        pc: PASTELS[(Math.random() * PASTELS.length) | 0], // light-theme tint
        candy: (Math.random() * 2) | 0, // rainbow: which candy sprite
        spin: (Math.random() - 0.5) * 4, // tumble rate
      });
      if (shards.length >= MAX_SHARDS) break;
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
    const burst = Math.min(18, near.length);
    for (let m = 0; m < burst && shards.length < MAX_SHARDS; m++) {
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
        pc: PASTELS[(Math.random() * PASTELS.length) | 0], // light-theme tint
        candy: (Math.random() * 2) | 0,
        spin: (Math.random() - 0.5) * 4,
      });
    }
    poke = null;
  }

  ctx.font = `${fontSize * 0.72}px ui-monospace, Menlo, monospace`;
  if (!rainbow) ctx.fillStyle = "rgb(226,242,255)"; // bright ice on dark
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
    const candy = rainbow && candyImgs[s.candy];
    if (candy && candy.complete && candy.naturalWidth) {
      // rainbow theme: a tumbling cotton candy / spiral marshmallow
      const w = fontSize * 2.1;
      const h = (w * candy.naturalHeight) / candy.naturalWidth;
      ctx.globalAlpha = Math.min(1, 0.65 + 0.45 * twk);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.phase + t * s.spin);
      ctx.drawImage(candy, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      // dark theme (or sprite still loading): a twinkling crystal glyph
      ctx.globalAlpha = twk;
      if (rainbow) ctx.fillStyle = s.pc;
      ctx.fillText(s.glyph, s.x, s.y);
    }
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
      // rainbow ribbon trailing the leap: sample the arc behind the unicorn and
      // stroke fading rainbow stripes (drawn under the sprite)
      const RB = [
        "#ff5a5a",
        "#ff9e3b",
        "#ffe23b",
        "#46d65a",
        "#4a8cff",
        "#9b5bff",
      ];
      const s0 = Math.max(0, up - 0.5);
      const sw = Math.max(2, uh * 0.1);
      const tx = mix(-uw, vw + uw, s0);
      const ty = cy + G * 0.25 - G * 0.85 * Math.sin(s0 * Math.PI);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = sw + 1;
      for (let i = 0; i < RB.length; i++) {
        const off = (i - (RB.length - 1) / 2) * sw;
        const g = ctx.createLinearGradient(tx, ty, ux, uy);
        g.addColorStop(0, RB[i] + "00"); // transparent at the tail
        g.addColorStop(1, RB[i] + "aa"); // ~0.67 alpha behind the unicorn
        ctx.strokeStyle = g;
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) {
          const s = s0 + (up - s0) * (k / 16);
          const x = mix(-uw, vw + uw, s);
          const y = cy + G * 0.25 - G * 0.85 * Math.sin(s * Math.PI) + off;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(ux, uy);
      ctx.rotate(-Math.cos(up * Math.PI) * 0.25); // nose up rising, down falling
      ctx.drawImage(unicornImg, -uw / 2, -uh / 2, uw, uh);
      ctx.restore();
    }
  }

  // fading finger trail — hints that drawing does something (drag to draw a
  // circle for rainbow, swipe the Konami code). Points age out over ~0.5s.
  while (trail.length && t - trail[0].t > 0.5) trail.shift();
  if (trail.length > 1) {
    ctx.lineWidth = Math.max(2, G * 0.013);
    ctx.lineCap = "round";
    ctx.strokeStyle = rainbow ? "rgb(70,45,100)" : "rgb(226,242,255)";
    for (let i = 1; i < trail.length; i++) {
      const a = 1 - (t - trail[i].t) / 0.5;
      if (a <= 0) continue;
      ctx.globalAlpha = a * 0.4;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (shAmp > 0.5) ctx.translate(-shx, -shy); // undo shake → base transform
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

// Click anywhere → anime "wow" (meme easter egg). Decode the inlined mp3 once
// into an AudioBuffer and fire cheap overlapping BufferSource voices, so a fast
// mash layers full plays — no per-tap decode (the old jank) and no clipped
// restarts (the pool's flaw). Capped at WOW_MAX simultaneous voices.
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const WOW_MAX = 8;
let actx = null,
  wowBuf = null,
  wowVoices = 0;
if (AudioCtx) {
  actx = new AudioCtx();
  fetch(wowUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => actx.decodeAudioData(b))
    .then((buf) => (wowBuf = buf))
    .catch(() => {});
}
function playWow() {
  if (!actx || !wowBuf || wowVoices >= WOW_MAX) return;
  if (actx.state === "suspended") actx.resume(); // unlock on the user gesture
  const src = actx.createBufferSource();
  src.buffer = wowBuf;
  const g = actx.createGain();
  g.gain.value = 0.7;
  src.connect(g).connect(actx.destination);
  src.onended = () => wowVoices--;
  wowVoices++;
  src.start();
}
// resume the (autoplay-suspended) AudioContext on the first gesture — keydown
// counts, so going straight to R + Konami (no prior click) still gets the wow
function unlockAudio() {
  if (actx && actx.state === "suspended") actx.resume();
}

// --- shared easter-egg triggers (keyboard + touch gestures) ---
function toggleRainbow() {
  rainbow = !rainbow;
  document.body.style.background = rainbow ? LIGHT_BG : DARK_BG;
  if (reduced) render(INTRO, 0);
}
function fireKonami() {
  eruptStart = animT;
  if (rainbow) unicornStart = animT; // rainbow mode → a unicorn leaps over
  playWow(); // one "wow" punctuates the reveal (reuses the signature meme)
  if (reduced) render(INTRO, 0);
}

// keyboard: R = rainbow, classic Konami = erupt
const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
]; // prettier-ignore
window.addEventListener("keydown", (e) => {
  unlockAudio();
  if (e.key === "r" || e.key === "R") toggleRainbow();
  if (e.key === "s" || e.key === "S") togglePanel();
  if (e.key === "Escape" && panelEl) togglePanel();
  konamiAt =
    e.key === KONAMI[konamiAt] ? konamiAt + 1 : e.key === KONAMI[0] ? 1 : 0;
  if (konamiAt === KONAMI.length) {
    konamiAt = 0;
    fireKonami();
  }
});

// a plain tap: wow + flakes, rapid-tap spin combo, double-tap vent
function tap(x, y) {
  playWow();
  poke = { x, y }; // released as flakes next frame
  combo = animT - lastHit < 0.6 ? combo + 1 : 1;
  lastHit = animT;
  if (combo >= 3) spinVel += SPIN_IMPULSE;
  // smash tier: frantic tapping builds rage; at the top the mark overheats
  rage = Math.min(1, rage + RAGE_BUILD);
  if (rage >= 1 && animT - lastMelt > 3) {
    lastMelt = animT;
    eruptStart = animT; // meltdown — you poked the frozen mark until it melted
  }
  if (animT - lastTap < 0.32 && Math.hypot(x - lastTapX, y - lastTapY) < 40) {
    let best = (G * 0.3) ** 2,
      bc = null;
    for (const cell of cells) {
      const dx = cell.sx - x,
        dy = cell.sy - y,
        dd = dx * dx + dy * dy;
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
    lastTapX = x;
    lastTapY = y;
  }
}

// --- touch gestures: swipes spell the Konami code; a CW-then-CCW double loop
// toggles rainbow (the fading trail, drawn in render, hints at it) ---
const SWIPE = ["U", "U", "D", "D", "L", "R", "L", "R"];
let swipeIdx = 0,
  lastSwipe = -10;
let gdown = false,
  gx0 = 0,
  gy0 = 0;
const gpts = []; // current gesture path, for classification

// CW ~360° then CCW ~360° (or vice-versa) in one drag — a deliberate "rewind"
// loop. A single loop is too easy to fling off accidentally (the parallax tilt
// invites circular motion); requiring the reversal makes it intentional.
function isRewind(pts) {
  if (pts.length < 16) return false;
  let cx2 = 0,
    cy2 = 0;
  for (const p of pts) {
    cx2 += p[0];
    cy2 += p[1];
  }
  cx2 /= pts.length;
  cy2 /= pts.length;
  const F = Math.PI * 1.8; // ~324° counts as a full turn (tolerant)
  let sweep = 0,
    prev = Math.atan2(pts[0][1] - cy2, pts[0][0] - cx2);
  let hi = 0,
    lo = 0,
    minAfterHi = 0,
    maxAfterLo = 0;
  for (let i = 1; i < pts.length; i++) {
    const ang = Math.atan2(pts[i][1] - cy2, pts[i][0] - cx2);
    let d = ang - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    sweep += d;
    prev = ang;
    if (sweep > hi) ((hi = sweep), (minAfterHi = sweep));
    if (sweep < lo) ((lo = sweep), (maxAfterLo = sweep));
    if (sweep < minAfterHi) minAfterHi = sweep;
    if (sweep > maxAfterLo) maxAfterLo = sweep;
  }
  // a peak then a return (CW→CCW), or a trough then a return (CCW→CW)
  return (
    (hi >= F && hi - minAfterHi >= F) || (-lo >= F && maxAfterLo - lo >= F)
  );
}

// --- hidden settings panel (press S, or pull down from the top edge) ---
// Each tunable is a `let` above; the schema reads/writes it via closures so
// changes apply live. Compact single-line rows (label · slider · value).
const TUNABLES = [
  { l: "light orbit", s: 4, x: 30, st: 0.5, g: () => SWEEP, p: (v) => (SWEEP = v) },
  { l: "shine", s: 2, x: 40, st: 1, g: () => SHINE, p: (v) => (SHINE = v) },
  { l: "bloom", s: 0.1, x: 0.95, st: 0.05, g: () => BLOOM_TH, p: (v) => (BLOOM_TH = v) },
  { l: "cycle s", s: 6, x: 40, st: 1, g: () => EV_PERIOD, p: (v) => (EV_PERIOD = v) },
  { l: "sweep s", s: 1.5, x: 8, st: 0.5, g: () => EV_DUR, p: (v) => (EV_DUR = v) },
  { l: "cold s", s: 0, x: 6, st: 0.5, g: () => HEAT_DELAY, p: (v) => (HEAT_DELAY = v) },
  { l: "magma r", s: 3, x: 22, st: 1, g: () => MAGMA_R, p: (v) => (MAGMA_R = v) },
  { l: "magma edge", s: 1, x: 8, st: 0.5, g: () => MAGMA_EDGE, p: (v) => (MAGMA_EDGE = v) },
  { l: "seeds", s: 1, x: 10, st: 1, g: () => MAGMA_SEEDS, p: (v) => (MAGMA_SEEDS = v) },
  { l: "unicorn s", s: 1, x: 5, st: 0.1, g: () => UNICORN_DUR, p: (v) => (UNICORN_DUR = v) },
  { l: "spin", s: 4, x: 30, st: 1, g: () => SPIN_IMPULSE, p: (v) => (SPIN_IMPULSE = v) },
  { l: "spin damp", s: 0.5, x: 4, st: 0.1, g: () => SPIN_DAMP, p: (v) => (SPIN_DAMP = v) },
  { l: "rage +", s: 0.02, x: 0.4, st: 0.01, g: () => RAGE_BUILD, p: (v) => (RAGE_BUILD = v) },
  { l: "rage −", s: 0.1, x: 1.5, st: 0.05, g: () => RAGE_DECAY, p: (v) => (RAGE_DECAY = v) },
  { l: "shake", s: 0, x: 70, st: 2, g: () => SHAKE_AMP, p: (v) => (SHAKE_AMP = v) },
  { l: "flakes", s: 20, x: 320, st: 10, g: () => MAX_SHARDS, p: (v) => (MAX_SHARDS = v) },
  { l: "vapour", s: 0, x: 2, st: 0.1, g: () => PQ_MUL, p: (v) => (PQ_MUL = v) },
]; // prettier-ignore
let panelEl = null;
function buildPanel() {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed;top:8px;right:8px;z-index:50;width:230px;max-height:86vh;" +
    "overflow:auto;background:rgba(10,16,30,.92);color:#cfe0f5;font:11px/1.5 " +
    "ui-monospace,Menlo,monospace;padding:8px 10px;border:1px solid #2c3a57;" +
    "border-radius:8px;backdrop-filter:blur(4px);touch-action:auto;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.5)";
  const head = document.createElement("div");
  head.textContent = "tweak · tap to close";
  head.style.cssText =
    "opacity:.6;margin-bottom:6px;cursor:pointer;user-select:none";
  head.addEventListener("click", togglePanel);
  wrap.appendChild(head);
  const repaint = () => {
    if (reduced) render(INTRO, 0);
  };
  for (const tn of TUNABLES) {
    const dec = tn.st < 1 ? (String(tn.st).split(".")[1] || "").length : 0;
    const row = document.createElement("label");
    row.style.cssText = "display:flex;align-items:center;gap:6px;margin:2px 0";
    const name = document.createElement("span");
    name.textContent = tn.l;
    name.style.cssText = "flex:0 0 64px";
    const val = document.createElement("span");
    val.style.cssText = "flex:0 0 34px;text-align:right;color:#8fd0ff";
    const sl = document.createElement("input");
    sl.type = "range";
    sl.min = tn.s;
    sl.max = tn.x;
    sl.step = tn.st;
    sl.value = tn.g();
    sl.style.cssText = "flex:1;min-width:0;accent-color:#5a9cff";
    val.textContent = tn.g().toFixed(dec);
    sl.addEventListener("input", () => {
      const v = parseFloat(sl.value);
      tn.p(v);
      val.textContent = v.toFixed(dec);
      repaint();
    });
    row.append(name, sl, val);
    wrap.appendChild(row);
  }
  document.body.appendChild(wrap);
  return wrap;
}
function togglePanel() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  } else {
    panelEl = buildPanel();
  }
}

window.addEventListener(
  "pointerdown",
  (e) => {
    if (panelEl && panelEl.contains(e.target)) return; // let the sliders work
    e.preventDefault();
    unlockAudio();
    gdown = true;
    gx0 = e.clientX;
    gy0 = e.clientY;
    gpts.length = 0;
    gpts.push([e.clientX, e.clientY]);
    trail.push({ x: e.clientX, y: e.clientY, t: animT });
    // iOS gates deviceorientation behind a user-gesture permission prompt
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function")
      DOE.requestPermission()
        .then((s) => {
          if (s === "granted")
            window.addEventListener("deviceorientation", onTilt);
        })
        .catch(() => {});
  },
  { passive: false },
);

window.addEventListener(
  "pointermove",
  (e) => {
    if (panelEl && panelEl.contains(e.target)) return; // don't tilt while tweaking
    if (!reduced) {
      pnx = clamp((e.clientX / vw - 0.5) * 2, -1, 1); // gear leans toward pointer
      pny = clamp((e.clientY / vh - 0.5) * 2, -1, 1);
    }
    if (gdown) {
      e.preventDefault();
      gpts.push([e.clientX, e.clientY]);
      trail.push({ x: e.clientX, y: e.clientY, t: animT });
      if (trail.length > 160) trail.shift();
    }
  },
  { passive: false },
);

window.addEventListener("pointerup", (e) => {
  if (!gdown) return;
  gdown = false;
  const dx = e.clientX - gx0,
    dy = e.clientY - gy0,
    dist = Math.hypot(dx, dy);
  if (isRewind(gpts)) {
    toggleRainbow(); // CW+CCW loop → rainbow
  } else if (
    gy0 < 60 &&
    dy > Math.min(vw, vh) * 0.25 &&
    Math.abs(dy) > Math.abs(dx) * 1.5
  ) {
    togglePanel(); // pull down from the top edge → settings
  } else if (dist >= Math.min(vw, vh) * 0.08) {
    // a swipe → next Konami direction
    const dir =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U";
    if (animT - lastSwipe > 1.5) swipeIdx = 0; // timeout resets the sequence
    lastSwipe = animT;
    swipeIdx =
      dir === SWIPE[swipeIdx] ? swipeIdx + 1 : dir === SWIPE[0] ? 1 : 0;
    if (swipeIdx === SWIPE.length) {
      swipeIdx = 0;
      fireKonami();
    }
  } else {
    tap(e.clientX, e.clientY); // a tap
  }
});
window.addEventListener("pointercancel", () => {
  gdown = false;
});

// ease parallax back to centre when the cursor leaves the window
document.addEventListener("pointerleave", () => {
  if (!reduced) pnx = pny = 0;
});
// non-iOS browsers fire deviceorientation without a permission prompt
{
  const DOE = window.DeviceOrientationEvent;
  if (!reduced && DOE && typeof DOE.requestPermission !== "function")
    window.addEventListener("deviceorientation", onTilt);
}
function onTilt(e) {
  if (e.gamma == null) return;
  pnx = clamp(e.gamma / 35, -1, 1); // left↔right tilt
  pny = clamp((e.beta - 45) / 35, -1, 1); // front↔back, 45° = neutral hold
}
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
