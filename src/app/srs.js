// Spaced repetition (simplified SM-2) and helpers for turning highlights into cards.
const DAY = 86400000;

export function newCard(fields) {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: Date.now(), createdAt: Date.now(), ...fields };
}

// Returns the card's next state for a grade: 'again' | 'good' | 'easy'
export function schedule(card, grade, now = Date.now()) {
  const c = { ...card };
  if (grade === 'again') {
    c.lapses += 1;
    c.reps = 0;
    c.interval = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = now + 60 * 1000;
  } else if (grade === 'good') {
    c.interval = c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.round(c.interval * c.ease);
    c.reps += 1;
    c.due = now + c.interval * DAY;
  } else {
    c.interval = c.reps === 0 ? 4 : Math.round(Math.max(c.interval, 1) * c.ease * 1.3);
    c.reps += 1;
    c.ease = Math.min(3.2, c.ease + 0.15);
    c.due = now + c.interval * DAY;
  }
  c.lastReviewed = now;
  return c;
}

export function previewLabel(card, grade) {
  const next = schedule(card, grade, 0);
  if (grade === 'again') return '1 min';
  const d = next.interval;
  if (d === 1) return '1 day';
  if (d < 30) return `${d} days`;
  if (d < 365) return `${Math.round(d / 30)} mo`;
  return `${(d / 365).toFixed(1)} yr`;
}

const STOP = new Set('the a an and or but of to in on at for with from by as is are was were be been this that these those it its into than then also which who whom whose what when where why how not no can could will would should may might must has have had do does did'.split(' '));

// Suggest a question by blanking out the most informative word or number.
export function suggestCloze(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const tokens = clean.match(/[\p{L}\p{M}\p{N}'’-]+/gu) || [];
  let best = null;
  let bestScore = 0;
  tokens.forEach((t, i) => {
    const w = t.replace(/[’']s$/, '');
    if (w.length < 3 || STOP.has(w.toLowerCase())) return;
    let score = w.length;
    if (/^\d{2,}/.test(w)) score += 12;
    if (/^\p{Lu}/u.test(w) && i > 0) score += 8;
    if (/[ऀ-ॿ]/.test(w)) score += 2;
    if (score > bestScore) { bestScore = score; best = w; }
  });
  if (!best) return { front: clean, back: '' };
  const idx = clean.indexOf(best);
  const front = clean.slice(0, idx) + '_____' + clean.slice(idx + best.length);
  return { front, back: best };
}
