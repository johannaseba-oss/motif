// Community-Challenges auf dem Startbildschirm: Gruppe bilden, nacheinander Fotos einreichen
import * as auth from './auth.js';
import { createChallengeApi } from './challenges-api.js';
import { api as socialApi, avatarEl, fillAvatar } from './profile-page.js';
import { icons } from './icons.js';
import { tick } from './haptics.js';

export const CHALLENGES = [
  'Cats of the neighbourhood',
  'Horse',
  'Someone playing an Instrument',
  'Graffiti Art',
  'Sunset',
];
const MIN_INVITES = 3;
const MAX_GROUP = 6;

let api = null;

export async function init() {
  const client = auth.getClient();
  if (import.meta.env.DEV && client.isDev) {
    const { createDevChallengeApi } = await import('./challenges-api-dev.js');
    api = createDevChallengeApi(() => auth.user.id);
  } else {
    api = createChallengeApi(client, () => auth.user.id);
  }
}

const me = () => auth.user.id;
const accepted = st => st.members.filter(m => m.status === 'accepted');
const joinedOthers = st => accepted(st).filter(m => m.user_id !== st.group.owner).length;
const submitted = (st, n) => st.entries.filter(e => e.challenge === n);
function unlocked(st, n) {
  if (!st.group || joinedOthers(st) < MIN_INVITES) return false;
  return n === 1 || accepted(st).every(m => submitted(st, n - 1).some(e => e.user_id === m.user_id));
}
const done = (st, n) => !!st.group && accepted(st).every(m => submitted(st, n).some(e => e.user_id === m.user_id));
const nameOf = m => (m.profile ? `@${m.profile.username}` : 'Ohne Namen');

function screen(cls) {
  const el = document.createElement('div');
  el.className = `${cls} screen`;
  document.getElementById('app').append(el);
  el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
  return el;
}

/* ---------- Gemeinsames Vorschaufenster auf dem Startbildschirm ---------- */

// Erste Challenge, die noch nicht alle geschafft haben (oder die letzte)
const currentChallenge = st => {
  for (let n = 1; n <= CHALLENGES.length; n++) if (!done(st, n)) return n;
  return CHALLENGES.length;
};

export async function renderSection(host, deps) {
  let st;
  try {
    st = await api.state();
  } catch {
    host.innerHTML = '';
    return;
  }
  if (!host.isConnected) return;
  const refresh = () => renderSection(host, deps);
  const inv = st.invitations[0];
  const forming = st.group && joinedOthers(st) < MIN_INVITES;
  const cur = st.group ? currentChallenge(st) : 1;
  const allDone = st.group && !forming && CHALLENGES.every((_, i) => done(st, i + 1));

  host.innerHTML = `
    <div class="ch-card" role="group" aria-label="Challenges mit Freunden">
      <p class="ch-eyebrow">Challenges</p>
      <h2></h2>
      <p class="ch-lead"></p>
      <ol class="ch-steps" aria-label="Fortschritt"></ol>
      <div class="ch-cta"></div>
    </div>`;
  const card = host.querySelector('.ch-card');
  const h2 = card.querySelector('h2');
  const lead = card.querySelector('.ch-lead');
  const cta = card.querySelector('.ch-cta');

  // Fünf kleine Marken als Fortschritt: geschafft, aktuell, noch verdeckt
  const steps = card.querySelector('.ch-steps');
  CHALLENGES.forEach((_, i) => {
    const n = i + 1;
    const state = st.group && !forming && done(st, n) ? 'done' : n === cur ? 'now' : 'later';
    const li = document.createElement('li');
    li.className = `ch-step ${state}`;
    li.innerHTML = `<span class="stamp-clip">${state === 'done' ? icons.check : n}</span>`;
    li.setAttribute('aria-label', `Challenge ${n}: ${state === 'done' ? 'geschafft' : state === 'now' ? 'aktuell' : 'noch verdeckt'}`);
    steps.append(li);
  });

  const button = (label, cls, onClick) => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    cta.append(b);
    return b;
  };

  if (inv && !st.group) {
    h2.textContent = 'Du bist eingeladen';
    lead.textContent = `${inv.owner ? `@${inv.owner.username}` : 'Jemand'} möchte die Challenges mit dir machen. Ein Thema, jeder ein Foto, dann wird das nächste frei.`;
    button('Mitmachen', 'pill ch-go', async () => {
      try {
        await api.accept(inv.group_id);
        tick();
      } catch (e) {
        deps.toast(/already/.test(e?.message) ? 'Du bist schon in einer Challenge-Gruppe.' : 'Das hat nicht geklappt. Bist du online?');
      }
      refresh();
    });
    button('Ablehnen', 'text-btn ch-no', async () => {
      await api.leave(inv.group_id).catch(() => deps.toast('Das hat nicht geklappt.'));
      refresh();
    });
    return;
  }

  if (!st.group) {
    h2.textContent = 'Mach mit deinen Freunden mit';
    lead.textContent = 'Ladet euch zu dritt bis zu sechst ein. Ihr bekommt ein Thema, jeder reicht ein Foto ein, und erst dann wird das nächste Thema frei.';
    button('Freunde einladen', 'pill ch-go', () => openInvite(null, st, deps, refresh));
    return;
  }

  if (forming) {
    h2.textContent = 'Gleich geht es los';
    lead.textContent = `Sobald ${MIN_INVITES} deiner Freunde zugesagt haben, startet die erste Challenge. Bisher ${joinedOthers(st)} von ${MIN_INVITES}.`;
    button('Gruppe ansehen', 'pill ch-go', () => openChallenge(1, deps, refresh));
    return;
  }

  if (allDone) {
    h2.textContent = 'Alle Challenges geschafft';
    lead.textContent = 'Ihr habt jedes Thema zusammen gemeistert.';
    button('Eure Fotos ansehen', 'pill ch-go', () => openChallenge(CHALLENGES.length, deps, refresh));
    return;
  }

  const mineIn = submitted(st, cur).some(e => e.user_id === me());
  h2.textContent = CHALLENGES[cur - 1];
  lead.textContent = `Challenge ${cur} · ${submitted(st, cur).length} von ${accepted(st).length} eingereicht`;
  button(mineIn ? 'Ansehen' : 'Foto einreichen', 'pill ch-go', () => openChallenge(cur, deps, refresh));
}

/* ---------- Freunde einladen ---------- */

function openInvite(groupId, st, deps, onDone) {
  const taken = new Set((st?.members || []).map(m => m.user_id));
  const room = groupId ? MAX_GROUP - taken.size : MAX_GROUP - 1;
  const min = groupId ? 1 : MIN_INVITES;
  const picked = new Map();
  const el = screen('about invite');
  el.innerHTML = `
    <div class="about-top"><button class="round" data-a="close" aria-label="Schließen">${icons.close}</button></div>
    <div class="about-body">
      <h1>Freunde einladen</h1>
      <p class="invite-rule"></p>
      <ul class="invite-picked"></ul>
      <label class="field"><span>@Name suchen</span>
        <input type="search" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="@name"></label>
      <ul class="members search-results"></ul>
      <button class="pill primary" data-a="send"></button>
    </div>`;
  el.querySelector('.invite-rule').textContent = groupId
    ? `Noch ${room} ${room === 1 ? 'Platz' : 'Plätze'} frei.`
    : `Mindestens ${MIN_INVITES}, höchstens ${MAX_GROUP - 1} Personen.`;
  const close = () => el.remove();
  el.querySelector('[data-a=close]').addEventListener('click', close);
  const send = el.querySelector('[data-a=send]');
  const pickedList = el.querySelector('.invite-picked');
  const results = el.querySelector('.search-results');
  const input = el.querySelector('input');

  function paint() {
    pickedList.innerHTML = '';
    for (const [uid, p] of picked) {
      const li = document.createElement('li');
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.innerHTML = `<span></span>${icons.close}`;
      chip.querySelector('span').textContent = `@${p.username}`;
      chip.setAttribute('aria-label', `@${p.username} entfernen`);
      chip.addEventListener('click', () => { picked.delete(uid); paint(); });
      li.append(chip);
      pickedList.append(li);
    }
    send.disabled = picked.size < min;
    send.textContent = picked.size ? `${picked.size} ${picked.size === 1 ? 'Person' : 'Personen'} einladen` : 'Einladen';
  }
  paint();

  let timer = 0, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const rows = (await socialApi.search(input.value.replace(/^@/, '')).catch(() => []))
        .filter(p => p.user_id !== me() && !taken.has(p.user_id));
      if (mine !== seq) return;
      results.innerHTML = '';
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
        b.addEventListener('click', () => {
          if (picked.has(p.user_id)) return;
          if (picked.size >= room) { deps.toast('Die Gruppe ist damit voll.'); return; }
          picked.set(p.user_id, p);
          tick();
          input.value = '';
          results.innerHTML = '';
          paint();
        });
        li.append(b);
        results.append(li);
      }
    }, 250);
  });

  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      if (groupId) for (const uid of picked.keys()) await api.invite(groupId, uid);
      else await api.create([...picked.keys()]);
      deps.toast('Einladungen verschickt.');
      close();
      onDone();
    } catch (e) {
      deps.toast(/already/.test(e?.message) ? 'Du bist schon in einer Challenge-Gruppe.' : 'Das hat nicht geklappt. Bist du online?');
      paint();
    }
  });
  setTimeout(() => input.focus(), 60);
}

/* ---------- Eine Challenge ---------- */

async function openChallenge(n, deps, onChange) {
  const el = screen('about challenge');
  el.innerHTML = `<div class="about-top"><button class="round" data-a="close" aria-label="Schließen">${icons.close}</button></div><div class="about-body"></div>`;
  el.querySelector('[data-a=close]').addEventListener('click', () => { el.remove(); onChange(); });
  const body = el.querySelector('.about-body');
  const urls = [];

  async function paint() {
    let st;
    try {
      st = await api.state();
    } catch {
      body.innerHTML = '<p class="about-empty">Die Challenge lässt sich gerade nicht laden. Bist du online?</p>';
      return;
    }
    if (!st.group) { el.remove(); onChange(); return; }
    const open = unlocked(st, n);
    const forming = joinedOthers(st) < MIN_INVITES;
    const mineIn = submitted(st, n).some(e => e.user_id === me());
    body.innerHTML = `
      <ol class="ch-steps ch-tabs" aria-label="Challenges"></ol>
      <p class="ch-kicker">Challenge ${n}</p>
      <h1 class="ch-title"></h1>
      <p class="ch-state"></p>
      <div class="ch-grid"></div>
      <div class="ch-actions"></div>`;
    // Zwischen freien Challenges wechseln, verdeckte bleiben gesperrt
    const tabs = body.querySelector('.ch-tabs');
    CHALLENGES.forEach((_, i) => {
      const k = i + 1;
      const free = k === 1 || unlocked(st, k);
      const li = document.createElement('li');
      li.className = `ch-step ${k === n ? 'now' : done(st, k) && !forming ? 'done' : free ? 'free' : 'later'}`;
      const b = document.createElement('button');
      b.className = 'stamp-clip';
      b.innerHTML = k !== n && done(st, k) && !forming ? icons.check : String(k);
      b.disabled = !free;
      b.setAttribute('aria-label', free ? `Challenge ${k}` : `Challenge ${k}, noch verdeckt`);
      b.addEventListener('click', () => { n = k; paint(); });
      li.append(b);
      tabs.append(li);
    });
    body.querySelector('.ch-title').textContent = CHALLENGES[n - 1];
    body.querySelector('.ch-state').textContent = forming
      ? `Los geht es, sobald ${MIN_INVITES} Eingeladene zugesagt haben. Bisher ${joinedOthers(st)}.`
      : !open ? 'Gesperrt, bis alle die vorige Challenge eingereicht haben.'
        : done(st, n) ? 'Alle haben eingereicht.'
          : `${submitted(st, n).length} von ${accepted(st).length} eingereicht.`;

    const grid = body.querySelector('.ch-grid');
    for (const m of st.members) {
      const entry = submitted(st, n).find(e => e.user_id === m.user_id);
      const cell = document.createElement('div');
      cell.className = 'ch-cell' + (entry ? ' in' : '');
      cell.innerHTML = '<div class="ch-stamp"></div><b></b><small></small>';
      cell.querySelector('b').textContent = m.user_id === me() ? 'Du' : nameOf(m);
      cell.querySelector('small').textContent = m.status === 'invited' ? 'eingeladen' : entry ? 'eingereicht' : '';
      if (entry) {
        api.image(m.user_id, entry.stamp_id).then(b => {
          const url = URL.createObjectURL(b);
          urls.push(url);
          cell.querySelector('.ch-stamp').innerHTML = `<img src="${url}" alt="">`;
        }, () => {});
      }
      grid.append(cell);
    }

    const actions = body.querySelector('.ch-actions');
    if (open) {
      const shoot = document.createElement('button');
      shoot.className = 'pill primary';
      shoot.innerHTML = `${icons.camera}<span>${mineIn ? 'Neues Foto einreichen' : 'Foto einreichen'}</span>`;
      shoot.addEventListener('click', async () => {
        const stamp = await deps.takePhoto();
        if (!stamp) return;
        try {
          await api.submit(st.group.id, n, stamp.id);
          tick();
        } catch {
          deps.toast('Einreichen hat nicht geklappt. Bist du online?');
        }
        paint();
      });
      actions.append(shoot);
    }
    if (st.members.length < MAX_GROUP) {
      const more = document.createElement('button');
      more.className = 'text-btn';
      more.textContent = 'Weitere Freunde einladen';
      more.addEventListener('click', () => openInvite(st.group.id, st, deps, paint));
      actions.append(more);
    }
    const leave = document.createElement('button');
    leave.className = 'text-btn';
    leave.textContent = 'Gruppe verlassen';
    leave.addEventListener('click', async () => {
      if (!(await deps.confirm('Gruppe verlassen?', 'Deine eingereichten Fotos bleiben für die anderen sichtbar.', 'Verlassen'))) return;
      await api.leave(st.group.id).catch(() => deps.toast('Das hat nicht geklappt.'));
      el.remove();
      onChange();
    });
    actions.append(leave);
  }
  paint();
}
