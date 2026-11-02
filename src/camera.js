import { cropPhoto, cutStamp } from './stamp.js';
import { icons } from './icons.js';
import { tick } from './haptics.js';

// Testquelle für Geräte ohne Kamera: ?fakecam
function fakeStream() {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1920;
  const g = c.getContext('2d');
  const draw = () => {
    if (!c.isConnected && c.dead) return;
    const t = performance.now() / 1000;
    const grad = g.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, '#9a9a9a');
    grad.addColorStop(1, '#2a2a2a');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath();
    g.arc(540 + Math.sin(t) * 200, 900, 220, 0, 7);
    g.fill();
  };
  const id = setInterval(draw, 66);
  draw();
  const stream = c.captureStream(15);
  stream.getTracks()[0].addEventListener('ended', () => clearInterval(id));
  return stream;
}

async function getStream(facing) {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fakecam')) return fakeStream();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
}

/**
 * Öffnet die Kamera als Vollbild.
 * onShot(cut, shot) wird nach der Aufnahme aufgerufen, danach schließt sich die Kamera.
 * shot enthält das Foto als Rechteck, seine Lage im Sucher und finish() zum Ausblenden.
 */
export function openCamera({ facing = 'environment', onShot }) {
  const el = document.createElement('div');
  el.className = 'camera screen';
  el.innerHTML = `
    <div class="viewfinder">
      <div class="vf-shadow stamp-clip"></div>
      <div class="vf-frame stamp-clip"><video playsinline muted autoplay></video><div class="vf-flash"></div></div>
      <p class="vf-error" hidden></p>
    </div>
    <button class="round cam-close" aria-label="Fotomodus verlassen">${icons.close}</button>
    <div class="cam-bar">
      <span class="cam-side"></span>
      <button class="shutter" aria-label="Aufnehmen"><span></span></button>
      <button class="cam-side round" data-a="flip" aria-label="Kamera wechseln">${icons.flip}</button>
    </div>`;
  document.getElementById('app').append(el);

  const video = el.querySelector('video');
  const errorEl = el.querySelector('.vf-error');
  const shutter = el.querySelector('.shutter');
  let stream = null, busy = false, closed = false;

  async function start() {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    errorEl.hidden = true;
    shutter.disabled = true;
    try {
      const s = await getStream(facing);
      if (closed) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      video.srcObject = s;
      video.classList.toggle('mirror', facing === 'user');
      await video.play().catch(() => {});
      shutter.disabled = false;
    } catch (e) {
      errorEl.hidden = false;
      errorEl.textContent = e.name === 'NotAllowedError'
        ? 'MOTIF darf die Kamera noch nicht benutzen. Du kannst das in den Einstellungen des iPhones erlauben.'
        : 'Die Kamera ließ sich nicht starten.';
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    stream?.getTracks().forEach(t => t.stop());
    el.remove();
  }

  // Blendet die Kamera aus, die Stanz-Animation läuft darüber weiter
  async function finish() {
    await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.catch(() => {});
    close();
  }

  async function shoot() {
    if (busy || !video.videoWidth) return;
    busy = true;
    tick('medium');
    const frame = el.querySelector('.vf-frame').getBoundingClientRect();
    const mirror = facing === 'user';
    const photo = cropPhoto(video, video.videoWidth, video.videoHeight, mirror);
    const cut = await cutStamp(video, video.videoWidth, video.videoHeight, mirror);
    el.classList.add('shot');
    await onShot(cut, { frame, photo, finish });
    close();
  }

  shutter.addEventListener('click', shoot);
  el.querySelector('.cam-close').addEventListener('click', close);
  el.querySelector('[data-a=flip]').addEventListener('click', () => {
    facing = facing === 'user' ? 'environment' : 'user';
    start();
  });
  start();
  return { close, shoot };
}
