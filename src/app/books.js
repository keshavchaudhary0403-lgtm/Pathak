// Importing books: reads metadata and a cover, then stores the file in IndexedDB.
import ePub from 'epubjs';
import { db, uid } from './db.js';
import { pdfjs } from './pdfjs.js';

export function detectType(file) {
  const n = (file.name || '').toLowerCase();
  if (n.endsWith('.epub') || file.type === 'application/epub+zip') return 'epub';
  if (n.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  return null;
}

const baseName = (n) => n.replace(/\.(epub|pdf)$/i, '').replace(/[_]+/g, ' ').trim();

async function epubMeta(buf, file) {
  const book = ePub(buf);
  await book.ready;
  const md = await book.loaded.metadata;
  let cover = null;
  try {
    const url = await book.coverUrl();
    if (url) cover = await (await fetch(url)).blob();
  } catch { /* no cover */ }
  book.destroy();
  return {
    title: (md.title || baseName(file.name)).trim(),
    author: (md.creator || '').trim(),
    lang: md.language || '',
    cover,
  };
}

async function pdfMeta(buf, file) {
  const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
  let title = '';
  let author = '';
  try {
    const m = await doc.getMetadata();
    title = m?.info?.Title || '';
    author = m?.info?.Author || '';
  } catch { /* ignore */ }
  let cover = null;
  try {
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 360 / vp0.width });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    cover = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  } catch { /* ignore */ }
  const pages = doc.numPages;
  doc.destroy();
  if (!title || /^(untitled|microsoft word|document)/i.test(title)) title = baseName(file.name);
  return { title: title.trim(), author: author.trim(), lang: '', cover, pages };
}

export async function importFile(file) {
  const type = detectType(file);
  if (!type) throw new Error(`${file.name} isn't an EPUB or PDF file.`);
  const buf = await file.arrayBuffer();
  let meta;
  try {
    meta = type === 'epub' ? await epubMeta(buf, file) : await pdfMeta(buf, file);
  } catch (e) {
    console.error(e);
    throw new Error(`${file.name} couldn't be opened. It may be damaged or protected with DRM.`);
  }
  const all = await db.all('books');
  const dup = all.find((b) => b.title === meta.title && b.size === file.size);
  if (dup) return { book: dup, duplicate: true };
  const id = uid();
  const book = {
    id, type, ...meta,
    fileName: file.name, size: file.size,
    addedAt: Date.now(), lastOpened: 0, progress: 0, position: null,
  };
  await db.put('files', { id, blob: new Blob([buf], { type: type === 'epub' ? 'application/epub+zip' : 'application/pdf' }) });
  await db.put('books', book);
  return { book, duplicate: false };
}

export async function removeBook(id) {
  await db.del('books', id);
  await db.del('files', id);
  for (const h of await db.byIndex('highlights', 'bookId', id)) await db.del('highlights', h.id);
  for (const c of await db.byIndex('cards', 'bookId', id)) await db.del('cards', c.id);
}
