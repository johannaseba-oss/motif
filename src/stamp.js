import { STAMP_ASPECT, STAMP_POINTS } from './stamp-shape.js';

export { STAMP_ASPECT };
export const FULL_W = 900;
export const THUMB_W = 320;

// Form in Einheitskoordinaten 0..1
export const stampPath = new Path2D();
STAMP_POINTS.forEach(([x, y], i) => (i ? stampPath.lineTo(x, y) : stampPath.moveTo(x, y)));
stampPath.closePath();

export const clipPathCss = 'polygon(' + STAMP_POINTS.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(',') + ')';

function toBlob(canvas) {
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

function drawCover(g, source, srcW, srcH, W, H, mirror, zoom = 1) {
  let sw = srcW, sh = srcH;
  if (srcW / srcH > STAMP_ASPECT) sw = srcH * STAMP_ASPECT; else sh = srcW / STAMP_ASPECT;
  sw /= zoom;
  sh /= zoom;
  if (mirror) { g.translate(W, 0); g.scale(-1, 1); }
  g.drawImage(source, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, 0, 0, W, H);
}

// Das ganze Foto im Markenformat, noch ohne ausgestanzte Form
export function cropPhoto(source, srcW, srcH, mirror = false, zoom = 1) {
  const c = document.createElement('canvas');
  c.width = FULL_W; c.height = Math.round(FULL_W / STAMP_ASPECT);
  drawCover(c.getContext('2d'), source, srcW, srcH, c.width, c.height, mirror, zoom);
  return c;
}

// Schneidet eine Quelle (Video, Bild, Canvas) mittig auf das Markenformat zu.
// Außerhalb der Form bleibt das gespeicherte PNG durchsichtig.
export async function cutStamp(source, srcW, srcH, mirror = false, zoom = 1) {
  const W = FULL_W, H = Math.round(FULL_W / STAMP_ASPECT);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.save();
  g.scale(W, H);
  g.clip(stampPath);
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawCover(g, source, srcW, srcH, W, H, mirror, zoom);
  g.restore();

  const t = document.createElement('canvas');
  t.width = THUMB_W; t.height = Math.round(THUMB_W / STAMP_ASPECT);
  const tg = t.getContext('2d');
  tg.imageSmoothingQuality = 'high';
  tg.drawImage(c, 0, 0, t.width, t.height);
  return { full: await toBlob(c), thumb: await toBlob(t) };
}
