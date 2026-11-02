// Alles liegt lokal in IndexedDB. Vorschaubilder und Originale sind getrennt,
// damit das Album nicht alle großen Bilder laden muss.
const DB_NAME = 'perfo';
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

export async function open() {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('stamps', { keyPath: 'id' });
      r.result.createObjectStore('full');
      r.result.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  navigator.storage?.persist?.().catch(() => {});
  const all = await req(db.transaction('stamps').objectStore('stamps').getAll());
  stamps.length = 0;
  stamps.push(...all);
  bySlot.clear();
  for (const s of stamps) bySlot.set(s.slot, s);
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
  return max < 0 ? 0 : Math.floor(max / PER_PAGE) + 1;
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
