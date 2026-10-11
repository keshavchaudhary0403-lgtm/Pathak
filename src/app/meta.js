// Clean up messy book metadata (common in PDFs made with DTP tools).
const baseName = (n) => (n || '').replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim();

export function cleanTitle(t, fileName) {
  let s = (t || '')
    .replace(/^microsoft (word|powerpoint|excel)\s*-\s*/i, '')
    .replace(/\.(pmd|p65|indd|qxd|qxp|docx?|rtf|odt|pdf|epub|txt|pages|cdr|ai|psd|tex)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || /^(untitled|document\s*\d*|book\s*\d*|new document)$/i.test(s)) s = baseName(fileName);
  if (s && s === s.toLowerCase()) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s || 'Untitled book';
}

export function cleanAuthor(a) {
  const s = (a || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^(user|admin|administrator|owner|unknown|author|pc|hp|dell|lenovo|acer|asus|windows user)\s*\d*$/i.test(s)) return '';
  if (!/\s/.test(s) && /\d/.test(s)) return ''; // machine or login names like "dtpcell5"
  if (!/\s/.test(s) && s === s.toLowerCase()) return ''; // single lowercase token, e.g. a username
  return s;
}
