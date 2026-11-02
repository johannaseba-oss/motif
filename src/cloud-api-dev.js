// Nur im Dev-Server: Album-"Server" im Browser, getrennt vom Gerätespeicher, um einen zweiten Browser nachzustellen.
const key = uid => `motif.devCloud.${uid}`;

function blobDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('motif-dev-cloud', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function blobOp(mode, fn) {
  const db = await blobDb();
  return new Promise((res, rej) => {
    const q = fn(db.transaction('blobs', mode).objectStore('blobs'));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export function createDevCloudApi(getUid) {
  const load = () => JSON.parse(localStorage.getItem(key(getUid())) || '{"meta":null,"stamps":[]}');
  const save = s => localStorage.setItem(key(getUid()), JSON.stringify(s));
  const name = (id, kind) => `${getUid()}/${id}_${kind}`;
  return {
    async getMeta() { return load().meta; },
    async putMeta(meta) { const s = load(); s.meta = meta; save(s); },
    async listStamps() { return load().stamps; },
    async upsertStamp(x) {
      const s = load();
      s.stamps = s.stamps.filter(r => r.id !== x.id);
      s.stamps.push({ id: x.id, slot: x.slot, name: x.name || '', description: x.desc || '', created_at: new Date(x.createdAt).toISOString() });
      save(s);
    },
    async uploadImages(id, thumb, full) {
      await blobOp('readwrite', o => o.put(thumb, name(id, 'thumb')));
      await blobOp('readwrite', o => o.put(full, name(id, 'full')));
    },
    download: (id, kind) => blobOp('readonly', o => o.get(name(id, kind))),
    async deleteStamp(id) { const s = load(); s.stamps = s.stamps.filter(r => r.id !== id); save(s); },
    uploadAvatar: blob => blobOp('readwrite', o => o.put(blob, name('me', 'avatar'))),
    downloadAvatar: () => blobOp('readonly', o => o.get(name('me', 'avatar'))),
  };
}
