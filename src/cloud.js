// Gleicht das private Album mit dem Konto ab. Das Gerät bleibt der Arbeitsspeicher:
// Änderungen landen zuerst dort und gehen hoch, sobald Netz da ist.
import * as store from './store.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import { createCloudApi } from './cloud-api.js';

let api = null;
let running = false;
let again = false;
export let lastError = false;

export async function init() {
  const client = auth.getClient();
  if (import.meta.env.DEV && client.isDev) {
    const { createDevCloudApi } = await import('./cloud-api-dev.js');
    api = createDevCloudApi(() => auth.user.id);
  } else {
    api = createCloudApi(client, () => auth.user.id);
  }
  store.setCloudFull(id => api.download(id, 'full'));
}

// Private Marken auf einer gemeinsamen Seite machen Platz
function clearSharedPages() {
  let moved = false;
  for (const s of store.stamps) {
    if (s.shared || !store.isShared(Math.floor(s.slot / store.PER_PAGE))) continue;
    if (store.bySlot.get(s.slot) === s) store.bySlot.delete(s.slot);
    s.slot = store.firstFreeSlot();
    s.dirty = true;
    store.bySlot.set(s.slot, s);
    store.persistLocal(s);
    moved = true;
  }
  return moved;
}

async function pull(rows, removed) {
  let changed = false;
  const remote = new Map(rows.map(r => [r.id, r]));
  const tombstones = store.tombstones();

  for (const s of store.stamps.filter(x => !x.shared && x.synced && !remote.has(x.id))) {
    await store.dropPrivate(s);
    removed.push(s.id);
    changed = true;
  }

  // Erst alle verschobenen Marken herausnehmen, sonst stören sich getauschte Marken gegenseitig
  const place = [];
  for (const row of rows) {
    const s = store.stamps.find(x => x.id === row.id);
    if (!s) {
      if (!tombstones.includes(row.id)) place.push({ row, thumb: await api.download(row.id, 'thumb') });
    } else if (!s.shared && s.synced && !s.dirty) {
      if (s.name !== row.name || s.desc !== row.description) {
        s.name = row.name;
        s.desc = row.description;
        await store.persistLocal(s);
        changed = true;
      }
      if (s.slot !== row.slot) {
        if (store.bySlot.get(s.slot) === s) store.bySlot.delete(s.slot);
        place.push({ row, s });
      }
    }
  }
  for (const { row, thumb, s: known } of place) {
    const wanted = row.slot;
    const free = !store.bySlot.has(wanted) && !store.isShared(Math.floor(wanted / store.PER_PAGE));
    const slot = free ? wanted : store.firstFreeSlot();
    const s = known || { id: row.id, createdAt: Date.parse(row.created_at), thumb, name: row.name, desc: row.description, synced: true };
    s.slot = slot;
    if (!free) s.dirty = true;
    if (!known) store.stamps.push(s);
    store.bySlot.set(slot, s);
    await store.persistLocal(s);
    changed = true;
  }
  return changed;
}

async function push() {
  for (const s of store.stamps.filter(x => !x.shared && !x.pending && !x.synced)) {
    const full = await store.getFull(s.id);
    if (!full) continue;
    await api.uploadImages(s.id, s.thumb, full);
    await api.upsertStamp(s);
    if (s.shared) continue;
    s.synced = true;
    s.dirty = false;
    await store.persistLocal(s);
  }
  for (const s of store.stamps.filter(x => !x.shared && x.synced && x.dirty)) {
    await api.upsertStamp(s);
    s.dirty = false;
    await store.persistLocal(s);
  }
}

async function syncAvatar(meta) {
  const profile = await store.getProfile();
  if (!profile) return false;
  const version = meta.avatar_version || 0;
  const mine = profile.avatarVersion || 0;
  if (profile.avatar && (profile.avatarDirty || (!mine && !version))) {
    await api.uploadAvatar(profile.avatar);
    meta.avatar_version = version + 1;
    await store.saveProfile({ ...profile, avatarDirty: false, avatarVersion: meta.avatar_version });
    return 'pushed';
  }
  if (version > mine) {
    const avatar = await api.downloadAvatar();
    await store.saveProfile({ ...profile, avatar, avatarDirty: false, avatarVersion: version });
    return 'pulled';
  }
  return false;
}

const sameJson = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
const sortedKeys = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a - b));

// Ein kompletter Abgleich. isBusy: läuft gerade eine Geste, wird nichts am Album verschoben.
export async function syncAll(isBusy = () => false) {
  if (running) { again = true; return { changed: false, removed: [], avatar: false }; }
  running = true;
  const removed = [];
  let changed = false;
  let avatar = false;
  try {
    const stored = await api.getMeta();
    const meta = { page_titles: {}, shared_map: {}, avatar_version: 0, ...stored };
    const metaBefore = JSON.stringify(sortedKeys(meta.page_titles)) + JSON.stringify(sortedKeys(meta.shared_map));

    // Gemeinsame Seiten liegen auf jedem Gerät auf derselben Albumseite
    sync.setPreferredPages(meta.shared_map);
    if (store.applySharedPlaces(meta.shared_map)) changed = true;
    const shared = await sync.refresh();
    removed.push(...shared.removed);
    if (shared.changed) changed = true;
    if (clearSharedPages()) changed = true;

    for (const id of store.tombstones()) {
      await api.deleteStamp(id);
      await store.clearTombstone(id);
    }

    if (!isBusy()) {
      if (await pull(await api.listStamps(), removed)) changed = true;
      if (store.applyRemoteTitles(meta.page_titles)) changed = true;
    }
    await push();

    meta.page_titles = store.mergedTitles(meta.page_titles);
    meta.shared_map = store.currentSharedMap();
    avatar = await syncAvatar(meta);
    const metaAfter = JSON.stringify(sortedKeys(meta.page_titles)) + JSON.stringify(sortedKeys(meta.shared_map));
    if (!stored || metaBefore !== metaAfter || avatar === 'pushed' || !sameJson(stored.avatar_version, meta.avatar_version)) {
      await api.putMeta({ page_titles: meta.page_titles, shared_map: meta.shared_map, avatar_version: meta.avatar_version });
    }
    await store.clearDirtyTitles();
    lastError = false;
  } catch (e) {
    lastError = true;
    throw e;
  } finally {
    running = false;
    if (again) { again = false; setTimeout(() => trigger(), 200); }
  }
  return { changed, removed, avatar };
}

export let trigger = () => {};
export const setTrigger = f => { trigger = f; };
