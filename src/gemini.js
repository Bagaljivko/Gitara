// Google Gemini API — poziva se direktno iz pregledača sa korisnikovim ključem.
import { t } from './i18n.js';
// Ključ se nikad ne nalazi u kodu; čuva se samo u IndexedDB na uređaju.
import { settings } from './db.js';
import { normalizeSong } from './songformat.js';
import { parseAsciiTab } from './tabs.js';

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
3. Ime akorda prepiši TAČNO kako je napisano na papiru — NE pretvaraj u drugu notaciju: "H" i "H7" ostaju H (ne piši ih kao B), "B" ostaje "B", "Fis", "Cis", "Gis", "Es", "As", "Des" ostaju tako napisani, kao i "F#", "C#", "Bb", "Eb". Samo zapis mola ujednači: "a" ili "am" za a-mol piši "Am", "E-" piši "Em", "fis" piši "Fism". Nastavke piši standardno: m, 7, maj7, m7, sus2, sus4, dim, aug, 6, add9, a bas posle kose crte (npr. "D/Fis" ili "D/F#", kako je napisano).
4. Linije koje imaju samo akorde (uvod, prelaz) imaju "text": "".
5. Podeli pesmu na delove ("sections") po strukturi: npr. "Uvod", "Strofa 1", "Refren", "Most", "Kraj". Ako je deo označen na slici (npr. "Ref.", "R:", "1."), koristi tu oznaku. Ako nema oznaka, koristi "Strofa 1", "Strofa 2"... i "Refren" za ponovljeni deo.
6. "title" i "artist" uzmi sa slike; ako ih nema, ostavi prazan string. "key" je tonalitet ako je naznačen, inače ga proceni iz akorda (npr. "Am", "G"); piši ga istim imenovanjem kao akorde na papiru (npr. "Hm" ako papir koristi H).
7. Ako neki deo ne može da se pročita, napiši najverovatniju reč; ne izostavljaj linije.
9. NESIGURNA MESTA: ako neki akord ili reč nisi mogao pouzdano da pročitaš, napiši u tekstu/akordima svoju najbolju procenu i dodaj stavku u "uncertain": { "section": indeks dela (od 0), "line": indeks linije u tom delu (od 0), "kind": "chord" ili "word", "text": tačno ono što si upisao, "position": pozicija akorda ili početak reči u liniji, "suggestion": drugo najverovatnije čitanje }. Navedi samo zaista nesigurna mesta (najviše 15); ako ih nema, "uncertain" je prazan niz.
10. TABLATURA: ako slika sadrži gitarsku tablaturu (šest linija sa brojevima pragova), prepiši je u polje "tab" tog dela kao ASCII tekst od TAČNO 6 redova razdvojenih sa \n, odozgo: e, B, G, D, A, E (visoka e gore). Svaki red počinje nazivom žice i znakom "|", taktovi se odvajaju sa "|", crtice "-" popunjavaju prazna mesta, a kolone moraju biti poravnate (ista nota u svim redovima je u istoj koloni). Primer jednog reda: "e|-----0-----|---------3-|". Tehnike piši posle broja: h, p, /, \\, b, ~. "tabSig" je takt ako je naznačen (npr. "3/4"), inače "4/4". Prag koji nisi pouzdano pročitao dodaj u "tabUnsure": { "string": 1–6 (1 = e gore), "column": indeks prvog znaka tog broja u redu, računajući od 0 od prvog znaka POSLE prve "|", "fret": upisan broj, "suggestion": drugi najverovatniji broj }.
11. Ako je više slika i jedna sadrži samo tablaturu, stavi je u odgovarajući deo pesme koji nema tekst (npr. "Uvod"/"Intro", "Rif"/"Riff", deo sa prebiranjem). Ako nisi siguran gde pripada, napravi zaseban deo sa tom tablaturom i postavi "tabPlacementUnclear": true.
12. VRSTA LISTA: "sheetKind" je "akordi" za pesmu sa tekstom i akordima (i kad ima malo tablature), a "tab" ako je list notni zapis / tablatura cele kompozicije za gitaru (prebiranje, klasična gitara: šest linija sa brojevima pragova kroz ceo list, taktovi, obično bez teksta pesme). Ako nisi siguran, "akordi".
8. Ako na papiru postoji ritam udaranja (strelice ↓ ↑, ili zapis poput „D DU UDU“ / „dole gore“), vrati ga kao "strum": { "steps": "...", "sig": "4/4" }. "steps" ima jedan znak po osmini: D = udarac na dole, U = na gore, x = prigušen udarac, - = pauza (npr. „↓ ↓↑ ↑↓↑“ u 4/4 je "D-DU-UDU"). "sig" je "2/4", "3/4", "4/4" ili "6/8". Ako ritam važi samo za jedan deo pesme, stavi "strum" u taj deo (sekciju). Ako ritma nema, izostavi polje "strum".

Vrati ISKLJUČIVO JSON ovog oblika (polja "strum" su opciona):
{ "title": "", "artist": "", "key": "", "strum": { "steps": "D-DU-UDU", "sig": "4/4" }, "uncertain": [ { "section": 0, "line": 0, "kind": "chord", "text": "Hm", "position": 4, "suggestion": "Em" } ], "sections": [ { "name": "", "strum": { "steps": "", "sig": "" }, "lines": [ { "chords": [ { "chord": "Am", "position": 0 } ], "text": "" } ] } ] }`;

const STRUM_SCHEMA = { type: 'OBJECT', properties: { steps: { type: 'STRING' }, sig: { type: 'STRING' } } };
const UNCERTAIN_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { section: { type: 'INTEGER' }, line: { type: 'INTEGER' }, kind: { type: 'STRING' }, text: { type: 'STRING' }, position: { type: 'INTEGER' }, suggestion: { type: 'STRING' } },
    required: ['section', 'line', 'kind', 'text', 'suggestion'],
  },
};
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sheetKind: { type: 'STRING' },
    strum: STRUM_SCHEMA,
    uncertain: UNCERTAIN_SCHEMA,
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
          tab: { type: 'STRING' },
          tabSig: { type: 'STRING' },
          tabPlacementUnclear: { type: 'BOOLEAN' },
          tabUnsure: { type: 'ARRAY', items: { type: 'OBJECT', properties: { string: { type: 'INTEGER' }, column: { type: 'INTEGER' }, fret: { type: 'STRING' }, suggestion: { type: 'STRING' } } } },
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

// ---- TAB list (prebiranje, klasična gitara): taktovi i note sa ritmom ----
const TAB_PROMPT = `Ti si precizan prepisivač notnih zapisa za gitaru (TAB). Na slici je kompozicija za gitaru: notni sistem i ispod njega tablatura (šest linija sa brojevima pragova).

PRAVILA:
1. Brojevi u TABLATURI su izvor istine: za svaku notu prepiši žicu i prag tačno kako su odštampani. Note iz notnog sistema koristi SAMO za ritam (gde nota počinje i koliko traje) — ne menjaj prag prema notama.
2. Žice: 1 = najviša (tanka e, gornja linija tablature), 6 = najniža (debela E, donja linija). Prag 0–24.
3. Za svaki takt redom (brojevi taktova od 1) navedi sve note: "s" žica, "f" prag, "start" = početak u četvrtinama od početka takta (prva doba = 0; u 3/4 su dobe 0, 1, 2), "len" = trajanje u četvrtinama (četvrtina = 1, osmina = 0.5, triola osmina = 0.333, polovina = 2, polovina sa tačkom = 3). Triole: tri note u jednoj dobi počinju na 0, 0.333, 0.667 te dobe. Bas koji traje ceo takt ima len celog takta. Note koje se sviraju zajedno imaju isti "start".
4. "finger" je odštampan broj prsta leve ruke (1–4) uz notu, ako postoji; inače 0. Slova p, i, m, a (desna ruka) ignoriši.
5. Barre: oznake kao "BV", "BVII", "CII", "1/2 BV", "½ CV" prepiši u "barre": [{ "label": tačno kako piše, "fret": broj praga (rimski broj pretvori u broj), "half": true za 1/2 ili ½ }] tog takta (i svakog takta dokle se proteže crta posle oznake).
6. Ponavljanja: "repeatStart": true na taktu koji počinje znakom „|:“, "repeatEnd": true na taktu koji se završava znakom „:|“ ("times": broj prolaza, obično 2). Volte (1. i 2. završetak): "ending": 1 ili 2.
7. "sig" je takt kompozicije (npr. "3/4"); ako se takt menja, stavi "sig" u takt gde počinje promena. "key" je tonalitet na početku (po predznacima i kraju: npr. "Em", "E", "Am"); ako se predznaci promene, stavi "key" u prvi takt novog tonaliteta (npr. "E"). "bpm" je tempo ako je odštampan (broj uz četvrtinu), inače 0.
8. "title" i "composer" sa lista (npr. "Anonymous").
9. NESIGURNO: ako neki takt ne možeš pouzdano da pročitaš (mutan broj, nejasan ritam), prepiši najbolju procenu i dodaj { "bar": broj takta, "why": kratko objašnjenje na srpskom } u "unsure". Ne izmišljaj note koje ne vidiš.
10. Ne prepisuj ništa osim kompozicije (bez imena izdavača, brojeva strana, reklama).

Vrati ISKLJUČIVO JSON ovog oblika:
{ "title": "", "composer": "", "key": "Em", "sig": "3/4", "bpm": 0, "unsure": [ { "bar": 12, "why": "" } ], "bars": [ { "n": 1, "sig": "", "key": "", "repeatStart": false, "repeatEnd": false, "times": 2, "ending": 0, "barre": [ { "label": "1/2 BV", "fret": 5, "half": true } ], "notes": [ { "s": 6, "f": 0, "start": 0, "len": 3, "finger": 0 } ] } ] }`;

const TAB_MULTI = (n) => `

VIŠE SLIKA: dobijaš ${n} slika, ovim redom — uzastopne strane ISTE kompozicije. Spoji ih u jedan niz taktova, redom; brojevi taktova se nastavljaju preko strana (druga strana obično počinje brojem takta odštampanim na početku reda). Ako se isti takt vidi na kraju jedne i početku sledeće slike, prepiši ga JEDNOM.`;

const TAB_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' }, composer: { type: 'STRING' }, key: { type: 'STRING' }, sig: { type: 'STRING' }, bpm: { type: 'NUMBER' },
    unsure: { type: 'ARRAY', items: { type: 'OBJECT', properties: { bar: { type: 'INTEGER' }, why: { type: 'STRING' } } } },
    bars: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'INTEGER' }, sig: { type: 'STRING' }, key: { type: 'STRING' },
          repeatStart: { type: 'BOOLEAN' }, repeatEnd: { type: 'BOOLEAN' }, times: { type: 'INTEGER' }, ending: { type: 'INTEGER' },
          barre: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, fret: { type: 'INTEGER' }, half: { type: 'BOOLEAN' } } } },
          notes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { s: { type: 'INTEGER' }, f: { type: 'INTEGER' }, start: { type: 'NUMBER' }, len: { type: 'NUMBER' }, finger: { type: 'INTEGER' } }, required: ['s', 'f', 'start', 'len'] } },
        },
        required: ['n', 'notes'],
      },
    },
  },
  required: ['title', 'sig', 'bars'],
};

const RETRY_DELAYS = [1500, 3000, 5000]; // do 3 ponovna pokušaja kada je Gemini zauzet
const FALLBACK_RETRY = [1500, 3000];      // u automatskom režimu kraće — pa sledeći model
const DEADLINE_MS = () => globalThis.__gitaraDeadline || 120000; // najduže trajanje jednog skeniranja (120 s)
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

// ---------------- Razmišljanje (thinking) ----------------
// Prepisivanje ne zahteva dugo „razmišljanje“: tražimo najmanji nivo koji model dozvoljava.
// Ako model odbije podešavanje (HTTP 400), probamo sledeću varijantu, na kraju bez podešavanja.
export function thinkingVariants(model) {
  const m = String(model).toLowerCase();
  if (/gemini-(1\.|2\.0)/.test(m)) return [null];                       // stari modeli nemaju „thinking“
  if (/gemini-2\.5/.test(m)) return [{ thinkingBudget: /pro/.test(m) ? 128 : 0 }, null];
  return [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];
}
const describeThinking = (v) => (!v ? '—' : v.thinkingLevel ? `thinkingLevel=${v.thinkingLevel}` : `thinkingBudget=${v.thinkingBudget}`);
function withThinking(body, v) {
  const gc = { ...(body.generationConfig || {}) };
  if (v) gc.thinkingConfig = v; else delete gc.thinkingConfig;
  return { ...body, generationConfig: gc };
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
  if (res.status === 400 && /thinking/i.test(msg)) return new GeminiError(msg, { code: 'THINKING', model });
  if (res.status === 400 && /location|region|country/i.test(msg)) return new GeminiError(t('gem.region'));
  return new GeminiError(msg ? t('gem.errorMsg', { msg }) : t('gem.error'), { code: 'HTTP_' + res.status, model });
}

async function callOnce(apiKey, body, signal, model, { diag, onStatus, thinking } = {}) {
  if (navigator.onLine === false) throw new GeminiError(t('gem.offline'));
  const payload = JSON.stringify(body);
  const att = { model, thinking: describeThinking(thinking), sentBytes: payload.length, ms: 0, status: '…', message: '' };
  if (diag) diag.attempts.push(att);
  const t0 = performance.now();
  if (onStatus) onStatus('send', model);
  // „Šaljem…“ dok traje slanje (procena po veličini), zatim „Gemini čita…“
  const readTimer = onStatus ? setTimeout(() => onStatus('reading', model), Math.min(8000, Math.max(700, payload.length / 250))) : 0;
  let res;
  try {
    res = await fetch(`${API_BASE}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: payload,
      signal,
    });
  } catch (e) {
    clearTimeout(readTimer);
    att.ms = performance.now() - t0;
    if (e && e.name === 'AbortError') { att.status = 'prekinuto'; throw e; }
    att.status = 'mreža';
    att.message = String((e && e.message) || e);
    throw new GeminiError(t('gem.network'));
  }
  let data = null;
  try { data = await res.json(); } catch {}
  clearTimeout(readTimer);
  att.ms = performance.now() - t0;
  att.status = 'HTTP ' + res.status;
  if (!res.ok) {
    att.message = String((data && data.error && (data.error.message || data.error.status)) || res.statusText || '').slice(0, 400);
    throw httpError(res, data, model);
  }
  const cand = data && data.candidates && data.candidates[0];
  att.message = cand ? `OK (finishReason ${cand.finishReason || '?'})` : 'OK (bez kandidata)';
  return data;
}
/** Jedan model sa ponavljanjem kada je zauzet (503 / 429 / „overloaded“). */
async function callWithRetry(apiKey, body, signal, model, onStatus, delays, diag) {
  const variants = thinkingVariants(model);
  for (let v = 0; v < variants.length; v++) {
    const b = withThinking(body, variants[v]);
    for (let attempt = 0; ; attempt++) {
      try {
        return await callOnce(apiKey, b, signal, model, { diag, onStatus, thinking: variants[v] });
      } catch (e) {
        if (e instanceof GeminiError && e.code === 'THINKING' && v < variants.length - 1) break; // sledeća varijanta
        if (e instanceof GeminiError && e.code === 'THINKING') throw new GeminiError(t('gem.errorMsg', { msg: e.message }), { code: 'HTTP_400', model });
        if (!(e instanceof GeminiError) || e.code !== 'BUSY' || attempt >= delays.length) throw e;
        if (onStatus) onStatus('retry', model);
        await sleep(delays[attempt], signal);
      }
    }
  }
  throw new GeminiError(t('gem.noAnswer'));
}
/**
 * Šalje zahtev: u automatskom režimu probava modele redom (poslednji koji je radio, najnoviji Flash,
 * Flash-Lite, ostali) dok jedan ne uspe. Ukupno najviše ~60 s; „Otkaži“ (signal) prekida odmah.
 * Vraća { data, model }.
 */
async function generate(apiKey, body, { signal, onStatus, selection, models, diag } = {}) {
  if (!apiKey) throw new GeminiError(t('gem.noKey'));
  if (navigator.onLine === false) throw new GeminiError(t('gem.offline'));
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, DEADLINE_MS());
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); signal.addEventListener('abort', onAbort); }
  const sel = selection || (await getModelSetting());
  if (diag) diag.selection = sel;
  try {
    const list = models || (await candidates(apiKey, sel));
    const auto = sel === AUTO && !models;
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      const model = list[i];
      if (i > 0 && onStatus) onStatus('switch', model);
      try {
        const data = await callWithRetry(apiKey, body, ctrl.signal, model, onStatus, auto && list.length > 1 ? FALLBACK_RETRY : RETRY_DELAYS, diag);
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
    if (timedOut) {
      const last = diag && diag.attempts[diag.attempts.length - 1];
      if (last && (last.status === 'prekinuto' || last.status === '…')) { last.status = 'isteklo vreme'; }
      throw new GeminiError(t('gem.timeout'), { code: 'TIMEOUT' });
    }
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
export async function prepareImage(file, { max = 1600, quality = 0.8, maxBytes = 500 * 1024 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new GeminiError(t('gem.badImage')));
      i.src = url;
    });
    const ow = img.naturalWidth, oh = img.naturalHeight;
    let side = max, q = quality, dataUrl = '', w = 0, h = 0;
    // Smanjuj dok slika ne bude ispod ~500 KB (prvo kvalitet, pa dimenzije).
    for (let step = 0; step < 6; step++) {
      const scale = Math.min(1, side / Math.max(ow, oh));
      w = Math.round(ow * scale); h = Math.round(oh * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      dataUrl = canvas.toDataURL('image/jpeg', q);
      canvas.width = canvas.height = 0; // oslobodi memoriju odmah (važno na telefonu)
      if (b64Bytes(dataUrl) <= maxBytes) break;
      if (q > 0.62) q -= 0.1; else side = Math.round(side * 0.85);
    }
    const base64 = dataUrl.split(',')[1];
    return { mime: 'image/jpeg', base64, preview: dataUrl, info: { ow, oh, origBytes: file.size, w, h, bytes: b64Bytes(dataUrl), quality: +q.toFixed(2) } };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const b64Bytes = (dataUrl) => Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/** Šalje sliku Geminiju i vraća normalizovanu pesmu. */
const MULTI_PROMPT = (n) => `

VIŠE SLIKA: dobijaš ${n} slika, ovim redom. To su uzastopne strane ili snimci ekrana ISTE pesme.
- Spoji ih u JEDNU pesmu, redom kojim su slike poslate.
- Snimci ekrana se često preklapaju: ako se isti stihovi (sa istim akordima) vide na kraju jedne i na početku sledeće slike, prepiši ih SAMO JEDNOM.
- Ne briši ponavljanja koja zaista postoje u pesmi (npr. refren napisan dva puta na različitim mestima).
- Slike mogu biti rukom pisane strane ili snimci ekrana sa sajta; kod sajta prepiši samo pesmu (naslov, izvođač, akordi, tekst) i ignoriši meni, reklame, komentare i dugmad.`;

/** Šalje jednu ili više slika (istim redom) i vraća jednu spojenu pesmu. */
export async function scanSong(images, signal, onStatus, diag) {
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
    }, { signal, onStatus, diag });
  } catch (e) {
    // Ako neki model ne prihvata šemu odgovora, pokušaj isti model samo sa JSON izlazom (prompt opisuje oblik).
    if (!(e instanceof GeminiError) || e.code !== 'HTTP_400' || !e.model || !/schema|response_?schema|responseMimeType|field/i.test(e.message)) throw e;
    res = await generate(apiKey, { contents, generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }, { signal, onStatus, models: [e.model], diag });
  }
  const text = textOf(res.data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let json;
  try { json = JSON.parse(text); } catch { throw new GeminiError(t('gem.badJson')); }
  const unplaced = tabsFromScan(json);
  let song;
  try { song = normalizeSong(json); } catch {
    // TAB list: tekst i akordi često ne postoje — svejedno nastavi na čitanje tablature
    if (json && json.sheetKind === 'tab') song = { title: String(json.title || '').slice(0, 120), artist: String(json.artist || '').slice(0, 120), key: '', transpose: 0, sections: [{ name: '', lines: [{ text: '', chords: [] }] }] };
    else throw new GeminiError(t('gem.noSong'));
  }
  // delovi sa tablaturom za koje Gemini nije siguran gde pripadaju (indeksi posle normalizacije su isti)
  song.unplacedTabs = unplaced.filter((i) => song.sections[i] && song.sections[i].tabs);
  song.scanModel = res.model; // prikazuje se na „Proveri i ispravi“, ne čuva se u pesmi
  if (json.sheetKind === 'tab') song.sheetKind = 'tab'; // Gemini misli da je ovo TAB list (pitaj/pročitaj kao TAB)
  return song;
}

/** TAB list (jedna ili više strana) → sirov JSON taktova (pesmu pravi tabSong.fromScan). */
export async function scanTab(images, signal, onStatus, diag) {
  const list = Array.isArray(images) ? images : [images];
  const apiKey = await getApiKey();
  const parts = [{ text: TAB_PROMPT + (list.length > 1 ? TAB_MULTI(list.length) : '') }];
  list.forEach((img, i) => {
    if (list.length > 1) parts.push({ text: `Strana ${i + 1} od ${list.length}:` });
    parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
  });
  const contents = [{ parts }];
  const cfg = { temperature: 0.1, responseMimeType: 'application/json' };
  let res;
  try {
    res = await generate(apiKey, { contents, generationConfig: { ...cfg, responseSchema: TAB_SCHEMA } }, { signal, onStatus, diag });
  } catch (e) {
    if (!(e instanceof GeminiError) || e.code !== 'HTTP_400' || !e.model || !/schema|response_?schema|responseMimeType|field/i.test(e.message)) throw e;
    res = await generate(apiKey, { contents, generationConfig: cfg }, { signal, onStatus, models: [e.model], diag });
  }
  const text = textOf(res.data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let json;
  try { json = JSON.parse(text); } catch { throw new GeminiError(t('gem.badJson')); }
  if (!json || !Array.isArray(json.bars) || !json.bars.length) throw new GeminiError(t('gem.noTab'));
  json.scanModel = res.model;
  return json;
}

/**
 * ASCII tablature iz odgovora pretvara u strukturirane (sections[i].tabs), nesigurne pragove dodaje u
 * json.uncertain (kind 'fret'). Vraća indekse delova čije mesto nije jasno.
 */
export function tabsFromScan(json) {
  const unplaced = [];
  if (!json || !Array.isArray(json.sections)) return unplaced;
  json.uncertain = Array.isArray(json.uncertain) ? json.uncertain : [];
  json.sections.forEach((sec, si) => {
    if (!sec || typeof sec.tab !== 'string' || !sec.tab.trim()) return;
    const lines = sec.tab.split(/\r?\n/).filter((l) => l.trim());
    const tab = parseAsciiTab(lines, sec.tabSig);
    if (!tab) return;
    sec.tabs = [...(Array.isArray(sec.tabs) ? sec.tabs : []), tab];
    const ti = sec.tabs.length - 1;
    for (const u of Array.isArray(sec.tabUnsure) ? sec.tabUnsure : []) {
      json.uncertain.push({ section: si, kind: 'fret', tab: ti, string: u.string, col: u.column, text: String(u.fret ?? ''), suggestion: String(u.suggestion ?? '') });
    }
    if (sec.tabPlacementUnclear) unplaced.push(si);
    if (!Array.isArray(sec.lines)) sec.lines = [];
  });
  return unplaced;
}

// ---------------- Predlog ritma ----------------
/**
 * Predlaže jedan od ugrađenih ritmova za pesmu (isti izbor modela i minimalno „razmišljanje“ kao skeniranje).
 * patterns: [{ id, sig, steps, name }]. Vraća { id, reason } ili baca GeminiError.
 */
export async function suggestStrumAI(song, patterns, lang, signal) {
  const apiKey = await getApiKey();
  const lines = (song.sections || []).flatMap((s) => [s.name ? `[${s.name}]` : '', ...s.lines.slice(0, 6).map((l) => l.text)]).filter(Boolean).slice(0, 24).join('\n');
  const prompt = `Gitarista vežba pesmu i treba mu ritam udaranja (strumming).
Pesma: "${song.title}"${song.artist ? ` — ${song.artist}` : ''}${song.key ? `, tonalitet ${song.key}` : ''}.
Početak teksta:
${lines}

Izaberi JEDAN ritam sa spiska koji najbolje odgovara taktu i karakteru pesme (ako znaš pesmu, koristi njen pravi takt):
${patterns.map((p) => `- ${p.id} (${p.sig}, ${p.steps}): ${p.name}`).join('\n')}

Vrati JSON { "pattern": "<id sa spiska>", "reason": "<jedna kratka rečenica, najviše 15 reči, na jeziku: ${lang === 'en' ? 'English' : 'srpski (latinica)'}>" }.`;
  const { data } = await generate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2, maxOutputTokens: 200, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { pattern: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['pattern', 'reason'] },
    },
  }, { signal });
  let j;
  try { j = JSON.parse(textOf(data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new GeminiError(t('gem.badJson')); }
  const p = patterns.find((x) => x.id === j.pattern);
  if (!p) throw new GeminiError(t('gem.noAnswer'));
  return { id: p.id, reason: String(j.reason || '').slice(0, 200) };
}
