import './app.css';
import { db, uid, today } from './db.js';
import { DEFAULT_SETTINGS, THEMES, FONTS, HL_COLORS } from './config.js';
import { newCard, schedule, previewLabel, suggestCloze } from './srs.js';
import { lookup } from './dict.js';

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
  nb: { q: '', book: 'all', color: 'all' },
  deck: 'all',
};

async function loadAll() {
  [S.books, S.highlights, S.cards, S.stats] = await Promise.all([db.all('books'), db.all('highlights'), db.all('cards'), db.all('stats')]);
  S.settings = { ...DEFAULT_SETTINGS, ...(await db.getKV('settings', {})) };
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
const dueCards = (deck = 'all') => S.cards.filter((c) => c.due <= Date.now() && (deck === 'all' || c.bookId === deck)).sort((a, b) => a.due - b.due);
function updateBadges() {
  const n = dueCards().length;
  $$('[data-due]').forEach((b) => { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; });
}

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
  m.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" class="${it.danger ? 'd' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
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
  if (parts[0] === 'notebook') return { name: 'notebook', params };
  if (parts[0] === 'review') return { name: 'review', params };
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
    await openReader(r.id, r.params.get('h'));
    return;
  }
  if (R.active) await closeReader(false);
  lastShellRoute = location.hash || '#/library';
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.tab === r.name ? 'page' : 'false'));
  if (r.name === 'notebook') {
    if (r.params.get('book')) S.nb.book = r.params.get('book');
    renderNotebook();
  } else if (r.name === 'review') renderReview();
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
    <div><div class="t">${esc(b.title)}</div><div class="a">${esc(b.author || '')}</div></div>
    <div class="pm"><span class="pbar"><i style="width:${pct(b.progress)}"></i></span>${b.progress >= 0.995 ? 'Done' : pct(b.progress)}</div>
  </div>`;
}

function renderLibrary() {
  const v = $('#view');
  const recent = [...S.books].filter((b) => b.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened)[0];
  const due = dueCards().length;
  const st = streak();
  const top = `
    <div class="lib-top">
      ${recent ? `<button class="continue glass" type="button" data-open="${recent.id}">
        ${coverHTML(recent)}
        <div class="info">
          <span class="eyebrow">Continue reading</span>
          <h2>${esc(recent.title)}</h2>
          <span class="meta">${esc(recent.author || '')}${recent.author ? ' · ' : ''}${pct(recent.progress)} · ${relTime(recent.lastOpened)}</span>
          <span class="pbar"><i style="width:${pct(recent.progress)}"></i></span>
        </div>
      </button>` : ''}
      <div class="stats" style="${recent ? '' : 'grid-column:1/-1'}">
        <div class="stat glass"><span class="ic" style="background:linear-gradient(135deg,var(--a1),var(--a2))">${icon('flame')}</span><b>${st}</b><span>day streak</span></div>
        <div class="stat glass"><span class="ic" style="background:linear-gradient(135deg,var(--ok),#0EA5E9)">${icon('clock')}</span><b>${minutesToday()}</b><span>min today</span></div>
        <a class="stat glass" href="#/review"><span class="ic" style="background:linear-gradient(135deg,var(--a3),var(--a2))">${icon('cards')}</span><b>${due}</b><span>cards due</span></a>
        <div class="heatcard glass"><div class="row"><span>Reading activity</span><span>${minutesThisWeek()} min this week</span></div>${heatmapHTML()}</div>
      </div>
    </div>`;

  const books = sortedBooks();
  const lib = S.books.length
    ? `<div class="section-title"><span>Books <span class="muted" style="font-weight:500">${S.books.length}</span></span>
        <div class="toolbar">
          <label class="search">${icon('search')}<input class="input" id="libSearch" type="search" placeholder="Search" value="${esc(S.libQuery)}" aria-label="Search books"></label>
          <select class="select" id="libSort" aria-label="Sort books">
            ${[['recent', 'Recent'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress']].map(([k, l]) => `<option value="${k}" ${S.libSort === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
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
  $('#libSort')?.addEventListener('change', (e) => { S.libSort = e.target.value; renderLibrary(); });
  $('#addSample')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const b = await addSample();
    if (b) renderLibrary();
    else toast("Couldn't load the guide book. Check your connection.");
  });
}

$('#view').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) { go(`#/read/${open.dataset.open}`); return; }
  const more = e.target.closest('[data-more]');
  if (more) {
    const b = bookById(more.dataset.more);
    openMenu(more, [
      { icon: 'book', label: b.progress > 0 ? 'Continue reading' : 'Start reading', run: () => go(`#/read/${b.id}`) },
      { icon: 'notes', label: 'Highlights', run: () => { S.nb.book = b.id; go('#/notebook'); } },
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

/* ---------- notebook ---------- */
function filteredHighlights() {
  const q = S.nb.q.trim().toLowerCase();
  return S.highlights.filter((h) =>
    (S.nb.book === 'all' || h.bookId === S.nb.book) &&
    (S.nb.color === 'all' || h.color === S.nb.color) &&
    (!q || h.text.toLowerCase().includes(q) || (h.note || '').toLowerCase().includes(q)));
}
function hlCardHTML(h, showBook = false) {
  const b = bookById(h.bookId);
  const hasCard = S.cards.some((c) => c.highlightId === h.id);
  return `<div class="hlc glass" style="--c:${HL_COLORS[h.color]?.fill}" data-h="${h.id}">
    <q>${esc(h.text)}</q>
    ${h.note ? `<div class="note">${esc(h.note)}</div>` : ''}
    <div class="foot"><span>${showBook && b ? esc(b.title) + ' · ' : ''}${esc(h.chapter || '')}${h.chapter ? ' · ' : ''}${relTime(h.createdAt)}</span>
      <span class="acts">
        <button class="ib" type="button" data-act="open" aria-label="Open in book" title="Open in book">${icon('open')}</button>
        <button class="ib" type="button" data-act="note" aria-label="Edit note" title="Note">${icon('note')}</button>
        <button class="ib" type="button" data-act="card" aria-label="Make card" title="${hasCard ? 'Card made' : 'Make card'}" style="${hasCard ? 'color:var(--a3)' : ''}">${icon('cards')}</button>
        <button class="ib" type="button" data-act="del" aria-label="Delete highlight" title="Delete">${icon('trash')}</button>
      </span></div>
  </div>`;
}
function renderNotebook() {
  const v = $('#view');
  if (S.nb.book !== 'all' && !bookById(S.nb.book)) S.nb.book = 'all';
  const list = filteredHighlights();
  const booksWith = S.books.filter((b) => S.highlights.some((h) => h.bookId === b.id));
  const groups = new Map();
  list.sort((a, b) => b.createdAt - a.createdAt).forEach((h) => {
    if (!groups.has(h.bookId)) groups.set(h.bookId, []);
    groups.get(h.bookId).push(h);
  });
  v.innerHTML = `
    <div class="view-head"><h1>Notebook</h1>
      <button class="btn soft" type="button" id="nbExport" ${S.highlights.length ? '' : 'disabled'}>${icon('download')}Export</button></div>
    ${S.highlights.length ? `<div class="toolbar">
      <label class="search">${icon('search')}<input class="input" id="nbSearch" type="search" placeholder="Search highlights and notes" value="${esc(S.nb.q)}" aria-label="Search highlights"></label>
      <select class="select" id="nbBook" aria-label="Book"><option value="all">All books</option>${booksWith.map((b) => `<option value="${b.id}" ${S.nb.book === b.id ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>
      <div class="chips" role="group" aria-label="Colour">
        <button class="chip" type="button" data-color="all" aria-pressed="${S.nb.color === 'all'}">All</button>
        ${Object.entries(HL_COLORS).map(([k, c]) => `<button class="chip" type="button" data-color="${k}" aria-pressed="${S.nb.color === k}" aria-label="${c.label}"><i style="--c:${c.fill}"></i>${c.label}</button>`).join('')}
      </div></div>` : ''}
    <div id="nbBody">
      ${!S.highlights.length ? `<div class="empty" style="margin-top:10px"><span class="big">${icon('notes')}</span><h2>No highlights yet</h2><p>Select text while reading to highlight it. Everything you mark shows up here.</p><a class="btn soft" href="#/library">Go to library</a></div>`
        : !list.length ? '<p class="muted" style="margin-top:24px">Nothing matches these filters.</p>'
        : [...groups.entries()].map(([bid, hs]) => {
          const b = bookById(bid);
          if (!b) return '';
          const cu = coverURL(b);
          return `<div class="nb-group"><h3>${cu ? `<img src="${cu}" alt="">` : `<span class="mini" style="background:${gradFor(b.title)}"></span>`}<span>${esc(b.title)} <small>${plural(hs.length, 'highlight')}</small></span></h3>
            <div class="nb-list">${hs.map((h) => hlCardHTML(h)).join('')}</div></div>`;
        }).join('')}
    </div>`;

  $('#nbSearch')?.addEventListener('input', (e) => { S.nb.q = e.target.value; refreshNbBody(); });
  $('#nbBook')?.addEventListener('change', (e) => { S.nb.book = e.target.value; renderNotebook(); });
  $$('[data-color]').forEach((c) => c.addEventListener('click', () => { S.nb.color = c.dataset.color; renderNotebook(); }));
  $('#nbExport')?.addEventListener('click', exportMarkdown);
}
function refreshNbBody() {
  const pos = $('#nbSearch')?.selectionStart;
  renderNotebook();
  const s = $('#nbSearch');
  if (s) { s.focus(); s.setSelectionRange(pos, pos); }
}
$('#view').addEventListener('click', async (e) => {
  const btn = e.target.closest('.hlc [data-act]');
  if (!btn) return;
  const h = S.highlights.find((x) => x.id === btn.closest('.hlc').dataset.h);
  if (!h) return;
  const act = btn.dataset.act;
  if (act === 'open') go(`#/read/${h.bookId}?h=${h.id}`);
  if (act === 'note') noteDialog(h, () => renderNotebook());
  if (act === 'card') cardDialog({ bookId: h.bookId, highlightId: h.id, text: h.text, color: h.color }, () => renderNotebook());
  if (act === 'del') { await deleteHighlight(h); renderNotebook(); }
});

function exportMarkdown() {
  const lines = ['# Pathak highlights', '', `Exported ${new Date().toLocaleDateString()}`, ''];
  const byBook = new Map();
  filteredHighlights().forEach((h) => { if (!byBook.has(h.bookId)) byBook.set(h.bookId, []); byBook.get(h.bookId).push(h); });
  for (const [bid, hs] of byBook) {
    const b = bookById(bid);
    lines.push(`## ${b?.title || 'Unknown book'}${b?.author ? ` · ${b.author}` : ''}`, '');
    hs.sort((a, c) => (a.progress || 0) - (c.progress || 0)).forEach((h) => {
      lines.push(`> ${h.text.replace(/\n+/g, ' ')}`);
      if (h.note) lines.push('', `**Note:** ${h.note}`);
      if (h.chapter) lines.push('', `*${h.chapter}*`);
      lines.push('');
    });
  }
  download(new Blob([lines.join('\n')], { type: 'text/markdown' }), `pathak-highlights-${today()}.md`);
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
  if (!quiet) toast('Highlight deleted', { label: 'Undo', run: async () => { await saveHighlight(h); if (currentRoute().name === 'notebook') renderNotebook(); } });
}

function noteDialog(h, after) {
  const sh = openSheet(`
    <h2>Note</h2>
    <div class="quote" style="--c:${HL_COLORS[h.color]?.fill}">${esc(h.text)}</div>
    <div class="field"><label for="noteText">Your note</label><textarea id="noteText" placeholder="What do you think about this?">${esc(h.note || '')}</textarea></div>
    <div class="foot">${h.note ? '<button class="btn ghost" type="button" data-x="clear">Remove note</button>' : ''}<button class="btn soft" type="button" data-x="cancel">Cancel</button><button class="btn primary" type="button" data-x="save">Save</button></div>`, { dialog: true });
  sh.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'cancel') return closeOverlay();
    h.note = x === 'clear' ? '' : $('#noteText', sh).value.trim();
    await saveHighlight(h);
    closeOverlay();
    toast(h.note ? 'Note saved' : 'Note removed');
    after?.();
  });
  sh.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sh.querySelector('[data-x="save"]').click(); });
}

function cardDialog({ bookId, highlightId = null, text = '', front, back, color, existing }, after) {
  const sug = front != null ? { front, back } : suggestCloze(text);
  const card = existing;
  const sh = openSheet(`
    <h2>${card ? 'Edit card' : 'New card'}</h2>
    ${text && !card ? `<div class="quote" style="--c:${HL_COLORS[color]?.fill || 'var(--a1)'}">${esc(text)}</div>` : ''}
    <div class="field"><label for="cFront">Question</label><textarea id="cFront" style="min-height:80px">${esc(card ? card.front : sug.front)}</textarea></div>
    <div class="field"><label for="cBack">Answer</label><textarea id="cBack" style="min-height:64px">${esc(card ? card.back : sug.back)}</textarea></div>
    <div class="foot"><button class="btn soft" type="button" data-x="cancel">Cancel</button><button class="btn primary" type="button" data-x="save">${card ? 'Save' : 'Add card'}</button></div>`, { dialog: true });
  sh.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'cancel') return closeOverlay();
    const f = $('#cFront', sh).value.trim();
    const b = $('#cBack', sh).value.trim();
    if (!f) { $('#cFront', sh).focus(); return; }
    const c = card ? { ...card, front: f, back: b } : newCard({ id: uid(), bookId, highlightId, front: f, back: b, context: text });
    await db.put('cards', c);
    const i = S.cards.findIndex((y) => y.id === c.id);
    if (i >= 0) S.cards[i] = c; else S.cards.push(c);
    closeOverlay();
    updateBadges();
    toast(card ? 'Card updated' : 'Card added to Review');
    after?.();
  });
}

/* ---------- dictionary ---------- */
async function defineSheet(word, ctx) {
  const sh = openSheet(`<div id="dictBody"><div class="dict-word">${esc(word)}</div><div style="padding:24px 0;text-align:center" class="muted"><div class="spinner"></div>Looking up…</div></div>`);
  const res = await lookup(word);
  if (!document.body.contains(sh)) return;
  const body = $('#dictBody', sh);
  if (!res) { body.innerHTML = `<div class="dict-word">${esc(word)}</div><p class="muted" style="margin-top:8px">Select a single word to look it up.</p>`; return; }
  if (res.offline) { body.innerHTML = `<div class="dict-word">${esc(res.word)}</div><p class="muted" style="margin-top:8px">Connect to the internet to look up words.</p>`; return; }
  const hi = res.lang === 'hi';
  body.innerHTML = `
    <div><span class="dict-word">${esc(res.word)}</span>${res.phonetic ? `<span class="dict-ph">${esc(res.phonetic)}</span>` : ''}</div>
    ${res.translation ? `<div class="dict-tr"><b>${esc(res.translation)}</b><span>${hi ? 'English' : 'Hindi'}</span></div>` : ''}
    ${res.senses.map((s) => `<div class="dict-sense"><i>${esc(s.pos)}</i><p>${esc(s.def)}</p>${s.example ? `<em>“${esc(s.example)}”</em>` : ''}</div>`).join('')}
    ${res.empty ? '<p class="muted" style="margin-top:10px">No meaning found for this word.</p>' : ''}
    <div class="foot" style="justify-content:space-between">
      <a class="btn ghost sm" href="https://www.google.com/search?q=${encodeURIComponent(`${res.word} meaning`)}" target="_blank" rel="noopener">${icon('search')}Search the web</a>
      ${!res.empty && ctx?.bookId ? '<button class="btn primary sm" type="button" id="wordCard">' + icon('cards') + 'Add to cards</button>' : ''}
    </div>`;
  $('#wordCard', sh)?.addEventListener('click', () => {
    const back = [res.translation, res.senses[0]?.def].filter(Boolean).join(' · ');
    cardDialog({ bookId: ctx.bookId, front: `What does “${res.word}” mean?`, back, text: ctx.text || '' });
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
  $('#rChapter').textContent = b.author || '';
  $('#rLoading').hidden = false;
  $('[data-r="zoomin"]').hidden = b.type !== 'pdf';
  $('[data-r="zoomout"]').hidden = b.type !== 'pdf';
  b.lastOpened = Date.now();
  db.put('books', b);

  const handlers = {
    relocate: onRelocate,
    select: onSelect,
    highlightClick: onHighlightClick,
    tapCenter: () => { if (pop) { closePop(); return; } rEl.classList.toggle('immersive'); },
    key: onKey,
    saveLocations: (json) => { b.locations = json; db.put('books', b); },
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
  const h = S.highlights.find((x) => x.id === hid);
  if (!h || !R.reader) return;
  if (h.cfi) R.reader.goTo(h.cfi);
  else R.reader.goTo({ page: h.page, offset: Math.max(0, (h.rects?.[0]?.y || 0) - 0.15) });
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
    $('#rLeft').textContent = R.reader?.locationsReady ? '' : 'Preparing…';
    if (info.pagesLeftInChapter != null) {
      const m = Math.round((info.pagesLeftInChapter * R.secPerPage) / 60);
      $('#rMid').textContent = info.pagesLeftInChapter === 0 ? 'End of chapter' : m < 1 ? 'Less than a minute left in chapter' : `${m} min left in chapter`;
    } else $('#rMid').textContent = '';
  }
  clearTimeout(R.saveT);
  R.saveT = setTimeout(savePosition, 600);
}
async function savePosition() {
  if (!R.book) return;
  R.book.position = R.pos;
  R.book.progress = Math.max(0, Math.min(1, R.pct));
  await db.put('books', R.book);
}

async function closeReader(navigate = true) {
  if (!R.active) return;
  clearTimeout(R.saveT);
  clearInterval(R.tick);
  await savePosition();
  closePop();
  closeOverlay();
  try { R.reader?.destroy(); } catch { /* ignore */ }
  R.reader = null;
  R.active = false;
  R.book = null;
  R.pct = 0;
  R.lastTurn = 0;
  rEl.hidden = true;
  document.body.style.overflow = '';
  if (navigate) go(lastShellRoute.startsWith('#/read') ? '#/library' : lastShellRoute);
}

function onKey(e) {
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
  const b = e.target.closest('[data-r]');
  if (!b) return;
  const a = b.dataset.r;
  if (a === 'close') closeReader();
  if (a === 'next') R.reader?.next();
  if (a === 'prev') R.reader?.prev();
  if (a === 'toc') tocDrawer();
  if (a === 'settings') readerSettings();
  if (a === 'zoomin' || a === 'zoomout') {
    const steps = ['fit', '1.25', '1.5', '2', '2.5'];
    let i = steps.indexOf(String(S.settings.pdfZoom));
    if (i < 0) i = 0;
    i = Math.max(0, Math.min(steps.length - 1, i + (a === 'zoomin' ? 1 : -1)));
    updateSettings({ pdfZoom: steps[i] });
    toast(steps[i] === 'fit' ? 'Fit to width' : `${Math.round(Number(steps[i]) * 100)}%`);
  }
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
function placePop(el, rect) {
  document.body.appendChild(el);
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(innerWidth - w - 8, left));
  let top = rect.top - h - 12;
  if (top < 70) top = (rect.bottom ?? rect.top + rect.height) + 12;
  top = Math.min(top, innerHeight - h - 8);
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
  if (sel.text.length > 4000) { toast('That selection is too long to highlight.'); return; }
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
      return;
    }
    const p = b.dataset.p;
    if (p === 'copy') { copyText(sel.text); sel.clear(); closePop(); }
    if (p === 'define') { const w = sel.text.split(/\s+/)[0]; sel.clear(); closePop(); defineSheet(w, { bookId: R.book.id, text: sel.text }); }
    if (p === 'note' || p === 'card') {
      const h = makeHighlight(sel, 'yellow');
      await saveHighlight(h);
      sel.clear(); closePop();
      if (p === 'note') noteDialog(h);
      else cardDialog({ bookId: h.bookId, highlightId: h.id, text: h.text, color: h.color });
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
    if (p === 'card') cardDialog({ bookId: h.bookId, highlightId: h.id, text: h.text, color: h.color });
    if (p === 'del') deleteHighlight(h);
  });
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast("Couldn't copy. Select the text and copy it manually."); }
}
document.addEventListener('pointerdown', (e) => { if (pop && !pop.el.contains(e.target) && !e.target.closest?.('.r-host')) closePop(); }, true);

/* ---------- review ---------- */
const RV = { showing: false, timer: null };
function renderReview() {
  clearTimeout(RV.timer);
  const v = $('#view');
  if (S.deck !== 'all' && !bookById(S.deck)) S.deck = 'all';
  const inDeck = S.cards.filter((c) => S.deck === 'all' || c.bookId === S.deck);
  const due = dueCards(S.deck);
  const reviewedToday = inDeck.filter((c) => c.lastReviewed && today(new Date(c.lastReviewed)) === today()).length;
  const decks = S.books.filter((b) => S.cards.some((c) => c.bookId === b.id));
  const c = due[0];
  const book = c && bookById(c.bookId);
  const nextDue = inDeck.filter((x) => x.due > Date.now()).sort((a, b) => a.due - b.due)[0];

  let stage;
  if (!S.cards.length) {
    stage = `<div class="done"><span class="big">${icon('cards')}</span><h2>No cards yet</h2><p class="muted">While reading, select text and tap <b>Card</b>. You can also make cards from the Notebook.</p></div>`;
  } else if (!c) {
    stage = `<div class="done"><span class="big">${icon('check')}</span><h2>All caught up</h2><p class="muted">${reviewedToday ? `${plural(reviewedToday, 'card')} reviewed today. ` : ''}${nextDue ? `Next card ${untilText(nextDue.due)}.` : ''}</p></div>`;
    if (nextDue && nextDue.due - Date.now() < 15 * 60e3) RV.timer = setTimeout(() => { if (currentRoute().name === 'review') renderReview(); }, nextDue.due - Date.now() + 500);
  } else {
    RV.showing = false;
    stage = `
      <div class="qcard" id="qcard">
        <span class="src">${esc(book?.title || 'Card')}</span>
        <p class="q">${esc(c.front)}</p>
        <div id="ansWrap" hidden>
          <p class="ans">${esc(c.back || '—')}</p>
          ${c.context && c.context !== c.back ? `<p class="ctx" style="margin-top:12px">${esc(c.context)}</p>` : ''}
        </div>
      </div>
      <button class="reveal" type="button" id="reveal">Show answer <span class="kbd">Space</span></button>
      <div class="grade" id="grade" hidden>
        <button type="button" class="again" data-g="again">Again<small>${previewLabel(c, 'again')}</small></button>
        <button type="button" class="good" data-g="good">Good<small>${previewLabel(c, 'good')}</small></button>
        <button type="button" class="easy" data-g="easy">Easy<small>${previewLabel(c, 'easy')}</small></button>
      </div>`;
  }

  v.innerHTML = `
    <div class="view-head"><h1>Review</h1>
      <button class="btn soft" type="button" id="newCard">${icon('plus')}New card</button></div>
    <div class="review">
      <div class="deck glass">
        <div class="deck-top">
          <select class="select" id="deckSel" aria-label="Deck"><option value="all">All cards</option>${decks.map((b) => `<option value="${b.id}" ${S.deck === b.id ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}</select>
          <div class="counts"><span>Due <b>${due.length}</b></span><span>Done today <b>${reviewedToday}</b></span></div>
        </div>
        ${stage}
      </div>
      <aside class="side glass">
        <h3>Cards <span class="muted" style="font-weight:500">${inDeck.length}</span></h3>
        ${inDeck.length ? `<div class="clist">${[...inDeck].sort((a, b) => b.createdAt - a.createdAt).map((x) => `
          <div class="citem" data-c="${x.id}"><p title="${esc(x.front)}">${esc(x.front)}</p><small>${x.due <= Date.now() ? 'Due' : untilText(x.due)}</small>
            <button class="ib" type="button" data-ce="edit" aria-label="Edit card">${icon('edit')}</button>
            <button class="ib" type="button" data-ce="del" aria-label="Delete card">${icon('trash')}</button></div>`).join('')}</div>` : '<p class="muted" style="font-size:14px">Cards you make appear here.</p>'}
      </aside>
    </div>`;

  $('#deckSel').addEventListener('change', (e) => { S.deck = e.target.value; renderReview(); });
  $('#newCard').addEventListener('click', () => {
    const bid = S.deck !== 'all' ? S.deck : (S.books[0]?.id || null);
    cardDialog({ bookId: bid, front: '', back: '' }, () => renderReview());
  });
  $('#reveal')?.addEventListener('click', reveal);
  $('#grade')?.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) grade(c, b.dataset.g); });
  $$('.citem [data-ce]').forEach((b) => b.addEventListener('click', async () => {
    const card = S.cards.find((x) => x.id === b.closest('.citem').dataset.c);
    if (!card) return;
    if (b.dataset.ce === 'edit') cardDialog({ bookId: card.bookId, existing: card }, () => renderReview());
    else {
      await db.del('cards', card.id);
      S.cards = S.cards.filter((x) => x.id !== card.id);
      renderReview(); updateBadges();
      toast('Card deleted', { label: 'Undo', run: async () => { await db.put('cards', card); S.cards.push(card); renderReview(); updateBadges(); } });
    }
  }));
  RV.current = c;
}
function reveal() {
  if (RV.showing || !$('#ansWrap')) return;
  RV.showing = true;
  $('#ansWrap').hidden = false;
  $('#reveal').hidden = true;
  $('#grade').hidden = false;
  $('#grade button.good')?.focus();
}
async function grade(c, g) {
  const next = schedule(c, g);
  await db.put('cards', next);
  S.cards = S.cards.map((x) => (x.id === c.id ? next : x));
  $('#qcard')?.classList.add('out');
  setTimeout(() => { renderReview(); updateBadges(); }, 260);
}
document.addEventListener('keydown', (e) => {
  if (currentRoute().name !== 'review' || overlay || e.target.closest?.('input, textarea, select')) return;
  if (e.key === ' ' && !RV.showing && $('#reveal')) { e.preventDefault(); reveal(); }
  else if (RV.showing && RV.current && ['1', '2', '3'].includes(e.key)) grade(RV.current, ['again', 'good', 'easy'][Number(e.key) - 1]);
});

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
      for (const c of data.cards || []) await db.put('cards', c);
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
async function exportBackup() {
  const data = {
    app: 'pathak', version: 1, exportedAt: new Date().toISOString(),
    books: S.books.map(({ cover, locations, ...b }) => b),
    highlights: S.highlights, cards: S.cards, stats: S.stats, settings: S.settings,
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
