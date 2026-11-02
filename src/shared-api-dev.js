// Nur im Dev-Server: gemeinsame Seiten ohne Server, damit sich zwei Testkonten im selben Browser testen lassen.
const KEY = 'motif.devShared';
const load = () => JSON.parse(localStorage.getItem(KEY) || '{"pages":[],"stamps":[]}');
const save = s => localStorage.setItem(KEY, JSON.stringify(s));

function blobDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('motif-dev-shared', 1);
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

export function createDevApi(getUser) {
  const me = () => getUser().id;
  return {
    async listPages() {
      return load().pages.filter(p => p.members.some(m => m.user_id === me()));
    },
    async listStamps(ids) { return load().stamps.filter(s => ids.includes(s.page_id)); },
    async createPage(title, name) {
      const s = load();
      const id = crypto.randomUUID();
      s.pages.push({ id, title, owner: me(), token: crypto.randomUUID().replaceAll('-', ''), members: [{ user_id: me(), display_name: name }] });
      save(s);
      return id;
    },
    async joinPage(token, name) {
      const s = load();
      const p = s.pages.find(x => x.token === token);
      if (!p) throw new Error('invalid invite');
      if (!p.members.some(m => m.user_id === me())) p.members.push({ user_id: me(), display_name: name });
      save(s);
      return p.id;
    },
    async leavePage(pageId, userId) {
      const s = load();
      const p = s.pages.find(x => x.id === pageId);
      p.members = p.members.filter(m => m.user_id !== userId);
      save(s);
    },
    async removeMember(pageId, userId) { return this.leavePage(pageId, userId); },
    async deletePage(pageId) {
      const s = load();
      s.pages = s.pages.filter(p => p.id !== pageId);
      s.stamps = s.stamps.filter(x => x.page_id !== pageId);
      save(s);
    },
    async setTitle(pageId, title) {
      const s = load();
      s.pages.find(p => p.id === pageId).title = title;
      save(s);
    },
    async setMemberName(userId, display_name) {
      const s = load();
      for (const p of s.pages) for (const m of p.members) if (m.user_id === userId) m.display_name = display_name;
      save(s);
    },
    async upload(pageId, id, thumb, full) {
      await blobOp('readwrite', o => o.put(thumb, `${id}_thumb`));
      await blobOp('readwrite', o => o.put(full, `${id}_full`));
    },
    async insertStamp(row) {
      const s = load();
      if (s.stamps.some(x => x.page_id === row.page_id && x.cell === row.cell)) throw { code: '23505' };
      s.stamps.push({ ...row, created_at: new Date().toISOString() });
      save(s);
    },
    download: (pageId, id, kind) => blobOp('readonly', o => o.get(`${id}_${kind}`)),
    async updateStamp(id, fields) {
      const s = load();
      Object.assign(s.stamps.find(x => x.id === id), fields);
      save(s);
    },
    async deleteStamp(pageId, id) {
      const s = load();
      s.stamps = s.stamps.filter(x => x.id !== id);
      save(s);
    },
  };
}
