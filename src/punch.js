import { stampPath } from './stamp.js';
import { tick } from './haptics.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const place = (el, x, y, w, h) => Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });

// Fotoabzug mit weißem Rand. Die schwarze Stanze schlägt zu, die Marke bleibt liegen,
// der Rest des Abzugs fällt nach unten weg. Liefert die freie Marke an Ort und Stelle.
export async function punchOut(frame, photo, full) {
  const m = Math.round(frame.width * 0.055);
  const W = frame.width + 2 * m, H = frame.height + 2 * m;
  const d = Math.min(3, devicePixelRatio || 1);

  const sheet = document.createElement('canvas');
  sheet.className = 'punch-sheet';
  sheet.width = W * d; sheet.height = H * d;
  place(sheet, frame.left - m, frame.top - m, W, H);
  const g = sheet.getContext('2d');
  g.scale(d, d);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.drawImage(photo, m, m, frame.width, frame.height);
  g.strokeStyle = '#000';
  g.lineWidth = 2;
  g.strokeRect(1, 1, W - 2, H - 2);

  const img = new Image();
  img.className = 'punch-stamp';
  img.src = URL.createObjectURL(full);
  await img.decode().catch(() => {});
  place(img, frame.left, frame.top, frame.width, frame.height);
  img.style.visibility = 'hidden';

  const die = document.createElement('div');
  die.className = 'punch-die stamp-clip';
  place(die, frame.left, frame.top, frame.width, frame.height);
  document.body.append(sheet, img, die);

  sheet.animate([{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 140, easing: 'ease-out' });
  await sleep(300);

  await die.animate(
    [{ transform: 'scale(1.22)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 150, easing: 'cubic-bezier(.6,0,1,.6)', fill: 'forwards' }).finished.catch(() => {});

  // Aufprall: Form aus dem Abzug lösen
  tick('medium');
  g.save();
  g.setTransform(frame.width * d, 0, 0, frame.height * d, m * d, m * d);
  g.globalCompositeOperation = 'destination-out';
  g.fill(stampPath);
  g.restore();
  img.style.visibility = 'visible';
  sheet.animate([{ transform: 'none' }, { transform: 'translateY(5px)' }, { transform: 'none' }], { duration: 120 });
  await sleep(90);

  die.animate(
    [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.14)', opacity: 0 }],
    { duration: 170, easing: 'ease-out', fill: 'forwards' }).finished.then(() => die.remove(), () => die.remove());
  img.animate([{ transform: 'none' }, { transform: 'scale(1.035)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
  const fall = sheet.animate(
    [{ transform: 'none' }, { transform: `translate(14px,${innerHeight - frame.top + 40}px) rotate(7deg)` }],
    { duration: 460, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'forwards' });
  fall.finished.then(() => sheet.remove(), () => sheet.remove());
  await sleep(300);
  return img;
}

// Die Marke fliegt auf ihren Platz im Album und wird dort festgedrückt
export async function pinToAlbum(img, frame, to, onImpact) {
  const k = to.width / frame.width;
  const dx = to.left - frame.left, dy = to.top - frame.top;
  const at = (x, y, s, r = 0) => `translate(${x}px,${y}px) scale(${s}) rotate(${r}deg)`;
  img.style.transformOrigin = '0 0';
  await img.animate([
    { transform: at(0, 0, 1) },
    { transform: at(dx * 0.55, dy * 0.45 - 26, k * 2.1, -5), offset: 0.55 },
    { transform: at(dx, dy, k * 1.32, -2) },
  ], { duration: 460, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'forwards' }).finished.catch(() => {});

  // Festdrücken
  const cx = to.width * 0.16, cy = to.height * 0.16;
  await img.animate([
    { transform: at(dx, dy, k * 1.32, -2) },
    { transform: at(dx + cx * 0.08, dy + cy * 0.08, k * 0.92), offset: 0.55 },
    { transform: at(dx, dy, k) },
  ], { duration: 190, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
  tick('medium');
  await onImpact();
  URL.revokeObjectURL(img.src);
  img.remove();
}
