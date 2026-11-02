// Zugriff auf gemeinsame Seiten in Supabase
const BUCKET = 'shared';
const path = (pageId, id, kind) => `${pageId}/${id}_${kind}.png`;

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export function createApi(sb) {
  return {
    async listPages() {
      const rows = check(await sb.from('shared_pages')
        .select('id,title,owner,invite_token,shared_members(user_id,display_name)'));
      return rows.map(r => ({ id: r.id, title: r.title, owner: r.owner, token: r.invite_token, members: r.shared_members }));
    },
    async listStamps(pageIds) {
      if (!pageIds.length) return [];
      return check(await sb.from('shared_stamps').select('*').in('page_id', pageIds));
    },
    createPage: async (title, name) => check(await sb.rpc('create_shared_page', { page_title: title, member_name: name })),
    joinPage: async (token, name) => check(await sb.rpc('join_shared_page', { token, member_name: name })),
    async leavePage(pageId, userId) {
      check(await sb.from('shared_members').delete().eq('page_id', pageId).eq('user_id', userId));
    },
    async removeMember(pageId, userId) {
      check(await sb.from('shared_members').delete().eq('page_id', pageId).eq('user_id', userId));
    },
    async deletePage(pageId, stampIds) {
      const files = stampIds.flatMap(id => [path(pageId, id, 'thumb'), path(pageId, id, 'full')]);
      if (files.length) check(await sb.storage.from(BUCKET).remove(files));
      check(await sb.from('shared_pages').delete().eq('id', pageId));
    },
    async setTitle(pageId, title) {
      check(await sb.from('shared_pages').update({ title }).eq('id', pageId));
    },
    async setMemberName(userId, display_name) {
      check(await sb.from('shared_members').update({ display_name }).eq('user_id', userId));
    },
    async upload(pageId, id, thumb, full) {
      for (const [kind, blob] of [['thumb', thumb], ['full', full]]) {
        check(await sb.storage.from(BUCKET).upload(path(pageId, id, kind), blob, { contentType: 'image/png', upsert: false }));
      }
    },
    async insertStamp(row) {
      check(await sb.from('shared_stamps').insert(row));
    },
    download: async (pageId, id, kind) => check(await sb.storage.from(BUCKET).download(path(pageId, id, kind))),
    async updateStamp(id, fields) {
      check(await sb.from('shared_stamps').update(fields).eq('id', id));
    },
    async deleteStamp(pageId, id) {
      check(await sb.from('shared_stamps').delete().eq('id', id));
      await sb.storage.from(BUCKET).remove([path(pageId, id, 'thumb'), path(pageId, id, 'full')]);
    },
  };
}

// Doppelt belegter Platz: jemand anderes war schneller
export const isCellTaken = e => e?.code === '23505';
