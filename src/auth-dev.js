// Nur im Dev-Server ohne Supabase-Zugang: Test-Login im localStorage. Kommt nie in den fertigen Build.
const KEY = 'motif.devAuth';
const load = () => JSON.parse(localStorage.getItem(KEY) || '{"users":{},"session":null}');
const save = s => localStorage.setItem(KEY, JSON.stringify(s));
const err = message => ({ data: {}, error: { message } });
const pub = (email, u) => ({ id: u.id, email, identities: [{}] });

export const devClient = {
  auth: {
    onAuthStateChange() {},
    async getSession() {
      const s = load();
      return { data: { session: s.session ? { user: pub(s.session, s.users[s.session]) } : null } };
    },
    async signUp({ email, password }) {
      const s = load();
      if (s.users[email]) return err('already registered');
      s.users[email] = { id: crypto.randomUUID(), password };
      s.session = email;
      save(s);
      const user = pub(email, s.users[email]);
      return { data: { user, session: { user } }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const s = load();
      if (s.users[email]?.password !== password) return err('Invalid login credentials');
      s.session = email;
      save(s);
      return { data: { user: pub(email, s.users[email]) }, error: null };
    },
    async resetPasswordForEmail() { return { error: null }; },
    async updateUser({ password }) {
      const s = load();
      s.users[s.session].password = password;
      save(s);
      return { data: { user: pub(s.session, s.users[s.session]) }, error: null };
    },
    async signOut() {
      const s = load();
      s.session = null;
      save(s);
    },
  },
};
