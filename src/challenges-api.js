// Challenge-Gruppen in Supabase
function check({ data, error }) {
  if (error) throw error;
  return data;
}

export function createChallengeApi(sb, me) {
  const profilesOf = async ids => (ids.length ? check(await sb.from('profiles').select('*').in('user_id', ids)) : []);
  return {
    // Eigene Gruppe (angenommen) und offene Einladungen
    async state() {
      const mine = check(await sb.from('challenge_members').select('group_id,status').eq('user_id', me()));
      const accepted = mine.find(m => m.status === 'accepted');
      const invitedIds = mine.filter(m => m.status === 'invited').map(m => m.group_id);
      const invGroups = invitedIds.length ? check(await sb.from('challenge_groups').select('id,owner').in('id', invitedIds)) : [];
      let group = null, members = [], entries = [];
      if (accepted) {
        group = check(await sb.from('challenge_groups').select('id,owner').eq('id', accepted.group_id).single());
        members = check(await sb.from('challenge_members').select('user_id,status').eq('group_id', group.id));
        entries = check(await sb.from('challenge_entries').select('challenge,user_id,stamp_id').eq('group_id', group.id));
      }
      const profiles = await profilesOf([...new Set([...members.map(m => m.user_id), ...invGroups.map(g => g.owner)])]);
      const byId = new Map(profiles.map(p => [p.user_id, p]));
      return {
        group,
        members: members.map(m => ({ ...m, profile: byId.get(m.user_id) || null })),
        entries,
        invitations: invGroups.map(g => ({ group_id: g.id, owner: byId.get(g.owner) || null })),
      };
    },
    create: async ids => check(await sb.rpc('create_challenge_group', { invitees: ids })),
    invite: async (g, uid) => check(await sb.rpc('invite_to_challenge', { g, invitee: uid })),
    accept: async g => check(await sb.rpc('accept_challenge', { g })),
    async leave(g) {
      check(await sb.from('challenge_members').delete().eq('group_id', g).eq('user_id', me()));
    },
    submit: async (g, n, stampId) => check(await sb.rpc('submit_challenge', { g, n, stamp: stampId })),
    image: async (uid, stampId) => check(await sb.storage.from('albums').download(`${uid}/${stampId}_thumb.png`)),
  };
}
