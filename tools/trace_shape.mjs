// Liest assets-input/stamp-shape.webp und schreibt die Umrisslinie als
// normierte Punkte (0..1) nach src/stamp-shape.js + public/stamp.svg.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const { data, info } = await sharp('assets-input/stamp-shape.webp')
  .flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });

const W = info.width, H = info.height;
const v = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 255 : data[y * W + x];
const ISO = 128;

// Bounding Box der schwarzen Form
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (v(x, y) < ISO) {
  if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
}
console.log('Bild', W, H, 'Form', x0, y0, x1, y1);

// Marching Squares mit Subpixel-Interpolation. Startet an der Oberkante.
const interp = (a, b) => (ISO - a) / (b - a);
function edgePoint(cx, cy, e) {
  const tl = v(cx, cy), tr = v(cx + 1, cy), br = v(cx + 1, cy + 1), bl = v(cx, cy + 1);
  if (e === 0) return [cx + interp(tl, tr), cy];
  if (e === 1) return [cx + 1, cy + interp(tr, br)];
  if (e === 2) return [cx + interp(bl, br), cy + 1];
  return [cx, cy + interp(tl, bl)];
}
const EDGES = { 1: [3, 2], 2: [2, 1], 3: [3, 1], 4: [1, 0], 6: [2, 0], 7: [3, 0], 8: [0, 3], 9: [0, 2], 11: [0, 1], 12: [1, 3], 13: [1, 2], 14: [2, 3] };
const STEP = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const code = (cx, cy) =>
  (v(cx, cy + 1) < ISO ? 1 : 0) | (v(cx + 1, cy + 1) < ISO ? 2 : 0) | (v(cx + 1, cy) < ISO ? 4 : 0) | (v(cx, cy) < ISO ? 8 : 0);

let cx = x0 - 1, cy = -1;
for (let y = y0 - 1; y <= y1 && cy < 0; y++) {
  for (let x = x0 - 1; x <= x1; x++) { const c = code(x, y); if (c && c !== 15 && EDGES[c]) { cx = x; cy = y; break; } }
}
const pts = [];
const sx = cx, sy = cy;
let guard = 0;
do {
  const [, out] = EDGES[code(cx, cy)];
  pts.push(edgePoint(cx, cy, out));
  cx += STEP[out][0]; cy += STEP[out][1];
} while ((cx !== sx || cy !== sy) && ++guard < 200000);
console.log('Konturpunkte', pts.length);

// Ramer-Douglas-Peucker (geschlossen: an zwei fernen Punkten aufteilen)
function rdp(p, eps) {
  if (p.length < 3) return p;
  const [a, b] = [p[0], p[p.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  let max = 0, idx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs(dy * (p[i][0] - a[0]) - dx * (p[i][1] - a[1])) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return rdp(p.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(p.slice(idx), eps));
}
const half = pts.length >> 1;
const simple = rdp(pts.slice(0, half + 1), 0.45).slice(0, -1).concat(rdp(pts.slice(half).concat([pts[0]]), 0.45).slice(0, -1));
console.log('Vereinfacht', simple.length);

const sw = x1 + 1 - x0, sh = y1 + 1 - y0;
const norm = simple.map(([x, y]) => [+((x + 0.5 - x0) / sw).toFixed(5), +((y + 0.5 - y0) / sh).toFixed(5)]);

writeFileSync('src/stamp-shape.js',
  `// Automatisch erzeugt von tools/trace_shape.mjs – nicht von Hand ändern.\n` +
  `export const STAMP_ASPECT = ${(sw / sh).toFixed(5)}; // Breite / Höhe\n` +
  `export const STAMP_POINTS = ${JSON.stringify(norm)};\n`);

const d = 'M' + norm.map(([x, y]) => `${(x * sw).toFixed(1)} ${(y * sh).toFixed(1)}`).join('L') + 'Z';
writeFileSync('public/stamp.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw} ${sh}"><path d="${d}"/></svg>\n`);
console.log('Seitenverhältnis', (sw / sh).toFixed(4));
