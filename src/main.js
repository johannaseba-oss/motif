import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/900.css';
import './style.css';
import * as store from './store.js';
import { clipPathCss, cutStamp } from './stamp.js';
import { Album } from './album.js';
import { openCamera } from './camera.js';
import { punchOut, pinToAlbum } from './punch.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as cloud from './cloud.js';
import * as social from './profile-page.js';
import { icons } from './icons.js';
import { tick } from './haptics.js';
import { COVER_COLORS, THEME_ALBUM, themeOf } from './themes.js';
import * as challenges from './challenges.js';

const app = document.getElementById('app');
document.documentElement.style.setProperty('--stamp-clip', clipPathCss);

let profile = null;
let album = null;
let avatarUrl = null;

const fmtDate = t => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const markenText = n => `${n} ${n === 1 ? 'Marke' : 'Marken'}`;
const PUBLIC_URL = import.meta.env.DEV ? location.origin + location.pathname : 'https://johannaseba-oss.github.io/motif/';
const PENDING_JOIN = 'motif.pendingJoin';

function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 4500);
}

function setAvatarUrl() {
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = profile?.avatar ? URL.createObjectURL(profile.avatar) : null;
}

function avatarHtml() {
  return avatarUrl
    ? `<img src="${avatarUrl}" alt="">`
    : `<span class="avatar-empty stamp-clip">${icons.person}</span>`;
}

/* ---------- Anmelden ---------- */

function authForm(startMode = 'login') {
  const el = document.createElement('div');
  el.className = 'profile auth screen first';
  app.append(el);
  let mode = startMode;

  const TEXT = {
    login: { lead: 'Melde dich an, um dein Album zu öffnen.', button: 'Anmelden', pw: 'current-password' },
    signup: { lead: 'Lege ein Konto an. Deine Fotos bleiben nur auf diesem Gerät.', button: 'Konto erstellen', pw: 'new-password' },
    reset: { lead: 'Wir schicken dir einen Link, mit dem du ein neues Passwort vergibst.', button: 'Link schicken' },
    newpw: { lead: 'Vergib ein neues Passwort.', button: 'Passwort speichern', pw: 'new-password' },
  };

  function paint(notice = '', error = '') {
    const t = TEXT[mode];
    const emailValue = el.querySelector('[name=email]')?.value || '';
    el.innerHTML = `
      <div class="profile-head"><h1>MOTIF</h1></div>
      <p class="lead">${t.lead}</p>
      <form novalidate>
        ${mode === 'newpw' ? '' : `<label class="field"><span>E-Mail</span>
          <input name="email" type="email" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="du@beispiel.de"></label>`}
        ${mode === 'reset' ? '' : `<label class="field"><span>Passwort</span>
          <input name="password" type="password" autocomplete="${t.pw}" minlength="8" placeholder="Mindestens 8 Zeichen"></label>`}
        <p class="form-msg ${error ? 'error' : ''}" role="status" ${notice || error ? '' : 'hidden'}></p>
        <button class="pill primary" type="submit">${t.button}</button>
      </form>
      <div class="auth-links">
        ${mode === 'login' ? '<button class="text-btn" data-mode="signup">Neues Konto erstellen</button><button class="text-btn" data-mode="reset">Passwort vergessen?</button>' : ''}
        ${mode === 'signup' || mode === 'reset' ? '<button class="text-btn" data-mode="login">Zurück zur Anmeldung</button>' : ''}
      </div>`;
    el.querySelector('.form-msg').textContent = error || notice;
    const emailEl = el.querySelector('[name=email]');
    if (emailEl) emailEl.value = emailValue;
    el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; paint(); }));
    el.querySelector('form').addEventListener('submit', submit);
  }

  async function submit(e) {
    e.preventDefault();
    const email = el.querySelector('[name=email]')?.value.trim();
    const password = el.querySelector('[name=password]')?.value;
    if (mode !== 'newpw' && !email) return paint('', 'Bitte gib deine E-Mail ein.');
    if (mode !== 'reset' && !password) return paint('', 'Bitte gib dein Passwort ein.');
    if ((mode === 'signup' || mode === 'newpw') && password.length < 8) return paint('', 'Das Passwort muss mindestens 8 Zeichen haben.');
    const button = el.querySelector('[type=submit]');
    button.disabled = true;
    try {
      if (mode === 'login') await auth.signIn(email, password);
      if (mode === 'newpw') await auth.setPassword(password);
      if (mode === 'signup' && await auth.signUp(email, password)) {
        mode = 'login';
        return paint(`Fast geschafft: Bestätige den Link in der Mail an ${email} und melde dich dann hier an.`);
      }
      if (mode === 'reset') {
        await auth.resetPassword(email);
        mode = 'login';
        return paint(`Falls es zu ${email} ein Konto gibt, ist der Link unterwegs.`);
      }
      el.remove();
      await enterApp();
    } catch (err) {
      paint('', err.message);
    }
  }

  paint();
}

async function enterApp() {
  app.innerHTML = '';
  await store.open(auth.user.id);
  await sync.init();
  await cloud.init();
  await social.init();
  await challenges.init();
  profile = await store.getProfile();
  // Name kommt aus dem Konto, damit ein neuer Browser nicht wieder nach dem Profil fragt
  const accountName = auth.accountName();
  if (accountName && profile?.name !== accountName) {
    profile = { avatar: null, createdAt: Date.parse(auth.user.created_at) || Date.now(), ...profile, name: accountName };
    await store.saveProfile(profile);
  } else if (profile && !accountName) {
    auth.setAccountName(profile.name).catch(() => {});
  }
  setAvatarUrl();
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search);
    if (q.has('seed') && !store.stamps.length) await devSeed(+q.get('seed') || 40);
    window.__perfo = { store, auth, sync, cloud, get album() { return album; } };
  }
  // Nur im Dev-Server: ?shot = leere Albumseite ohne Kopfzeile, ?shot=page = nur die Seite bildschirmfüllend
  const shot = import.meta.env.DEV ? new URLSearchParams(location.search).get('shot') : null;
  if (shot != null && !profile) {
    profile = { name: 'Demo', avatar: null, createdAt: Date.now() };
    await store.saveProfile(profile);
  }
  if (shot != null) showAlbum('private');
  else if (profile) showShelf();
  else profileForm({ first: true });
  if (shot != null) devShot(shot);
}

function devShot(mode) {
  album.plain = true;
  album.render();
  if (mode !== 'page') return;
  const W = innerWidth, H = innerHeight;
  Object.assign(album, { pw: W, ph: H, dpr: devicePixelRatio || 1 });
  album.grid = album.computeGrid();
  const c = document.createElement('canvas');
  c.width = W * album.dpr;
  c.height = H * album.dpr;
  Object.assign(c.style, { position: 'fixed', inset: 0, width: W + 'px', height: H + 'px', zIndex: 99 });
  album.drawPage(c.getContext('2d'), 0, 'r');
  document.body.append(c);
}

/* ---------- Profil anlegen und bearbeiten ---------- */

function profileForm({ first, onSaved }) {
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
    ${first ? '' : `<label class="field"><span>@Name</span>
      <input name="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="20" placeholder="nur a–z, 0–9, Punkt und _"></label>
    <label class="field"><span>Über mich</span>
      <textarea name="bio" rows="3" maxlength="160" placeholder="Ein paar Worte über dich"></textarea></label>
    <div class="field"><span>Wer sieht dein Profil?</span><div class="segmented" role="radiogroup"></div></div>
    <p class="form-msg" role="status" hidden></p>`}
    ${first ? '' : `<div class="stats"><div><b>${store.stamps.length}</b><span>${store.stamps.length === 1 ? 'Marke' : 'Marken'}</span></div><div><b>${pages}</b><span>${pages === 1 ? 'Seite' : 'Seiten'}</span></div><div class="since"><b>${fmtDate(profile.createdAt)}</b><span>dabei seit</span></div></div>`}
    <button class="pill primary" data-a="save">${first ? 'Album öffnen' : 'Speichern'}</button>
    ${first ? '' : `<p class="backup-state" role="status"></p><p class="account-mail"></p><button class="text-btn" data-a="logout">Abmelden</button>`}`;
  app.append(el);

  const input = el.querySelector('input[name=name]');
  input.value = profile?.name || '';

  // Öffentliches Profil: @Name, Bio, Sichtbarkeit
  const userInput = el.querySelector('[name=username]');
  const bioInput = el.querySelector('[name=bio]');
  const seg = el.querySelector('.segmented');
  const msg = el.querySelector('.form-msg');
  let visibility = 'private';
  let socialBefore = null;
  const paintSeg = () => seg?.querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === visibility);
    b.setAttribute('aria-checked', b.dataset.v === visibility);
  });
  if (seg) {
    for (const v of social.VISIBILITY) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = v.id;
      b.textContent = v.label;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { visibility = v.id; paintSeg(); });
      seg.append(b);
    }
    paintSeg();
    social.api.getProfile(auth.user.id).then(p => {
      if (!p || !el.isConnected) return;
      socialBefore = p;
      userInput.value = p.username;
      bioInput.value = p.bio;
      visibility = p.visibility;
      paintSeg();
    }).catch(() => {});
  }
  const pick = el.querySelector('.avatar-pick');
  const save = el.querySelector('[data-a=save]');
  const paint = () => {
    pick.innerHTML = draftUrl ? `<img src="${draftUrl}" alt="">` : `<span class="avatar-empty stamp-clip">${icons.person}</span>`;
    pick.classList.toggle('empty', !draftUrl);
    save.disabled = !input.value.trim();
  };
  paint();
  input.addEventListener('input', paint);

  pick.addEventListener('click', () => {
    openCamera({
      facing: 'user',
      onShot: async cut => {
        draftAvatar = cut.thumb;
        if (draftUrl) URL.revokeObjectURL(draftUrl);
        draftUrl = URL.createObjectURL(draftAvatar);
        paint();
      },
    });
  });

  const close = () => { if (draftUrl) URL.revokeObjectURL(draftUrl); el.remove(); };
  const mail = el.querySelector('.account-mail');
  if (mail) mail.textContent = auth.user.email;
  const backup = el.querySelector('.backup-state');
  if (backup) {
    const paintBackup = () => {
      if (!el.isConnected) { clearInterval(backupTimer); return; }
      const open = store.pendingUploads();
      backup.textContent = open === 0 && !cloud.lastError
        ? 'Dein Album ist im Konto gesichert.'
        : `Noch ${open} ${open === 1 ? 'Änderung' : 'Änderungen'} werden gesichert${cloud.lastError ? ', sobald es wieder klappt. Bist du online?' : ' …'}`;
    };
    const backupTimer = setInterval(paintBackup, 1500);
    paintBackup();
  }
  el.querySelector('[data-a=logout]')?.addEventListener('click', async () => {
    await auth.signOut();
    location.reload();
  });
  el.querySelector('[data-a=close]')?.addEventListener('click', close);
  el.querySelector('form')?.addEventListener('submit', e => e.preventDefault());
  save.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) return;
    if (userInput) {
      const username = userInput.value.trim().replace(/^@/, '').toLowerCase();
      const fail = text => { msg.hidden = false; msg.classList.add('error'); msg.textContent = text; };
      if (username || socialBefore) {
        if (!/^[a-z0-9._]{3,20}$/.test(username)) return fail('Der @Name braucht 3 bis 20 Zeichen: a–z, 0–9, Punkt oder _.');
        try {
          await social.api.saveProfile({ username, display_name: name, bio: bioInput.value.trim(), visibility });
          if (visibility === 'public' && socialBefore?.visibility !== 'public') await social.api.acceptAll();
        } catch (e) {
          return fail(e?.code === '23505' ? 'Diesen @Namen gibt es schon.' : 'Speichern hat nicht geklappt. Bist du online?');
        }
      }
      social.dropAvatarCache(auth.user.id);
    }
    profile = {
      ...profile, name, avatar: draftAvatar, createdAt: profile?.createdAt || Date.now(),
      avatarDirty: profile?.avatarDirty || (!!draftAvatar && draftAvatar !== profile?.avatar),
    };
    await store.saveProfile(profile);
    auth.setAccountName(name).catch(() => {});
    sync.setDisplayName(name).catch(() => {});
    setAvatarUrl();
    close();
    if (first) showShelf(); else if (album) showAlbum(); else showShelf();
    onSaved?.();
  });
  if (first) setTimeout(() => input.focus(), 50);
}

/* ---------- Album ---------- */

/* ---------- Startbildschirm: Wahl zwischen Themenalbum und eigenem Album ---------- */

let albumKind = null;

function showShelf() {
  albumKind = null;
  album = null;
  app.querySelector('.home')?.remove();
  app.querySelector('.shelf')?.remove();
  const el = document.createElement('div');
  el.className = 'shelf screen';
  el.innerHTML = `
    <header class="top">
      <h1>MOTIF</h1>
      <button class="profile-btn" aria-label="Profil von ${escapeHtml(profile.name)}">${avatarHtml()}</button>
    </header>
    <div class="covers">
      <button class="cover" data-kind="theme">
        <span class="cover-dots">${COVER_COLORS.map(c => `<i style="background:${c}"></i>`).join('')}</span>
        <b>${THEME_ALBUM.replace("walks", "&shy;walks")}</b>
      </button>
      <button class="cover" data-kind="private">
        <span class="cover-stamp stamp-clip"></span>
        <b>Mein Album</b>
      </button>
    </div>
    <section class="challenges"></section>`;
  app.prepend(el);
  el.querySelectorAll('.cover').forEach(b => b.addEventListener('click', () => showAlbum(b.dataset.kind)));
  el.querySelector('.profile-btn').addEventListener('click', openOwnProfile);
  challenges.renderSection(el.querySelector('.challenges'), { toast, confirm: confirmSheet, takePhoto: takeChallengePhoto });
  startSharing();
}

// Foto für eine Challenge: landet auch in "Mein Album" und wird vor dem Einreichen ins Konto gesichert
function takeChallengePhoto() {
  return new Promise(resolve => {
    let stamp = null;
    openCamera({
      onShot: async (cut, { finish }) => {
        stamp = await store.addStamp(cut);
        await finish();
      },
      onClose: async () => {
        if (!stamp) { resolve(null); return; }
        await cloud.ensureSynced(stamp);
        if (!stamp.synced) toast('Das Foto liegt in deinem Album, ließ sich aber noch nicht hochladen. Bist du online?');
        resolve(stamp.synced ? stamp : null);
      },
    });
  });
}

function showAlbum(kind = albumKind || 'private') {
  albumKind = kind;
  app.querySelector('.home')?.remove();
  app.querySelector('.shelf')?.remove();
  const el = document.createElement('div');
  el.className = 'home screen';
  el.innerHTML = `
    <header class="top">
      <button class="round back-btn" aria-label="Zur Albumwahl">${icons.back}</button>
      <h1>${kind === 'theme' ? THEME_ALBUM : 'Mein Album'}</h1>
      <button class="profile-btn" aria-label="Profil von ${escapeHtml(profile.name)}">${avatarHtml()}</button>
    </header>
    <main class="stage"></main>
    <footer class="bottom">
      <button class="pill primary shoot">${icons.camera}<span>Aufnehmen</span></button>
    </footer>`;
  app.prepend(el);
  album = new Album(el.querySelector('.stage'), {
    theme: kind === 'theme',
    onOpen: openDetail,
    onShare: openShareSheet,
    canMove: sync.isMine,
    confirmShareDrop: () => confirmSheet('Marke auf die gemeinsame Seite legen?', 'Das Foto wird dafür hochgeladen und alle auf dieser Seite können es sehen.', 'Hochladen'),
  });
  album.canEditSharedTitle = info => info.owner === auth.user.id;
  startSharing();
  el.querySelector('.back-btn').addEventListener('click', showShelf);
  el.querySelector('.profile-btn').addEventListener('click', openOwnProfile);
  el.querySelector('.shoot').addEventListener('click', showCamera);
}

function openOwnProfile() {
  social.openProfilePage(auth.user.id, {
    toast,
    onEdit: refresh => profileForm({ first: false, onSaved: refresh }),
    // Für die Auswahl im Profil: nur eigene Marken aus dem privaten Album, neueste zuerst
    ownStamps: () => store.stamps.filter(s => !s.shared).sort((a, b) => b.createdAt - a.createdAt),
    thumbUrl: s => album?.images.get(s.id)?.src || URL.createObjectURL(s.thumb),
    ensureSynced: s => cloud.ensureSynced(s),
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- Kamera ---------- */

function showCamera() {
  // Im Themenalbum landet das Foto auf der aufgeschlagenen Seite
  if (album.theme && album.visibleFreeSlot() == null) {
    toast('Diese Seite ist voll. Blättere zu einem Thema mit freiem Platz.');
    return;
  }
  openCamera({
    onShot: async (cut, { frame, photo, finish }) => {
      // Bei einer offenen gemeinsamen Seite landet das Foto dort, sonst bleibt es privat
      const sharedTarget = album.visibleSharedPage();
      const stamp = sharedTarget != null
        ? sync.addToShared(sharedTarget, cut, () => {
          toast('Hochladen hat nicht geklappt. Das Foto liegt jetzt privat in deinem Album.');
          album.preload();
          album.render();
        })
        : await store.addStamp(cut, album.theme ? album.visibleFreeSlot() : undefined);
      // Der Platz bleibt frei, bis die Marke dort ankommt
      album.hiddenId = stamp.id;
      album.goToSlot(stamp.slot);
      const flying = await punchOut(frame, photo, cut.full);
      const closing = finish();
      await pinToAlbum(flying, frame, album.cellClientRect(stamp.slot), async () => {
        await album.images.get(stamp.id)?.decode().catch(() => {});
        album.hiddenId = null;
        album.render();
        album.book.animate(
          [{ transform: 'none' }, { transform: 'translateY(3px)' }, { transform: 'none' }],
          { duration: 150, easing: 'ease-out' });
      });
      await closing;
    },
  });
}

/* ---------- Gemeinsame Seiten ---------- */

let sharingStarted = false;

async function syncNow() {
  // Auch auf der Albumwahl abgleichen; nur während einer Geste im Album warten
  const busy = () => !!(album && (album.drag || album.flip || album.gesture));
  if (busy()) return;
  try {
    const { changed, removed, avatar } = await cloud.syncAll(busy);
    removed.forEach(id => album?.forget(id));
    if (changed && album) { album.clampCur(); album.preload(); album.render(); }
    profile = await store.getProfile() || profile;
    if (avatar === 'pulled') {
      setAvatarUrl();
      const btn = document.querySelector('.profile-btn');
      if (btn) btn.innerHTML = avatarHtml();
    }
  } catch { /* offline: beim nächsten Mal */ }
}

async function startSharing() {
  if (sharingStarted) return;
  sharingStarted = true;
  sync.handlers.failed = () => toast('Hochladen hat nicht geklappt. Die Marke liegt wieder privat in deinem Album.');
  sync.handlers.changed = () => { album?.preload(); album?.render(); };
  let soon = 0;
  const syncSoon = () => { clearTimeout(soon); soon = setTimeout(syncNow, 800); };
  store.setOnChange(syncSoon);
  cloud.setTrigger(syncSoon);
  await syncNow();
  setInterval(() => { if (!document.hidden) syncNow(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });

  const token = localStorage.getItem(PENDING_JOIN);
  if (!token) return;
  localStorage.removeItem(PENDING_JOIN);
  try {
    const page = await sync.joinByToken(token, profile.name);
    if (!album || album.theme) showAlbum('private');
    album.preload();
    album.goToSlot(page * store.PER_PAGE);
    toast('Du bist jetzt auf dieser gemeinsamen Seite dabei.');
  } catch {
    toast('Dieser Einladungslink funktioniert nicht mehr.');
  }
}

function confirmSheet(title, text, yes) {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'sheet-wrap';
    el.innerHTML = `<div class="sheet"><h2></h2><p></p>
      <button class="pill primary" data-a="yes"></button><button class="text-btn" data-a="no">Abbrechen</button></div>`;
    el.querySelector('h2').textContent = title;
    el.querySelector('p').textContent = text;
    el.querySelector('[data-a=yes]').textContent = yes;
    document.body.append(el);
    const done = v => { el.remove(); res(v); };
    el.querySelector('[data-a=yes]').addEventListener('click', () => done(true));
    el.querySelector('[data-a=no]').addEventListener('click', () => done(false));
  });
}

async function shareLink(info) {
  const url = `${PUBLIC_URL}?join=${info.token}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'MOTIF', text: 'Klebe mit mir Marken auf diese Seite:', url }); return; }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  await navigator.clipboard.writeText(url);
  toast('Link kopiert.');
}

function openShareSheet(page) {
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  document.body.append(el);
  const close = () => el.remove();
  el.addEventListener('click', e => { if (e.target === el) close(); });

  const afterChange = ({ removed }) => {
    removed.forEach(id => album.forget(id));
    album.clampCur();
    album.preload();
    album.render();
  };

  function paint() {
    const info = store.sharedPage(page);
    if (!info) {
      const count = store.stamps.filter(s => Math.floor(s.slot / store.PER_PAGE) === page).length;
      el.innerHTML = `<div class="sheet"><h2>Seite ${page + 1} teilen</h2>
        <p>Lade andere ein, diese Seite mit dir zu befüllen. Marken auf dieser Seite werden dafür hochgeladen und alle Eingeladenen sehen sie${count ? `, auch deine ${count} vorhandenen` : ''}. Deine anderen Seiten bleiben privat auf dem Gerät.</p>
        <button class="pill primary" data-a="create">Seite teilen</button>
        <button class="text-btn" data-a="close">Abbrechen</button></div>`;
      el.querySelector('[data-a=close]').addEventListener('click', close);
      el.querySelector('[data-a=create]').addEventListener('click', async e => {
        e.target.disabled = true;
        e.target.textContent = 'Wird hochgeladen …';
        try {
          await sync.sharePage(page, profile.name);
          album.render();
          cloud.trigger();
          paint();
        } catch {
          toast('Teilen hat nicht geklappt. Bist du online?');
          await syncNow();
          paint();
        }
      });
      return;
    }

    const owner = info.owner === auth.user.id;
    el.innerHTML = `<div class="sheet"><h2></h2>
      <ul class="members"></ul>
      <button class="pill primary" data-a="invite">Einladungslink teilen</button>
      <p class="sheet-note">Alle mit diesem Link können nach der Anmeldung mitmachen.</p>
      <button class="text-btn" data-a="${owner ? 'end' : 'leave'}">${owner ? 'Teilen beenden' : 'Seite verlassen'}</button>
      <button class="text-btn" data-a="close">Schließen</button></div>`;
    el.querySelector('h2').textContent = info.title || 'Gemeinsame Seite';
    const list = el.querySelector('.members');
    for (const m of info.members) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = (m.display_name || 'Ohne Namen') + (m.user_id === info.owner ? ' · hat eingeladen' : '');
      li.append(name);
      if (owner && m.user_id !== auth.user.id) {
        const kick = document.createElement('button');
        kick.className = 'text-btn';
        kick.textContent = 'Entfernen';
        kick.addEventListener('click', async () => {
          if (!await confirmSheet('Person entfernen?', 'Die Person sieht die Seite dann nicht mehr. Ihre Marken bleiben hier, bis du sie löschst.', 'Entfernen')) return;
          try { afterChange(await sync.removeMember(page, m.user_id)); paint(); } catch { toast('Das hat nicht geklappt. Bist du online?'); }
        });
        li.append(kick);
      }
      list.append(li);
    }
    el.querySelector('[data-a=close]').addEventListener('click', close);
    el.querySelector('[data-a=invite]').addEventListener('click', () => shareLink(info));
    el.querySelector('[data-a=end]')?.addEventListener('click', async () => {
      if (!await confirmSheet('Teilen beenden?', 'Die Seite und alle ihre Marken werden für alle gelöscht, auch deine eigenen auf dieser Seite.', 'Für alle löschen')) return;
      try { afterChange(await sync.endSharing(page)); close(); } catch { toast('Das hat nicht geklappt. Bist du online?'); }
    });
    el.querySelector('[data-a=leave]')?.addEventListener('click', async () => {
      if (!await confirmSheet('Seite verlassen?', 'Die Seite verschwindet aus deinem Album. Deine Marken bleiben für die anderen sichtbar, bis jemand sie löscht.', 'Verlassen')) return;
      try { afterChange(await sync.leave(page)); close(); } catch { toast('Das hat nicht geklappt. Bist du online?'); }
    });
  }
  paint();
}

/* ---------- Große Ansicht ---------- */

async function openDetail(first, from) {
  const el = document.createElement('div');
  el.className = 'detail screen';
  el.innerHTML = `
    <div class="detail-bg"></div>
    <div class="detail-stamp"><img alt=""></div>
    <div class="detail-info">
      <input class="stamp-name" maxlength="60" placeholder="Name" aria-label="Name der Marke">
      <textarea class="stamp-desc" rows="2" maxlength="500" placeholder="Beschreibung" aria-label="Beschreibung der Marke"></textarea>
      <div class="detail-row">
        <div>
          <b class="detail-date"></b>
          <span class="detail-meta"></span>
        </div>
      </div>
      <button class="pill feature-btn" data-a="feature"></button>
      <div class="detail-actions">
        <button class="delete-btn" data-a="export">${icons.export}<span>Exportieren</span></button>
        <button class="delete-btn" data-a="delete" aria-label="Marke löschen">${icons.trash}<span>Löschen</span></button>
      </div>
    </div>
    <button class="round detail-close" aria-label="Schließen">${icons.close}</button>`;
  app.append(el);

  const img = el.querySelector('img');
  const wrap = el.querySelector('.detail-stamp');
  const nameInput = el.querySelector('.stamp-name');
  const descInput = el.querySelector('.stamp-desc');
  const del = el.querySelector('[data-a=delete]');
  const featureBtn = el.querySelector('[data-a=feature]');
  let stamp = null;
  let fullUrl = null;
  let saveTimer = 0;
  let armed = false;

  // Alle Marken der Seite, auf der die gerade gezeigte liegt, in Album-Reihenfolge
  const pageOf = s => Math.floor(s.slot / store.PER_PAGE);
  const siblings = () => store.stamps.filter(s => pageOf(s) === pageOf(stamp)).sort((a, b) => a.slot - b.slot);

  const saveText = () => {
    clearTimeout(saveTimer);
    if (!stamp || !sync.isMine(stamp)) return;
    const name = nameInput.value.trim(), desc = descInput.value.trim();
    if (name !== (stamp.name || '') || desc !== (stamp.desc || '')) {
      Promise.resolve(store.updateStamp(stamp, { name, desc })).catch(() => toast('Speichern hat nicht geklappt.'));
    }
  };
  for (const field of [nameInput, descInput]) {
    field.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveText, 400); });
    field.addEventListener('blur', saveText);
  }

  function resetDelete() {
    armed = false;
    del.classList.remove('armed');
    del.innerHTML = `${icons.trash}<span>Löschen</span>`;
  }

  function show(s) {
    saveText();
    stamp = s;
    resetDelete();
    const mine = sync.isMine(s);
    nameInput.value = s.name || '';
    descInput.value = s.desc || '';
    nameInput.readOnly = descInput.readOnly = !mine;
    nameInput.hidden = !mine && !s.name;
    descInput.hidden = !mine && !s.desc;
    del.hidden = !sync.canDelete(s);
    featureBtn.hidden = !!s.shared;
    paintFeature();
    el.querySelector('.detail-date').textContent = fmtDate(s.createdAt);
    const list = siblings();
    const where = s.shared ? `von ${s.shared.ownerName || 'jemandem'}` : themeOf(pageOf(s))?.title || `Seite ${pageOf(s) + 1}`;
    el.querySelector('.detail-meta').textContent = list.length > 1 ? `${where} · ${list.indexOf(s) + 1} von ${list.length}` : where;

    if (fullUrl) { URL.revokeObjectURL(fullUrl); fullUrl = null; }
    img.src = album.images.get(s.id)?.src || URL.createObjectURL(s.thumb);
    store.getFull(s.id).then(b => {
      if (!b || !el.isConnected || stamp !== s) return;
      fullUrl = URL.createObjectURL(b);
      const hi = new Image();
      hi.onload = () => { if (el.isConnected && stamp === s) img.src = fullUrl; };
      hi.src = fullUrl;
    }).catch(() => {});
  }
  function paintFeature() {
    const on = social.isFeatured(stamp.id);
    featureBtn.classList.toggle('on', on);
    featureBtn.textContent = on ? 'Im Profil geklebt' : 'Ins Profil kleben';
  }
  featureBtn.addEventListener('click', async () => {
    if (tooSoon()) return;
    const s = stamp;
    featureBtn.disabled = true;
    try {
      // Erst ins Konto sichern, dann zeigen
      if (!(await cloud.ensureSynced(s))) throw new Error('not synced');
      await social.setFeatured(s.id, !social.isFeatured(s.id));
      tick();
    } catch {
      toast('Das hat nicht geklappt. Bist du online?');
    }
    featureBtn.disabled = false;
    if (stamp === s) paintFeature();
  });

  show(first);

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
    saveText();
    from = album.cellClientRect(stamp.slot) || from;
    const a = wrap.animate(zoomFrames().reverse(), { duration: 220, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    el.classList.add('leaving');
    await a.finished.catch(() => {});
    if (fullUrl) URL.revokeObjectURL(fullUrl);
    el.remove();
  };

  /* ---------- Wischen zur nächsten oder vorigen Marke der Seite ---------- */

  let swipe = null, sliding = false, swiped = false;
  const W = () => wrap.getBoundingClientRect().width;

  async function slideTo(dir) {
    const list = siblings();
    const next = list[list.indexOf(stamp) + dir];
    sliding = true;
    if (!next) {
      // Am Rand der Seite federt die Marke zurück
      await wrap.animate([{ transform: wrap.style.transform || 'none' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.catch(() => {});
      wrap.style.transform = '';
      sliding = false;
      return;
    }
    tick();
    const off = innerWidth * 0.75;
    await wrap.animate([{ transform: wrap.style.transform || 'none', opacity: 1 }, { transform: `translateX(${-dir * off}px)`, opacity: 0 }],
      { duration: 160, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
    show(next);
    wrap.getAnimations().forEach(a => a.cancel());
    wrap.style.transform = '';
    await wrap.animate([{ transform: `translateX(${dir * off}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.catch(() => {});
    sliding = false;
  }

  wrap.addEventListener('pointerdown', e => {
    if (sliding || closing) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, active: false };
    swiped = false;
    try { wrap.setPointerCapture(e.pointerId); } catch {}
  });
  wrap.addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.active && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) swipe.active = true;
    if (!swipe.active) return;
    const list = siblings();
    const i = list.indexOf(stamp);
    const blocked = (dx > 0 && i === 0) || (dx < 0 && i === list.length - 1);
    swipe.dx = dx;
    wrap.style.transform = `translateX(${blocked ? dx * 0.3 : dx}px)`;
  });
  const endSwipe = e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const { active, dx, t } = swipe;
    swipe = null;
    if (!active) return;
    swiped = true;
    const fast = Math.abs(dx) / Math.max(1, e.timeStamp - t) > 0.5;
    if (Math.abs(dx) > W() * 0.25 || (fast && Math.abs(dx) > 30)) slideTo(dx < 0 ? 1 : -1);
    else slideTo(0);
  };
  wrap.addEventListener('pointerup', endSwipe);
  wrap.addEventListener('pointercancel', endSwipe);

  el.querySelector('.detail-close').addEventListener('click', close);
  el.querySelector('.detail-bg').addEventListener('click', close);
  // Antippen schließt, Wischen nicht
  wrap.addEventListener('click', () => { if (!swiped && !sliding) close(); swiped = false; });

  el.querySelector('[data-a=export]').addEventListener('click', async () => {
    if (tooSoon()) return;
    try {
      const blob = await store.getFull(stamp.id);
      await exportStamp(blob, stamp);
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Exportieren hat nicht geklappt.');
    }
  });

  del.addEventListener('click', async () => {
    if (tooSoon()) return;
    if (!armed) {
      armed = true;
      tick();
      del.classList.add('armed');
      del.innerHTML = 'Wirklich löschen?';
      const shownAt = stamp;
      setTimeout(() => { if (del.isConnected && stamp === shownAt && armed) resetDelete(); }, 3000);
      return;
    }
    clearTimeout(saveTimer);
    const gone = stamp;
    const list = siblings();
    const next = list[list.indexOf(gone) + 1] || list[list.indexOf(gone) - 1];
    try {
      await store.deleteStamp(gone);
    } catch {
      toast('Löschen hat nicht geklappt. Bist du online?');
      return;
    }
    album.forget(gone.id);
    social.forgetFeatured(gone.id);
    album.clampCur();
    album.render();
    // Weitere Marken auf der Seite: die nächste zeigen, sonst zurück ins Album
    if (next) {
      stamp = null;
      show(next);
      wrap.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
      return;
    }
    if (fullUrl) URL.revokeObjectURL(fullUrl);
    el.remove();
  });
}

async function exportStamp(blob, stamp) {
  const day = new Date(stamp.createdAt).toISOString().slice(0, 10);
  const base = (stamp.name || 'marke').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '') || 'marke';
  const file = new File([blob], `motif-${base}-${day}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
  await document.fonts?.ready;
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('shot')) {
    // Eigenes leeres Testkonto, damit kein echtes Album auf dem Bild landet
    const id = '00000000-0000-4000-8000-00000000500d';
    localStorage.setItem('motif.devAuth', JSON.stringify({ users: { 'demo@example.test': { id, password: 'x' } }, session: 'demo@example.test' }));
    localStorage.setItem('motif.legacyAlbumMoved', '1');
  }
  const params = new URLSearchParams(location.search);
  if (params.has('join')) {
    localStorage.setItem(PENDING_JOIN, params.get('join'));
    params.delete('join');
    history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''));
  }
  let recovering = false;
  await auth.init({
    onRecovery: () => {
      recovering = true;
      app.innerHTML = '';
      authForm('newpw');
    },
  });
  if (!auth.isConfigured()) {
    app.innerHTML = '<div class="profile auth screen first"><div class="profile-head"><h1>MOTIF</h1></div><p class="lead">Die Anmeldung ist gerade nicht verfügbar.</p></div>';
    return;
  }
  await new Promise(r => setTimeout(r));
  if (recovering) return;
  if (auth.user) await enterApp();
  else authForm();
}

boot();
