// Nur im Dev-Server: Challenge-Gruppen im Browser, mit denselben Regeln wie auf dem Server.
const KEY = 'motif.devChallenges';
const load = () => JSON.parse(localStorage.getItem(KEY) || '{"groups":[],"members":[],"entries":[]}');
const save = s => localStorage.setItem(KEY, JSON.stringify(s));
const profiles = () => JSON.parse(localStorage.getItem('motif.devSocial') || '{"profiles":{}}').profiles;
const fail = msg => { throw new Error(msg); };

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

export function unlocked(s, g, n) {
  const group = s.groups.find(x => x.id === g);
  const acc = s.members.filter(m => m.group_id === g && m.status === 'accepted');
  if (acc.filter(m => m.user_id !== group.owner).length < 3) return false;
  return n === 1 || acc.every(m => s.entries.some(e => e.group_id === g && e.challenge === n - 1 && e.user_id === m.user_id));
}

export function createDevChallengeApi(me) {
  const myGroup = s => s.members.find(m => m.user_id === me() && m.status === 'accepted')?.group_id || null;
  return {
    async state() {
      const s = load(), p = profiles();
      const gid = myGroup(s);
      const group = gid ? s.groups.find(g => g.id === gid) : null;
      return {
        group,
        members: gid ? s.members.filter(m => m.group_id === gid).map(m => ({ user_id: m.user_id, status: m.status, profile: p[m.user_id] || null })) : [],
        entries: gid ? s.entries.filter(e => e.group_id === gid) : [],
        invitations: s.members.filter(m => m.user_id === me() && m.status === 'invited')
          .map(m => ({ group_id: m.group_id, owner: p[s.groups.find(g => g.id === m.group_id).owner] || null })),
      };
    },
    async create(ids) {
      const s = load();
      if (myGroup(s)) fail('already in group');
      if (ids.length < 3 || ids.length > 5 || ids.includes(me())) fail('invalid invitees');
      const id = crypto.randomUUID();
      s.groups.push({ id, owner: me() });
      s.members.push({ group_id: id, user_id: me(), status: 'accepted' }, ...ids.map(u => ({ group_id: id, user_id: u, status: 'invited' })));
      save(s);
      return id;
    },
    async invite(g, uid) {
      const s = load();
      if (s.members.filter(m => m.group_id === g).length >= 6) fail('group full');
      if (!s.members.some(m => m.group_id === g && m.user_id === uid)) s.members.push({ group_id: g, user_id: uid, status: 'invited' });
      save(s);
    },
    async accept(g) {
      const s = load();
      if (myGroup(s)) fail('already in group');
      const m = s.members.find(x => x.group_id === g && x.user_id === me());
      if (!m) fail('no invitation');
      m.status = 'accepted';
      save(s);
    },
    async leave(g) { const s = load(); s.members = s.members.filter(m => !(m.group_id === g && m.user_id === me())); save(s); },
    async submit(g, n, stampId) {
      const s = load();
      if (!unlocked(s, g, n)) fail('locked');
      s.entries = s.entries.filter(e => !(e.group_id === g && e.challenge === n && e.user_id === me()));
      s.entries.push({ group_id: g, challenge: n, user_id: me(), stamp_id: stampId });
      save(s);
    },
    image: (uid, stampId) => blob(`${uid}/${stampId}_thumb`),
  };
}
