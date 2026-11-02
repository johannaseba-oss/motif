// Alles liegt lokal in IndexedDB. Vorschaubilder und Originale sind getrennt,
// damit das Album nicht alle großen Bilder laden muss.
// Jedes Konto hat auf dem Gerät sein eigenes Album.
const LEGACY_DB = 'perfo';
const LEGACY_DONE = 'motif.legacyAlbumMoved';
let db;

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

export const PER_PAGE = 16;
export const stamps = []; // {id, slot, createdAt, thumb}
export const bySlot = new Map();

function openDb(name) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('stamps', { keyPath: 'id' });
      r.result.createObjectStore('full');
      r.result.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// Das Album aus der Zeit vor den Konten geht an das erste Konto, das sich hier anmeldet
async function adoptLegacyAlbum() {
  if (localStorage.getItem(LEGACY_DONE)) return;
  const known = await indexedDB.databases?.();
  if (known?.some(d => d.name === LEGACY_DB)) {
    const old = await openDb(LEGACY_DB);
    const read = async store => {
      const os = old.transaction(store).objectStore(store);
      const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
      return keys.map((key, i) => [key, values[i]]);
    };
    const [stampRows, fullRows, metaRows] = [await read('stamps'), await read('full'), await read('meta')];
    await tx(['stamps', 'full', 'meta'], 'readwrite', t => {
      for (const [, v] of stampRows) t.objectStore('stamps').put(v);
      for (const [k, v] of fullRows) t.objectStore('full').put(v, k);
      for (const [k, v] of metaRows) t.objectStore('meta').put(v, k);
    });
    old.close();
    indexedDB.deleteDatabase(LEGACY_DB);
  }
  localStorage.setItem(LEGACY_DONE, '1');
}

export async function open(accountId) {
  db = await openDb(`motif-${accountId}`);
  await adoptLegacyAlbum();
  navigator.storage?.persist?.().catch(() => {});
  const all = await req(db.transaction('stamps').objectStore('stamps').getAll());
  stamps.length = 0;
  stamps.push(...all);
  bySlot.clear();
  for (const s of stamps) bySlot.set(s.slot, s);
  pageTitles = (await req(db.transaction('meta').objectStore('meta').get('pageTitles'))) || {};
  shared = (await req(db.transaction('meta').objectStore('meta').get('sharedPages'))) || {};
  deleted = (await req(db.transaction('meta').objectStore('meta').get('tombstones'))) || [];
  dirtyTitles = (await req(db.transaction('meta').objectStore('meta').get('dirtyTitles'))) || {};
}

/* Abgleich mit dem Konto: gelöschte Marken und geänderte Titel warten hier, bis Netz da ist */
let deleted = [];
let dirtyTitles = {};
let cloudFull = null;
let onChange = () => {};
export const setCloudFull = f => { cloudFull = f; };
export const setOnChange = f => { onChange = f; };
const saveMeta = (key, value) => tx('meta', 'readwrite', t => t.objectStore('meta').put(value, key));
export const tombstones = () => [...deleted];
export function clearTombstone(id) {
  deleted = deleted.filter(x => x !== id);
  return saveMeta('tombstones', deleted);
}
function addTombstone(id) {
  if (!deleted.includes(id)) deleted.push(id);
  return saveMeta('tombstones', deleted);
}
export const pendingUploads = () => stamps.filter(s => !s.shared && (!s.synced || s.dirty)).length + deleted.length;

// Marke wurde auf einem anderen Gerät gelöscht
export async function dropPrivate(s) {
  await tx(['stamps', 'full'], 'readwrite', t => {
    t.objectStore('stamps').delete(s.id);
    t.objectStore('full').delete(s.id);
  });
  stamps.splice(stamps.indexOf(s), 1);
  if (bySlot.get(s.slot) === s) bySlot.delete(s.slot);
}

export function applyRemoteTitles(remote) {
  let changed = false;
  const next = { ...remote, ...dirtyTitles };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  if (JSON.stringify(next) !== JSON.stringify(pageTitles)) { pageTitles = next; changed = true; saveMeta('pageTitles', pageTitles); }
  return changed;
}
export function mergedTitles(remote) {
  const next = { ...remote, ...dirtyTitles };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  return next;
}
export async function clearDirtyTitles() {
  if (!Object.keys(dirtyTitles).length) return;
  dirtyTitles = {};
  await saveMeta('dirtyTitles', dirtyTitles);
}

export const currentSharedMap = () => Object.fromEntries(Object.entries(shared).map(([page, info]) => [page, info.id]));

// Gemeinsame Seiten auf die im Konto gemerkte Albumseite legen
export function applySharedPlaces(map) {
  let changed = false;
  for (const [page, id] of Object.entries(map || {})) {
    const cur = pageOfShared(id);
    if (cur == null || cur === +page || shared[page]) continue;
    shared[page] = shared[cur];
    delete shared[cur];
    changed = true;
  }
  return changed;
}

/* Gemeinsame Seiten: Albumseite -> Angaben vom Server. Die Serverzugriffe kommen aus sync.js. */
let shared = {};
let ops = null;
let titleOp = null;
export const setSharedOps = o => { ops = o; };
export const setSharedTitleOp = f => { titleOp = f; };
export const sharedPages = () => shared;
export const sharedPage = page => shared[page] || null;
export const isShared = page => !!shared[page];
export function pageOfShared(id) {
  const hit = Object.entries(shared).find(([, info]) => info.id === id);
  return hit ? +hit[0] : null;
}
export const setSharedPage = (page, info) => { shared[page] = info; };
export const unsetSharedPage = page => { delete shared[page]; };
export const saveSharedPages = () => tx('meta', 'readwrite', t => t.objectStore('meta').put(shared, 'sharedPages'));

export function firstFreeSlotOnPage(page) {
  for (let c = 0; c < PER_PAGE; c++) if (!bySlot.has(page * PER_PAGE + c)) return page * PER_PAGE + c;
  return null;
}
export function firstEmptyPage() {
  for (let p = 0; ; p++) {
    if (isShared(p) || pageTitles[p]) continue;
    if (!stamps.some(s => Math.floor(s.slot / PER_PAGE) === p)) return p;
  }
}

// Was beim Ablegen passieren darf: true, 'share' (wird hochgeladen, vorher fragen) oder false
export function dropRule(s, slot) {
  const page = Math.floor(slot / PER_PAGE);
  const other = bySlot.get(slot);
  if (other === s) return true;
  if (s.shared) return page === Math.floor(s.slot / PER_PAGE) && !other;
  if (isShared(page)) return other ? false : 'share';
  return other?.shared ? false : true;
}

export async function deleteLocalRecord(id) {
  await tx(['stamps', 'full'], 'readwrite', t => {
    t.objectStore('stamps').delete(id);
    t.objectStore('full').delete(id);
  });
  await addTombstone(id);
  onChange();
}
export const persistLocal = s => tx('stamps', 'readwrite', t => t.objectStore('stamps').put(s));

let pageTitles = {};
export const getPageTitle = page => (shared[page] ? shared[page].title : pageTitles[page]) || '';
export function setPageTitle(page, title) {
  if (shared[page]) return titleOp(page, title);
  return setPageTitleLocal(page, title);
}
export function setPageTitleLocal(page, title) {
  if (title) pageTitles[page] = title; else delete pageTitles[page];
  dirtyTitles[page] = title;
  saveMeta('dirtyTitles', dirtyTitles);
  onChange();
  return saveMeta('pageTitles', pageTitles);
}

export async function getProfile() {
  return (await req(db.transaction('meta').objectStore('meta').get('profile'))) || null;
}
export function saveProfile(p) {
  return tx('meta', 'readwrite', t => t.objectStore('meta').put(p, 'profile'));
}

export function firstFreeSlot() {
  let s = 0;
  while (bySlot.has(s) || isShared(Math.floor(s / PER_PAGE))) s++;
  return s;
}
export function usedPages() {
  let max = -1;
  for (const s of stamps) if (s.slot > max) max = s.slot;
  const stampPages = max < 0 ? 0 : Math.floor(max / PER_PAGE) + 1;
  return Math.max(stampPages, ...[...Object.keys(pageTitles), ...Object.keys(shared)].map(p => +p + 1));
}

export async function addStamp({ full, thumb, createdAt = Date.now() }) {
  const s = { id: crypto.randomUUID(), slot: firstFreeSlot(), createdAt, thumb };
  await tx(['stamps', 'full'], 'readwrite', t => {
    t.objectStore('stamps').put(s);
    t.objectStore('full').put(full, s.id);
  });
  stamps.push(s);
  bySlot.set(s.slot, s);
  onChange();
  return s;
}

// Legt eine Marke auf einen Platz; ein belegter Platz tauscht.
export async function moveStamp(s, slot) {
  if (s.slot === slot) return null;
  if (s.shared) { await ops.move(s, slot); return null; }
  if (isShared(Math.floor(slot / PER_PAGE))) { await ops.adopt(s, slot); return null; }
  const other = bySlot.get(slot) || null;
  const from = s.slot;
  bySlot.delete(from);
  s.slot = slot;
  bySlot.set(slot, s);
  s.dirty = true;
  if (other) { other.slot = from; other.dirty = true; bySlot.set(from, other); }
  await tx('stamps', 'readwrite', t => {
    t.objectStore('stamps').put(s);
    if (other) t.objectStore('stamps').put(other);
  });
  onChange();
  return other;
}

export function updateStamp(s, fields) {
  if (s.shared) return ops.update(s, fields);
  Object.assign(s, fields);
  s.dirty = true;
  onChange();
  return tx('stamps', 'readwrite', t => t.objectStore('stamps').put(s));
}

export async function deleteStamp(s) {
  if (s.shared) return ops.remove(s);
  await tx(['stamps', 'full'], 'readwrite', t => {
    t.objectStore('stamps').delete(s.id);
    t.objectStore('full').delete(s.id);
  });
  stamps.splice(stamps.indexOf(s), 1);
  bySlot.delete(s.slot);
  await addTombstone(s.id);
  onChange();
}

export async function getFull(id) {
  const s = stamps.find(x => x.id === id);
  if (s?.shared && !s.pending) return ops.full(s);
  const local = await req(db.transaction('full').objectStore('full').get(id));
  if (local || !s?.synced) return local;
  // Marke von einem anderen Gerät: Original nachladen und auf diesem Gerät behalten
  const blob = await cloudFull(id);
  await tx('full', 'readwrite', t => t.objectStore('full').put(blob, id));
  return blob;
}
