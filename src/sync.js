// Hält die gemeinsamen Seiten im Album aktuell. Ihre Marken leben auf dem Server,
// im Album erscheinen sie als Einträge mit dem Feld "shared".
import * as store from './store.js';
import * as auth from './auth.js';
import { createApi, isCellTaken } from './shared-api.js';

const { PER_PAGE } = store;
let api = null;
let refreshing = false;
export const handlers = { failed() {}, changed() {} };
let preferred = {};
export const setPreferredPages = map => { preferred = map || {}; };
function placeFor(id) {
  const hit = Object.entries(preferred).find(([, v]) => v === id);
  return hit && !store.isShared(+hit[0]) ? +hit[0] : store.firstEmptyPage();
}

export async function init() {
  const client = auth.getClient();
  if (import.meta.env.DEV && client.isDev) {
    const { createDevApi } = await import('./shared-api-dev.js');
    api = createDevApi(() => auth.user);
  } else {
    api = createApi(client);
  }
  store.setSharedOps({ move, adopt, update, remove, full });
}

const me = () => auth.user.id;
export const isMine = s => !s.shared || s.shared.owner === me();
export const canDelete = s => isMine(s) || store.sharedPage(pageOf(s))?.owner === me();
const pageOf = s => Math.floor(s.slot / PER_PAGE);

function memberName(info, userId) {
  return info.members.find(m => m.user_id === userId)?.display_name || '';
}

function placeRemote(page, info, row, thumb) {
  const s = {
    id: row.id, slot: page * PER_PAGE + row.cell, createdAt: Date.parse(row.created_at),
    thumb, name: row.name, desc: row.description,
    shared: { pageId: info.id, owner: row.owner, ownerName: memberName(info, row.owner) },
  };
  store.stamps.push(s);
  store.bySlot.set(s.slot, s);
  return s;
}

function dropRemote(s) {
  store.stamps.splice(store.stamps.indexOf(s), 1);
  if (store.bySlot.get(s.slot) === s) store.bySlot.delete(s.slot);
}

// Holt den aktuellen Stand. Liefert die entfernten IDs und ob sich etwas geändert hat.
export async function refresh() {
  if (refreshing) return { changed: false, removed: [] };
  refreshing = true;
  try {
    const pages = await api.listPages();
    const rows = await api.listStamps(pages.map(p => p.id));
    const removed = [];
    let changed = false;

    // Seiten, zu denen der Zugang fehlt, verschwinden; neue bekommen eine leere Albumseite
    for (const [page, info] of Object.entries(store.sharedPages())) {
      if (!pages.some(p => p.id === info.id)) {
        for (const s of store.stamps.filter(x => x.shared?.pageId === info.id)) { dropRemote(s); removed.push(s.id); }
        store.unsetSharedPage(+page);
        changed = true;
      }
    }
    for (const info of pages) {
      let page = store.pageOfShared(info.id);
      if (page == null) { page = placeFor(info.id); changed = true; }
      const old = store.sharedPage(page);
      if (old?.title !== info.title || old?.members.length !== info.members.length) changed = true;
      store.setSharedPage(page, info);

      const here = rows.filter(r => r.page_id === info.id);
      for (const s of store.stamps.filter(x => x.shared?.pageId === info.id && !x.pending)) {
        if (!here.some(r => r.id === s.id)) { dropRemote(s); removed.push(s.id); changed = true; }
      }
      for (const row of here) {
        const s = store.stamps.find(x => x.id === row.id);
        if (!s) {
          placeRemote(page, info, row, await api.download(info.id, row.id, 'thumb'));
          changed = true;
        } else if (!s.pending) {
          const slot = page * PER_PAGE + row.cell;
          if (s.slot !== slot) {
            if (store.bySlot.get(s.slot) === s) store.bySlot.delete(s.slot);
            s.slot = slot;
            store.bySlot.set(slot, s);
            changed = true;
          }
          if (s.name !== row.name || s.desc !== row.description) { s.name = row.name; s.desc = row.description; changed = true; }
          s.shared.ownerName = memberName(info, row.owner);
        }
      }
    }
    await store.saveSharedPages();
    return { changed, removed };
  } finally {
    refreshing = false;
  }
}

async function uploadTo(page, s, full) {
  const info = store.sharedPage(page);
  await api.upload(info.id, s.id, s.thumb, full);
  for (;;) {
    try {
      await api.insertStamp({
        id: s.id, page_id: info.id, owner: me(), cell: s.slot % PER_PAGE,
        name: s.name || '', description: s.desc || '',
      });
      return;
    } catch (e) {
      if (!isCellTaken(e)) throw e;
      await refresh();
      const free = store.firstFreeSlotOnPage(page);
      if (free == null) throw e;
      if (store.bySlot.get(s.slot) === s) store.bySlot.delete(s.slot);
      s.slot = free;
      store.bySlot.set(free, s);
    }
  }
}

// Neue Aufnahme auf eine gemeinsame Seite. Klappt das Hochladen nicht, bleibt das Foto privat im Album.
export function addToShared(page, cut, onFailed) {
  const info = store.sharedPage(page);
  const s = {
    id: crypto.randomUUID(), slot: store.firstFreeSlotOnPage(page), createdAt: Date.now(), thumb: cut.thumb, name: '', desc: '',
    shared: { pageId: info.id, owner: me(), ownerName: memberName(info, me()) }, pending: true,
  };
  store.stamps.push(s);
  store.bySlot.set(s.slot, s);
  uploadTo(page, s, cut.full).then(() => { s.pending = false; handlers.changed(); }, async () => {
    dropRemote(s);
    const kept = await store.addStamp(cut);
    onFailed(s.id, kept);
  });
  return s;
}

// Private Marke auf eine gemeinsame Seite gezogen
async function adopt(s, slot) {
  const from = s.slot;
  const page = Math.floor(slot / PER_PAGE);
  const info = store.sharedPage(page);
  const full_ = await store.getFull(s.id);
  if (store.bySlot.get(from) === s) store.bySlot.delete(from);
  s.slot = slot;
  s.pending = true;
  s.shared = { pageId: info.id, owner: me(), ownerName: memberName(info, me()) };
  store.bySlot.set(slot, s);
  uploadTo(page, s, full_).then(async () => {
    s.pending = false;
    await store.deleteLocalRecord(s.id);
    handlers.changed();
  }, async () => {
    store.bySlot.delete(s.slot);
    delete s.shared;
    delete s.pending;
    s.slot = store.firstFreeSlot();
    store.bySlot.set(s.slot, s);
    await store.persistLocal(s);
    handlers.failed();
    handlers.changed();
  });
}

async function move(s, slot) {
  store.bySlot.delete(s.slot);
  s.slot = slot;
  store.bySlot.set(slot, s);
  await api.updateStamp(s.id, { cell: slot % PER_PAGE });
}

async function update(s, fields) {
  Object.assign(s, fields);
  await api.updateStamp(s.id, { name: s.name || '', description: s.desc || '' });
}

async function remove(s) {
  await api.deleteStamp(s.shared.pageId, s.id);
  dropRemote(s);
}

const full = s => api.download(s.shared.pageId, s.id, 'full');

// Macht aus einer privaten Albumseite eine gemeinsame und lädt ihre Marken hoch
export async function sharePage(page, displayName) {
  const title = store.getPageTitle(page);
  const id = await api.createPage(title, displayName);
  const local = store.stamps.filter(s => !s.shared && pageOf(s) === page);
  store.setSharedPage(page, { id, title, owner: me(), token: null, members: [{ user_id: me(), display_name: displayName }] });
  await store.setPageTitleLocal(page, '');
  for (const s of local) {
    const blob = await store.getFull(s.id);
    await api.upload(id, s.id, s.thumb, blob);
    await api.insertStamp({ id: s.id, page_id: id, owner: me(), cell: s.slot % PER_PAGE, name: s.name || '', description: s.desc || '' });
    await store.deleteLocalRecord(s.id);
    s.shared = { pageId: id, owner: me(), ownerName: displayName };
  }
  await refresh();
}

export async function joinByToken(token, displayName) {
  const id = await api.joinPage(token, displayName);
  await refresh();
  return store.pageOfShared(id);
}

export async function leave(page) {
  const info = store.sharedPage(page);
  await api.leavePage(info.id, me());
  return refresh();
}

export async function endSharing(page) {
  const info = store.sharedPage(page);
  const ids = store.stamps.filter(s => s.shared?.pageId === info.id).map(s => s.id);
  await api.deletePage(info.id, ids);
  return refresh();
}

export async function removeMember(page, userId) {
  await api.removeMember(store.sharedPage(page).id, userId);
  return refresh();
}

export const setTitle = (page, title) => {
  const info = store.sharedPage(page);
  info.title = title;
  store.saveSharedPages();
  return api.setTitle(info.id, title);
};
store.setSharedTitleOp(setTitle);

export const setDisplayName = name => api.setMemberName(me(), name);
