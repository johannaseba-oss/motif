// Profile, Folgen und gezeigte Marken in Supabase
const BUCKET = 'albums';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export function createSocialApi(sb, me) {
  const profiles = ids => (ids.length ? sb.from('profiles').select('*').in('user_id', ids) : Promise.resolve({ data: [] }));
  return {
    getProfile: async uid => check(await sb.from('profiles').select('*').eq('user_id', uid).maybeSingle()),
    async search(q) {
      const term = q.toLowerCase().replace(/[^a-z0-9._]/g, '');
      if (!term) return [];
      return check(await sb.from('profiles').select('*').ilike('username', `${term.replace(/[_]/g, '\\_')}%`).order('username').limit(20));
    },
    async saveProfile(p) {
      check(await sb.from('profiles').upsert({ user_id: me(), ...p }));
    },
    stats: async uid => (check(await sb.rpc('profile_stats', { target: uid }))[0] || { posts: 0, followers: 0, following: 0 }),
    canView: async uid => check(await sb.rpc('can_view_profile', { owner: uid })),
    async myFollow(uid) {
      return check(await sb.from('follows').select('status').eq('follower', me()).eq('followee', uid).maybeSingle())?.status || null;
    },
    follow: async uid => check(await sb.rpc('follow_user', { target: uid })),
    async unfollow(uid) {
      check(await sb.from('follows').delete().eq('follower', me()).eq('followee', uid));
    },
    async requests() {
      const rows = check(await sb.from('follows').select('follower').eq('followee', me()).eq('status', 'pending'));
      return check(await profiles(rows.map(r => r.follower)));
    },
    async accept(uid) {
      check(await sb.from('follows').update({ status: 'accepted' }).eq('followee', me()).eq('follower', uid));
    },
    async acceptAll() {
      check(await sb.from('follows').update({ status: 'accepted' }).eq('followee', me()).eq('status', 'pending'));
    },
    async decline(uid) {
      check(await sb.from('follows').delete().eq('followee', me()).eq('follower', uid));
    },
    // Gezeigte Marken einer Person, neueste Aufnahme zuerst
    async feed(uid) {
      const ids = check(await sb.from('featured').select('stamp_id').eq('user_id', uid)).map(r => r.stamp_id);
      if (!ids.length) return [];
      return check(await sb.from('album_stamps').select('id,user_id,name,description,created_at').in('id', ids).order('created_at', { ascending: false }));
    },
    async myFeatured() {
      return new Set(check(await sb.from('featured').select('stamp_id').eq('user_id', me())).map(r => r.stamp_id));
    },
    async feature(stampId) {
      check(await sb.from('featured').insert({ stamp_id: stampId, user_id: me() }));
    },
    async unfeature(stampId) {
      check(await sb.from('featured').delete().eq('stamp_id', stampId));
    },
    image: async (uid, id, kind) => check(await sb.storage.from(BUCKET).download(`${uid}/${id}_${kind}.png`)),
    avatar: async uid => check(await sb.storage.from(BUCKET).download(`${uid}/avatar.png`)),
  };
}
