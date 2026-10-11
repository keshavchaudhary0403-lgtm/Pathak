import './app.css';
import { db, uid, today } from './db.js';
import { DEFAULT_SETTINGS, THEMES, FONTS, HL_COLORS } from './config.js';
import { lookup } from './dict.js';
import { cleanTitle, cleanAuthor } from './meta.js';

/* ---------- helpers ---------- */
const books = () => import('./books.js');
function detectType(file) {
  const n = (file.name || '').toLowerCase();
  if (n.endsWith('.epub') || file.type === 'application/epub+zip') return 'epub';
  if (n.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  return null;
}
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`;
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const DAY = 86400000;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`;
  if (d < DAY) return `${Math.floor(d / 3600e3)} h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function untilText(ts) {
  const d = ts - Date.now();
  if (d <= 0) return 'now';
  if (d < 3600e3) return `in ${Math.max(1, Math.round(d / 60e3))} min`;
  if (d < DAY) return `in ${Math.round(d / 3600e3)} h`;
  return `in ${Math.round(d / DAY)} days`;
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const GRADS = [
  ['#FF8A1F', '#FF3D7F'], ['#7B5CFF', '#FF3D7F'], ['#12B886', '#0EA5E9'], ['#F59F00', '#E8590C'],
  ['#5B3FD6', '#0EA5E9'], ['#E11D48', '#7B5CFF'], ['#0F766E', '#84CC16'], ['#334155', '#7B5CFF'],
];
function gradFor(s) {
  let h = 0;
  for (const c of s || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = GRADS[h % GRADS.length];
  return `linear-gradient(150deg,${a},${b})`;
}

/* ---------- state ---------- */
const S = {
  books: [],
  highlights: [],
  cards: [],
  stats: [],
  settings: { ...DEFAULT_SETTINGS },
  covers: new Map(),
  libSort: 'recent',
  libQuery: '',
  cardsView: { q: '', book: 'all' },
};

async function loadAll() {
  [S.books, S.highlights, S.cards, S.stats] = await Promise.all([db.all('books'), db.all('highlights'), db.all('cards'), db.all('stats')]);
  S.settings = { ...DEFAULT_SETTINGS, ...(await db.getKV('settings', {})) };
  for (const b of S.books) {
    try {
      const p = await db.getKV(`pos:${b.id}`, null);
      if (p && (p.progress ?? 0) !== (b.progress ?? 0)) { b.position = p.position; b.progress = p.progress; }
    } catch { /* ignore */ }
  }
  for (const b of S.books) {
    if (b.edited) continue;
    const t = cleanTitle(b.title, b.fileName);
    const a = cleanAuthor(b.author);
    if (t !== b.title || a !== (b.author || '')) { b.title = t; b.author = a; await db.put('books', b); }
  }
  for (const c of [...S.cards]) {
    const h = c.highlightId && S.highlights.find((x) => x.id === c.highlightId);
    if (h) {
      if (c.note && !h.note) { h.note = c.note; await db.put('highlights', h); }
      await db.del('cards', c.id);
      S.cards = S.cards.filter((x) => x.id !== c.id);
    }
  }
  for (const c of S.cards) {
    if (c.text == null) {
      c.kind = 'quote';
      c.text = c.context || [c.front, c.back].filter(Boolean).join(' ');
      await db.put('cards', c);
    }
  }
}
const bookById = (id) => S.books.find((b) => b.id === id);
function coverURL(b) {
  if (!b?.cover) return null;
  if (!S.covers.has(b.id)) S.covers.set(b.id, URL.createObjectURL(b.cover));
  return S.covers.get(b.id);
}
function coverHTML(b, extra = '') {
  const url = coverURL(b);
  const inner = url
    ? `<img src="${url}" alt="" loading="lazy">`
    : `<div class="gen" style="--g:${gradFor(b.title)}"><b>${esc(b.title)}</b><small>${esc(b.author || '')}</small></div>`;
  return `<div class="cv">${inner}${extra}</div>`;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { action.run(); t.classList.remove('show'); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
}

/* ---------- theme ---------- */
function currentMode() {
  const a = document.documentElement.getAttribute('data-theme');
  if (a === 'light' || a === 'dark') return a;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function setMode(m) {
  if (m === 'system') {
    document.documentElement.removeAttribute('data-theme');
    try { localStorage.removeItem('pathak-theme'); } catch { /* ignore */ }
  } else {
    document.documentElement.setAttribute('data-theme', m);
    try { localStorage.setItem('pathak-theme', m); } catch { /* ignore */ }
  }
  syncThemeBtn();
}
function syncThemeBtn() {
  const dark = currentMode() === 'dark';
  $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

/* ---------- stats ---------- */
function statFor(date) { return S.stats.find((s) => s.date === date); }
async function addReadingSeconds(sec) {
  const d = today();
  let row = statFor(d);
  if (!row) { row = { date: d, seconds: 0 }; S.stats.push(row); }
  row.seconds += sec;
  await db.put('stats', row);
}
function streak() {
  const days = new Set(S.stats.filter((s) => s.seconds >= 60).map((s) => s.date));
  let n = 0;
  const d = new Date();
  if (!days.has(today(d))) d.setDate(d.getDate() - 1);
  while (days.has(today(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function minutesThisWeek() {
  const cut = new Date();
  cut.setDate(cut.getDate() - 6);
  const from = today(cut);
  return Math.floor(S.stats.filter((s) => s.date >= from).reduce((a, s) => a + s.seconds, 0) / 60);
}
const minutesToday = () => Math.floor((statFor(today())?.seconds || 0) / 60);
function updateBadges() {}

/* ---------- overlays ---------- */
let overlay = null;
function closeOverlay() {
  if (!overlay) return;
  overlay.forEach((el) => el.remove());
  overlay = null;
}
function openSheet(html, { dialog = false, onMount } = {}) {
  closeOverlay();
  closePop();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sh = document.createElement('div');
  sh.className = `sheet${dialog ? ' dialog' : ''}`;
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  scrim.onclick = closeOverlay;
  document.body.append(scrim, sh);
  overlay = [scrim, sh];
  onMount?.(sh);
  setTimeout(() => sh.querySelector('textarea, input:not([type=range]), [autofocus]')?.focus(), 60);
  return sh;
}
function openDrawer(html, onMount) {
  closeOverlay();
  closePop();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const dr = document.createElement('aside');
  dr.className = 'drawer';
  dr.innerHTML = html;
  scrim.onclick = closeOverlay;
  document.body.append(scrim, dr);
  overlay = [scrim, dr];
  onMount?.(dr);
  return dr;
}
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }
function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${it.danger ? 'd' : ''}${it.selected ? ' sel' : ''}" ${it.selected != null ? `role="menuitemradio" aria-checked="${!!it.selected}"` : ''}>${it.icon ? icon(it.icon) : '<span class="i-blank"></span>'}<span>${esc(it.label)}</span></button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  m.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  m.style.top = `${r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6}px`;
  m.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    if (it.confirm && !b.dataset.armed) {
      b.dataset.armed = '1';
      b.querySelector('span').textContent = it.confirm;
      return;
    }
    closeMenu();
    it.run();
  };
  menuEl = m;
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) {
    if (!m.contains(ev.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); }
  }, true), 0);
}

/* ---------- dropdown ---------- */
// Custom dropdown so it looks the same in every browser.
function dropdownHTML(id, options, value, label) {
  const cur = options.find(([v]) => v === value) || options[0];
  return `<button class="dd" type="button" id="${id}" aria-haspopup="menu" aria-label="${esc(label)}: ${esc(cur[1])}"><span>${esc(cur[1])}</span><svg class="i" aria-hidden="true"><use href="#i-chev"/></svg></button>`;
}
function bindDropdown(id, options, value, onPick) {
  const btn = $(`#${id}`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.setAttribute('aria-expanded', 'true');
    openMenu(btn, options.map(([v, l]) => ({ label: l, selected: v === value, icon: v === value ? 'check' : null, run: () => onPick(v) })));
    const off = () => btn.setAttribute('aria-expanded', 'false');
    setTimeout(() => menuEl?.addEventListener('click', off), 0);
    document.addEventListener('pointerdown', off, { once: true, capture: true });
  });
}

/* ---------- importing ---------- */
async function importFiles(files) {
  const list = [...files].filter((f) => detectType(f));
  const skipped = files.length - list.length;
  if (!list.length) { toast('Pathak opens EPUB and PDF files.'); return; }
  let added = 0;
  let lastBook = null;
  for (const f of list) {
    toast(`Adding ${f.name}…`);
    try {
      const { book, duplicate } = await (await books()).importFile(f);
      if (!duplicate) { S.books.push(book); added++; lastBook = book; }
      else toast(`${book.title} is already in your library.`);
    } catch (e) {
      toast(e.message || `Couldn't add ${f.name}.`);
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
  if (added) {
    toast(added === 1 ? `Added ${lastBook.title}` : `Added ${added} books`, added === 1 ? { label: 'Read', run: () => go(`#/read/${lastBook.id}`) } : null);
    if (currentRoute().name === 'library') renderLibrary();
  }
  if (skipped) setTimeout(() => toast(`${plural(skipped, 'file')} skipped. Only EPUB and PDF are supported.`), 2600);
}
async function addSample() {
  try {
    const r = await fetch('/samples/welcome-to-pathak.epub');
    const blob = await r.blob();
    const f = new File([blob], 'welcome-to-pathak.epub', { type: 'application/epub+zip' });
    const { book, duplicate } = await (await books()).importFile(f);
    if (!duplicate) S.books.push(book);
    return book;
  } catch (e) {
    console.warn(e);
    return null;
  }
}

/* ---------- router ---------- */
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const parts = path.split('/');
  const params = new URLSearchParams(query || '');
  if (parts[0] === 'read' && parts[1]) return { name: 'read', id: parts[1], params };
  if (parts[0] === 'notebook') return { name: 'cards', params };
  if (parts[0] === 'cards' || parts[0] === 'review') return { name: 'cards', params };
  return { name: 'library', params };
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
let lastShellRoute = '#/library';
async function route() {
  closeOverlay();
  closeMenu();
  closePop();
  const r = currentRoute();
  if (r.name === 'read') {
    await openReader(r.id, r.params.get('h') || (r.params.get('c') ? `card:${r.params.get('c')}` : null));
    return;
  }
  if (R.active) await closeReader(false);
  lastShellRoute = location.hash || '#/library';
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.tab === r.name ? 'page' : 'false'));
  if (r.name === 'cards' && r.params.get('book')) S.cardsView.book = r.params.get('book');
  if (r.name === 'cards') renderCards();
  else renderLibrary();
  updateBadges();
  window.scrollTo(0, 0);
}

/* ---------- library ---------- */
function heatmapHTML() {
  const days = 52 * 7;
  const map = new Map(S.stats.map((s) => [s.date, s.seconds]));
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1 + (6 - end.getDay()));
  let cells = '';
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (d > end) { cells += '<i style="visibility:hidden"></i>'; continue; }
    const m = (map.get(today(d)) || 0) / 60;
    const l = m >= 30 ? 3 : m >= 10 ? 2 : m >= 1 ? 1 : 0;
    cells += `<i data-l="${l}" title="${d.toDateString()}: ${Math.round(m)} min"></i>`;
  }
  return `<div class="heat">${cells}</div>`;
}

const SORTS = [['recent', 'Recent'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress']];
function sortedBooks() {
  const q = S.libQuery.trim().toLowerCase();
  let list = S.books.filter((b) => !q || b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q));
  const by = {
    recent: (a, b) => (b.lastOpened || b.addedAt) - (a.lastOpened || a.addedAt),
    title: (a, b) => a.title.localeCompare(b.title),
    author: (a, b) => (a.author || '~').localeCompare(b.author || '~'),
    progress: (a, b) => (b.progress || 0) - (a.progress || 0),
  }[S.libSort];
  return list.sort(by);
}

function bookCardHTML(b) {
  const isNew = !b.lastOpened;
  const extra = `<span class="type">${b.type.toUpperCase()}</span>${isNew ? '<span class="new">New</span>' : ''}`;
  return `<div class="bk" data-id="${b.id}">
    <button class="open" type="button" data-open="${b.id}" aria-label="Read ${esc(b.title)}">${coverHTML(b, extra)}</button>
    <button class="more" type="button" data-more="${b.id}" aria-label="More options for ${esc(b.title)}">${icon('dots')}</button>
    <div><button class="t clk" type="button" data-open="${b.id}">${esc(b.title)}</button>${b.author ? `<button class="a clk" type="button" data-author="${esc(b.author)}" title="More by ${esc(b.author)}">${esc(b.author)}</button>` : '<div class="a">&nbsp;</div>'}</div>
    <div class="pm"><span class="pbar"><i style="width:${pct(b.progress)}"></i></span>${b.progress >= 0.995 ? 'Done' : pct(b.progress)}</div>
  </div>`;
}

function renderLibrary() {
  const v = $('#view');
  const recent = [...S.books].filter((b) => b.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened)[0];
  const st = streak();
  const top = !recent ? '' : `
    <div class="lib-top one">
      ${recent ? `<button class="continue glass" type="button" data-open="${recent.id}">
        ${coverHTML(recent)}
        <div class="info">
          <span class="eyebrow">Continue reading</span>
          <h2>${esc(recent.title)}</h2>
          <span class="meta">${esc(recent.author || '')}${recent.author ? ' · ' : ''}${pct(recent.progress)} · ${relTime(recent.lastOpened)}</span>
          <span class="pbar"><i style="width:${pct(recent.progress)}"></i></span>
        </div>
      </button>` : ''}
    </div>
    <div class="lib-stats">
      <span>${icon('flame')}<b>${st}</b> day streak</span>
      <span>${icon('clock')}<b>${minutesToday()}</b> min today</span>
      <a href="#/cards">${icon('cards')}<b>${savedItems().length}</b> cards</a>
    </div>`;

  const books = sortedBooks();
  const lib = S.books.length
    ? `<div class="section-title"><span>Books <span class="muted" style="font-weight:500">${S.books.length}</span></span>
        <div class="toolbar">
          <label class="search">${icon('search')}<input class="input" id="libSearch" type="search" placeholder="Search" value="${esc(S.libQuery)}" aria-label="Search books"></label>
          ${dropdownHTML('libSort', SORTS, S.libSort, 'Sort books')}
        </div></div>
       ${books.length ? `<div class="grid" id="bookGrid">${books.map(bookCardHTML).join('')}</div>` : '<p class="muted">No books match your search.</p>'}`
    : `<div class="empty" style="margin-top:24px">
        <span class="big">${icon('book')}</span>
        <h2>Add your first book</h2>
        <p>Drop an EPUB or PDF here, or choose one from your device.</p>
        <div class="row"><button class="btn grad" type="button" data-add>${icon('plus')}Add book</button><button class="btn soft" type="button" id="addSample">Add the guide book</button></div>
      </div>`;

  const free = `<div class="section-title"><span>Free books</span></div>
    <div class="free">
      <a class="glass" href="https://www.gutenberg.org" target="_blank" rel="noopener"><span class="m" style="--c:linear-gradient(135deg,#1F9D8A,#0E7C86)">G</span><span><b>Project Gutenberg</b><small>Classics, EPUB</small></span></a>
      <a class="glass" href="https://standardebooks.org" target="_blank" rel="noopener"><span class="m" style="--c:linear-gradient(135deg,#3B82F6,#6366F1)">S</span><span><b>Standard Ebooks</b><small>Edited classics, EPUB</small></span></a>
      <a class="glass" href="https://ncert.nic.in/textbook.php" target="_blank" rel="noopener"><span class="m" style="--c:linear-gradient(135deg,#FF8A1F,#F25C05)">N</span><span><b>NCERT</b><small>Textbooks, PDF</small></span></a>
      <a class="glass" href="https://openlibrary.org" target="_blank" rel="noopener"><span class="m" style="--c:linear-gradient(135deg,#8B5CF6,#C026D3)">O</span><span><b>Open Library</b><small>Borrow books</small></span></a>
    </div>`;

  v.innerHTML = `${S.books.length ? top : ''}${lib}${free}`;

  $('#libSearch')?.addEventListener('input', (e) => {
    S.libQuery = e.target.value;
    const g = $('#bookGrid');
    const list = sortedBooks();
    if (g) g.innerHTML = list.map(bookCardHTML).join('');
  });
  bindDropdown('libSort', SORTS, S.libSort, (v) => { S.libSort = v; renderLibrary(); });
  $('#addSample')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const b = await addSample();
    if (b) renderLibrary();
    else toast("Couldn't load the guide book. Check your connection.");
  });
}

$('#view').addEventListener('click', (e) => {
  const au = e.target.closest('[data-author]');
  if (au) { S.libQuery = au.dataset.author; renderLibrary(); $('#libSearch')?.focus(); window.scrollTo({ top: $('#libSearch')?.getBoundingClientRect().top + scrollY - 120, behavior: 'smooth' }); return; }
  const open = e.target.closest('[data-open]');
  if (open) { go(`#/read/${open.dataset.open}`); return; }
  const more = e.target.closest('[data-more]');
  if (more) {
    const b = bookById(more.dataset.more);
    openMenu(more, [
      { icon: 'book', label: b.progress > 0 ? 'Continue reading' : 'Start reading', run: () => go(`#/read/${b.id}`) },
      { icon: 'cards', label: 'Saved cards', run: () => { S.cardsView.book = b.id; go('#/cards'); } },
      { icon: 'edit', label: 'Edit title and author', run: () => editBookDialog(b) },
      { icon: 'check', label: b.progress >= 0.995 ? 'Mark as unread' : 'Mark as finished', run: async () => { b.progress = b.progress >= 0.995 ? 0 : 1; if (!b.progress) b.position = null; await db.put('books', b); renderLibrary(); } },
      { icon: 'trash', label: 'Remove from library', danger: true, confirm: 'Tap again to remove', run: async () => {
        await (await books()).removeBook(b.id);
        S.books = S.books.filter((x) => x.id !== b.id);
        S.highlights = S.highlights.filter((x) => x.bookId !== b.id);
        S.cards = S.cards.filter((x) => x.bookId !== b.id);
        renderLibrary(); updateBadges(); toast(`Removed ${b.title}`);
      } },
    ]);
  }
});

function editBookDialog(b) {
  const sh = openSheet(`
    <h2>Book details</h2>
    <div class="field"><label for="bkTitle">Title</label><input class="input" id="bkTitle" value="${esc(b.title)}" style="height:46px;border-radius:14px"></div>
    <div class="field"><label for="bkAuthor">Author</label><input class="input" id="bkAuthor" value="${esc(b.author || '')}" placeholder="Unknown" style="height:46px;border-radius:14px"></div>
    <div class="foot"><button class="btn soft" type="button" data-x="cancel">Cancel</button><button class="btn primary" type="button" data-x="save">Save</button></div>`, { dialog: true });
  sh.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'save') {
      b.title = $('#bkTitle', sh).value.trim() || b.title;
      b.author = $('#bkAuthor', sh).value.trim();
      b.edited = true;
      await db.put('books', b);
      toast('Book details saved');
      refreshCurrent();
    }
    closeOverlay();
  });
  sh.addEventListener('keydown', (e) => { if (e.key === 'Enter') sh.querySelector('[data-x="save"]').click(); });
}

/* ---------- highlights, notes and cards ---------- */
async function saveHighlight(h) {
  await db.put('highlights', h);
  const i = S.highlights.findIndex((x) => x.id === h.id);
  if (i >= 0) S.highlights[i] = h; else S.highlights.push(h);
  if (R.active && R.book?.id === h.bookId) { R.reader.setHighlights(R.bookHighlights()); R.reader.draw(h); }
}
async function deleteHighlight(h, quiet = false) {
  await db.del('highlights', h.id);
  S.highlights = S.highlights.filter((x) => x.id !== h.id);
  if (R.active && R.book?.id === h.bookId) { R.reader.undraw(h.id); R.reader.setHighlights(R.bookHighlights()); }
  if (!quiet) toast('Highlight removed', { label: 'Undo', run: async () => { await saveHighlight(h); refreshCurrent(); } });
}

function noteDialog(h, saver = saveHighlight, after) {
  const sh = openSheet(`
    <h2>Note</h2>
    <div class="quote" style="--c:${HL_COLORS[h.color]?.fill || 'var(--a1)'}">${esc(h.text)}</div>
    <div class="field"><label for="noteText">Your note</label><textarea id="noteText" placeholder="Why does this matter to you?">${esc(h.note || '')}</textarea></div>
    <div class="foot">${h.note ? '<button class="btn ghost" type="button" data-x="clear">Remove note</button>' : ''}<button class="btn soft" type="button" data-x="cancel">Cancel</button><button class="btn primary" type="button" data-x="save">Save</button></div>`, { dialog: true });
  sh.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'cancel') return closeOverlay();
    h.note = x === 'clear' ? '' : $('#noteText', sh).value.trim();
    await saver(h);
    closeOverlay();
    toast(h.note ? 'Note saved' : 'Note removed');
    after?.();
  });
  sh.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sh.querySelector('[data-x="save"]').click(); });
}

async function putCard(c) {
  await db.put('cards', c);
  const i = S.cards.findIndex((y) => y.id === c.id);
  if (i >= 0) S.cards[i] = c; else S.cards.push(c);
}
async function deleteCard(c, quiet = false) {
  await db.del('cards', c.id);
  S.cards = S.cards.filter((x) => x.id !== c.id);
  if (!quiet) toast('Removed from Cards', { label: 'Undo', run: async () => { await putCard(c); refreshCurrent(); } });
}
function refreshCurrent() {
  const n = currentRoute().name;
  if (n === 'cards') renderCards();
  else if (n === 'library') renderLibrary();
}

/* ---------- dictionary ---------- */
function speak(word, lang, audio) {
  if (audio) { new Audio(audio).play().catch(() => speak(word, lang)); return; }
  if (!('speechSynthesis' in window)) { toast("This browser can't read words aloud."); return; }
  const u = new SpeechSynthesisUtterance(word);
  u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
async function defineSheet(rawWord, ctx) {
  const shown = rawWord.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
  const display = shown.length > 1 && shown === shown.toUpperCase() && !/[ऀ-ॿ]/.test(shown) ? shown.toLowerCase() : shown;
  const head = (w, sub = '') => `
    <div class="dict-head">
      <div class="dict-title"><div class="dict-word">${esc(w)}</div>${sub ? `<div class="dict-sub">${sub}</div>` : ''}</div>
      <button class="ib dict-x" type="button" data-x="close" aria-label="Close">${icon('x')}</button>
    </div>`;
  const sh = openSheet(`<div class="dict" id="dictBody">${head(display || rawWord)}
    <div class="dict-load" aria-label="Looking up"><i></i><i></i><i style="width:60%"></i></div></div>`, { dialog: true });
  sh.classList.add('dict-sheet');
  sh.addEventListener('click', (e) => { if (e.target.closest('[data-x="close"]')) closeOverlay(); });
  const res = await lookup(rawWord);
  if (!document.body.contains(sh)) return;
  const body = $('#dictBody', sh);
  const msg = (t) => `${head(display || rawWord)}<p class="dict-msg">${t}</p>
    <div class="foot"><a class="btn soft sm" href="https://www.google.com/search?q=${encodeURIComponent(`${display} meaning in Hindi`)}" target="_blank" rel="noopener">${icon('search')}Search the web</a></div>`;
  if (!res) { body.innerHTML = msg('Select a single word to look it up.'); return; }
  if (res.offline) { body.innerHTML = msg("You're offline. Connect to the internet to look up words."); return; }
  if (res.empty) { body.innerHTML = msg("Couldn't find this word. Try searching the web."); return; }
  const hi = res.lang === 'hi';
  const sub = [res.phonetic || res.translit, res.senses[0]?.pos || res.groups[0]?.pos].filter(Boolean).map(esc).join(' · ');
  body.innerHTML = `
    <div class="dict-head">
      <div class="dict-title"><div class="dict-word">${esc(res.word)}</div>${sub ? `<div class="dict-sub">${sub}</div>` : ''}</div>
      <button class="ib dict-say" type="button" data-x="say" aria-label="Pronounce">${icon('speaker')}</button>
      <button class="ib dict-x" type="button" data-x="close" aria-label="Close">${icon('x')}</button>
    </div>
    ${res.translations.length ? `<div class="dict-tr">
      <span class="lbl">${hi ? 'English' : 'हिन्दी'}</span>
      <div class="chips-tr">${res.translations.map((t, i) => `<span class="${i === 0 ? 'main' : ''} ${hi ? '' : 'deva'}">${esc(t)}</span>`).join('')}</div>
    </div>` : ''}
    ${res.senses.length ? `<div class="dict-senses">${res.senses.map((s) => `
      <div class="dict-sense"><span class="pos">${esc(s.pos)}</span>
        <ol>${s.defs.map((d) => `<li>${esc(d.def)}${d.example ? `<em>“${esc(d.example)}”</em>` : ''}</li>`).join('')}</ol>
      </div>`).join('')}</div>` : ''}
    <div class="foot">
      <a class="btn ghost sm" href="https://www.google.com/search?q=${encodeURIComponent(`${res.word} meaning`)}" target="_blank" rel="noopener">${icon('search')}Search the web</a>
      <button class="btn primary sm" type="button" id="wordCard">${icon('cards')}Save to Cards</button>
    </div>`;
  $('[data-x="say"]', sh)?.addEventListener('click', () => speak(res.word, res.lang, res.audio));
  $('#wordCard', sh)?.addEventListener('click', async (e) => {
    const meaning = res.senses.flatMap((x) => x.defs.map((d) => d.def)).slice(0, 2).join(' ');
    await putCard({
      id: uid(), kind: 'word', bookId: ctx?.bookId || null, text: res.word,
      translation: res.translations.slice(0, 3).join(', '), meaning, pos: res.senses[0]?.pos || res.groups[0]?.pos || '',
      context: ctx?.text || '', chapter: R.chapter || '', createdAt: Date.now(), note: '',
    });
    const btn = e.target.closest('button');
    btn.disabled = true;
    btn.innerHTML = `${icon('check')}Saved`;
  });
}

/* ---------- reader ---------- */
const R = {
  active: false,
  book: null,
  reader: null,
  pct: 0,
  pos: null,
  lastTurn: 0,
  secPerPage: 50,
  activityAt: 0,
  tick: null,
  saveT: null,
  bookHighlights() { return S.highlights.filter((h) => h.bookId === R.book?.id); },
};
const rEl = $('#reader');

function applyReaderChrome() {
  const t = THEMES[S.settings.theme] || THEMES.paper;
  $$('.r-sw [data-rt]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rt === S.settings.theme)));
  rEl.style.setProperty('--r-bg', t.bg);
  rEl.style.setProperty('--r-fg', t.fg);
  rEl.dataset.ui = t.ui;
}

async function openReader(id, jumpHighlight) {
  const b = bookById(id);
  if (!b) { toast("That book isn't in your library."); go('#/library'); return; }
  if (R.active && R.book?.id === id) {
    if (jumpHighlight) jumpTo(jumpHighlight);
    return;
  }
  if (R.active) await closeReader(false);
  const file = await db.get('files', id);
  if (!file) { toast("This book's file is missing. Add it again."); go('#/library'); return; }

  R.active = true;
  R.book = b;
  R.secPerPage = await db.getKV('secPerPage', 50);
  rEl.hidden = false;
  rEl.dataset.kind = b.type;
  rEl.classList.remove('immersive');
  document.body.style.overflow = 'hidden';
  applyReaderChrome();
  $('#rTitle').textContent = b.title;
  $('[data-r="save"]').innerHTML = `${icon(b.type === 'pdf' ? 'crop' : 'plus')}${b.type === 'pdf' ? 'Save part' : 'Save card'}`;
  $('#rChapter').textContent = b.author || '';
  $('#rLoading').hidden = false;
  b.lastOpened = Date.now();
  db.put('books', b);

  const handlers = {
    relocate: onRelocate,
    select: onSelect,
    highlightClick: onHighlightClick,
    tapCenter: () => { if (pop) { closePop(); return; } rEl.classList.toggle('immersive'); },
    key: onKey,
    saveLocations: (json) => { b.locations = json; db.put('books', b); },
    zoomChange: (z) => { S.settings.pdfZoom = z; db.setKV('settings', S.settings); },
    pinch: (ratio) => {
      const v = Math.max(70, Math.min(220, Math.round((S.settings.size * ratio) / 10) * 10));
      if (v === S.settings.size) return;
      updateSettings({ size: v });
      toast(`Text size ${v}%`);
    },
  };
  const host = $('#rHost');
  host.innerHTML = '';
  try {
    if (b.type === 'epub') {
      const { openEpub } = await import('./epub-reader.js');
      R.reader = await openEpub({ book: b, blob: file.blob, host, settings: S.settings, highlights: R.bookHighlights(), on: handlers });
    } else {
      const { openPdf } = await import('./pdf-reader.js');
      R.reader = await openPdf({ book: b, blob: file.blob, host, settings: S.settings, highlights: R.bookHighlights(), on: handlers });
    }
  } catch (e) {
    console.error(e);
    toast("This book couldn't be opened.");
    await closeReader();
    return;
  }
  $('#rLoading').hidden = true;
  if (jumpHighlight) jumpTo(jumpHighlight);
  R.activityAt = Date.now();
  clearInterval(R.tick);
  R.tick = setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - R.activityAt < 120e3) addReadingSeconds(15);
  }, 15e3);
}

function jumpTo(hid) {
  const h = hid.startsWith('card:') ? S.cards.find((x) => x.id === hid.slice(5)) : S.highlights.find((x) => x.id === hid);
  if (!h || !R.reader) return;
  if (h.cfi) R.reader.goTo(h.cfi);
  else if (h.page) R.reader.goTo({ page: h.page, offset: Math.max(0, (h.rects?.[0]?.y || 0) - 0.15) });
}

function onRelocate(info) {
  const now = Date.now();
  R.activityAt = now;
  if (R.reader?.kind === 'epub' && info.pct > R.pct) {
    const dt = (now - R.lastTurn) / 1000;
    if (R.lastTurn && dt > 4 && dt < 240) { R.secPerPage = R.secPerPage * 0.85 + dt * 0.15; db.setKV('secPerPage', Math.round(R.secPerPage)); }
  }
  R.lastTurn = now;
  R.pct = info.pct;
  R.pos = info.pos;
  R.chapter = info.chapter;
  closePop();
  const range = $('#rRange');
  if (document.activeElement !== range) range.value = Math.round(info.pct * 1000);
  range.style.setProperty('--p', `${info.pct * 100}%`);
  $('#rPct').textContent = pct(info.pct);
  if (R.reader?.kind === 'pdf') {
    $('#rChapter').textContent = info.chapter;
    $('#rLeft').textContent = `${info.page} / ${info.pages}`;
    $('#rMid').textContent = info.pages - info.page > 0 ? `${plural(info.pages - info.page, 'page')} left` : 'Last page';
  } else {
    $('#rChapter').textContent = info.chapter || R.book.author || '';
    $('#rLeft').textContent = info.loc != null ? `Loc ${(info.loc + 1).toLocaleString('en-IN')}` : (R.reader?.locationsReady ? '' : 'Preparing…');
    if (info.pagesLeftInChapter != null) {
      const m = Math.round((info.pagesLeftInChapter * R.secPerPage) / 60);
      $('#rMid').textContent = info.pagesLeftInChapter === 0 ? 'End of chapter' : m < 1 ? 'Less than a minute left in chapter' : `${m} min left in chapter`;
    } else $('#rMid').textContent = '';
  }
  clearTimeout(R.saveT);
  R.saveT = setTimeout(savePosition, 600);
}
async function savePosition(book = R.book) {
  if (!book) return;
  if (book === R.book) {
    book.position = R.pos;
    book.progress = Math.max(0, Math.min(1, R.pct || 0));
  }
  // Position is also kept in a small record of its own, so a failed book write
  // (some browsers refuse to re-store the cover image) never loses your place.
  try { await db.setKV(`pos:${book.id}`, { position: book.position, progress: book.progress, at: Date.now() }); } catch (e) { console.warn(e); }
  try { await db.put('books', book); } catch (e) { console.warn('book save failed', e); }
}

async function closeReader(navigate = true) {
  if (!R.active) return;
  clearTimeout(R.saveT);
  clearInterval(R.tick);
  const book = R.book;
  if (book) { book.position = R.pos ?? book.position; book.progress = Math.max(0, Math.min(1, R.pct || 0)); }
  try { closePop(); closeOverlay(); endSnip(); } catch { /* ignore */ }
  try { R.reader?.destroy(); } catch { /* ignore */ }
  R.reader = null;
  R.active = false;
  R.book = null;
  R.pct = 0;
  R.lastTurn = 0;
  rEl.hidden = true;
  document.body.style.overflow = '';
  if (navigate) go(lastShellRoute.startsWith('#/read') ? '#/library' : lastShellRoute);
  savePosition(book);
}

function onKey(e) {
  if (snipEl && e.key === 'Escape') { endSnip(); return; }
  if (!R.active || overlay) {
    if (e.key === 'Escape') closeOverlay();
    return;
  }
  if (e.target?.closest?.('input, textarea, select')) return;
  R.activityAt = Date.now();
  if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey && R.reader?.kind === 'epub')) { e.preventDefault?.(); R.reader?.next(); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault?.(); R.reader?.prev(); }
  else if (e.key === 'Escape') { if (pop) closePop(); else closeReader(); }
}
document.addEventListener('keydown', (e) => {
  if (R.active) onKey(e);
  else if (e.key === 'Escape') { closeOverlay(); closeMenu(); }
});
['pointermove', 'pointerdown', 'wheel'].forEach((ev) => rEl.addEventListener(ev, () => { R.activityAt = Date.now(); }, { passive: true }));

rEl.addEventListener('click', (e) => {
  const sw = e.target.closest('.r-sw [data-rt]');
  if (sw) { updateSettings({ theme: sw.dataset.rt }); return; }
  const b = e.target.closest('[data-r]');
  if (!b) return;
  const a = b.dataset.r;
  if (a === 'close') closeReader();
  if (a === 'next') R.reader?.next();
  if (a === 'prev') R.reader?.prev();
  if (a === 'toc') tocDrawer();
  if (a === 'settings') readerSettings();
  if (a === 'save') saveCardFromBar();
  if (a === 'snip') startSnip();
  if (a === 'zoomin' || a === 'zoomout') {
    const cur = S.settings.pdfZoom === 'fit' ? 1 : Number(S.settings.pdfZoom) || 1;
    let z = a === 'zoomin' ? cur * 1.25 : cur / 1.25;
    z = Math.max(0.5, Math.min(4, z));
    const val = Math.abs(z - 1) < 0.05 ? 'fit' : String(Math.round(z * 100) / 100);
    updateSettings({ pdfZoom: val });
    toast(val === 'fit' ? 'Fit to width' : `${Math.round(z * 100)}%`);
  }
});
// Clicks on the page area outside the book text (margins, wide screens): edges turn pages, middle toggles controls.
$('.r-stage').addEventListener('click', (e) => {
  if (!R.reader || R.reader.kind !== 'epub' || e.target.closest('button, iframe')) return;
  if (S.settings.layout === 'scroll') return;
  const r = e.currentTarget.getBoundingClientRect();
  const rel = (e.clientX - r.left) / r.width;
  if (rel < 0.35) R.reader.prev();
  else if (rel > 0.65) R.reader.next();
  else { if (pop) closePop(); else rEl.classList.toggle('immersive'); }
});
$('#rRange').addEventListener('input', (e) => {
  const p = e.target.value / 1000;
  e.target.style.setProperty('--p', `${p * 100}%`);
  $('#rPct').textContent = pct(p);
});
$('#rRange').addEventListener('change', (e) => {
  if (R.reader?.kind === 'epub' && !R.reader.locationsReady) { toast('Still preparing this book. Try again in a moment.'); return; }
  R.reader?.goToPct(e.target.value / 1000);
});

async function updateSettings(patch) {
  const prevLayout = S.settings.layout;
  S.settings = { ...S.settings, ...patch };
  await db.setKV('settings', S.settings);
  applyReaderChrome();
  if (!R.reader) return;
  if (R.reader.kind === 'epub' && prevLayout !== S.settings.layout) {
    await savePosition();
    const id = R.book.id;
    R.reader.destroy();
    R.active = false;
    await openReader(id);
    return;
  }
  await R.reader.applySettings(S.settings);
}

function readerSettings() {
  const s = S.settings;
  const isPdf = R.reader?.kind === 'pdf';
  const sh = openSheet(`
    <div class="set-row" style="margin-top:0"><span class="lbl">Page</span>
      <div class="themes">${Object.entries(THEMES).map(([k, t]) => `<button type="button" data-theme="${k}" aria-pressed="${s.theme === k}" style="background:${t.bg};color:${t.fg}"><b>Aa</b>${t.label}</button>`).join('')}</div></div>
    ${isPdf ? `
    <div class="set-row"><span class="lbl">Zoom</span>
      <div class="seg">${[['fit', 'Fit'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']].map(([k, l]) => `<button type="button" data-zoom="${k}" aria-pressed="${String(s.pdfZoom) === k}">${l}</button>`).join('')}</div></div>` : `
    <div class="set-row"><span class="lbl">Typeface</span>
      <div class="fonts">${Object.entries(FONTS).map(([k, f]) => `<button type="button" data-font="${k}" aria-pressed="${s.font === k}"><b style="font-family:${f.stack || 'inherit'}">Ag</b>${f.label}</button>`).join('')}</div></div>
    <div class="set-row"><span class="lbl">Text size <span id="szV">${s.size}%</span></span>
      <div class="stepper"><button type="button" data-size="-10" aria-label="Smaller text">A−</button><div class="rangewrap"><input class="set-range" type="range" id="szR" min="70" max="220" step="10" value="${s.size}" aria-label="Text size"></div><button type="button" data-size="10" aria-label="Larger text">A+</button></div></div>
    <div class="set-row"><span class="lbl">Line spacing</span>
      <div class="seg">${[[1.4, 'Tight'], [1.6, 'Normal'], [1.85, 'Relaxed'], [2.1, 'Loose']].map(([k, l]) => `<button type="button" data-lh="${k}" aria-pressed="${s.lineHeight === k}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><span class="lbl">Margins</span>
      <div class="seg">${[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']].map(([k, l]) => `<button type="button" data-mg="${k}" aria-pressed="${s.margins === k}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><span class="lbl">Layout</span>
      <div class="seg">${[['paged', 'Pages'], ['scroll', 'Scroll']].map(([k, l]) => `<button type="button" data-layout="${k}" aria-pressed="${s.layout === k}">${l}</button>`).join('')}</div></div>`}
  `);
  const press = (sel, attr, val) => $$(sel, sh).forEach((x) => x.setAttribute('aria-pressed', String(x.getAttribute(attr) === String(val))));
  sh.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.theme) { updateSettings({ theme: t.dataset.theme }); press('[data-theme]', 'data-theme', t.dataset.theme); }
    if (t.dataset.font) { updateSettings({ font: t.dataset.font }); press('[data-font]', 'data-font', t.dataset.font); }
    if (t.dataset.lh) { updateSettings({ lineHeight: Number(t.dataset.lh) }); press('[data-lh]', 'data-lh', t.dataset.lh); }
    if (t.dataset.mg) { updateSettings({ margins: t.dataset.mg }); press('[data-mg]', 'data-mg', t.dataset.mg); }
    if (t.dataset.zoom) { updateSettings({ pdfZoom: t.dataset.zoom }); press('[data-zoom]', 'data-zoom', t.dataset.zoom); }
    if (t.dataset.layout) { closeOverlay(); updateSettings({ layout: t.dataset.layout }); }
    if (t.dataset.size) {
      const v = Math.max(70, Math.min(220, S.settings.size + Number(t.dataset.size)));
      $('#szR', sh).value = v; $('#szV', sh).textContent = `${v}%`;
      updateSettings({ size: v });
    }
  });
  $('#szR', sh)?.addEventListener('input', (e) => { $('#szV', sh).textContent = `${e.target.value}%`; });
  $('#szR', sh)?.addEventListener('change', (e) => updateSettings({ size: Number(e.target.value) }));
}

function tocDrawer(tab = 'toc') {
  const toc = R.reader?.toc || [];
  const hs = R.bookHighlights().sort((a, b) => (a.progress || 0) - (b.progress || 0));
  const dr = openDrawer(`
    <div class="dh"><h2>${esc(R.book.title)}</h2><button class="ib" type="button" data-x="close" aria-label="Close">${icon('x')}</button></div>
    <div class="seg" role="tablist"><button type="button" data-tab="toc" aria-pressed="${tab === 'toc'}">Contents</button><button type="button" data-tab="hl" aria-pressed="${tab === 'hl'}">Highlights ${hs.length ? `(${hs.length})` : ''}</button></div>
    <div class="db">
      ${tab === 'toc'
        ? (toc.length ? `<nav class="toc">${toc.map((t, i) => `<a href="#" data-i="${i}" data-d="${Math.min(t.depth, 2)}" class="${t.label === R.chapter ? 'cur' : ''}">${esc(t.label)}</a>`).join('')}</nav>` : '<p class="muted" style="padding:12px">This book has no table of contents.</p>')
        : (hs.length ? hs.map((h) => `<div class="bh" style="--c:${HL_COLORS[h.color]?.fill}" data-h="${h.id}"><q>${esc(h.text)}</q>${h.note ? `<span class="n">${esc(h.note)}</span>` : ''}<small>${esc(h.chapter || '')}</small></div>`).join('') : '<p class="muted" style="padding:12px">Select text in the book to highlight it.</p>')}
    </div>`);
  dr.addEventListener('click', (e) => {
    if (e.target.closest('[data-x="close"]')) return closeOverlay();
    const tb = e.target.closest('[data-tab]');
    if (tb) { tocDrawer(tb.dataset.tab); return; }
    const a = e.target.closest('.toc a');
    if (a) {
      e.preventDefault();
      const item = toc[Number(a.dataset.i)];
      closeOverlay();
      R.reader.kind === 'epub' ? R.reader.goToHref(item.href) : R.reader.goToHref(item);
      return;
    }
    const h = e.target.closest('.bh');
    if (h) { closeOverlay(); jumpTo(h.dataset.h); }
  });
}

/* selection popover */
let pop = null;
function closePop() { pop?.el.remove(); pop = null; }
// On touch screens the phone shows its own Copy / Select all bar above the selection,
// so Pathak's tools go below it (clear of the selection handles), or at the top when there's no room.
const coarse = matchMedia('(pointer: coarse)');
function placePop(el, rect) {
  document.body.appendChild(el);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const bottom = rect.bottom ?? rect.top + rect.height;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(innerWidth - w - 8, left));
  let top;
  if (coarse.matches) {
    const topBar = (document.querySelector('.r-top')?.getBoundingClientRect().bottom || 60) + 8;
    const botBar = rEl.classList.contains('immersive') ? innerHeight - 12 : (document.querySelector('.r-bot')?.getBoundingClientRect().top || innerHeight) - 8;
    top = bottom + 36;
    if (top + h > botBar) {
      top = topBar;
      el.classList.add('docked');
      left = Math.max(8, (innerWidth - w) / 2);
    }
  } else {
    top = rect.top - h - 12;
    if (top < 70) top = bottom + 12;
  }
  top = Math.max(8, Math.min(top, innerHeight - h - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
function popHTML(activeColor, existing) {
  return `${Object.entries(HL_COLORS).map(([k, c]) => `<button class="sw" type="button" data-c="${k}" aria-label="${c.label} highlight" aria-pressed="${activeColor === k}" style="--c:${c.fill}"><i></i></button>`).join('')}
    <span class="sep"></span>
    <button class="pb" type="button" data-p="note">${icon('note')}Note</button>
    ${existing ? '' : `<button class="pb" type="button" data-p="define">${icon('define')}Define</button>`}
    <button class="pb" type="button" data-p="card">${icon('cards')}Card</button>
    <button class="pb" type="button" data-p="copy">${icon('copy')}Copy</button>
    ${existing ? `<button class="pb" type="button" data-p="del">${icon('trash')}Delete</button>` : ''}`;
}

function makeHighlight(sel, color) {
  const h = {
    id: uid(), bookId: R.book.id, type: R.reader.kind, text: sel.text, color, note: '',
    chapter: R.reader.kind === 'pdf' ? `Page ${sel.anchor.page}` : (R.chapter || ''),
    progress: R.pct, createdAt: Date.now(), ...sel.anchor,
  };
  return h;
}

function onSelect(sel) {
  closePop();
  if (sel.text.length > 15000) { toast('That selection is too long. Try a smaller section.'); return; }
  const el = document.createElement('div');
  el.className = 'pop';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Selection');
  el.innerHTML = popHTML(null, false);
  pop = { el, sel };
  placePop(el, sel.rect);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.c) {
      await saveHighlight(makeHighlight(sel, b.dataset.c));
      sel.clear(); closePop();
      savedToast();
      return;
    }
    const p = b.dataset.p;
    if (p === 'copy') { copyText(sel.text); sel.clear(); closePop(); }
    if (p === 'define') { const w = sel.text.split(/\s+/)[0]; sel.clear(); closePop(); defineSheet(w, { bookId: R.book.id, text: sel.text }); }
    if (p === 'card') {
      await saveHighlight(makeHighlight(sel, 'yellow'));
      sel.clear(); closePop();
      savedToast();
      return;
    }
    if (p === 'note') {
      const h = makeHighlight(sel, 'yellow');
      await saveHighlight(h);
      sel.clear(); closePop();
      noteDialog(h);
    }
  });
}

function onHighlightClick(id, rect) {
  const h = S.highlights.find((x) => x.id === id);
  if (!h) return;
  closePop();
  const el = document.createElement('div');
  el.className = 'pop';
  el.setAttribute('role', 'toolbar');
  el.innerHTML = popHTML(h.color, true);
  pop = { el, h };
  placePop(el, rect || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.c) { h.color = b.dataset.c; await saveHighlight(h); closePop(); return; }
    const p = b.dataset.p;
    closePop();
    if (p === 'copy') copyText(h.text);
    if (p === 'note') noteDialog(h);
    if (p === 'card') toast('Already in Cards', { label: 'View', run: () => { closeReader(false).then(() => go('#/cards')); } });
    if (p === 'del') deleteHighlight(h);
  });
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast("Couldn't copy. Select the text and copy it manually."); }
}
document.addEventListener('pointerdown', (e) => { if (pop && !pop.el.contains(e.target) && !e.target.closest?.('.r-host, [data-r="save"]')) closePop(); }, true);
/* ---------- snip (PDF): capture a region as an image card ---------- */
let snipEl = null;
function endSnip() { snipEl?.remove(); snipEl = null; }
function startSnip() {
  if (R.reader?.kind !== 'pdf' || snipEl) return;
  closePop();
  rEl.classList.remove('immersive');
  const el = document.createElement('div');
  el.className = 'snip';
  el.innerHTML = `<div class="snip-hint">${icon('crop')}<span>Drag over the part you want to save</span><button type="button" class="btn sm" data-snip="cancel">Cancel</button></div><div class="snip-box" hidden></div>`;
  rEl.appendChild(el);
  snipEl = el;
  const box = el.querySelector('.snip-box');
  let start = null;
  let cur = null;
  const norm = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.snip-hint')) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
    cur = start;
    box.hidden = false;
    Object.assign(box.style, { left: `${start.x}px`, top: `${start.y}px`, width: '0px', height: '0px' });
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    cur = { x: e.clientX, y: e.clientY };
    const r = norm(start, cur);
    Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  });
  el.addEventListener('pointerup', async () => {
    if (!start) return;
    const r = norm(start, cur);
    start = null;
    if (r.w < 12 || r.h < 12) { box.hidden = true; return; }
    // Pick the page the box overlaps most, and clip the box to it.
    let best = null;
    let bestArea = 0;
    for (const pr of R.reader.pageRects()) {
      const ix = Math.max(0, Math.min(r.x + r.w, pr.rect.right) - Math.max(r.x, pr.rect.left));
      const iy = Math.max(0, Math.min(r.y + r.h, pr.rect.bottom) - Math.max(r.y, pr.rect.top));
      if (ix * iy > bestArea) { bestArea = ix * iy; best = pr; }
    }
    if (!best) { box.hidden = true; toast('Drag over the page to capture a part of it.'); return; }
    const pb = best.rect;
    const x1 = Math.max(r.x, pb.left); const y1 = Math.max(r.y, pb.top);
    const x2 = Math.min(r.x + r.w, pb.right); const y2 = Math.min(r.y + r.h, pb.bottom);
    const rel = { x: (x1 - pb.left) / pb.width, y: (y1 - pb.top) / pb.height, w: (x2 - x1) / pb.width, h: (y2 - y1) / pb.height };
    el.querySelector('.snip-hint span').textContent = 'Capturing…';
    try {
      const shot = await R.reader.snip(best.page, rel);
      endSnip();
      snipPreview({ ...shot, page: best.page, rel });
    } catch (err) {
      console.error(err);
      endSnip();
      toast("Couldn't capture that part. Try again.");
    }
  });
  el.addEventListener('wheel', (e) => { e.preventDefault(); R.reader?.scrollBy(e.deltaX, e.deltaY); }, { passive: false });
  el.querySelector('[data-snip="cancel"]').addEventListener('click', endSnip);
}
function snipPreview({ blob, w, h, page, rel }) {
  const url = URL.createObjectURL(blob);
  const book = R.book;
  const card = {
    id: uid(), kind: 'image', image: blob, imgW: w, imgH: h, type: 'pdf',
    bookId: book.id, page, rects: [rel], chapter: `Page ${page}`, text: '', note: '',
    progress: R.pct, createdAt: Date.now(),
  };
  const sh = openSheet(`
    <h2>Save this snip</h2>
    <div class="snip-prev"><img src="${url}" alt="Captured part of page ${page}"></div>
    <div class="field"><label for="snipNote">Note (optional)</label><textarea id="snipNote" style="min-height:64px" placeholder="Why does this matter to you?"></textarea></div>
    <div class="foot"><button class="btn ghost" type="button" data-x="cancel">Cancel</button><button class="btn soft" type="button" data-x="dl">${icon('download')}Download card</button><button class="btn primary" type="button" data-x="save">${icon('cards')}Save to Cards</button></div>`, { dialog: true });
  sh.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    card.note = $('#snipNote', sh).value.trim();
    if (x === 'cancel') { closeOverlay(); URL.revokeObjectURL(url); return; }
    if (x === 'dl') { await shareImage(card); return; }
    await putCard(card);
    closeOverlay();
    toast('Saved to Cards', { label: 'View', run: () => { closeReader(false).then(() => go('#/cards')); } });
  });
}

const savedToast = () => toast('Saved to Cards', { label: 'View', run: () => { closeReader(false).then(() => go('#/cards')); } });
async function saveCardFromBar() {
  if (pop?.sel) {
    const sel = pop.sel;
    await saveHighlight(makeHighlight(sel, 'yellow'));
    sel.clear(); closePop();
    savedToast();
  } else if (pop?.h) {
    closePop();
    toast('Already in Cards');
  } else {
    if (R.reader?.kind === 'pdf') startSnip();
    else toast('Select a sentence or section, then tap Save card');
  }
}

/* ---------- cards ---------- */
// Drop quote marks left dangling by a selection (an opening quote with no closing one, or the reverse).
function tidyQuote(t) {
  let text = (t || '').trim();
  const opens = (text.match(/[“‘]/g) || []).length;
  const closes = (text.match(/[”’]/g) || []).length;
  if (/^[“‘"]/.test(text) && opens >= closes) text = text.slice(1).trim();
  if (/[”’"]$/.test(text) && closes > opens) text = text.slice(0, -1).trim();
  return text;
}
// Everything you've saved: highlighted passages plus word and snip cards.
function savedItems() {
  return [...S.highlights.map((h) => ({ ...h, kind: 'highlight' })), ...S.cards];
}
function findSaved(id) {
  const h = S.highlights.find((x) => x.id === id);
  return h ? { item: h, isHl: true } : { item: S.cards.find((x) => x.id === id), isHl: false };
}
function filteredCards() {
  const q = S.cardsView.q.trim().toLowerCase();
  return savedItems()
    .filter((c) => (S.cardsView.book === 'all' || c.bookId === S.cardsView.book) &&
      (!q || [c.text, c.note, c.meaning, c.translation].some((x) => (x || '').toLowerCase().includes(q))))
    .sort((a, b) => b.createdAt - a.createdAt);
}
const cardImgs = new Map();
function cardImgURL(c) {
  if (!c.image) return '';
  if (!cardImgs.has(c.id)) cardImgs.set(c.id, URL.createObjectURL(c.image));
  return cardImgs.get(c.id);
}
function cardHTML(c) {
  const b = bookById(c.bookId);
  const src = [b?.title, c.chapter].filter(Boolean).map(esc).join(' · ');
  const deva = /[\u0900-\u097F]/.test(c.text);
  const acts = `
    ${c.kind !== 'word' && b ? `<button class="ib" type="button" data-cact="open" aria-label="Open in book" title="Open in book">${icon('open')}</button>` : ''}
    <button class="ib" type="button" data-cact="note" aria-label="Note" title="Note">${icon('note')}</button>
    <button class="ib" type="button" data-cact="copy" aria-label="Copy" title="Copy">${icon('copy')}</button>
    <button class="ib" type="button" data-cact="share" aria-label="Save as image" title="Save as image">${icon('download')}</button>
    <button class="ib" type="button" data-cact="del" aria-label="Remove from Cards" title="Remove">${icon('trash')}</button>`;
  if (c.kind === 'image') {
    return `<article class="qc glass snipcard" data-card="${c.id}">
      <img class="${b ? 'clk' : ''}" ${b ? 'data-cact="open" title="Open in book"' : ''} src="${cardImgURL(c)}" alt="Snip from ${esc(b?.title || 'a book')}" loading="lazy">
      ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
      <div class="foot">${b ? `<button class="src-l clk" type="button" data-cact="open">${src}</button>` : `<span>${src}</span>`}<span class="acts">${acts}</span></div>
    </article>`;
  }
  if (c.kind === 'word') {
    return `<article class="qc glass word" data-card="${c.id}">
      <span class="kind">Word</span>
      <div class="w">${esc(c.text)}${c.pos ? `<small>${esc(c.pos)}</small>` : ''}</div>
      ${c.translation ? `<div class="tr">${esc(c.translation)}</div>` : ''}
      ${c.meaning ? `<p class="mean">${esc(c.meaning)}</p>` : ''}
      ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
      <div class="foot"><span>${src || relTime(c.createdAt)}</span><span class="acts">${acts}</span></div>
    </article>`;
  }
  return `<article class="qc glass" data-card="${c.id}" style="--c:${HL_COLORS[c.color]?.fill || 'var(--a1)'}">
    <blockquote class="${deva ? 'deva-q' : ''}${b ? ' clk' : ''}" ${b ? 'data-cact="open" title="Open in book"' : ''}>${esc(tidyQuote(c.text))}</blockquote>
    ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
    <div class="foot">${b ? `<button class="src-l clk" type="button" data-cact="open">${src}</button>` : `<span>${src}</span>`}<span class="acts">${acts}</span></div>
  </article>`;
}
function renderCards() {
  const v = $('#view');
  if (S.cardsView.book !== 'all' && !bookById(S.cardsView.book)) S.cardsView.book = 'all';
  const list = filteredCards();
  const all = savedItems();
  const booksWith = S.books.filter((b) => all.some((c) => c.bookId === b.id));
  v.innerHTML = `
    <div class="view-head"><h1>Cards <span class="muted" style="font-weight:500;font-size:.6em">${all.length || ''}</span></h1>
      ${all.length ? `<button class="btn soft" type="button" id="cardsExport">${icon('download')}Export</button>` : ''}</div>
    ${all.length ? `<div class="toolbar" style="margin-bottom:20px">
      <label class="search">${icon('search')}<input class="input" id="cardsSearch" type="search" placeholder="Search cards" value="${esc(S.cardsView.q)}" aria-label="Search cards"></label>
      ${dropdownHTML('cardsBook', [['all', 'All books'], ...booksWith.map((b) => [b.id, b.title])], S.cardsView.book, 'Book')}
    </div>` : ''}
    ${!all.length
      ? `<div class="empty" style="margin-top:10px"><span class="big">${icon('cards')}</span><h2>Save the lines that matter</h2><p>While reading, select a sentence or section and pick a colour, or tap <b>Save card</b>. It shows up here.</p><a class="btn soft" href="#/library">Go to library</a></div>`
      : list.length ? `<div class="qgrid">${list.map(cardHTML).join('')}</div>` : '<p class="muted">No cards match your search.</p>'}`;
  $('#cardsSearch')?.addEventListener('input', (e) => {
    S.cardsView.q = e.target.value;
    const g = $('.qgrid');
    const l = filteredCards();
    if (g) g.innerHTML = l.map(cardHTML).join('');
    else renderCards();
  });
  bindDropdown('cardsBook', [['all', 'All books'], ...booksWith.map((b) => [b.id, b.title])], S.cardsView.book, (v) => { S.cardsView.book = v; renderCards(); });
  $('#cardsExport')?.addEventListener('click', exportCards);
}
$('#view').addEventListener('click', async (e) => {
  const btn = e.target.closest('.qc [data-cact]');
  if (!btn) return;
  const { item: c, isHl } = findSaved(btn.closest('.qc').dataset.card);
  if (!c) return;
  const a = btn.dataset.cact;
  if (a === 'open') {
    if (isHl) go(`#/read/${c.bookId}?h=${c.id}`);
    else if (c.highlightId && S.highlights.some((h) => h.id === c.highlightId)) go(`#/read/${c.bookId}?h=${c.highlightId}`);
    else go(`#/read/${c.bookId}?c=${c.id}`);
  }
  if (a === 'note') noteDialog(c, isHl ? saveHighlight : putCard, () => renderCards());
  if (a === 'copy') {
    if (c.kind === 'image') {
      try { await navigator.clipboard.write([new ClipboardItem({ [c.image.type || 'image/png']: c.image })]); toast('Image copied'); }
      catch { toast("This browser can't copy images. Use download instead."); }
    } else copyText(c.kind === 'word' ? [c.text, c.translation, c.meaning].filter(Boolean).join(' — ') : c.text);
  }
  if (a === 'share') shareImage(c);
  if (a === 'del') {
    if (isHl) {
      await deleteHighlight(c, true);
      toast('Removed from Cards', { label: 'Undo', run: async () => { await saveHighlight(c); refreshCurrent(); } });
    } else await deleteCard(c);
    renderCards();
  }
});
function exportCards() {
  const lines = ['# Pathak cards', ''];
  for (const c of filteredCards()) {
    const b = bookById(c.bookId);
    if (c.kind === 'image') lines.push(`*[Snip from ${c.chapter || 'a page'}]*`);
    else if (c.kind === 'word') lines.push(`**${c.text}**${c.translation ? ` (${c.translation})` : ''}: ${c.meaning || ''}`);
    else lines.push(`> ${c.text.replace(/\n+/g, '\n> ')}`);
    if (c.note) lines.push('', `Note: ${c.note}`);
    if (b) lines.push('', `— *${b.title}*${c.chapter ? `, ${c.chapter}` : ''}`);
    lines.push('', '---', '');
  }
  download(new Blob([lines.join('\n')], { type: 'text/markdown' }), `pathak-cards-${today()}.md`);
}

// Render a card as a shareable image (1080×1350).
async function shareImage(c) {
  const W = 1080;
  let H = 1350;
  let bmp = null;
  if (c.kind === 'image' && c.image) {
    // Snips get a card height that fits the image, so wide snips aren't lost in empty space.
    bmp = await createImageBitmap(c.image);
    const sc = Math.min((W - 180 - 140) / bmp.width, 1000 / bmp.height, 3);
    H = Math.round(Math.max(760, 180 + 70 + bmp.height * sc + 70 + 190));
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const deva = /[\u0900-\u097F]/.test(c.text);
  const serif = deva ? '"Tiro Devanagari Hindi", "Literata", serif' : '"Literata", Georgia, serif';
  try { await Promise.all([document.fonts.load(`500 48px ${serif}`), document.fonts.load('700 30px "Hanken Grotesk"'), document.fonts.load('700 40px "Mukta"')]); } catch { /* fallback fonts */ }
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#FF8A1F'); g.addColorStop(0.5, '#FF3D7F'); g.addColorStop(1, '#7B5CFF');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const pad = 90;
  const cw = W - pad * 2;
  x.fillStyle = 'rgba(255,255,255,0.96)';
  x.beginPath(); x.roundRect(pad, pad, cw, H - pad * 2, 48); x.fill();
  if (bmp) {
    const top = pad + 70;
    const bottom = H - pad - 190;
    const maxW = cw - 140;
    const maxH = bottom - top;
    const s = Math.min(maxW / bmp.width, maxH / bmp.height, 3);
    const dw = bmp.width * s;
    const dh = bmp.height * s;
    const dx = pad + (cw - dw) / 2;
    const dy = top + (maxH - dh) / 2;
    x.save();
    x.beginPath(); x.roundRect(dx, dy, dw, dh, 14); x.clip();
    x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, dx, dy, dw, dh);
    x.restore();
    x.strokeStyle = 'rgba(26,22,38,0.10)'; x.lineWidth = 2;
    x.beginPath(); x.roundRect(dx, dy, dw, dh, 14); x.stroke();
  } else {
  // Drop quote marks left dangling by the selection (e.g. an opening quote with no closing one).
  const text = tidyQuote(c.text);
  let size = text.length < 60 ? 76 : text.length < 140 ? 64 : text.length < 300 ? 54 : 46;
  let lines;
  const wrap = (t, s) => {
    x.font = `500 ${s}px ${serif}`;
    const out = [];
    for (const para of t.split(/\n+/)) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        const test = line ? `${line} ${w}` : w;
        if (x.measureText(test).width > cw - 150 && line) { out.push(line); line = w; } else line = test;
      }
      if (line) out.push(line);
    }
    return out;
  };
  const top = pad + 200;
  const bottom = H - pad - 190;
  const maxH = bottom - top;
  do { lines = wrap(text, size); size -= 2; } while (lines.length * size * 1.45 > maxH && size > 24);
  size += 2;
  if (lines.length * size * 1.45 > maxH) {
    const keep = Math.floor(maxH / (size * 1.45));
    lines = lines.slice(0, keep);
    lines[keep - 1] = lines[keep - 1].replace(/\s+\S*$/, '') + '…';
  }
  const lh = size * 1.45;
  let y = top + (maxH - lines.length * lh) / 2;
  x.fillStyle = '#FF3D7F';
  x.font = `700 150px "Literata", Georgia, serif`;
  x.fillText('“', pad + 66, pad + 185);
  x.fillStyle = '#1A1626';
  x.font = `500 ${size}px ${serif}`;
  for (const l of lines) { x.fillText(l, pad + 75, y + size); y += lh; }
  if (c.kind === 'word' && (c.translation || c.meaning)) {
    x.font = '600 38px "Mukta", "Hanken Grotesk", sans-serif';
    x.fillStyle = '#5B3FD6';
    x.fillText([c.translation, c.pos].filter(Boolean).join(' · ').slice(0, 50), pad + 75, y + 46);
  }
  }
  // Footer: divider, book title, chapter and author, Pathak mark on the right.
  const fit = (str, max) => {
    if (!str) return '';
    let t = str;
    while (t && x.measureText(t).width > max) t = t.slice(0, -1);
    return t === str ? t : `${t.trimEnd()}…`;
  };
  const b = bookById(c.bookId);
  const fy = H - pad - 150;
  x.fillStyle = 'rgba(26,22,38,0.08)';
  x.fillRect(pad + 75, fy, cw - 150, 2);
  const textMax = cw - 150 - 190;
  const title = b?.title || '';
  const sub = [c.chapter && (c.kind === 'image' || !/^page \d+$/i.test(c.chapter)) && c.chapter !== title ? c.chapter : '', b?.author].filter(Boolean).join(' · ');
  if (title) {
    x.fillStyle = '#1A1626';
    x.font = '700 34px "Hanken Grotesk", sans-serif';
    x.fillText(fit(title, textMax), pad + 75, fy + (sub ? 62 : 84));
  }
  if (sub) {
    x.fillStyle = '#676179';
    x.font = '500 28px "Hanken Grotesk", sans-serif';
    x.fillText(fit(sub, textMax), pad + 75, fy + 104);
  }
  const lx = W - pad - 75 - 170;
  const ly = fy + 50;
  const lg = x.createLinearGradient(lx, ly, lx + 44, ly + 44);
  lg.addColorStop(0, '#FF8A1F'); lg.addColorStop(0.5, '#FF3D7F'); lg.addColorStop(1, '#7B5CFF');
  x.fillStyle = lg;
  x.beginPath(); x.roundRect(lx, ly, 44, 44, 12); x.fill();
  x.fillStyle = '#fff'; x.font = '700 28px "Mukta", sans-serif'; x.textAlign = 'center';
  x.fillText('प', lx + 22, ly + 32);
  x.textAlign = 'left'; x.fillStyle = '#1A1626'; x.font = '700 30px "Hanken Grotesk", sans-serif';
  x.fillText('Pathak', lx + 56, ly + 32);
  cv.toBlob((blob) => { if (blob) { download(blob, `pathak-card-${today()}.png`); toast('Card image downloaded'); } }, 'image/png');
}

/* ---------- app settings ---------- */
function appSettings() {
  const mode = document.documentElement.getAttribute('data-theme') || 'system';
  const sh = openSheet(`
    <h2>Settings</h2>
    <div class="set-row"><span class="lbl">Appearance</span>
      <div class="seg">${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><span class="lbl">Backup</span>
      <p class="muted" style="font-size:14px">Saves highlights, notes, cards and reading history. Book files stay on this device.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn soft" type="button" data-s="export">${icon('download')}Export backup</button><button class="btn soft" type="button" data-s="import">${icon('upload')}Restore backup</button></div>
      <input type="file" id="bkFile" accept=".json,application/json" hidden></div>
    <div class="set-row"><span class="lbl">Data</span>
      <div><button class="btn danger" type="button" data-s="wipe">${icon('trash')}Delete everything</button></div>
      <div id="wipeConfirm"></div></div>
    <div class="foot" style="justify-content:space-between;align-items:center"><span class="muted" style="font-size:13px">Pathak 1.0 · Data stored in this browser</span><button class="btn primary" type="button" data-s="close">Done</button></div>
  `, { dialog: true });
  sh.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { setMode(m.dataset.mode); $$('[data-mode]', sh).forEach((x) => x.setAttribute('aria-pressed', String(x === m))); return; }
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (s === 'close') closeOverlay();
    if (s === 'export') exportBackup();
    if (s === 'import') $('#bkFile', sh).click();
    if (s === 'wipe') {
      $('#wipeConfirm', sh).innerHTML = `<div class="confirm"><span>This removes every book, highlight and card on this device.</span><button class="btn danger sm" type="button" data-s="wipe2">Delete</button><button class="btn ghost sm" type="button" data-s="nowipe">Cancel</button></div>`;
    }
    if (s === 'nowipe') $('#wipeConfirm', sh).innerHTML = '';
    if (s === 'wipe2') {
      for (const st of ['books', 'files', 'highlights', 'cards', 'stats', 'kv']) await db.clear(st);
      S.covers.forEach((u) => URL.revokeObjectURL(u));
      S.covers.clear();
      await db.setKV('seeded', true);
      await loadAll();
      closeOverlay();
      route();
      toast('All data deleted');
    }
  });
  $('#bkFile', sh).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'pathak') throw new Error();
      for (const h of data.highlights || []) await db.put('highlights', h);
      for (const c of data.cards || []) {
        if (typeof c.image === 'string' && c.image.startsWith('data:')) c.image = await (await fetch(c.image)).blob();
        await db.put('cards', c);
      }
      for (const st of data.stats || []) {
        const cur = await db.get('stats', st.date);
        await db.put('stats', { date: st.date, seconds: Math.max(st.seconds, cur?.seconds || 0) });
      }
      for (const b of data.books || []) {
        const cur = await db.get('books', b.id);
        if (cur) await db.put('books', { ...cur, progress: Math.max(cur.progress || 0, b.progress || 0), position: (b.progress || 0) > (cur.progress || 0) ? b.position : cur.position });
      }
      if (data.settings) await db.setKV('settings', data.settings);
      await loadAll();
      closeOverlay();
      route();
      const missing = (data.books || []).filter((b) => !bookById(b.id)).length;
      toast(missing ? `Backup restored. Add ${plural(missing, 'book')} again to see their highlights.` : 'Backup restored');
    } catch {
      toast("That file isn't a Pathak backup.");
    }
  });
}
const blobToDataURL = (b) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
async function exportBackup() {
  const cards = await Promise.all(S.cards.map(async (c) => (c.image ? { ...c, image: await blobToDataURL(c.image) } : c)));
  const data = {
    app: 'pathak', version: 1, exportedAt: new Date().toISOString(),
    books: S.books.map(({ cover, locations, ...b }) => b),
    highlights: S.highlights, cards, stats: S.stats, settings: S.settings,
  };
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `pathak-backup-${today()}.json`);
}

/* ---------- global wiring ---------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-add]')) $('#filePick').click();
});
$('#filePick').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
$('#themeBtn').addEventListener('click', () => setMode(currentMode() === 'dark' ? 'light' : 'dark'));
$('#settingsBtn').addEventListener('click', appSettings);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeBtn);

let dragDepth = 0;
let dropEl = null;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files') || R.active) return;
  e.preventDefault();
  dragDepth++;
  if (!dropEl) {
    dropEl = document.createElement('div');
    dropEl.className = 'drop-overlay';
    dropEl.innerHTML = '<div>Drop to add to your library</div>';
    document.body.appendChild(dropEl);
  }
});
window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { dropEl?.remove(); dropEl = null; } });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; dropEl?.remove(); dropEl = null;
  if (e.dataTransfer?.files?.length && !R.active) importFiles(e.dataTransfer.files);
});
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => { if (R.active) savePosition(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && R.active) savePosition(); });

/* ---------- boot ---------- */
(async function boot() {
  syncThemeBtn();
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty" style="margin-top:40px"><h2>Storage isn't available</h2><p>Pathak saves books in your browser. Private browsing windows or blocked site data can prevent this. Open Pathak in a regular window.</p></div>`;
    return;
  }
  if (!(await db.getKV('seeded', false))) {
    await db.setKV('seeded', true);
    if (!S.books.length) await addSample();
  }
  if (!location.hash) history.replaceState(null, '', '#/library');
  route();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
