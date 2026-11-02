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
    <div class="zoom-row" role="group" aria-label="Zoom"></div>
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

  /* ---------- Zoom: über die Kamera, wenn das Gerät es kann, sonst durch Ausschnitt ---------- */

  const DIGITAL_MAX = 5;
  const zoomRow = el.querySelector('.zoom-row');
  let track = null, hardware = false;
  let zoom = 1, zoomMin = 1, zoomMax = DIGITAL_MAX, presets = [];
  let applying = false, queued = null, glide = 0;
  const digitalZoom = () => (hardware ? 1 : zoom);

  function showVideoZoom() {
    const k = digitalZoom();
    video.style.transform = `scale(${facing === 'user' ? -k : k},${k})`;
  }

  async function sendZoom(value) {
    if (applying) { queued = value; return; }
    applying = true;
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
    } catch {
      // Das Gerät nennt Zoom, setzt ihn aber nicht um: auf Ausschnitt wechseln
      hardware = false;
      zoomMin = 1;
      zoomMax = DIGITAL_MAX;
      zoom = Math.max(1, zoom);
      buildPresets();
      showVideoZoom();
    }
    applying = false;
    if (queued != null && hardware) { const next = queued; queued = null; sendZoom(next); }
  }

  function setZoom(value) {
    zoom = Math.min(zoomMax, Math.max(zoomMin, value));
    if (hardware) sendZoom(zoom); else showVideoZoom();
    paintZoom();
  }

  function paintZoom() {
    // Der nächstliegende Knopf zeigt den genauen Wert, wie in der iPhone-Kamera
    let active = presets[0];
    for (const p of presets) if (zoom >= p - 0.001) active = p;
    const label = v => `${String(+v.toFixed(1)).replace('.', ',')}×`;
    for (const b of zoomRow.children) {
      const p = +b.dataset.z;
      const on = p === active;
      b.classList.toggle('on', on);
      b.textContent = on ? label(zoom) : label(p);
    }
  }

  function buildPresets() {
    presets = [zoomMin < 1 ? zoomMin : null, 1, 2, zoomMax >= 5 ? 5 : null].filter(v => v != null);
    zoomRow.innerHTML = '';
    for (const p of presets) {
      const b = document.createElement('button');
      b.dataset.z = p;
      b.addEventListener('click', () => glideTo(p));
      zoomRow.append(b);
    }
    paintZoom();
  }

  // Weicher Übergang beim Tippen auf einen Zoom-Knopf
  function glideTo(target) {
    cancelAnimationFrame(glide);
    tick();
    const from = zoom, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 220);
      setZoom(from + (target - from) * (1 - (1 - k) ** 3));
      if (k < 1) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }

  function setupZoom() {
    track = stream.getVideoTracks()[0];
    const range = track.getCapabilities?.().zoom;
    hardware = !!range && range.max > range.min;
    zoomMin = hardware ? range.min : 1;
    zoomMax = hardware ? Math.min(range.max, 10) : DIGITAL_MAX;
    zoom = hardware ? (track.getSettings().zoom ?? Math.max(1, zoomMin)) : 1;
    buildPresets();
    showVideoZoom();
  }

  // Zwei Finger im Sucher
  const fingers = new Map();
  let pinchDist = 0, pinchZoom = 1;
  const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const viewfinder = el.querySelector('.viewfinder');
  viewfinder.addEventListener('pointerdown', e => {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { viewfinder.setPointerCapture(e.pointerId); } catch {}
    if (fingers.size === 2) {
      cancelAnimationFrame(glide);
      pinchDist = spread();
      pinchZoom = zoom;
    }
  });
  viewfinder.addEventListener('pointermove', e => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2 && pinchDist > 0) setZoom(pinchZoom * spread() / pinchDist);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    viewfinder.addEventListener(type, e => fingers.delete(e.pointerId));
  }
  // Safari würde sonst die ganze Seite zoomen
  el.addEventListener('gesturestart', e => e.preventDefault());

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
      setupZoom();
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
    const k = digitalZoom();
    const photo = cropPhoto(video, video.videoWidth, video.videoHeight, mirror, k);
    const cut = await cutStamp(video, video.videoWidth, video.videoHeight, mirror, k);
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
