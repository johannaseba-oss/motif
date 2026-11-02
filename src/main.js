import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/900.css';
import './style.css';
import * as store from './store.js';
import { clipPathCss, cutStamp } from './stamp.js';
import { Album } from './album.js';
import { openCamera } from './camera.js';
import { icons } from './icons.js';
import { tick } from './haptics.js';

const app = document.getElementById('app');
document.documentElement.style.setProperty('--stamp-clip', clipPathCss);

let profile = null;
let album = null;
let avatarUrl = null;

const fmtDate = t => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const markenText = n => `${n} ${n === 1 ? 'Marke' : 'Marken'}`;

function setAvatarUrl() {
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = profile?.avatar ? URL.createObjectURL(profile.avatar) : null;
}

function avatarHtml() {
  return avatarUrl
    ? `<img src="${avatarUrl}" alt="">`
    : `<span class="avatar-empty stamp-clip">${icons.person}</span>`;
}

/* ---------- Profil anlegen und bearbeiten ---------- */

function profileForm({ first }) {
  const el = document.createElement('div');
  el.className = 'profile screen' + (first ? ' first' : '');
  let draftAvatar = profile?.avatar || null;
  let draftUrl = draftAvatar ? URL.createObjectURL(draftAvatar) : null;
  const pages = store.usedPages();
  el.innerHTML = `
    <div class="profile-head">
      <h1>${first ? 'MOTIF' : 'Profil'}</h1>
      ${first ? '' : `<button class="round" data-a="close" aria-label="Schließen">${icons.close}</button>`}
    </div>
    ${first ? '<p class="lead">Dein Album für Fotos, die zu Briefmarken werden.</p>' : ''}
    <button class="avatar-pick" data-a="photo" aria-label="Profilfoto aufnehmen"></button>
    <p class="avatar-hint">${first ? 'Profilfoto aufnehmen (optional)' : 'Tippen für ein neues Foto'}</p>
    <label class="field">
      <span>Name</span>
      <input name="name" autocomplete="name" maxlength="30" placeholder="Wie heißt du?" value="">
    </label>
    ${first ? '' : `<div class="stats"><div><b>${store.stamps.length}</b><span>${store.stamps.length === 1 ? 'Marke' : 'Marken'}</span></div><div><b>${pages}</b><span>${pages === 1 ? 'Seite' : 'Seiten'}</span></div><div class="since"><b>${fmtDate(profile.createdAt)}</b><span>dabei seit</span></div></div>`}
    <button class="pill primary" data-a="save">${first ? 'Album öffnen' : 'Speichern'}</button>`;
  app.append(el);

  const input = el.querySelector('input');
  input.value = profile?.name || '';
  const pick = el.querySelector('.avatar-pick');
  const save = el.querySelector('[data-a=save]');
  const paint = () => {
    pick.innerHTML = draftUrl ? `<img src="${draftUrl}" alt="">` : `<span class="avatar-empty stamp-clip">${icons.person}</span>`;
    save.disabled = !input.value.trim();
  };
  paint();
  input.addEventListener('input', paint);

  pick.addEventListener('click', () => {
    openCamera({
      facing: 'user',
      leftLabel: 'Abbrechen',
      onShot: async cut => {
        draftAvatar = cut.thumb;
        if (draftUrl) URL.revokeObjectURL(draftUrl);
        draftUrl = URL.createObjectURL(draftAvatar);
        paint();
        return true;
      },
    });
  });

  const close = () => { if (draftUrl) URL.revokeObjectURL(draftUrl); el.remove(); };
  el.querySelector('[data-a=close]')?.addEventListener('click', close);
  el.querySelector('form')?.addEventListener('submit', e => e.preventDefault());
  save.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) return;
    profile = { name, avatar: draftAvatar, createdAt: profile?.createdAt || Date.now() };
    await store.saveProfile(profile);
    setAvatarUrl();
    close();
    showAlbum();
  });
  if (first) setTimeout(() => input.focus(), 50);
}

/* ---------- Album ---------- */

function showAlbum() {
  app.querySelector('.home')?.remove();
  const el = document.createElement('div');
  el.className = 'home screen';
  el.innerHTML = `
    <header class="top">
      <h1>MOTIF</h1>
      <button class="profile-btn" aria-label="Profil von ${escapeHtml(profile.name)}">${avatarHtml()}</button>
    </header>
    <main class="stage"></main>
    <footer class="bottom">
      <button class="pill primary shoot">${icons.camera}<span>Aufnehmen</span></button>
    </footer>`;
  app.prepend(el);
  album = new Album(el.querySelector('.stage'), { onOpen: openDetail });
  el.querySelector('.profile-btn').addEventListener('click', () => profileForm({ first: false }));
  el.querySelector('.shoot').addEventListener('click', showCamera);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- Kamera ---------- */

function lastThumbUrl() {
  const last = store.stamps.reduce((a, b) => (!a || b.createdAt > a.createdAt ? b : a), null);
  return last ? album.images.get(last.id)?.src || URL.createObjectURL(last.thumb) : null;
}

function showCamera() {
  let newest = null;
  openCamera({
    leftThumb: lastThumbUrl(),
    onShot: async (cut, screen) => {
      newest = await store.addStamp(cut);
      screen.flyTo();
      album.preload();
      setTimeout(() => screen.setBack(URL.createObjectURL(newest.thumb)), 380);
      return false;
    },
    onClose: () => {
      if (newest) album.goToSlot(newest.slot);
      else album.render();
    },
  });
}

/* ---------- Große Ansicht ---------- */

async function openDetail(stamp, from) {
  const el = document.createElement('div');
  el.className = 'detail screen';
  el.innerHTML = `
    <div class="detail-bg"></div>
    <div class="detail-stamp"><img alt=""></div>
    <div class="detail-info">
      <div>
        <b>${fmtDate(stamp.createdAt)}</b>
        <span>Seite ${Math.floor(stamp.slot / store.PER_PAGE) + 1}</span>
      </div>
      <button class="round" data-a="delete" aria-label="Marke löschen">${icons.trash}</button>
    </div>
    <button class="round detail-close" aria-label="Schließen">${icons.close}</button>`;
  app.append(el);

  const img = el.querySelector('img');
  const wrap = el.querySelector('.detail-stamp');
  img.src = album.images.get(stamp.id)?.src || URL.createObjectURL(stamp.thumb);
  let fullUrl = null;
  store.getFull(stamp.id).then(b => {
    if (!b || !el.isConnected) return;
    fullUrl = URL.createObjectURL(b);
    const hi = new Image();
    hi.onload = () => { if (el.isConnected) img.src = fullUrl; };
    hi.src = fullUrl;
  });

  const zoomFrames = () => {
    const to = wrap.getBoundingClientRect();
    if (!from) return [{ transform: 'scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }];
    const k = from.width / to.width;
    return [
      { transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${k})` },
      { transform: 'none' },
    ];
  };
  wrap.style.transformOrigin = '0 0';
  wrap.animate(zoomFrames(), { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  el.animate([{ backgroundColor: 'rgba(255,255,255,0)' }, { backgroundColor: 'rgba(255,255,255,1)' }], { duration: 220 });

  // Der Klick zum Antippen im Album landet sonst sofort auf dieser Ansicht
  const openedAt = performance.now();
  const tooSoon = () => performance.now() - openedAt < 400;

  let closing = false;
  const close = async () => {
    if (closing || tooSoon()) return;
    closing = true;
    from = album.cellClientRect(stamp.slot) || from;
    const a = wrap.animate(zoomFrames().reverse(), { duration: 220, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    el.classList.add('leaving');
    await a.finished.catch(() => {});
    if (fullUrl) URL.revokeObjectURL(fullUrl);
    el.remove();
  };

  el.querySelector('.detail-close').addEventListener('click', close);
  el.querySelector('.detail-bg').addEventListener('click', close);
  wrap.addEventListener('click', close);

  const del = el.querySelector('[data-a=delete]');
  let armed = false;
  del.addEventListener('click', async () => {
    if (tooSoon()) return;
    if (!armed) {
      armed = true;
      tick();
      del.classList.add('armed');
      del.innerHTML = 'Wirklich löschen?';
      setTimeout(() => {
        if (!del.isConnected) return;
        armed = false;
        del.classList.remove('armed');
        del.innerHTML = icons.trash;
      }, 3000);
      return;
    }
    await store.deleteStamp(stamp);
    album.forget(stamp.id);
    album.clampCur();
    album.render();
    if (fullUrl) URL.revokeObjectURL(fullUrl);
    el.remove();
  });
}

/* ---------- Start ---------- */

// Testdaten nur im Dev-Server: ?seed=40
async function devSeed(n) {
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 1200;
    const g = c.getContext('2d');
    const light = 45 + (i * 17) % 35;
    const grad = g.createLinearGradient(0, 0, 900, 1200);
    grad.addColorStop(0, `hsl(0 0% ${light}%)`);
    grad.addColorStop(1, `hsl(0 0% ${light - 30}%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#fff';
    g.font = '900 360px sans-serif';
    g.textAlign = 'center';
    g.fillText(String(i + 1), 450, 730);
    await store.addStamp({ ...(await cutStamp(c, 900, 1200)), createdAt: Date.now() - (n - i) * 86400000 });
  }
}

async function boot() {
  await store.open();
  profile = await store.getProfile();
  setAvatarUrl();
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search);
    if (q.has('seed') && !store.stamps.length) await devSeed(+q.get('seed') || 40);
    window.__perfo = { store, get album() { return album; } };
  }
  await document.fonts?.ready;
  if (profile) showAlbum();
  else profileForm({ first: true });
  album?.layout();
}

boot();
