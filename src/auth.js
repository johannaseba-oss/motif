// Konto mit E-Mail und Passwort. Die Fotos bleiben auf dem Gerät, nur die Anmeldung läuft über Supabase.
const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_KEY;

let client = null;
export let user = null;

const MESSAGES = [
  ['Invalid login credentials', 'E-Mail oder Passwort stimmt nicht.'],
  ['Email not confirmed', 'Bitte bestätige zuerst deine E-Mail. Der Link steht in der Mail von MOTIF.'],
  ['already registered', 'Zu dieser E-Mail gibt es schon ein Konto.'],
  ['rate limit', 'Gerade wurden zu viele E-Mails verschickt. Bitte versuche es später noch einmal.'],
  ['should be at least', 'Das Passwort muss mindestens 8 Zeichen haben.'],
  ['valid email', 'Diese E-Mail-Adresse sieht nicht richtig aus.'],
  ['invalid format', 'Diese E-Mail-Adresse sieht nicht richtig aus.'],
  ['different from the old', 'Das neue Passwort muss sich vom alten unterscheiden.'],
  ['fetch', 'Keine Verbindung. Zum Anmelden brauchst du Internet.'],
];

function fail(error) {
  const known = MESSAGES.find(([part]) => error.message?.includes(part));
  throw new Error(known ? known[1] : 'Das hat nicht geklappt. Bitte versuche es noch einmal.');
}

export const isConfigured = () => !!client;
export const getClient = () => client;

export async function init({ onRecovery }) {
  if (URL_ && KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(URL_, KEY);
  } else if (import.meta.env.DEV) {
    client = (await import('./auth-dev.js')).devClient;
  } else {
    return;
  }
  client.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') setTimeout(onRecovery);
  });
  const { data } = await client.auth.getSession();
  user = data.session?.user || null;
}

// Liefert true, wenn zuerst die E-Mail bestätigt werden muss
export async function signUp(email, password) {
  const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) fail(error);
  // Supabase verrät bei bestehenden Konten nichts, liefert aber keine Identitäten
  if (data.user && data.user.identities?.length === 0) fail({ message: 'already registered' });
  user = data.session?.user || null;
  return !data.session;
}

export async function signIn(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) fail(error);
  user = data.user;
}

export async function resetPassword(email) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) fail(error);
}

export async function setPassword(password) {
  const { data, error } = await client.auth.updateUser({ password });
  if (error) fail(error);
  user = data.user;
}

// Der Profilname gehört zum Konto, damit jeder Browser ihn kennt. Fotos bleiben auf dem Gerät.
export const accountName = () => user?.user_metadata?.display_name || '';
export async function setAccountName(name) {
  const { data, error } = await client.auth.updateUser({ data: { display_name: name } });
  if (error) throw error;
  user = data.user;
}

export async function signOut() {
  // Auch ohne Netz abmelden: die Sitzung auf diesem Gerät wird in jedem Fall entfernt
  await client.auth.signOut({ scope: 'local' }).catch(() => {});
  user = null;
}
