// Das Colourwalks-Album: zehn feste Farbseiten. Es liegt im selben Speicher wie das eigene Album,
// nur weit hinten (ab Seite THEME_FIRST), damit es sich nie mit freien Seiten überschneidet.
export const THEME_FIRST = 10000;
export const THEME_ALBUM = 'Colourwalks';

export const THEMES = [
  { title: 'Colour Walk Rot', color: '#e2463b' },
  { title: 'Colour Walk Gelb', color: '#f2c230' },
  { title: 'Colour Walk Blau', color: '#2f6fd6' },
  { title: 'Colour Walk Pink', color: '#ef7fb4' },
  { title: 'Colour Walk Grün', color: '#3f9a4f' },
  { title: 'Colour Walk Lila', color: '#8a4fc7' },
  { title: 'Colour Walk Schwarz', color: '#111111' },
  { title: 'Colour Walk Weiß', color: '#ffffff' },
  { title: 'Colour Walk Braun', color: '#8b5a32' },
  { title: 'Colour Walk Orange', color: '#f08a24' },
];

// Auf dem Albumdeckel bleiben es die ersten fünf Farbpunkte
export const COVER_COLORS = THEMES.slice(0, 5).map(t => t.color);

export const isThemePage = page => page >= THEME_FIRST && page < THEME_FIRST + THEMES.length;
export const themeOf = page => (isThemePage(page) ? THEMES[page - THEME_FIRST] : null);
