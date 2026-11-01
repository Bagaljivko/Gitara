// Google Gemini API — poziva se direktno iz pregledača sa korisnikovim ključem.
import { t } from './i18n.js';
// Ključ se nikad ne nalazi u kodu; čuva se samo u IndexedDB na uređaju.
import { settings } from './db.js';
import { normalizeSong } from './songformat.js';

// Podrazumevani model; korisnik ga može promeniti u „Podešavanjima“ bez izmene koda.
export const DEFAULT_MODEL = 'gemini-3.8-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

export class GeminiError extends Error {
  constructor(message, { code = '', suggestedModel = '' } = {}) {
    super(message);
    this.code = code;
    this.suggestedModel = suggestedModel;
  }
}

export const getApiKey = () => settings.get('geminiKey', '');

/** Čisti ime modela: dozvoljava i oblik „models/ime-modela“. Vraća '' ako ime nije ispravno. */
export function cleanModelName(name) {
  const m = String(name || '').trim().replace(/^models\//, '');
  return /^[a-z0-9][a-z0-9.\-]{1,80}$/i.test(m) ? m : '';
}

export async function getModel() {
  return cleanModelName(await settings.get('geminiModel', DEFAULT_MODEL)) || DEFAULT_MODEL;
}

const MODEL_GONE = /no longer available|not found for API version|is not found|not supported for generateContent|is not available|does not exist|unknown model|deprecated|retired|has been shut ?down/i;

function modelError(model, msg) {
  const sug = (String(msg).match(/use\s+(?:models\/)?([a-z0-9][a-z0-9.\-]+[a-z0-9])/i) || [])[1] || '';
  const suggested = cleanModelName(sug);
  return new GeminiError(
    t('gem.modelGone', { model }) + (suggested ? t('gem.modelSuggest', { model: suggested }) : t('gem.modelNewer', { model: DEFAULT_MODEL })),
    { code: 'MODEL_UNAVAILABLE', suggestedModel: suggested },
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
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** Poziv sa automatskim ponavljanjem kada je Gemini preopterećen (503 / 429 / „overloaded“). */
async function call(apiKey, body, signal, model, onRetry) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(apiKey, body, signal, model);
    } catch (e) {
      if (!(e instanceof GeminiError) || e.code !== 'BUSY') throw e;
      if (attempt >= RETRY_DELAYS.length) {
        throw new GeminiError(t('gem.busyFinal'), { code: 'BUSY' });
      }
      if (onRetry) onRetry(attempt + 1);
      await sleep(RETRY_DELAYS[attempt], signal);
    }
  }
}

async function callOnce(apiKey, body, signal, model) {
  model = cleanModelName(model) || DEFAULT_MODEL;
  if (!apiKey) throw new GeminiError(t('gem.noKey'));
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
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error.status)) || '';
    const reason = JSON.stringify(data && data.error && data.error.details || '');
    if (res.status === 404 || MODEL_GONE.test(msg)) throw modelError(model, msg);
    if (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(msg + reason)) throw new GeminiError(t('gem.badKey'));
    if (res.status === 401 || res.status === 403) throw new GeminiError(t('gem.forbidden'));
    if (res.status === 503 || res.status === 429 || /overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|try again later/i.test(msg)) {
      throw new GeminiError(t('gem.busy'), { code: 'BUSY' });
    }
    if (res.status >= 500) throw new GeminiError(t('gem.unavailable'), { code: 'HTTP_' + res.status });
    if (res.status === 400 && /location|region|country/i.test(msg)) throw new GeminiError(t('gem.region'));
    throw new GeminiError(msg ? t('gem.errorMsg', { msg }) : t('gem.error'), { code: 'HTTP_' + res.status });
  }
  return data;
}

function textOf(data) {
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) throw new GeminiError(t('gem.blocked'));
    throw new GeminiError(t('gem.noAnswer'));
  }
  return (cand.content && cand.content.parts || []).map((p) => p.text || '').join('');
}

/** Mali test poziv za proveru ključa i modela. */
export async function testKey(apiKey, model, onRetry) {
  const data = await call(apiKey, {
    contents: [{ parts: [{ text: 'Odgovori samo rečju: OK' }] }],
    generationConfig: { maxOutputTokens: 64, temperature: 0 },
  }, undefined, model || await getModel(), onRetry);
  if (!data || !data.candidates) throw new GeminiError(t('gem.unexpected'));
  return true;
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
export async function scanSong(images, signal, onRetry) {
  const list = Array.isArray(images) ? images : [images];
  const apiKey = await getApiKey();
  const model = await getModel();
  const prompt = SCAN_PROMPT + (list.length > 1 ? MULTI_PROMPT(list.length) : '');
  const parts = [{ text: prompt }];
  list.forEach((img, i) => {
    if (list.length > 1) parts.push({ text: `Slika ${i + 1} od ${list.length}:` });
    parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
  });
  const contents = [{ parts }];
  let data;
  try {
    data = await call(apiKey, {
      contents,
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    }, signal, model, onRetry);
  } catch (e) {
    // Ako neki model ne prihvata šemu odgovora, pokušaj samo sa JSON izlazom (prompt već opisuje oblik).
    if (!(e instanceof GeminiError) || e.code !== 'HTTP_400' || !/schema|response_?schema|responseMimeType|field/i.test(e.message)) throw e;
    data = await call(apiKey, { contents, generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }, signal, model, onRetry);
  }
  let text = textOf(data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let json;
  try { json = JSON.parse(text); } catch { throw new GeminiError(t('gem.badJson')); }
  try {
    return normalizeSong(json);
  } catch {
    throw new GeminiError(t('gem.noSong'));
  }
}
