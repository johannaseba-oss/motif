// Zugriff auf das private Album in Supabase
const BUCKET = 'albums';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export function createCloudApi(sb, getUid) {
  const path = (id, kind) => `${getUid()}/${id}_${kind}.png`;
  const avatarPath = () => `${getUid()}/avatar.png`;
  const put = async (p, blob) => check(await sb.storage.from(BUCKET).upload(p, blob, { contentType: 'image/png', upsert: true }));
  const get = async p => check(await sb.storage.from(BUCKET).download(p));
  return {
    getMeta: async () => check(await sb.from('album_meta').select('*').eq('user_id', getUid()).maybeSingle()),
    async putMeta(meta) {
      check(await sb.from('album_meta').upsert({ ...meta, user_id: getUid(), updated_at: new Date().toISOString() }));
    },
    listStamps: async () => check(await sb.from('album_stamps').select('*').eq('user_id', getUid())),
    async upsertStamp(s) {
      check(await sb.from('album_stamps').upsert({
        id: s.id, user_id: getUid(), slot: s.slot, name: s.name || '', description: s.desc || '',
        created_at: new Date(s.createdAt).toISOString(),
      }));
    },
    async uploadImages(id, thumb, full) {
      await put(path(id, 'thumb'), thumb);
      await put(path(id, 'full'), full);
    },
    download: (id, kind) => get(path(id, kind)),
    async deleteStamp(id) {
      check(await sb.from('album_stamps').delete().eq('id', id));
      await sb.storage.from(BUCKET).remove([path(id, 'thumb'), path(id, 'full')]);
    },
    uploadAvatar: blob => put(avatarPath(), blob),
    downloadAvatar: () => get(avatarPath()),
  };
}
