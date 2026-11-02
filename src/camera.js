import { cutStamp } from './stamp.js';
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
 * onShot(cut, screen) wird nach jeder Aufnahme aufgerufen; gibt es true zurück,
 * schließt sich die Kamera (Profilbild), sonst geht es direkt weiter.
 */
export function openCamera({ facing = 'environment', onShot, onClose, leftThumb, leftLabel = 'Zum Album' }) {
  const el = document.createElement('div');
  el.className = 'camera screen';
  el.innerHTML = `
    <div class="viewfinder">
      <div class="vf-shadow stamp-clip"></div>
      <div class="vf-frame stamp-clip"><video playsinline muted autoplay></video><div class="vf-flash"></div></div>
      <p class="vf-error" hidden></p>
    </div>
    <div class="cam-bar">
      <button class="cam-side cam-back" aria-label="${leftLabel}"></button>
      <button class="shutter" aria-label="Aufnehmen"><span></span></button>
      <button class="cam-side round" data-a="flip" aria-label="Kamera wechseln">${icons.flip}</button>
    </div>`;
  document.getElementById('app').append(el);

  const video = el.querySelector('video');
  const errorEl = el.querySelector('.vf-error');
  const back = el.querySelector('.cam-back');
  const shutter = el.querySelector('.shutter');
  let stream = null, busy = false, closed = false;

  const setBack = url => {
    back.innerHTML = url ? `<img src="${url}" alt="">` : icons.close;
    back.classList.toggle('round', !url);
  };
  setBack(leftThumb || null);

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
    onClose?.();
  }

  async function shoot() {
    if (busy || !video.videoWidth) return;
    busy = true;
    tick('medium');
    const flash = el.querySelector('.vf-flash');
    flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    const cut = await cutStamp(video, video.videoWidth, video.videoHeight, facing === 'user');
    const finished = await onShot(cut, { flyTo: flyTo(cut), setBack });
    busy = false;
    if (finished) close();
  }

  // Die frische Marke fliegt klein zum Album-Knopf
  function flyTo(cut) {
    return () => {
      const from = el.querySelector('.vf-frame').getBoundingClientRect();
      const to = back.getBoundingClientRect();
      const img = new Image();
      img.src = URL.createObjectURL(cut.thumb);
      img.className = 'fly';
      Object.assign(img.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
      el.append(img);
      const s = to.height / from.height;
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const anim = img.animate([
        { transform: 'none' },
        { transform: `translate(${dx}px,${dy}px) scale(${s}) rotate(-6deg)` },
      ], { duration: 420, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
      anim.onfinish = () => { img.remove(); URL.revokeObjectURL(img.src); };
    };
  }

  shutter.addEventListener('click', shoot);
  back.addEventListener('click', close);
  el.querySelector('[data-a=flip]').addEventListener('click', () => {
    facing = facing === 'user' ? 'environment' : 'user';
    start();
  });
  start();
  return { close, shoot };
}
