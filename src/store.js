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
}

let pageTitles = {};
export const getPageTitle = page => pageTitles[page] || '';
export function setPageTitle(page, title) {
  if (title) pageTitles[page] = title; else delete pageTitles[page];
  return tx('meta', 'readwrite', t => t.objectStore('meta').put(pageTitles, 'pageTitles'));
}

export async function getProfile() {
  return (await req(db.transaction('meta').objectStore('meta').get('profile'))) || null;
}
export function saveProfile(p) {
  return tx('meta', 'readwrite', t => t.objectStore('meta').put(p, 'profile'));
}

export function firstFreeSlot() {
  let s = 0;
  while (bySlot.has(s)) s++;
  return s;
}
export function usedPages() {
  let max = -1;
  for (const s of stamps) if (s.slot > max) max = s.slot;
  const stampPages = max < 0 ? 0 : Math.floor(max / PER_PAGE) + 1;
  return Math.max(stampPages, ...Object.keys(pageTitles).map(p => +p + 1));
}

export async function addStamp({ full, thumb, createdAt = Date.now() }) {
  const s = { id: crypto.randomUUID(), slot: firstFreeSlot(), createdAt, thumb };
  await tx(['stamps', 'full'], 'readwrite', t => {
    t.objectStore('stamps').put(s);
    t.objectStore('full').put(full, s.id);
  });
  stamps.push(s);
  bySlot.set(s.slot, s);
  return s;
}

// Legt eine Marke auf einen Platz; ein belegter Platz tauscht.
export async function moveStamp(s, slot) {
  if (s.slot === slot) return null;
  const other = bySlot.get(slot) || null;
  const from = s.slot;
  bySlot.delete(from);
  s.slot = slot;
  bySlot.set(slot, s);
  if (other) { other.slot = from; bySlot.set(from, other); }
  await tx('stamps', 'readwrite', t => {
    t.objectStore('stamps').put(s);
    if (other) t.objectStore('stamps').put(other);
  });
  return other;
}

export function updateStamp(s, fields) {
  Object.assign(s, fields);
  return tx('stamps', 'readwrite', t => t.objectStore('stamps').put(s));
}

export async function deleteStamp(s) {
  await tx(['stamps', 'full'], 'readwrite', t => {
    t.objectStore('stamps').delete(s.id);
    t.objectStore('full').delete(s.id);
  });
  stamps.splice(stamps.indexOf(s), 1);
  bySlot.delete(s.slot);
}

export function getFull(id) {
  return req(db.transaction('full').objectStore('full').get(id));
}
