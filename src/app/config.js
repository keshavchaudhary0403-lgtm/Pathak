export const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Hanken+Grotesk:ital,wght@0,400;0,600;1,400&family=Mukta:wght@400;600&family=Tiro+Devanagari+Hindi:ital@0;1&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap';

export const THEMES = {
  paper: { label: 'Paper', bg: '#FBFAF7', fg: '#1E1C24', link: '#5B3FD6', selection: 'rgba(123,92,255,.22)', ui: 'light' },
  sepia: { label: 'Sepia', bg: '#F4E9D3', fg: '#3E3022', link: '#8A4B12', selection: 'rgba(180,110,40,.25)', ui: 'light' },
  gray: { label: 'Dusk', bg: '#2B2A30', fg: '#E4E1EA', link: '#B8A8FF', selection: 'rgba(155,133,255,.35)', ui: 'dark' },
  night: { label: 'Night', bg: '#121017', fg: '#D4D0DE', link: '#B8A8FF', selection: 'rgba(155,133,255,.35)', ui: 'dark' },
};

export const FONTS = {
  original: { label: 'Original', stack: null },
  book: { label: 'Literata', stack: `'Literata', 'Tiro Devanagari Hindi', Georgia, serif` },
  modern: { label: 'Hanken', stack: `'Hanken Grotesk', 'Mukta', system-ui, sans-serif` },
  hindi: { label: 'Mukta', stack: `'Mukta', 'Hanken Grotesk', sans-serif` },
  legible: { label: 'Atkinson', stack: `'Atkinson Hyperlegible', 'Mukta', sans-serif` },
};

export const HL_COLORS = {
  yellow: { label: 'Yellow', fill: '#FFD43B' },
  pink: { label: 'Pink', fill: '#FF6B9A' },
  blue: { label: 'Blue', fill: '#5BC0EB' },
  green: { label: 'Green', fill: '#7EE081' },
};

export const DEFAULT_SETTINGS = {
  theme: 'paper',
  font: 'book',
  size: 110,
  lineHeight: 1.6,
  margins: 'normal',
  layout: 'paged',
  pdfZoom: 'fit',
};
