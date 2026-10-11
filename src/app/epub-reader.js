// EPUB reader built on epub.js. Exposes a small interface the app shell drives.
import ePub from 'epubjs';
import { THEMES, FONTS, HL_COLORS, FONT_CSS_URL } from './config.js';

function firstText(node) {
  if (node.nodeType === 3) return node;
  return node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
}
function lastText(node) {
  if (node.nodeType === 3) return node;
  const w = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let t = null;
  let n;
  while ((n = w.nextNode())) t = n;
  return t;
}
// Selections that start or end on element boundaries produce unreliable CFIs; pin them to text nodes.
function toTextRange(r) {
  const nr = r.cloneRange();
  if (r.startContainer.nodeType !== 3) {
    const t = firstText(r.startContainer.childNodes[r.startOffset] || r.startContainer);
    if (t) nr.setStart(t, 0);
  }
  if (r.endContainer.nodeType !== 3) {
    const t = lastText(r.endContainer.childNodes[r.endOffset - 1] || r.endContainer);
    if (t) nr.setEnd(t, t.length);
  }
  return nr;
}

export async function openEpub({ book, blob, host, settings, highlights, on }) {
  const buf = await blob.arrayBuffer();
  const ebook = ePub(buf);
  await ebook.ready;

  const scrolled = settings.layout === 'scroll';
  const rendition = ebook.renderTo(host, {
    width: '100%',
    height: '100%',
    flow: scrolled ? 'scrolled' : 'paginated',
    manager: scrolled ? 'continuous' : 'default',
    spread: 'none',
    allowScriptedContent: false,
  });

  let current = settings;
  const cssFor = (s) => {
    const t = THEMES[s.theme] || THEMES.paper;
    const f = FONTS[s.font] || FONTS.book;
    const fam = f.stack
      ? `body, p, div, span, li, blockquote, td, th, dd, dt, h1, h2, h3, h4, h5, h6, a, em, i, b, strong { font-family: ${f.stack} !important; }`
      : '';
    return `
      html, body { background: ${t.bg} !important; color: ${t.fg} !important; }
      body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
      ${fam}
      p, li, div, blockquote, dd { line-height: ${s.lineHeight} !important; }
      a { color: ${t.link} !important; }
      img, svg, video { max-width: 100% !important; height: auto !important; }
      ::selection { background: ${t.selection}; }
      ${s.theme === 'night' ? 'img { opacity: .85; }' : ''}
    `;
  };

  // Mouse wheel and trackpad turn pages in paged mode. One gesture turns one page,
  // waiting for the trackpad's momentum to settle before the next turn.
  let wAcc = 0;
  let lastWheel = 0;
  let wLocked = false;
  function onWheel(e) {
    if (scrolled || e.ctrlKey || e.metaKey) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = Date.now();
    const gap = now - lastWheel;
    lastWheel = now;
    if (gap > 300) wAcc = 0;
    if (wLocked) { if (gap < 200) return; wLocked = false; wAcc = 0; }
    wAcc += d;
    if (Math.abs(wAcc) > 40) {
      wAcc > 0 ? rendition.next() : rendition.prev();
      wAcc = 0;
      wLocked = true;
    }
  }
  host.addEventListener('wheel', onWheel, { passive: true });

  rendition.hooks.content.register((contents) => {
    contents.addStylesheet(FONT_CSS_URL);
    contents.addStylesheetCss(cssFor(current), 'pathak-style');
    contents.document.addEventListener('wheel', onWheel, { passive: true });
  });

  function applyHostPadding(s) {
    const pad = { narrow: '2%', normal: '6%', wide: '13%' }[s.margins] || '6%';
    host.style.paddingInline = pad;
  }
  applyHostPadding(settings);
  rendition.themes.fontSize(`${settings.size}%`);

  // Table of contents (flattened, with depth)
  const nav = await ebook.loaded.navigation;
  const toc = [];
  const walk = (items, depth) => items.forEach((it) => {
    toc.push({ label: it.label.trim(), href: it.href, depth });
    if (it.subitems?.length) walk(it.subitems, depth + 1);
  });
  walk(nav.toc || [], 0);
  const stripHash = (h) => (h || '').split('#')[0].split('/').pop();
  const chapterFor = (href) => {
    const target = stripHash(href);
    const hit = toc.find((t) => stripHash(t.href) === target);
    return hit ? hit.label : '';
  };

  // Locations power percentages and the slider. Cached per book.
  let locationsReady = false;
  const locReady = (async () => {
    try {
      if (book.locations) ebook.locations.load(book.locations);
      else {
        await ebook.locations.generate(1200);
        on.saveLocations?.(ebook.locations.save());
      }
      locationsReady = true;
      const loc = rendition.currentLocation();
      if (loc?.start) emitRelocate(loc);
    } catch (e) { console.warn('locations', e); }
  })();

  function emitRelocate(loc) {
    if (!loc?.start) return;
    const spineLen = ebook.spine.length || 1;
    let pct = locationsReady
      ? ebook.locations.percentageFromCfi(loc.start.cfi)
      : (loc.start.index || 0) / spineLen;
    if (loc.atEnd) pct = 1;
    const d = loc.start.displayed || {};
    on.relocate?.({
      pct: Math.max(0, Math.min(1, pct || 0)),
      pos: loc.start.cfi,
      chapter: chapterFor(loc.start.href),
      pagesLeftInChapter: d.total ? Math.max(0, d.total - d.page) : null,
      loc: locationsReady ? ebook.locations.locationFromCfi(loc.start.cfi) : null,
      atStart: !!loc.atStart,
      atEnd: !!loc.atEnd,
    });
  }
  rendition.on('relocated', emitRelocate);

  // Highlights
  const drawn = new Map();
  function draw(h) {
    if (drawn.has(h.id)) rendition.annotations.remove(drawn.get(h.id), 'highlight');
    const color = HL_COLORS[h.color]?.fill || HL_COLORS.yellow.fill;
    rendition.annotations.highlight(
      h.cfi,
      { id: h.id },
      (e) => {
        const r = e?.target?.getBoundingClientRect?.();
        on.highlightClick?.(h.id, r || null);
      },
      'pk-hl',
      { fill: color, 'fill-opacity': current.theme === 'night' ? '0.42' : '0.38', 'mix-blend-mode': current.theme === 'night' ? 'screen' : 'multiply' }
    );
    drawn.set(h.id, h.cfi);
  }
  function undraw(id) {
    if (drawn.has(id)) {
      rendition.annotations.remove(drawn.get(id), 'highlight');
      drawn.delete(id);
    }
  }

  // Selection
  rendition.on('selected', (cfiRange, contents) => {
    const sel = contents.window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = toTextRange(sel.getRangeAt(0));
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (!text) return;
    let cfi = cfiRange;
    try { cfi = contents.cfiFromRange(range); } catch { /* keep epub.js cfi */ }
    const frame = contents.document.defaultView.frameElement.getBoundingClientRect();
    const r = range.getBoundingClientRect();
    on.select?.({
      text,
      anchor: { cfi },
      rect: { left: frame.left + r.left, top: frame.top + r.top, width: r.width, height: r.height, bottom: frame.top + r.bottom },
      clear: () => contents.window.getSelection()?.removeAllRanges(),
    });
  });

  // Taps and swipes
  let touchX = null;
  let touchY = null;
  rendition.on('touchstart', (e) => { touchX = e.changedTouches[0].screenX; touchY = e.changedTouches[0].screenY; });
  rendition.on('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].screenX - touchX;
    const dy = e.changedTouches[0].screenY - touchY;
    touchX = null;
    if (scrolled || Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
    dx < 0 ? rendition.next() : rendition.prev();
  });
  rendition.on('click', (e) => {
    const win = e.view;
    if (win?.getSelection && !win.getSelection().isCollapsed) return;
    if (e.target?.closest?.('a')) return;
    const frame = win.frameElement.getBoundingClientRect();
    const x = frame.left + e.clientX;
    const hb = host.getBoundingClientRect();
    const rel = (x - hb.left) / hb.width;
    if (!scrolled && rel < 0.22) rendition.prev();
    else if (!scrolled && rel > 0.78) rendition.next();
    else on.tapCenter?.();
  });
  rendition.on('keydown', (e) => on.key?.(e));

  await rendition.display(book.position || undefined);
  highlights.forEach(draw);
  for (const c of rendition.getContents()) c.addStylesheetCss(cssFor(current), 'pathak-style');

  const api = {
    kind: 'epub',
    toc,
    get locationsReady() { return locationsReady; },
    locReady,
    next: () => rendition.next(),
    prev: () => rendition.prev(),
    goTo: (pos) => rendition.display(pos),
    goToHref: (href) => rendition.display(href),
    goToPct: (p) => { if (locationsReady) rendition.display(ebook.locations.cfiFromPercentage(p)); },
    draw,
    undraw,
    async applySettings(s) {
      const relayout = s.size !== current.size || s.lineHeight !== current.lineHeight || s.font !== current.font || s.margins !== current.margins;
      current = s;
      applyHostPadding(s);
      rendition.themes.fontSize(`${s.size}%`);
      for (const c of rendition.getContents()) c.addStylesheetCss(cssFor(s), 'pathak-style');
      for (const [id] of drawn) {
        const h = highlights.find((x) => x.id === id);
        if (h) draw(h);
      }
      if (relayout) {
        const loc = rendition.currentLocation();
        rendition.resize();
        if (loc?.start) await rendition.display(loc.start.cfi);
      }
    },
    setHighlights(list) { highlights = list; },
    resize: () => rendition.resize(),
    destroy() {
      try { rendition.destroy(); } catch { /* ignore */ }
      try { ebook.destroy(); } catch { /* ignore */ }
      host.innerHTML = '';
      host.style.paddingInline = '';
    },
  };
  return api;
}
