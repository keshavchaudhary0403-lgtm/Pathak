// PDF reader on pdf.js: continuous scroll, lazy page rendering, selectable text and highlights.
import { pdfjs } from './pdfjs.js';
import { THEMES, HL_COLORS } from './config.js';
import { wheelPager, touchGestures } from './gestures.js';

export async function openPdf({ book, blob, host, settings, highlights, on }) {
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const n = doc.numPages;
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });

  const scroller = document.createElement('div');
  scroller.className = 'pdf-scroll';
  const column = document.createElement('div');
  column.className = 'pdf-col';
  scroller.appendChild(column);
  host.appendChild(scroller);

  let current = settings;
  let scale = 1;
  const pages = [];
  const computeScale = () => {
    const avail = Math.min(scroller.clientWidth - 24, 1000);
    const fit = avail / base.width;
    return current.pdfZoom === 'fit' ? fit : fit * Number(current.pdfZoom);
  };

  function applyTheme(s) {
    const t = THEMES[s.theme] || THEMES.paper;
    scroller.style.background = t.ui === 'dark' ? '#0d0c11' : (s.theme === 'sepia' ? '#E9DCC2' : '#E8E6EE');
    scroller.dataset.theme = s.theme;
  }

  function layout() {
    scale = computeScale();
    column.innerHTML = '';
    pages.length = 0;
    for (let i = 1; i <= n; i++) {
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.dataset.page = i;
      el.style.width = `${Math.floor(base.width * scale)}px`;
      el.style.height = `${Math.floor(base.height * scale)}px`;
      el.style.setProperty('--scale-factor', scale);
      const hl = document.createElement('div');
      hl.className = 'pdf-hl';
      el.appendChild(hl);
      column.appendChild(el);
      pages.push({ el, hl, rendered: false, rendering: false });
      io.observe(el);
    }
    highlights.forEach(draw);
  }

  async function renderPage(i) {
    const p = pages[i - 1];
    if (!p || p.rendered || p.rendering) return;
    p.rendering = true;
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    p.el.style.width = `${Math.floor(vp.width)}px`;
    p.el.style.height = `${Math.floor(vp.height)}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    const tl = document.createElement('div');
    tl.className = 'textLayer';
    p.el.prepend(canvas);
    p.el.appendChild(tl);
    try {
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }).render();
    } catch (e) { console.warn('textlayer', e); }
    p.rendered = true;
    p.rendering = false;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) renderPage(Number(en.target.dataset.page)); });
  }, { root: scroller, rootMargin: '800px 0px' });

  // Current page tracking
  let curPage = 1;
  let raf = 0;
  function onScroll() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const mid = scroller.scrollTop + padTop + scroller.clientHeight * 0.2;
      let pg = 1;
      for (const p of pages) { if (p.el.offsetTop <= mid) pg = Number(p.el.dataset.page); else break; }
      const p = pages[pg - 1];
      const offset = p ? (scroller.scrollTop + padTop - p.el.offsetTop) / p.el.offsetHeight : 0;
      curPage = pg;
      on.relocate?.({
        pct: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 ? 1 : Math.min(1, (pg - 1 + Math.max(0, Math.min(1, offset))) / n),
        pos: { page: pg, offset: Math.max(0, Math.min(1, offset)) },
        chapter: `Page ${pg} of ${n}`,
        pagesLeftInChapter: null,
        page: pg,
        pages: n,
      });
    });
  }
  scroller.addEventListener('scroll', onScroll, { passive: true });

  // Trackpad: pinch (ctrl+wheel, or Safari gesture events) zooms; a horizontal swipe turns the page.
  const zoomOf = (z) => (z === 'fit' ? 1 : Number(z) || 1);
  let pinch = null;
  let pinchT = 0;
  function previewZoom(target, cx, cy, auto = true) {
    const cur = zoomOf(current.pdfZoom);
    pinch = Math.min(4, Math.max(0.5, target));
    const cr = column.getBoundingClientRect();
    column.style.transformOrigin = `${cx - cr.left}px ${cy - cr.top}px`;
    column.style.transform = `scale(${pinch / cur})`;
    clearTimeout(pinchT);
    if (auto) pinchT = setTimeout(commitZoom, 200);
  }
  function commitZoom() {
    if (pinch == null) return;
    const z = pinch;
    pinch = null;
    column.style.transform = '';
    const val = Math.abs(z - 1) < 0.05 ? 'fit' : String(Math.round(z * 100) / 100);
    if (val === current.pdfZoom) return;
    current = { ...current, pdfZoom: val };
    relayout();
    on.zoomChange?.(val);
  }
  const canPanX = () => scroller.scrollWidth > scroller.clientWidth + 2;
  const hPager = wheelPager((dir) => goTo({ page: curPage + dir }), { axis: 'x', threshold: 60 });
  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      previewZoom((pinch ?? zoomOf(current.pdfZoom)) * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      return;
    }
    if (canPanX()) return; // zoomed in: let the page pan sideways
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) {
      e.preventDefault();
      hPager(e);
    }
  }, { passive: false });
  // Touch: pinch to zoom, swipe sideways to turn the page.
  let touchPinch = false;
  let pinchBase = 1;
  touchGestures(scroller, {
    canSwipe: () => !canPanX() && window.getSelection()?.isCollapsed !== false,
    onSwipe: (dir) => goTo({ page: curPage + dir }),
    onPinchMove: (ratio, mid) => {
      if (!touchPinch) { touchPinch = true; pinchBase = zoomOf(current.pdfZoom); }
      previewZoom(pinchBase * ratio, mid.x, mid.y, false);
    },
    onPinchEnd: () => { touchPinch = false; commitZoom(); },
  });
  // Safari on a Mac trackpad sends gesture events for pinch.
  let gestureStart = 1;
  scroller.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureStart = zoomOf(current.pdfZoom); });
  scroller.addEventListener('gesturechange', (e) => { e.preventDefault(); if (!touchPinch) previewZoom(gestureStart * e.scale, e.clientX, e.clientY); });
  scroller.addEventListener('gestureend', (e) => { e.preventDefault(); if (!touchPinch) { clearTimeout(pinchT); commitZoom(); } });

  // Highlights: drawn below the text layer, hit-tested on click.
  function draw(h) {
    const p = pages[h.page - 1];
    if (!p) return;
    p.hl.querySelectorAll(`[data-id="${h.id}"]`).forEach((x) => x.remove());
    const fill = HL_COLORS[h.color]?.fill || HL_COLORS.yellow.fill;
    for (const r of h.rects) {
      const d = document.createElement('div');
      d.dataset.id = h.id;
      d.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%;background:${fill}`;
      p.hl.appendChild(d);
    }
  }
  function undraw(id) { column.querySelectorAll(`.pdf-hl [data-id="${id}"]`).forEach((x) => x.remove()); }

  function pageOf(node) { return node?.nodeType === 1 ? node.closest('.pdf-page') : node?.parentElement?.closest('.pdf-page'); }

  function checkSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const pageEl = pageOf(range.startContainer);
    if (!pageEl || !scroller.contains(pageEl)) return;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text) return;
    const pb = pageEl.getBoundingClientRect();
    const rects = [];
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      if (r.top < pb.top - 2 || r.bottom > pb.bottom + 2) continue;
      const rr = { x: (r.left - pb.left) / pb.width, y: (r.top - pb.top) / pb.height, w: r.width / pb.width, h: r.height / pb.height };
      const prev = rects[rects.length - 1];
      if (prev && Math.abs(prev.y - rr.y) < 0.004 && rr.x <= prev.x + prev.w + 0.02) {
        const right = Math.max(prev.x + prev.w, rr.x + rr.w);
        prev.x = Math.min(prev.x, rr.x); prev.w = right - prev.x; prev.h = Math.max(prev.h, rr.h);
      } else rects.push(rr);
    }
    if (!rects.length) return;
    const br = range.getBoundingClientRect();
    on.select?.({
      text,
      anchor: { page: Number(pageEl.dataset.page), rects },
      rect: { left: br.left, top: br.top, width: br.width, height: br.height, bottom: br.bottom },
      clear: () => window.getSelection()?.removeAllRanges(),
    });
  }
  const onUp = () => setTimeout(checkSelection, 10);
  scroller.addEventListener('mouseup', onUp);
  scroller.addEventListener('touchend', onUp);

  scroller.addEventListener('click', (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const pageEl = e.target.closest('.pdf-page');
    if (pageEl) {
      const pb = pageEl.getBoundingClientRect();
      const x = (e.clientX - pb.left) / pb.width;
      const y = (e.clientY - pb.top) / pb.height;
      const pg = Number(pageEl.dataset.page);
      const hit = highlights.find((h) => h.page === pg && h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h));
      if (hit) {
        const el = pageEl.querySelector(`.pdf-hl [data-id="${hit.id}"]`);
        on.highlightClick?.(hit.id, el ? el.getBoundingClientRect() : null);
        return;
      }
    }
    // Click the left or right edge to turn the page; the middle shows or hides the controls.
    const sr = scroller.getBoundingClientRect();
    const rel = (e.clientX - sr.left) / sr.width;
    if (rel < 0.18) goTo({ page: curPage - 1 });
    else if (rel > 0.82) goTo({ page: curPage + 1 });
    else on.tapCenter?.();
  });

  const ro = new ResizeObserver(() => {
    const s = computeScale();
    if (Math.abs(s - scale) / scale > 0.04) relayout();
  });

  function relayout() {
    const pos = { page: curPage, offset: pages[curPage - 1] ? (scroller.scrollTop - pages[curPage - 1].el.offsetTop) / pages[curPage - 1].el.offsetHeight : 0 };
    io.disconnect();
    layout();
    goTo(pos);
  }

  function goTo(pos) {
    const pg = Math.max(1, Math.min(n, pos?.page || 1));
    const p = pages[pg - 1];
    const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    scroller.scrollTop = Math.max(0, p.el.offsetTop - padTop + (pos?.offset || 0) * p.el.offsetHeight);
    onScroll();
  }

  // Page text, cached, for search and read aloud.
  const texts = new Map();
  async function pageText(i) {
    if (texts.has(i)) return texts.get(i);
    let t = '';
    try {
      const tc = await (await doc.getPage(i)).getTextContent();
      t = tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('');
    } catch { /* ignore */ }
    texts.set(i, t);
    return t;
  }
  async function ttsPage(i) {
    const t = (await pageText(i)).replace(/-\n(?=\p{Ll})/gu, '').replace(/\s*\n\s*/g, ' ').trim();
    return { page: i, start: 0, blocks: t ? [{ text: t }] : [] };
  }

  // Outline
  const toc = [];
  try {
    const outline = await doc.getOutline();
    const walk = (items, depth) => (items || []).forEach((it) => {
      toc.push({ label: it.title, dest: it.dest, depth });
      if (it.items?.length && depth < 2) walk(it.items, depth + 1);
    });
    walk(outline, 0);
  } catch { /* none */ }

  applyTheme(settings);
  layout();
  ro.observe(scroller);
  goTo(book.position || { page: 1 });

  return {
    kind: 'pdf',
    toc,
    pages: n,
    locationsReady: true,
    next: () => goTo({ page: curPage + 1 }),
    prev: () => goTo({ page: curPage - 1 }),
    goTo,
    async goToHref(item) {
      try {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (!dest) return;
        const idx = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0];
        goTo({ page: idx + 1 });
      } catch (e) { console.warn(e); }
    },
    goToPct: (p) => goTo({ page: Math.round(p * (n - 1)) + 1 }),
    scrollBy: (dx, dy) => scroller.scrollBy(dx, dy),
    async search(q, onBatch, cancelled) {
      const ql = q.toLowerCase();
      let batch = [];
      let total = 0;
      for (let i = 1; i <= n; i++) {
        if (cancelled()) return;
        const text = (await pageText(i)).replace(/\s+/g, ' ');
        const low = text.toLowerCase();
        let at = low.indexOf(ql);
        while (at !== -1 && total < 500) {
          const a = Math.max(0, at - 60);
          const b = Math.min(text.length, at + q.length + 60);
          batch.push({ page: i, excerpt: `${a > 0 ? '…' : ''}${text.slice(a, b).trim()}${b < text.length ? '…' : ''}`, where: `Page ${i}` });
          total++;
          at = low.indexOf(ql, at + ql.length);
        }
        if (batch.length && (i % 5 === 0 || i === n)) { onBatch(batch); batch = []; }
        if (i % 3 === 0) await new Promise((res) => setTimeout(res, 0));
      }
      if (batch.length) onBatch(batch);
    },
    async showResult(res, q) {
      goTo({ page: res.page });
      const p = pages[res.page - 1];
      for (let t = 0; t < 30 && !p.el.querySelector('.textLayer span'); t++) await new Promise((r2) => setTimeout(r2, 100));
      const ql = q.toLowerCase();
      const first = ql.split(/\s+/)[0];
      let spans = [...p.el.querySelectorAll('.textLayer span')].filter((sp) => sp.textContent.toLowerCase().includes(ql));
      if (!spans.length) spans = [...p.el.querySelectorAll('.textLayer span')].filter((sp) => sp.textContent.toLowerCase().includes(first));
      if (spans[0]) {
        const pr = p.el.getBoundingClientRect();
        const sr = spans[0].getBoundingClientRect();
        scroller.scrollTop += sr.top - pr.top - scroller.clientHeight * 0.3 + (pr.top - scroller.getBoundingClientRect().top);
        spans.forEach((sp) => sp.classList.add('pk-find'));
        setTimeout(() => spans.forEach((sp) => sp.classList.remove('pk-find')), 3500);
      }
    },
    async ttsStart() { return ttsPage(curPage); },
    async ttsNext(group) {
      for (let pg = group.page + 1; pg <= Math.min(n, group.page + 4); pg++) {
        const g = await ttsPage(pg);
        if (g.blocks.length) { goTo({ page: pg }); return g; }
      }
      return null;
    },
    ttsShow(group) { if (curPage !== group.page) goTo({ page: group.page }); },
    ttsClear() {},
    get page() { return curPage; },
    // Page boxes on screen, for the snip tool.
    pageRects() {
      return pages.map((p) => ({ page: Number(p.el.dataset.page), rect: p.el.getBoundingClientRect() }));
    },
    // Render a region of a page (fractions of the page) as a sharp PNG, straight from the PDF.
    async snip(pageNum, rel) {
      const page = await doc.getPage(pageNum);
      const vp1 = page.getViewport({ scale: 1 });
      const cropW = rel.w * vp1.width;
      const scale = Math.max(2, Math.min(6, 1800 / Math.max(cropW, 1)));
      const vp = page.getViewport({ scale, offsetX: -rel.x * vp1.width * scale, offsetY: -rel.y * vp1.height * scale });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(rel.w * vp1.width * scale));
      c.height = Math.max(1, Math.round(rel.h * vp1.height * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      return { blob, w: c.width, h: c.height };
    },
    draw,
    undraw,
    async applySettings(s) {
      const zoomChanged = s.pdfZoom !== current.pdfZoom;
      current = s;
      applyTheme(s);
      if (zoomChanged) relayout();
    },
    setHighlights(list) { highlights = list; },
    resize: () => relayout(),
    destroy() {
      io.disconnect();
      ro.disconnect();
      doc.destroy();
      host.innerHTML = '';
    },
  };
}
