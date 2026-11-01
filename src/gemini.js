// Google Gemini API — poziva se direktno iz pregledača sa korisnikovim ključem.
import { t } from './i18n.js';
// Ključ se nikad ne nalazi u kodu; čuva se samo u IndexedDB na uređaju.
import { settings } from './db.js';
import { normalizeSong } from './songformat.js';

// Podrazumevani model; korisnik ga može promeniti u „Podešavanjima“ bez izmene koda.
export const DEFAULT_MODEL = 'gemini-3.8-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const AUTO = 'auto';
const LEGACY_DEFAULT = 'gemini-3.8-flash'; // ranije podrazumevani model — tretira se kao „Automatski“
// Rezervni spisak kada spisak modela ne može da se učita
const FALLBACK_MODELS = [DEFAULT_MODEL, 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

export class GeminiError extends Error {
  constructor(message, { code = '', suggestedModel = '', model = '' } = {}) {
    super(message);
    this.code = code;
    this.suggestedModel = suggestedModel;
    this.model = model;
  }
}

export const getApiKey = () => settings.get('geminiKey', '');

/** Čisti ime modela: dozvoljava i oblik „models/ime-modela“. Vraća '' ako ime nije ispravno. */
export function cleanModelName(name) {
  const m = String(name || '').trim().replace(/^models\//, '');
  return /^[a-z0-9][a-z0-9.\-]{1,80}$/i.test(m) ? m : '';
}

/** Izbor u Podešavanjima: 'auto' (podrazumevano) ili tačno ime modela. */
export async function getModelSetting() {
  const sel = await settings.get('geminiModelSel');
  if (sel === AUTO) return AUTO;
  const c = cleanModelName(sel);
  if (c) return c;
  const old = cleanModelName(await settings.get('geminiModel'));
  return old && old !== LEGACY_DEFAULT ? old : AUTO;
}

export async function getModel() {
  const s = await getModelSetting();
  return s === AUTO ? cleanModelName(await settings.get('geminiLastModel', '')) || DEFAULT_MODEL : s;
}

const MODEL_GONE = /no longer available|not found for API version|is not found|not supported for generateContent|is not available|does not exist|unknown model|deprecated|retired|has been shut ?down/i;

function modelError(model, msg) {
  const sug = (String(msg).match(/use\s+(?:models\/)?([a-z0-9][a-z0-9.\-]+[a-z0-9])/i) || [])[1] || '';
  const suggested = cleanModelName(sug);
  return new GeminiError(
    t('gem.modelGone', { model }) + (suggested ? t('gem.modelSuggest', { model: suggested }) : t('gem.modelNewer', { model: DEFAULT_MODEL })),
    { code: 'MODEL_UNAVAILABLE', suggestedModel: suggested, model },
  );
}

const SCAN_PROMPT = `Ti si precizan prepisivač rukom pisanih pesama sa akordima za gitaru.
Na slici je pesma (tekst + akordi). Rukopis može biti neuredan, a tekst na srpskom (latinica ili ćirilica) ili engleskom.

PRAVILA:
1. Prepiši tekst TAČNO kako je napisan — ne prevodi, ne ispravljaj, ne dodaj stihove. Zadrži dijakritike (č, ć, š, ž, đ). Ako je tekst na ćirilici, prepiši ga na latinicu.
2. Akordi su obično napisani iznad reči. Za svaki akord odredi "position": indeks znaka (od 0) u polju "text" iste linije iznad kog akord stoji (početak sloga/reči ispod akorda). Ako akord stoji posle kraja teksta, position može biti veći od dužine teksta.
3. Ime akorda prepiši kako je napisano (npr. "Hm" ostaje "Hm", "a" ili "am" za a-mol piši "Am", "E-" piši "Em"). Koristi standardne oznake: C, Cm, C7, Cmaj7, Cm7, Csus2, Csus4, Cdim, Caug, C6, Cadd9, C/G, sa # ili b. H je isto što i B.
4. Linije koje imaju samo akorde (uvod, prelaz) imaju "text": "".
5. Podeli pesmu na delove ("sections") po strukturi: npr. "Uvod", "Strofa 1", "Refren", "Most", "Kraj". Ako je deo označen na slici (npr. "Ref.", "R:", "1."), koristi tu oznaku. Ako nema oznaka, koristi "Strofa 1", "Strofa 2"... i "Refren" za ponovljeni deo.
6. "title" i "artist" uzmi sa slike; ako ih nema, ostavi prazan string. "key" je tonalitet ako je naznačen, inače ga proceni iz akorda (npr. "Am", "G").
7. Ako neki deo ne može da se pročita, napiši najverovatniju reč; ne izostavljaj linije.
8. Ako na papiru postoji ritam udaranja (strelice ↓ ↑, ili zapis poput „D DU UDU“ / „dole gore“), vrati ga kao "strum": { "steps": "...", "sig": "4/4" }. "steps" ima jedan znak po osmini: D = udarac na dole, U = na gore, x = prigušen udarac, - = pauza (npr. „↓ ↓↑ ↑↓↑“ u 4/4 je "D-DU-UDU"). "sig" je "2/4", "3/4", "4/4" ili "6/8". Ako ritam važi samo za jedan deo pesme, stavi "strum" u taj deo (sekciju). Ako ritma nema, izostavi polje "strum".

Vrati ISKLJUČIVO JSON ovog oblika (polja "strum" su opciona):
{ "title": "", "artist": "", "key": "", "strum": { "steps": "D-DU-UDU", "sig": "4/4" }, "sections": [ { "name": "", "strum": { "steps": "", "sig": "" }, "lines": [ { "chords": [ { "chord": "Am", "position": 0 } ], "text": "" } ] } ] }`;

const STRUM_SCHEMA = { type: 'OBJECT', properties: { steps: { type: 'STRING' }, sig: { type: 'STRING' } } };
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    strum: STRUM_SCHEMA,
    title: { type: 'STRING' },
    artist: { type: 'STRING' },
    key: { type: 'STRING' },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          strum: STRUM_SCHEMA,
          lines: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                chords: {
                  type: 'ARRAY',
                  items: { type: 'OBJECT', properties: { chord: { type: 'STRING' }, position: { type: 'INTEGER' } }, required: ['chord', 'position'] },
                },
                text: { type: 'STRING' },
              },
              required: ['chords', 'text'],
            },
          },
        },
        required: ['name', 'lines'],
      },
    },
  },
  required: ['title', 'artist', 'key', 'sections'],
};

const RETRY_DELAYS = [1500, 3000, 5000]; // do 3 ponovna pokušaja kada je Gemini zauzet
const FALLBACK_RETRY = [1500, 3000];      // u automatskom režimu kraće — pa sledeći model
const DEADLINE_MS = () => globalThis.__gitaraDeadline || 60000; // najduže trajanje jednog skeniranja (~60 s)
const MODELS_TTL = 12 * 3600 * 1000;      // spisak modela se osvežava dva puta dnevno
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

// ---------------- Spisak modela ----------------
// Gemini modeli koji primaju sliku i vraćaju tekst; isključujemo embedding, govor, generisanje slika/videa itd.
const EXCLUDE = /embedding|aqa|tts|imagen|veo|image-generation|-image\b|-image-|native-audio|\blive\b|-live|computer-use|robotics|learnlm|gemma|nano/i;

function modelInfo(name) {
  const lite = /flash-lite/i.test(name);
  const flash = !lite && /flash/i.test(name);
  const v = (name.match(/gemini-(\d+(?:\.\d+)?)/i) || [])[1];
  return {
    group: flash ? 0 : lite ? 1 : 2,
    version: v ? parseFloat(v) : 0,
    unstable: /preview|exp|experimental/i.test(name) ? 1 : 0,
    alias: /latest/i.test(name) ? 1 : 0,
  };
}

/** Rangira modele: najnoviji Flash, pa Flash-Lite, pa ostali; stabilne verzije pre „preview“. */
export function rankModels(names) {
  return [...new Set(names)].sort((a, b) => {
    const x = modelInfo(a), y = modelInfo(b);
    return x.group - y.group || x.alias - y.alias || y.version - x.version || x.unstable - y.unstable || a.localeCompare(b);
  });
}

/** Filtrira odgovor /models: samo Gemini modeli sa generateContent koji primaju sliku. */
export function usableModels(apiModels) {
  return rankModels((apiModels || [])
    .filter((m) => m && typeof m.name === 'string' && (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini/i.test(n) && !EXCLUDE.test(n) && cleanModelName(n)));
}

/** Spisak modela dostupnih za ovaj ključ (keširan na uređaju). */
export async function listModels(apiKey, { force = false } = {}) {
  if (!apiKey) throw new GeminiError(t('gem.noKey'));
  const tag = apiKey.slice(-6);
  const cached = await settings.get('geminiModels', null);
  if (!force && cached && cached.tag === tag && Date.now() - cached.at < MODELS_TTL && cached.list.length) return cached.list;
  if (navigator.onLine === false) {
    if (cached && cached.tag === tag && cached.list.length) return cached.list;
    throw new GeminiError(t('gem.offline'));
  }
  const all = [];
  let page = '';
  for (let i = 0; i < 5; i++) {
    let res;
    try {
      res = await fetch(`${MODELS_URL}?pageSize=1000${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: { 'x-goog-api-key': apiKey } });
    } catch {
      throw new GeminiError(t('gem.network'));
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw httpError(res, data, '');
    all.push(...(data.models || []));
    page = data.nextPageToken;
    if (!page) break;
  }
  const list = usableModels(all);
  await settings.set('geminiModels', { tag, at: Date.now(), list });
  return list;
}

/** Redosled modela za pokušaje. selection: 'auto' ili ime modela. */
async function candidates(apiKey, selection) {
  if (selection !== AUTO) return [selection];
  const last = cleanModelName(await settings.get('geminiLastModel', ''));
  let list = null;
  try { list = await listModels(apiKey); } catch (e) { if (e instanceof GeminiError && e.code === 'BAD_KEY') throw e; } // bez spiska → rezervni spisak
  const names = list && list.length ? list : rankModels(FALLBACK_MODELS);
  const order = [];
  if (last && (!list || list.includes(last))) order.push(last); // model koji je poslednji radio — prvi
  for (const n of names) if (!order.includes(n)) order.push(n);
  return order.slice(0, 8);
}

// ---------------- Pozivi ----------------
function httpError(res, data, model) {
  const msg = (data && data.error && (data.error.message || data.error.status)) || '';
  const reason = JSON.stringify((data && data.error && data.error.details) || '');
  if (model && (res.status === 404 || MODEL_GONE.test(msg))) return modelError(model, msg);
  if (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(msg + reason)) return new GeminiError(t('gem.badKey'), { code: 'BAD_KEY' });
  if (res.status === 401 || res.status === 403) return new GeminiError(t('gem.forbidden'), { code: 'BAD_KEY' });
  if (res.status === 503 || res.status === 429 || /overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|try again later/i.test(msg)) {
    return new GeminiError(t('gem.busy'), { code: 'BUSY', model });
  }
  if (res.status >= 500) return new GeminiError(t('gem.unavailable'), { code: 'HTTP_' + res.status, model });
  if (res.status === 400 && /location|region|country/i.test(msg)) return new GeminiError(t('gem.region'));
  return new GeminiError(msg ? t('gem.errorMsg', { msg }) : t('gem.error'), { code: 'HTTP_' + res.status, model });
}

async function callOnce(apiKey, body, signal, model) {
  if (navigator.onLine === false) throw new GeminiError(t('gem.offline'));
  let res;
  try {
    res = await fetch(`${API_BASE}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new GeminiError(t('gem.network'));
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw httpError(res, data, model);
  return data;
}

/** Jedan model sa ponavljanjem kada je zauzet (503 / 429 / „overloaded“). */
async function callWithRetry(apiKey, body, signal, model, onStatus, delays) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(apiKey, body, signal, model);
    } catch (e) {
      if (!(e instanceof GeminiError) || e.code !== 'BUSY' || attempt >= delays.length) throw e;
      if (onStatus) onStatus('retry', model);
      await sleep(delays[attempt], signal);
    }
  }
}

/**
 * Šalje zahtev: u automatskom režimu probava modele redom (poslednji koji je radio, najnoviji Flash,
 * Flash-Lite, ostali) dok jedan ne uspe. Ukupno najviše ~60 s; „Otkaži“ (signal) prekida odmah.
 * Vraća { data, model }.
 */
async function generate(apiKey, body, { signal, onStatus, selection, models } = {}) {
  if (!apiKey) throw new GeminiError(t('gem.noKey'));
  if (navigator.onLine === false) throw new GeminiError(t('gem.offline'));
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, DEADLINE_MS());
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); signal.addEventListener('abort', onAbort); }
  const sel = selection || (await getModelSetting());
  try {
    const list = models || (await candidates(apiKey, sel));
    const auto = sel === AUTO && !models;
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      const model = list[i];
      if (i > 0 && onStatus) onStatus('switch', model);
      try {
        const data = await callWithRetry(apiKey, body, ctrl.signal, model, onStatus, auto && list.length > 1 ? FALLBACK_RETRY : RETRY_DELAYS);
        if (auto) await settings.set('geminiLastModel', model);
        return { data, model };
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        const tryNext = e instanceof GeminiError && ['BUSY', 'MODEL_UNAVAILABLE', 'HTTP_500', 'HTTP_502', 'HTTP_504'].includes(e.code);
        if (!auto || !tryNext) throw e;
        lastErr = e;
      }
    }
    if (lastErr && lastErr.code === 'BUSY') throw new GeminiError(t('gem.busyAll'), { code: 'BUSY' });
    throw lastErr || new GeminiError(t('gem.noAnswer'));
  } catch (e) {
    if (timedOut) throw new GeminiError(t('gem.timeout'), { code: 'TIMEOUT' });
    if (e && e.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
    if (e instanceof GeminiError && e.code === 'BUSY' && sel !== AUTO) throw new GeminiError(t('gem.busyFinal'), { code: 'BUSY' });
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function textOf(data) {
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) throw new GeminiError(t('gem.blocked'));
    throw new GeminiError(t('gem.noAnswer'));
  }
  return (cand.content && cand.content.parts || []).map((p) => p.text || '').join('');
}

/** Mali test poziv za proveru ključa i modela. Vraća ime modela koji je odgovorio. */
export async function testKey(apiKey, selection, onStatus) {
  const { data, model } = await generate(apiKey, {
    contents: [{ parts: [{ text: 'Odgovori samo rečju: OK' }] }],
    generationConfig: { maxOutputTokens: 64, temperature: 0 },
  }, { selection: selection || AUTO, onStatus });
  if (!data || !data.candidates) throw new GeminiError(t('gem.unexpected'));
  return model;
}

/** Smanjuje sliku (max 2000px) i vraća { mime, base64 }. */
export async function prepareImage(file, max = 2000) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new GeminiError(t('gem.badImage')));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { mime: 'image/jpeg', base64: dataUrl.split(',')[1], preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Šalje sliku Geminiju i vraća normalizovanu pesmu. */
const MULTI_PROMPT = (n) => `

VIŠE SLIKA: dobijaš ${n} slika, ovim redom. To su uzastopne strane ili snimci ekrana ISTE pesme.
- Spoji ih u JEDNU pesmu, redom kojim su slike poslate.
- Snimci ekrana se često preklapaju: ako se isti stihovi (sa istim akordima) vide na kraju jedne i na početku sledeće slike, prepiši ih SAMO JEDNOM.
- Ne briši ponavljanja koja zaista postoje u pesmi (npr. refren napisan dva puta na različitim mestima).
- Slike mogu biti rukom pisane strane ili snimci ekrana sa sajta; kod sajta prepiši samo pesmu (naslov, izvođač, akordi, tekst) i ignoriši meni, reklame, komentare i dugmad.`;

/** Šalje jednu ili više slika (istim redom) i vraća jednu spojenu pesmu. */
export async function scanSong(images, signal, onStatus) {
  const list = Array.isArray(images) ? images : [images];
  const apiKey = await getApiKey();
  const prompt = SCAN_PROMPT + (list.length > 1 ? MULTI_PROMPT(list.length) : '');
  const parts = [{ text: prompt }];
  list.forEach((img, i) => {
    if (list.length > 1) parts.push({ text: `Slika ${i + 1} od ${list.length}:` });
    parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
  });
  const contents = [{ parts }];
  let res;
  try {
    res = await generate(apiKey, {
      contents,
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    }, { signal, onStatus });
  } catch (e) {
    // Ako neki model ne prihvata šemu odgovora, pokušaj isti model samo sa JSON izlazom (prompt opisuje oblik).
    if (!(e instanceof GeminiError) || e.code !== 'HTTP_400' || !e.model || !/schema|response_?schema|responseMimeType|field/i.test(e.message)) throw e;
    res = await generate(apiKey, { contents, generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }, { signal, onStatus, models: [e.model] });
  }
  const text = textOf(res.data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let json;
  try { json = JSON.parse(text); } catch { throw new GeminiError(t('gem.badJson')); }
  let song;
  try { song = normalizeSong(json); } catch { throw new GeminiError(t('gem.noSong')); }
  song.scanModel = res.model; // prikazuje se na „Proveri i ispravi“, ne čuva se u pesmi
  return song;
}
