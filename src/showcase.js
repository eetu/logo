// The projects running on invinite.tech, shown with the frozen mark: ice shards
// orbiting it, and the same links as a frosted list below. Both are real <a>
// elements, so crawlers, screen readers and the keyboard get them too; the list
// is the accessible one, the shards are decoration over the same links.
//
// The list comes from /projects.json, which the invinite.tech platform builds
// from every project that opts in (a `showcase:` block) and mounts into this
// container. Anywhere else the file is missing and the page is just the mark.
//
// DOM only: the canvas render loop never learns about it. The orbit is an
// ellipse fitted to the screen — wide on a desktop, tall on a phone held
// upright — so the shards clear the mark and stay on screen at any size.

const GLYPHS = ["❆", "❅", "✦", "✳", "❄"];
const FROST = ["·", "+", "*", "◦", "❅", "✦"];
const PERIOD = 150; // seconds per lap
const MARGIN = 34; // px kept between a shard and the screen edge
const LABEL_H = 22; // px a name needs above or below its shard
const LABEL_W = 130; // px a name needs beside its shard

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Letters "freeze" in: each position cycles frost glyphs, then settles. */
function frostIn(el, text, delay = 0) {
  if (reduced) {
    el.textContent = text;
    return;
  }
  const chars = [...text];
  const settleAt = chars.map((c) => (c === " " ? 0 : 6 + Math.random() * 14));
  let step = 0;
  el.textContent = chars.map((c) => (c === " " ? " " : "")).join("");
  setTimeout(function tick() {
    step++;
    el.textContent = chars
      .map((c, i) =>
        step >= settleAt[i] ? c : FROST[(Math.random() * FROST.length) | 0],
      )
      .join("");
    if (step < 21) setTimeout(tick, 45);
  }, delay);
}

function build(projects) {
  // A shard and its list entry light up together, so the two read as one link.
  // On touch there is no hover: the first tap on a shard shows its name and
  // lights its entry, the second tap opens it. The name fades after a while.
  let active = -1;
  let fade = 0;
  const entries = [];
  const shards = [];
  function light(i, on) {
    shards[i].a.classList.toggle("lit", on);
    entries[i].classList.toggle("lit", on);
  }
  function activate(i) {
    if (active >= 0 && active !== i) light(active, false);
    active = i;
    light(i, true);
    frostIn(shards[i].label, projects[i].title);
    clearTimeout(fade);
    fade = setTimeout(() => {
      light(i, false);
      active = -1;
    }, 4000);
  }

  // --- the list: the accessible, crawlable links ----------------------------
  const nav = document.createElement("nav");
  nav.className = "projects";
  nav.dataset.ui = "";
  nav.setAttribute("aria-label", "Projects on invinite.tech");
  const ul = document.createElement("ul");
  projects.forEach((p, i) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = p.url;
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = p.title;
    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = p.description;
    a.append(title, desc);
    a.addEventListener("focus", () => {
      frostIn(title, p.title);
      light(i, true);
    });
    a.addEventListener("blur", () => light(i, false));
    a.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") light(i, true);
    });
    a.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") light(i, false);
    });
    li.append(a);
    ul.append(li);
    entries.push(a);
    // after the mark has frosted in (main.js INTRO ≈ 3.2 s)
    frostIn(title, p.title, 3400 + i * 250);
  });
  nav.append(ul);

  // --- the orbit: one shard per project, evenly spaced ----------------------
  const orbit = document.createElement("div");
  orbit.className = "orbit";
  orbit.dataset.ui = "";
  orbit.setAttribute("aria-hidden", "true"); // the list carries the links
  let held = 0; // shards under a mouse — the orbit stops while any is
  projects.forEach((p, i) => {
    const a = document.createElement("a");
    a.className = "shard";
    a.href = p.url;
    a.tabIndex = -1;
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.style.animationDelay = `${-((i * 1.7) % 5)}s`;
    glyph.textContent = GLYPHS[i % GLYPHS.length];
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = p.title;
    a.append(glyph, label);
    a.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      held++;
      light(i, true);
      frostIn(label, p.title);
    });
    a.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      held = Math.max(0, held - 1);
      light(i, false);
    });
    // Remembered from pointerdown: not every browser gives click a pointerType.
    let via = "mouse";
    a.addEventListener("pointerdown", (e) => (via = e.pointerType));
    a.addEventListener("click", (e) => {
      // a mouse click follows the link at once; a touch first says where to
      if (via === "mouse" || active === i) return;
      e.preventDefault();
      activate(i);
    });
    orbit.append(a);
    // start at the top, then clockwise
    shards.push({
      a,
      label,
      base: (Math.PI * 2 * i) / projects.length - Math.PI / 2,
    });
  });

  document.body.append(orbit, nav);

  // Ellipse from the mark's size (main.js: G = 0.62 × the shorter side) and the
  // room left on screen. A shard and its name must never run off the screen or
  // into the list — the list sits along the bottom, or down the right side on a
  // short landscape screen — so those limits win over clearing the mark.
  let cx, cy, rx, ry, vw, edge; // edge: x where a name beside a shard must stop
  function fit() {
    vw = window.innerWidth;
    const vh = window.innerHeight;
    const g = Math.min(vw, vh) * 0.62;
    // Many projects with descriptions make a tall list, which would push up
    // into the mark; past a quarter of the screen it drops to titles only.
    nav.classList.remove("compact");
    if (nav.getBoundingClientRect().height > vh * 0.25)
      nav.classList.add("compact");
    const list = nav.getBoundingClientRect();
    cx = vw / 2;
    cy = vh / 2;
    const listAtSide = list.left > cx;
    const bottom = listAtSide ? vh : list.top;
    const right = listAtSide ? list.left : vw;
    ry = Math.min(
      g * 0.8,
      cy - MARGIN - LABEL_H,
      bottom - cy - MARGIN - LABEL_H,
    );
    rx = Math.min(g * 0.9, cx - MARGIN, right - cx - MARGIN);
    edge = right;
  }
  fit();
  window.addEventListener("resize", fit);

  let phase = 0;
  let last = performance.now();
  function place(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // held still under a mouse, and while a tapped shard waits for its
    // second tap, so the target does not slide away
    if (!held && active < 0 && !reduced) phase += (dt * Math.PI * 2) / PERIOD;
    for (const s of shards) {
      const t = s.base + phase;
      const x = cx + rx * Math.cos(t);
      const y = cy + ry * Math.sin(t);
      s.a.style.transform = `translate(${x}px, ${y}px)`;
      // The name goes on the side away from the mark: above a shard at the top,
      // below one at the bottom, outwards at the sides when the screen has room
      // for it there, and below otherwise.
      const c = Math.cos(t);
      const outward = c > 0 ? edge - x : x;
      const side =
        Math.abs(c) > 0.75 && outward > LABEL_W
          ? c > 0
            ? "right"
            : "left"
          : Math.sin(t) < 0
            ? "above"
            : "below";
      s.label.dataset.side = side;
      // A centred name above or below a shard near the edge would be cut off:
      // slide it back inside the screen.
      let shift = 0;
      if (side === "above" || side === "below") {
        const half = s.label.offsetWidth / 2;
        shift = Math.max(0, 8 + half - x) + Math.min(0, vw - 8 - half - x);
      }
      s.label.style.translate =
        side === "above" || side === "below" ? `${shift}px 0` : "";
    }
    if (!reduced) requestAnimationFrame(place);
  }
  requestAnimationFrame(place);
}

fetch("/projects.json", { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    const projects =
      (data && Array.isArray(data.projects) && data.projects) || [];
    if (projects.length) build(projects);
  })
  .catch(() => {});
