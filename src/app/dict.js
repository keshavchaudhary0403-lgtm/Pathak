// Word lookup. Several free sources are queried together and merged, so one slow or
// missing source never leaves the card empty:
//   - Google Translate (public web endpoint): Hindi ⇄ English words grouped by part of speech
//   - dictionaryapi.dev: English definitions, examples, phonetics
//   - Wiktionary REST API: definitions for English and Hindi words (fallback)
//   - MyMemory: plain translation (last fallback)
const cache = new Map();
const isHindi = (w) => /[ऀ-ॿ]/.test(w);

async function getJSON(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const stripHTML = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h || '';
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
};

// Google: [[["अनुवाद","word",...]], null, "en", ..., ] with dt=bd at index 1: [[pos, [words...], ...], ...]
async function google(word, sl, tl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&hl=en&dt=t&dt=bd&dt=rm&q=${encodeURIComponent(word)}`;
  const j = await getJSON(url, 6000);
  if (!Array.isArray(j)) return null;
  const main = (j[0] || []).map((x) => x?.[0]).filter(Boolean).join('').trim();
  const translit = (j[0] || []).map((x) => x?.[2] || x?.[3]).filter(Boolean).join(' ').trim();
  const groups = (j[1] || []).map((g) => ({ pos: g[0], words: (g[1] || []).slice(0, 5) })).filter((g) => g.words.length);
  return { main, translit, groups };
}

async function myMemory(word, pair) {
  const j = await getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${pair}`, 6000);
  const out = j?.responseData?.translatedText;
  if (!out || out.toLowerCase() === word.toLowerCase() || /MYMEMORY|INVALID|QUERY LENGTH/i.test(out)) return null;
  return out;
}

async function dictApi(word) {
  const d = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!Array.isArray(d)) return null;
  const senses = [];
  let phonetic = '';
  let audio = '';
  for (const entry of d) {
    phonetic ||= entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '';
    audio ||= entry.phonetics?.find((p) => p.audio)?.audio || '';
    for (const m of entry.meanings || []) {
      const defs = (m.definitions || []).slice(0, 2).map((x) => ({ def: x.definition, example: x.example || '' }));
      if (defs.length) senses.push({ pos: m.partOfSpeech, defs });
    }
  }
  return { senses, phonetic, audio };
}

async function wiktionary(word, lang) {
  const d = await getJSON(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
  const list = d?.[lang];
  if (!Array.isArray(list)) return null;
  const senses = list.slice(0, 4).map((e) => ({
    pos: (e.partOfSpeech || '').toLowerCase(),
    defs: (e.definitions || [])
      .map((x) => ({ def: stripHTML(x.definition), example: stripHTML(x.parsedExamples?.[0]?.example || x.examples?.[0] || '') }))
      .filter((x) => x.def)
      .slice(0, 2),
  })).filter((s) => s.defs.length);
  return { senses };
}

// Merge senses of the same part of speech and keep the most useful ones first.
function tidySenses(senses) {
  const by = new Map();
  for (const s of senses) {
    const k = s.pos || 'other';
    if (!by.has(k)) by.set(k, []);
    const arr = by.get(k);
    for (const d of s.defs) if (arr.length < 2 && !arr.some((x) => x.def === d.def)) arr.push(d);
  }
  return [...by.entries()]
    .slice(0, 3)
    .map(([pos, defs]) => ({ pos, defs }));
}

export async function lookup(raw) {
  let word = (raw || '').trim().replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
  if (!word) return null;
  // Headings and small caps come through as "BEFORE"; look them up as normal words.
  if (word.length > 1 && word === word.toUpperCase() && !isHindi(word)) word = word.toLowerCase();
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  if (!navigator.onLine) return { word, offline: true };

  let result;
  if (isHindi(word)) {
    const [g, wk] = await Promise.all([google(word, 'hi', 'en'), wiktionary(word, 'hi')]);
    let english = [g?.main, ...(g?.groups?.flatMap((x) => x.words) || [])].filter(Boolean);
    if (!english.length) { const m = await myMemory(word, 'hi|en'); if (m) english = [m]; }
    result = {
      word, lang: 'hi', translit: g?.translit || '',
      translations: [...new Set(english)].slice(0, 6),
      groups: g?.groups || [],
      senses: tidySenses(wk?.senses || []),
    };
  } else {
    const [g, da, wk] = await Promise.all([google(key, 'en', 'hi'), dictApi(key), wiktionary(key, 'en')]);
    let hindi = [g?.main, ...(g?.groups?.flatMap((x) => x.words) || [])].filter(Boolean);
    if (!hindi.length) { const m = await myMemory(key, 'en|hi'); if (m) hindi = [m]; }
    result = {
      word, lang: 'en',
      phonetic: da?.phonetic || '',
      audio: da?.audio || '',
      translations: [...new Set(hindi)].slice(0, 6),
      groups: g?.groups || [],
      senses: tidySenses([...(da?.senses || []), ...(da?.senses?.length ? [] : wk?.senses || [])]),
    };
  }
  result.empty = !result.translations.length && !result.senses.length;
  if (!result.empty) cache.set(key, result);
  return result;
}
