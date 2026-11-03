// Nur im Dev-Server: Profile und Folgen im Browser, mit denselben Sichtregeln wie auf dem Server.
const KEY = 'motif.devSocial';
const load = () => JSON.parse(localStorage.getItem(KEY) || '{"profiles":{},"follows":[],"featured":[]}');
const save = s => localStorage.setItem(KEY, JSON.stringify(s));
const cloudRows = uid => JSON.parse(localStorage.getItem(`motif.devCloud.${uid}`) || '{"stamps":[]}').stamps;

function blob(key) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('motif-dev-cloud', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => {
      const q = r.result.transaction('blobs').objectStore('blobs').get(key);
      q.onsuccess = () => (q.result ? res(q.result) : rej(new Error('not found')));
      q.onerror = () => rej(q.error);
    };
    r.onerror = () => rej(r.error);
  });
}

export function createDevSocialApi(me) {
  const canView = (s, uid) => {
    if (uid === me()) return true;
    const p = s.profiles[uid];
    if (!p) return false;
    return p.visibility === 'public'
      || (p.visibility === 'followers' && s.follows.some(f => f.follower === me() && f.followee === uid && f.status === 'accepted'));
  };
  return {
    async getProfile(uid) { return load().profiles[uid] || null; },
    async search(q) {
      const term = q.toLowerCase().replace(/[^a-z0-9._]/g, '');
      return term ? Object.values(load().profiles).filter(p => p.username.startsWith(term)).slice(0, 20) : [];
    },
    async saveProfile(p) {
      const s = load();
      if (Object.values(s.profiles).some(x => x.username === p.username && x.user_id !== me())) throw { code: '23505' };
      s.profiles[me()] = { ...s.profiles[me()], ...p, user_id: me() };
      save(s);
    },
    async stats(uid) {
      const s = load();
      return {
        posts: s.featured.filter(f => f.user_id === uid).length,
        followers: s.follows.filter(f => f.followee === uid && f.status === 'accepted').length,
        following: s.follows.filter(f => f.follower === uid && f.status === 'accepted').length,
      };
    },
    async canView(uid) { return canView(load(), uid); },
    async myFollow(uid) { return load().follows.find(f => f.follower === me() && f.followee === uid)?.status || null; },
    async follow(uid) {
      const s = load();
      let f = s.follows.find(x => x.follower === me() && x.followee === uid);
      if (!f) { f = { follower: me(), followee: uid, status: s.profiles[uid]?.visibility === 'public' ? 'accepted' : 'pending' }; s.follows.push(f); }
      save(s);
      return f.status;
    },
    async unfollow(uid) { const s = load(); s.follows = s.follows.filter(f => !(f.follower === me() && f.followee === uid)); save(s); },
    async requests() {
      const s = load();
      return s.follows.filter(f => f.followee === me() && f.status === 'pending').map(f => s.profiles[f.follower]).filter(Boolean);
    },
    async accept(uid) { const s = load(); for (const f of s.follows) if (f.followee === me() && f.follower === uid) f.status = 'accepted'; save(s); },
    async acceptAll() { const s = load(); for (const f of s.follows) if (f.followee === me()) f.status = 'accepted'; save(s); },
    async decline(uid) { const s = load(); s.follows = s.follows.filter(f => !(f.followee === me() && f.follower === uid)); save(s); },
    async feed(uid) {
      const s = load();
      if (!canView(s, uid)) return [];
      const ids = new Set(s.featured.filter(f => f.user_id === uid).map(f => f.stamp_id));
      return cloudRows(uid).filter(r => ids.has(r.id)).map(r => ({ ...r, user_id: uid }))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    },
    async myFeatured() { return new Set(load().featured.filter(f => f.user_id === me()).map(f => f.stamp_id)); },
    async feature(id) {
      const s = load();
      if (!cloudRows(me()).some(r => r.id === id)) throw new Error('not synced');
      if (!s.featured.some(f => f.stamp_id === id)) s.featured.push({ stamp_id: id, user_id: me() });
      save(s);
    },
    async unfeature(id) { const s = load(); s.featured = s.featured.filter(f => f.stamp_id !== id); save(s); },
    image: (uid, id, kind) => blob(`${uid}/${id}_${kind}`),
    avatar: uid => blob(`${uid}/me_avatar`),
  };
}
