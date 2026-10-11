// Word lookup: English definitions (dictionaryapi.dev) + Hindi/English translation (MyMemory).
const cache = new Map();
const isHindi = (w) => /[ऀ-ॿ]/.test(w);

async function getJSON(url, ms = 7000) {
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

async function translate(word, pair) {
  const j = await getJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${pair}`);
  const out = j?.responseData?.translatedText;
  if (!out || out.toLowerCase() === word.toLowerCase() || /MYMEMORY|INVALID/i.test(out)) return null;
  return out;
}

export async function lookup(raw) {
  const word = raw.trim().replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '');
  if (!word) return null;
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  if (!navigator.onLine) return { word, offline: true };

  let result;
  if (isHindi(word)) {
    const en = await translate(word, 'hi|en');
    result = { word, lang: 'hi', translation: en, senses: [] };
    if (en && /^[a-z]+$/i.test(en)) {
      const d = await getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(en.toLowerCase())}`);
      result.senses = parseSenses(d).slice(0, 2);
    }
  } else {
    const [d, hi] = await Promise.all([
      getJSON(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`),
      translate(key, 'en|hi'),
    ]);
    result = {
      word,
      lang: 'en',
      phonetic: Array.isArray(d) ? d[0]?.phonetic || d[0]?.phonetics?.find((p) => p.text)?.text : '',
      senses: parseSenses(d).slice(0, 3),
      translation: hi,
    };
  }
  result.empty = !result.translation && !result.senses.length;
  cache.set(key, result);
  return result;
}

function parseSenses(d) {
  if (!Array.isArray(d)) return [];
  const out = [];
  for (const entry of d) {
    for (const m of entry.meanings || []) {
      const def = m.definitions?.[0];
      if (def) out.push({ pos: m.partOfSpeech, def: def.definition, example: def.example });
    }
  }
  return out;
}
