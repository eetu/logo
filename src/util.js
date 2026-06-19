// Pure math + colour helpers and the ice/heat palettes.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerpRGB = (a, b, t) => [
  Math.round(mix(a[0], b[0], t)),
  Math.round(mix(a[1], b[1], t)),
  Math.round(mix(a[2], b[2], t)),
];

// palette stops (steel → ice → bright), interpolated by a 0..1 lightness
const DEEP = [46, 78, 130];
const ICE = [150, 200, 240];
const BRIGHT = [232, 246, 255];
export const iceColor = (p) =>
  p < 0.5 ? lerpRGB(DEEP, ICE, p * 2) : lerpRGB(ICE, BRIGHT, (p - 0.5) * 2);

// molten palette (dark blood → red → bright red-orange) shown through the
// crust where the magma bleeds up. Kept red — never reaches yellow.
const HEAT_LO = [70, 6, 4];
const HEAT_MID = [180, 22, 12];
const HEAT_HI = [255, 66, 30];
export const heatColor = (p) =>
  p < 0.5
    ? lerpRGB(HEAT_LO, HEAT_MID, p * 2)
    : lerpRGB(HEAT_MID, HEAT_HI, (p - 0.5) * 2);

// rainbow easter egg (press R): light theme + pastel hue ramp
export const DARK_BG =
  "radial-gradient(120% 120% at 50% 40%, #0d1426 0%, #080d1a 55%, #05080f 100%)";
export const LIGHT_BG =
  "radial-gradient(120% 120% at 50% 40%, #dcefff 0%, #c4e2fb 55%, #aed4f5 100%)";
const hue2 = (p, q, t) => {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
};
export const hslColor = (h, s, l) => {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2(p, q, h + 1 / 3) * 255),
    Math.round(hue2(p, q, h) * 255),
    Math.round(hue2(p, q, h - 1 / 3) * 255),
  ];
};
