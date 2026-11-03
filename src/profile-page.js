// "About me": eigenes und fremdes Profil mit gezeigten Marken, Folgen und Suche
import * as auth from './auth.js';
import { createSocialApi } from './social-api.js';
import { icons } from './icons.js';
import { tick } from './haptics.js';

export let api = null;
let featured = new Set();
const avatars = new Map();

export async function init() {
  const client = auth.getClient();
  if (import.meta.env.DEV && client.isDev) {
    const { createDevSocialApi } = await import('./social-api-dev.js');
    api = createDevSocialApi(() => auth.user.id);
  } else {
    api = createSocialApi(client, () => auth.user.id);
  }
  featured = await api.myFeatured().catch(() => new Set());
}

export const VISIBILITY = [
  { id: 'public', label: 'Öffentlich' },
  { id: 'followers', label: 'Nur Follower' },
  { id: 'private', label: 'Privat' },
];

const fmtDate = t => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

export const isFeatured = id => featured.has(id);
export async function setFeatured(id, on) {
  if (on) await api.feature(id); else await api.unfeature(id);
  if (on) featured.add(id); else featured.delete(id);
}
export const forgetFeatured = id => featured.delete(id);

async function avatarUrl(uid) {
  if (!avatars.has(uid)) avatars.set(uid, api.avatar(uid).then(b => URL.createObjectURL(b), () => null));
  return avatars.get(uid);
}
export const dropAvatarCache = uid => avatars.delete(uid);

export function avatarEl(cls) {
  const wrap = document.createElement('div');
  wrap.className = cls;
  wrap.innerHTML = `<span class="avatar-empty stamp-clip">${icons.person}</span>`;
  return wrap;
}
export async function fillAvatar(wrap, uid) {
  const url = await avatarUrl(uid);
  if (url && wrap.isConnected) wrap.innerHTML = `<img src="${url}" alt="">`;
}

function screen(cls) {
  const el = document.createElement('div');
  el.className = `${cls} screen`;
  document.getElementById('app').append(el);
  el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
  return el;
}

/* ---------- Profilseite ---------- */

export async function openProfilePage(uid, opts) {
  const { onEdit, toast } = opts;
  const mine = uid === auth.user.id;
  const el = screen('about');
  el.innerHTML = `<div class="about-top"><button class="round" data-a="close" aria-label="Schließen">${icons.close}</button></div><div class="about-body"></div>`;
  el.querySelector('[data-a=close]').addEventListener('click', () => el.remove());
  const body = el.querySelector('.about-body');
  const urls = [];
  const cleanup = new MutationObserver(() => {
    if (!el.isConnected) { urls.forEach(u => URL.revokeObjectURL(u)); cleanup.disconnect(); }
  });
  cleanup.observe(document.getElementById('app'), { childList: true });

  async function paint() {
    let profile, stats, follow, canView, feed, requests = [];
    try {
      profile = await api.getProfile(uid);
      if (!profile && !mine) { body.innerHTML = '<p class="about-empty">Dieses Profil gibt es nicht mehr.</p>'; return; }
      [stats, follow, canView, feed] = await Promise.all([
        api.stats(uid), mine ? null : api.myFollow(uid), api.canView(uid), api.feed(uid),
      ]);
      if (mine) requests = await api.requests();
    } catch {
      body.innerHTML = '<p class="about-empty">Das Profil lässt sich gerade nicht laden. Bist du online?</p>';
      return;
    }

    body.innerHTML = `
      <div class="about-head">
        <div class="about-stats">
          <div><b>${stats.posts}</b><span>Marken</span></div>
          <div><b>${stats.followers}</b><span>Follower</span></div>
          <div><b>${stats.following}</b><span>Folgt</span></div>
        </div>
      </div>
      <h1 class="about-name"></h1>
      <p class="about-user"></p>
      <p class="about-bio"></p>
      <div class="about-actions"></div>
      <div class="about-requests"></div>
      <div class="about-grid"></div>`;
    const head = body.querySelector('.about-head');
    const av = avatarEl('about-avatar');
    head.prepend(av);
    fillAvatar(av, uid);
    body.querySelector('.about-name').textContent = profile?.display_name || auth.accountName() || '';
    body.querySelector('.about-user').textContent = profile ? `@${profile.username}` : '';
    const bio = body.querySelector('.about-bio');
    bio.textContent = profile?.bio || '';
    bio.hidden = !profile?.bio;

    const actions = body.querySelector('.about-actions');
    if (mine) {
      const vis = VISIBILITY.find(v => v.id === profile?.visibility);
      actions.innerHTML = `
        <button class="pill" data-a="edit">Profil bearbeiten</button>
        <button class="round" data-a="add" aria-label="Marken ins Profil kleben">${icons.plus}</button>
        <button class="round" data-a="search" aria-label="Profile suchen">${icons.search}</button>`;
      if (vis) {
        const chip = document.createElement('p');
        chip.className = 'about-chip';
        chip.textContent = vis.label;
        body.querySelector('.about-user').append(' · ', chip);
      }
      actions.querySelector('[data-a=edit]').addEventListener('click', () => onEdit(paint));
      actions.querySelector('[data-a=search]').addEventListener('click', () => openSearch(opts));
      actions.querySelector('[data-a=add]').addEventListener('click', () => {
        if (!profile) { toast('Lege zuerst unter „Profil bearbeiten“ deinen @Namen fest.'); return; }
        openPicker(opts, paint);
      });
    } else {
      const label = follow === 'accepted' ? 'Folge ich' : follow === 'pending' ? 'Angefragt' : 'Folgen';
      actions.innerHTML = `<button class="pill ${follow ? '' : 'solid'}" data-a="follow">${label}</button>`;
      actions.querySelector('[data-a=follow]').addEventListener('click', async e => {
        e.target.disabled = true;
        try {
          if (follow) await api.unfollow(uid); else await api.follow(uid);
          tick();
        } catch {
          toast('Das hat nicht geklappt. Bist du online?');
        }
        paint();
      });
    }

    const req = body.querySelector('.about-requests');
    if (requests.length) {
      req.innerHTML = `<h2>Anfragen</h2><ul class="members"></ul>`;
      const list = req.querySelector('ul');
      for (const r of requests) {
        const li = document.createElement('li');
        const name = document.createElement('button');
        name.className = 'text-btn person';
        name.textContent = `@${r.username}`;
        name.addEventListener('click', () => openProfilePage(r.user_id, opts));
        const yes = document.createElement('button');
        yes.className = 'text-btn';
        yes.textContent = 'Annehmen';
        yes.addEventListener('click', async () => { await api.accept(r.user_id).catch(() => toast('Das hat nicht geklappt.')); paint(); });
        const no = document.createElement('button');
        no.className = 'text-btn';
        no.textContent = 'Ablehnen';
        no.addEventListener('click', async () => { await api.decline(r.user_id).catch(() => toast('Das hat nicht geklappt.')); paint(); });
        li.append(name, yes, no);
        list.append(li);
      }
    }

    const grid = body.querySelector('.about-grid');
    if (!mine && !canView) {
      grid.innerHTML = `<p class="about-empty">${profile.visibility === 'private' ? 'Dieses Profil ist privat.' : 'Nur Follower sehen die Marken.'}</p>`;
      return;
    }
    if (!feed.length) {
      grid.innerHTML = `<p class="about-empty">${mine && !profile ? 'Lege unter „Profil bearbeiten“ deinen @Namen fest.' : 'Noch keine Marken im Profil.'}</p>`;
      return;
    }
    feed.forEach((row, i) => {
      const cell = document.createElement('button');
      cell.className = 'about-cell';
      cell.setAttribute('aria-label', row.name || fmtDate(row.created_at));
      grid.append(cell);
      api.image(uid, row.id, 'thumb').then(b => {
        const url = URL.createObjectURL(b);
        urls.push(url);
        cell.innerHTML = `<img src="${url}" alt="">`;
      }, () => {});
      cell.addEventListener('click', () => openViewer(uid, feed, i));
    });
  }
  paint();
}

/* ---------- Eigene Marken auswählen und ins Profil kleben ---------- */

function openPicker({ ownStamps, ensureSynced, thumbUrl, toast }, onDone) {
  const el = screen('about picker');
  el.innerHTML = `
    <div class="picker-top">
      <h1>Ins Profil kleben</h1>
      <button class="pill solid picker-done" data-a="done">Fertig</button>
    </div>
    <div class="about-grid picker-grid"></div>`;
  const grid = el.querySelector('.picker-grid');
  const done = () => { el.remove(); onDone(); };
  el.querySelector('[data-a=done]').addEventListener('click', done);

  const stamps = ownStamps();
  if (!stamps.length) {
    grid.innerHTML = '<p class="about-empty">Dein Album ist noch leer.</p>';
    return;
  }
  for (const s of stamps) {
    const cell = document.createElement('button');
    cell.className = 'about-cell pick';
    cell.innerHTML = `<img src="${thumbUrl(s)}" alt=""><span class="pick-mark" aria-hidden="true">${icons.check}</span>`;
    const paint = () => {
      const on = featured.has(s.id);
      cell.classList.toggle('on', on);
      cell.setAttribute('aria-pressed', on);
      cell.setAttribute('aria-label', (s.name || 'Marke') + (on ? ', im Profil' : ''));
    };
    paint();
    cell.addEventListener('click', async () => {
      if (cell.disabled) return;
      cell.disabled = true;
      try {
        if (!(await ensureSynced(s))) throw new Error('not synced');
        await setFeatured(s.id, !featured.has(s.id));
        tick();
      } catch {
        toast('Das hat nicht geklappt. Bist du online?');
      }
      cell.disabled = false;
      paint();
    });
    grid.append(cell);
  }
}

/* ---------- Große Ansicht einer gezeigten Marke, Wischen durch das Profil ---------- */

function openViewer(uid, feed, index) {
  const el = screen('detail viewer');
  el.innerHTML = `
    <div class="detail-bg"></div>
    <div class="detail-stamp"><img alt=""></div>
    <div class="detail-info">
      <p class="viewer-name"></p>
      <p class="viewer-desc"></p>
      <div class="detail-row"><div><b class="detail-date"></b><span class="detail-meta"></span></div></div>
    </div>
    <button class="round detail-close" aria-label="Schließen">${icons.close}</button>`;
  const img = el.querySelector('img');
  const wrap = el.querySelector('.detail-stamp');
  let url = null;
  const close = () => { if (url) URL.revokeObjectURL(url); el.remove(); };
  el.querySelector('.detail-close').addEventListener('click', close);
  el.querySelector('.detail-bg').addEventListener('click', close);

  function show(i) {
    index = i;
    const row = feed[i];
    el.querySelector('.viewer-name').textContent = row.name || '';
    el.querySelector('.viewer-desc').textContent = row.description || '';
    el.querySelector('.detail-date').textContent = fmtDate(row.created_at);
    el.querySelector('.detail-meta').textContent = feed.length > 1 ? `${i + 1} von ${feed.length}` : '';
    img.removeAttribute('src');
    api.image(uid, row.id, 'full').then(b => {
      if (index !== i || !el.isConnected) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(b);
      img.src = url;
    }, () => {});
  }
  show(index);

  let start = null, moved = false;
  wrap.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY }; moved = false; });
  wrap.addEventListener('pointermove', e => {
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - start.y)) { moved = true; wrap.style.transform = `translateX(${dx}px)`; }
  });
  wrap.addEventListener('pointerup', e => {
    if (!start) return;
    const dx = e.clientX - start.x;
    start = null;
    wrap.style.transform = '';
    if (!moved) { close(); return; }
    const next = index + (dx < 0 ? 1 : -1);
    if (Math.abs(dx) > 60 && next >= 0 && next < feed.length) {
      tick();
      show(next);
      wrap.animate([{ opacity: 0, transform: `translateX(${dx < 0 ? 40 : -40}px)` }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    }
  });
}

/* ---------- Suche ---------- */

export function openSearch(opts) {
  const el = screen('about search');
  el.innerHTML = `
    <div class="about-top"><button class="round" data-a="close" aria-label="Schließen">${icons.close}</button></div>
    <div class="about-body">
      <label class="field"><span>Profile suchen</span>
        <input type="search" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="@name"></label>
      <ul class="members search-results"></ul>
    </div>`;
  el.querySelector('[data-a=close]').addEventListener('click', () => el.remove());
  const input = el.querySelector('input');
  const list = el.querySelector('.search-results');
  let timer = 0, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const rows = await api.search(input.value.replace(/^@/, '')).catch(() => []);
      if (mine !== seq) return;
      list.innerHTML = '';
      for (const p of rows) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.className = 'person-row';
        const av = avatarEl('person-avatar');
        const text = document.createElement('span');
        text.innerHTML = '<b></b><small></small>';
        text.querySelector('b').textContent = `@${p.username}`;
        text.querySelector('small').textContent = p.display_name;
        b.append(av, text);
        fillAvatar(av, p.user_id);
        b.addEventListener('click', () => openProfilePage(p.user_id, opts));
        li.append(b);
        list.append(li);
      }
    }, 250);
  });
  setTimeout(() => input.focus(), 60);
}
