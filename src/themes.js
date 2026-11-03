// Das Themenalbum: feste Seiten mit Vorgaben. Es liegt im selben Speicher wie das eigene Album,
// nur weit hinten (ab Seite THEME_FIRST), damit es sich nie mit freien Seiten überschneidet.
export const THEME_FIRST = 10000;

export const THEMES = [
  { title: 'Colour Walk Rot', color: '#e2463b' },
  { title: 'Colour Walk Gelb', color: '#f2c230' },
  { title: 'Colour Walk Blau', color: '#2f6fd6' },
  { title: 'Colour Walk Pink', color: '#ef7fb4' },
  { title: 'Colour Walk Grün', color: '#3f9a4f' },
  { title: 'Mein Hobby' },
  { title: 'Meine Freunde' },
  { title: 'Mein Zuhause' },
  { title: 'Mein Lieblingsessen' },
  { title: 'Meine Stadt' },
];

export const isThemePage = page => page >= THEME_FIRST && page < THEME_FIRST + THEMES.length;
export const themeOf = page => (isThemePage(page) ? THEMES[page - THEME_FIRST] : null);
