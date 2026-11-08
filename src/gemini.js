// Google Gemini API — poziva se direktno iz pregledača sa korisnikovim ključem.
import { t } from './i18n.js';
// Ključ se nikad ne nalazi u kodu; čuva se samo u IndexedDB na uređaju.
import { settings } from './db.js';
import { readSSE, looksStuck } from './streamRead.js';
import { fixCaps } from './textCase.js';
import { TAB_TEXT_PROMPT, TAB_TEXT_PAGE, TAB_TEXT_RANGE, TAB_TEXT_BARS, parseTabText } from './tabScanText.js';
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
6. "title" i "artist" (izvođač ili autor pesme) uzmi sa slike; ako ih nema, ostavi prazan string. Piši ih normalnim velikim i malim slovima (npr. "In My Life", "John Lennon"), NIKAD sve velikim slovima, čak i kad su tako odštampani. "artist" nikad nije izdavač, sajt, autorska prava ni onaj ko je prepisao akorde. "key" je tonalitet ako je naznačen, inače ga proceni iz akorda (npr. "Am", "G"); piši ga istim imenovanjem kao akorde na papiru (npr. "Hm" ako papir koristi H).
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
8. "title" je naslov kompozicije sa lista, normalnim velikim i malim slovima (npr. "Romance D'Amour"), nikad sve velikim slovima. "composer" je KOMPOZITOR (autor muzike) tačno kako je odštampan — obično desno iznad prvog sistema, npr. "Anonymous", "Trad.", "F. Tárrega", "J. S. Bach". NIKAD ne stavljaj izdavača, sajt, autorska prava, aranžera ni onoga ko je prepisao (npr. reči "arr.", "arranged by", "transcribed by", "edited by", "Music", "Publishing", "Edition", "©", adresa sajta) — njih upiši u "arranger" ili "publisher". Ako kompozitor nije odštampan, "composer" je prazan string (ne pogađaj).
9. NESIGURNO: ako neki takt ne možeš pouzdano da pročitaš (mutan broj, nejasan ritam), prepiši najbolju procenu i dodaj { "bar": broj takta, "why": kratko objašnjenje na srpskom } u "unsure". Ne izmišljaj note koje ne vidiš.
10. Ne prepisuj ništa osim kompozicije (bez imena izdavača, brojeva strana, reklama).

Vrati ISKLJUČIVO JSON ovog oblika:
{ "title": "", "composer": "", "arranger": "", "publisher": "", "key": "Em", "sig": "3/4", "bpm": 0, "firstBar": 1, "pageBars": 16, "unsure": [ { "bar": 12, "why": "" } ], "bars": [ { "n": 1, "sig": "", "key": "", "repeatStart": false, "repeatEnd": false, "times": 2, "ending": 0, "barre": [ { "label": "1/2 BV", "fret": 5, "half": true } ], "notes": [ { "s": 6, "f": 0, "start": 0, "len": 3, "finger": 0 } ] } ] }`;

const TAB_PAGE = (i, n, firstExpected) => `

STRANA: ovo je strana ${i} od ${n}. NAJPRE prebroj taktove na ovoj strani: "firstBar" = broj prvog takta na strani (broj odštampan na početku prvog reda; ako ga nema, ${firstExpected}), "pageBars" = koliko taktova ima na ovoj strani (prebroj sve redove do kraja strane). Zatim prepiši SVE te taktove, redom, svaki sa svojim brojem "n" — nijedan ne izostavljaj, ni poslednje redove strane.`;
const TAB_RANGE = (a, b) => `

PREPIŠI SAMO TAKTOVE ${a}–${b} sa ove strane (polje "bars" sadrži samo njih, sa tačnim brojevima "n").`;

const TAB_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' }, composer: { type: 'STRING' }, arranger: { type: 'STRING' }, publisher: { type: 'STRING' }, key: { type: 'STRING' }, sig: { type: 'STRING' }, bpm: { type: 'NUMBER' },
    firstBar: { type: 'INTEGER' }, pageBars: { type: 'INTEGER' },
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
    // koliko da se čeka: Google ga za 429 šalje (RetryInfo „37s“); preopterećenje (503) obično prođe za ~30 s
    const rd = /"retryDelay":"(\d+(?:\.\d+)?)s"/.exec(reason);
    const quotaModel = (/model: ([\w.-]+)/.exec(msg) || [])[1] || '';
    const e = new GeminiError(t('gem.busy'), { code: 'BUSY', model });
    e.retryMs = rd ? Math.min(90000, Math.ceil(Number(rd[1]) * 1000) + 1000) : res.status === 429 ? 60000 : 30000;
    e.quota = res.status === 429; e.quotaModel = quotaModel;
    return e;
  }
  if (res.status >= 500) return new GeminiError(t('gem.unavailable'), { code: 'HTTP_' + res.status, model });
  if (res.status === 400 && /thinking/i.test(msg)) return new GeminiError(msg, { code: 'THINKING', model });
  if (res.status === 400 && /location|region|country/i.test(msg)) return new GeminiError(t('gem.region'));
  return new GeminiError(msg ? t('gem.errorMsg', { msg }) : t('gem.error'), { code: 'HTTP_' + res.status, model });
}

const ATTEMPT_MS = () => globalThis.__gitaraAttemptMs || 75000; // jedan pokušaj kod jednog modela: duže = zaglavljen → sledeći model
async function callOnce(apiKey, body, signal, model, { diag, onStatus, thinking, stream } = {}) {
  if (navigator.onLine === false) throw new GeminiError(t('gem.offline'));
  const own = new AbortController();
  let stuck = false;
  const onParent = () => own.abort();
  if (signal) { if (signal.aborted) own.abort(); else signal.addEventListener('abort', onParent, { once: true }); }
  const stuckT = setTimeout(() => { stuck = true; own.abort(); }, ATTEMPT_MS());
  try { return await callOnceInner(apiKey, body, own.signal, model, { diag, onStatus, thinking, stream }); }
  catch (e) {
    if (stuck && e && e.name === 'AbortError') { const last = diag && diag.attempts[diag.attempts.length - 1]; if (last) last.status = 'zaglavljen (75 s)'; throw Object.assign(new GeminiError(t('gem.busy'), { code: 'BUSY', model }), { retryMs: 60000, stuck: true }); }
    throw e;
  } finally { clearTimeout(stuckT); if (signal) signal.removeEventListener('abort', onParent); }
}
const IDLE_MS = () => globalThis.__gitaraIdleMs || 30000; // odgovor „u delovima“: toliko bez novog dela = stao
async function callOnceInner(apiKey, body, signal, model, { diag, onStatus, thinking, stream } = {}) {
  const payload = JSON.stringify(body);
  const att = { model, thinking: describeThinking(thinking), sentBytes: payload.length, ms: 0, status: '…', message: '' };
  if (diag) diag.attempts.push(att);
  const t0 = performance.now();
  if (onStatus) onStatus('send', model);
  // „Šaljem…“ dok traje slanje (procena po veličini), zatim „Gemini čita…“
  const readTimer = onStatus ? setTimeout(() => onStatus('reading', model), Math.min(8000, Math.max(700, payload.length / 250))) : 0;
  let res;
  try {
    res = await fetch(`${API_BASE}${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
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
  if (stream && res.ok && res.body) {
    // odgovor stiže deo po deo: napredak se vidi, „zaglavljen“ odgovor (ponavljanje) se prekida odmah,
    // a i kad stane na pola (prestane da šalje, istekne rok) zadržava se sve što je stiglo
    const r = await readSSE(res.body, { onText: stream.onText, idleMs: IDLE_MS(), signal });
    clearTimeout(readTimer);
    att.ms = performance.now() - t0;
    att.status = 'HTTP 200';
    att.recvChars = r.text.length;
    const why = r.stopped ? 'LOOP' : r.idle ? 'IDLE' : r.aborted ? 'CUT' : r.finishReason || (r.error ? 'ERROR' : '?');
    att.message = `OK u delovima (${r.chunks}, finishReason ${why})` + (r.error ? ' ' + String(r.error.message || '').slice(0, 200) : '');
    if (!r.text.trim() && !r.chunks && !r.idle && !r.aborted && !r.error) return {}; // prazan odgovor (kao bez kandidata)
    if (!r.text.trim()) {
      if (r.aborted) { att.status = 'prekinuto'; throw new DOMException('Aborted', 'AbortError'); }
      if (r.idle) { att.status = 'zaglavljen (bez odgovora)'; throw Object.assign(new GeminiError(t('gem.busy'), { code: 'BUSY', model }), { retryMs: 60000, stuck: true }); }
      if (r.error) throw httpError({ status: Number(r.error.code) || 500, statusText: '' }, { error: r.error }, model);
    }
    return { candidates: [{ content: { parts: [{ text: r.text }] }, finishReason: ['LOOP', 'IDLE', 'CUT', 'ERROR'].includes(why) ? 'PARTIAL' : why, partial: why }] };
  }
  let data = null;
  try { data = await res.json(); } catch {}
  clearTimeout(readTimer);
  att.ms = performance.now() - t0;
  att.status = 'HTTP ' + res.status;
  if (!res.ok) {
    att.message = String((data && data.error && (data.error.message || data.error.status)) || res.statusText || '').slice(0, 400);
    const qid = /"quotaId":"([^"]+)"/.exec(JSON.stringify((data && data.error && data.error.details) || '')); // npr. …PerDay… / …PerMinute…
    if (qid) att.message += ' [' + qid[1] + ']';
    throw httpError(res, data, model);
  }
  const cand = data && data.candidates && data.candidates[0];
  att.message = cand ? `OK (finishReason ${cand.finishReason || '?'})` : 'OK (bez kandidata)';
  return data;
}
// ---------------- Zauzeti modeli (ograničenje zahteva u minutu, preopterećenje) ----------------
// Besplatan ključ ima ~5 zahteva u minutu PO MODELU. Model koji kaže „ograničenje“ ili „preopterećen“ se ne pita
// ponovo dok ne prođe vreme koje Google navede — umesto toga se odmah pita drugi model (svaki ima svoje ograničenje).
const cool = new Map();
const coolDown = (m, ms) => { if (m) cool.set(m, Math.max(cool.get(m) || 0, Date.now() + ms)); };
const coolLeft = (m) => Math.max(0, (cool.get(m) || 0) - Date.now());
export const _coolForTests = cool;
// Koja varijanta „razmišljanja“ radi za koji model (da se ne troše zahtevi na „MINIMAL nije podržan“)
const THINK_KEY = 'gitara-think';
const thinkStart = (m) => { try { return Number((JSON.parse(localStorage.getItem(THINK_KEY) || '{}'))[m]) || 0; } catch { return 0; } };
const thinkSave = (m, v) => { try { const o = JSON.parse(localStorage.getItem(THINK_KEY) || '{}'); o[m] = v; localStorage.setItem(THINK_KEY, JSON.stringify(o)); } catch {} };

// Modeli koji odbiju mediaResolution (stariji / drugačiji API) — pamti se da se ne troši zahtev svaki put
const MEDIA_KEY = 'gitara-nomedia';
const noMediaRes = new Set((() => { try { return JSON.parse(localStorage.getItem(MEDIA_KEY) || '[]'); } catch { return []; } })());
const saveNoMediaRes = () => { try { localStorage.setItem(MEDIA_KEY, JSON.stringify([...noMediaRes])); } catch {} };
function withoutMediaRes(body) { const gc = { ...(body.generationConfig || {}) }; delete gc.mediaResolution; return { ...body, generationConfig: gc }; }

/** Jedan model. auto: zauzet → hlađenje i greška (pita se drugi model); izabran model: čeka koliko Google kaže. */
async function callWithRetry(apiKey, body, signal, model, onStatus, delays, diag, { auto = false, until = Infinity, stream = null } = {}) {
  const variants = thinkingVariants(model);
  for (let v = Math.min(thinkStart(model), variants.length - 1); v < variants.length; v++) {
    let b = withThinking(noMediaRes.has(model) ? withoutMediaRes(body) : body, variants[v]);
    for (let attempt = 0; ; attempt++) {
      try {
        const data = await callOnce(apiKey, b, signal, model, { diag, onStatus, thinking: variants[v], stream });
        if (v !== thinkStart(model)) thinkSave(model, v);
        return data;
      } catch (e) {
        // model ne prihvata „visoku rezoluciju slike“: zapamti i pošalji isti zahtev bez nje
        if (e instanceof GeminiError && /^HTTP_400$/.test(e.code) && b.generationConfig && b.generationConfig.mediaResolution && /media_?resolution/i.test(e.message)) {
          noMediaRes.add(model); saveNoMediaRes(); b = withoutMediaRes(b); attempt--; continue;
        }
        if (e instanceof GeminiError && e.code === 'THINKING' && v < variants.length - 1) { thinkSave(model, v + 1); break; } // sledeća varijanta, zapamćeno
        if (e instanceof GeminiError && e.code === 'THINKING') throw new GeminiError(t('gem.errorMsg', { msg: e.message }), { code: 'HTTP_400', model });
        if (!(e instanceof GeminiError) || e.code !== 'BUSY') throw e;
        const wait = e.retryMs || 30000;
        coolDown(model, wait); if (e.quotaModel) coolDown(e.quotaModel, wait);
        if (auto) throw e; // drugi model odmah
        if (attempt >= delays.length || Date.now() + wait > until - 5000) throw e;
        if (onStatus) onStatus('wait', Math.round(wait / 1000));
        await sleep(wait, signal);
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
async function generate(apiKey, body, { signal, onStatus, selection, models, diag, deadline = 0, stream = null } = {}) {
  if (!apiKey) throw new GeminiError(t('gem.noKey'));
  if (navigator.onLine === false) throw new GeminiError(t('gem.offline'));
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, deadline ? Math.min(deadline, DEADLINE_MS()) : DEADLINE_MS());
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); signal.addEventListener('abort', onAbort); }
  const sel = selection || (await getModelSetting());
  if (diag) diag.selection = sel;
  try {
    const list = models || (await candidates(apiKey, sel));
    const auto = sel === AUTO && !models && list.length > 1;
    const until = Date.now() + (deadline ? Math.min(deadline, DEADLINE_MS()) : DEADLINE_MS());
    let lastErr = null, prev = '';
    for (let round = 0; round < 6; round++) {
      // modeli koji nisu „na hlađenju“ (onaj koji je poslednji radio je prvi u spisku)
      const ready = auto ? list.filter((m) => !coolLeft(m)) : list;
      for (const model of ready) {
        if (prev && model !== prev && onStatus) onStatus('switch', model);
        prev = model;
        try {
          const data = await callWithRetry(apiKey, body, ctrl.signal, model, onStatus, auto ? FALLBACK_RETRY : RETRY_DELAYS, diag, { auto, until, stream });
          if (auto) await settings.set('geminiLastModel', model);
          return { data, model };
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          const tryNext = e instanceof GeminiError && ['BUSY', 'MODEL_UNAVAILABLE', 'HTTP_500', 'HTTP_502', 'HTTP_504'].includes(e.code);
          if (!auto || !tryNext) throw e;
          if (e.code !== 'BUSY') coolDown(model, 10 * 60000); // model ne postoji / ne radi: ne pitaj ga dugo
          lastErr = e;
        }
      }
      if (!auto) break;
      // svi su zauzeti: sačekaj prvi koji se „ohladi“ (ako stigne pre roka), pa ponovo
      const soonest = Math.min(...list.map(coolLeft).filter((x) => x > 0));
      if (!isFinite(soonest) || Date.now() + soonest > until - 8000) break;
      if (onStatus) onStatus('wait', Math.round(soonest / 1000));
      await sleep(soonest, ctrl.signal);
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

/** Kada stiže nov dnevni besplatni limit: ponoć po pacifičkom vremenu (Google), u lokalnom vremenu. */
export function quotaResetAt(now = Date.now()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    const sec = ((Number(p.hour) % 24) * 60 + Number(p.minute)) * 60 + Number(p.second);
    return now + (86400 - sec) * 1000;
  } catch { return 0; }
}
/**
 * v1.70.1: šta tačno nije u redu — iz greške i svih pokušaja (diag.attempts).
 * kind: badKey (ključ ne radi — jedini pravi problem), daily (dnevni besplatni limit), minute (previše zahteva u minuti),
 * overload (Google preopterećen), net (internet), region, other.
 */
export function diagnose(err, diag) {
  const atts = (diag && diag.attempts) || [];
  const fails = atts.filter((a) => a.status !== 'HTTP 200' && a.status !== 'prekinuto');
  const txt = (a) => String(a.status) + ' ' + (a.message || '');
  if (err && err.code === 'BAD_KEY') return { kind: 'badKey' };
  if (navigator.onLine === false || (fails.length && fails.every((a) => a.status === 'mreža'))) return { kind: 'net' };
  if (err && err.message === t('gem.region')) return { kind: 'region' };
  const q429 = fails.filter((a) => /HTTP 429|RESOURCE_EXHAUSTED|quota/i.test(txt(a)));
  const daily = q429.filter((a) => /per.?day|PerDay|daily/i.test(txt(a)));
  const over = fails.filter((a) => /HTTP 50\d|zaglavljen|isteklo|overloaded|UNAVAILABLE/i.test(txt(a)));
  if (daily.length && !over.length && daily.length === q429.length) return { kind: 'daily', resetAt: quotaResetAt() };
  if (q429.length && !over.length) return { kind: 'minute' };
  if (over.length || (err && (err.code === 'BUSY' || err.code === 'TIMEOUT'))) return { kind: 'overload', withDaily: daily.length > 0, resetAt: daily.length ? quotaResetAt() : 0 };
  return { kind: 'other', msg: (err && err.message) || '' };
}
/** Naslov + objašnjenje + koliko je ozbiljno (ok | wait | bad) za prikaz. */
export function explain(d) {
  const time = d.resetAt ? new Date(d.resetAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
  const level = d.kind === 'badKey' || d.kind === 'region' || d.kind === 'other' ? 'bad' : 'wait';
  const body = t('gdx.' + d.kind + '.body', { time, msg: d.msg || '' }) + (d.withDaily ? ' ' + t('gdx.alsoDaily', { time }) : '');
  return { level, title: t('gdx.' + d.kind + '.title'), body };
}

/** Mali test poziv za proveru ključa i modela. Vraća ime modela koji je odgovorio. */
export async function testKey(apiKey, selection, onStatus, diag) {
  const { data, model } = await generate(apiKey, {
    contents: [{ parts: [{ text: 'Odgovori samo rečju: OK' }] }],
    generationConfig: { maxOutputTokens: 64, temperature: 0 },
  }, { selection: selection || AUTO, onStatus, diag, deadline: 60000 });
  if (!data || !data.candidates) throw new GeminiError(t('gem.unexpected'));
  return model;
}

/** Smanjuje sliku (max 2000px) i vraća { mime, base64 }. */
// ---------------- Priprema slike: samo papir, sivo, jasan kontrast ----------------
// Fotografija lista na stolu: drvo, senke i margine zauzimaju deo slike, pa su sitni brojevi tablature mali i
// bledi. Pre slanja: (1) isecanje na papir (najveći svetli pravougaonik), (2) sivo, (3) razvlačenje kontrasta
// (crni brojevi tamni, papir beo). Tamni snimci ekrana (bela slova na crnom) se ne diraju.
function lumOf(d, i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = i; }
  }
  return th;
}
/** Gde je papir na slici: { x, y, w, h } u delovima (0–1) ili null (cela slika / ne može se pouzdano odrediti). */
export function findPaper(lum, W, H) {
  const hist = new Array(256).fill(0);
  let mean = 0;
  for (const v of lum) { hist[v | 0]++; mean += v; }
  mean /= lum.length;
  if (mean < 90) return { dark: true };
  const th = Math.max(otsu(hist, lum.length), 110);
  // najduži niz redova / kolona u kojima je većina piksela „papir“
  const run = (n, frac) => { let best = [0, -1], s = -1; for (let i = 0; i <= n; i++) { const ok = i < n && frac(i) > 0.5; if (ok && s < 0) s = i; if (!ok && s >= 0) { if (i - 1 - s > best[1] - best[0]) best = [s, i - 1]; s = -1; } } return best; };
  const rowFrac = (y) => { let c = 0; for (let x = 0; x < W; x++) if (lum[y * W + x] > th) c++; return c / W; };
  const [y0, y1] = run(H, rowFrac);
  const colFrac = (x) => { let c = 0; for (let y = y0; y <= y1; y++) if (lum[y * W + x] > th) c++; return c / Math.max(1, y1 - y0 + 1); };
  const [x0, x1] = run(W, colFrac);
  if (y1 < y0 || x1 < x0) return null;
  const pad = 0.015;
  const box = { x: Math.max(0, x0 / W - pad), y: Math.max(0, y0 / H - pad), w: 0, h: 0 };
  box.w = Math.min(1, (x1 + 1) / W + pad) - box.x; box.h = Math.min(1, (y1 + 1) / H + pad) - box.y;
  const area = box.w * box.h;
  return area < 0.25 || area > 0.95 ? null : box;
}
/** Sivo + kontrast: tamni deo (brojevi) ka crnoj, papir ka beloj — po raspodeli svetline same slike. */
function enhance(ctx, w, h) {
  const im = ctx.getImageData(0, 0, w, h), d = im.data, n = w * h;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[lumOf(d, i) | 0]++;
  const pct = (p) => { let c = 0; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= n * p) return i; } return 255; };
  const lo = pct(0.01), hi = Math.max(lo + 40, pct(0.90)); // ~90 % slike je papir: on postaje beo
  const k = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (lumOf(d, i) - lo) * k));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
}

export async function prepareImage(file, { max = 1600, quality = 0.8, maxBytes = 500 * 1024, clean = true } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new GeminiError(t('gem.badImage')));
      i.src = url;
    });
    const ow = img.naturalWidth, oh = img.naturalHeight;
    // gde je papir (mala kopija slike, samo za merenje)
    let crop = { x: 0, y: 0, w: 1, h: 1 }, dark = false;
    if (clean) {
      try {
        const A = 320, sc = A / Math.max(ow, oh), aw = Math.max(1, Math.round(ow * sc)), ah = Math.max(1, Math.round(oh * sc));
        const c = document.createElement('canvas'); c.width = aw; c.height = ah;
        const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, aw, ah);
        const d = cx.getImageData(0, 0, aw, ah).data, lum = new Float32Array(aw * ah);
        for (let i = 0; i < lum.length; i++) lum[i] = lumOf(d, i * 4);
        c.width = c.height = 0;
        const box = findPaper(lum, aw, ah);
        if (box && box.dark) dark = true; else if (box) crop = box;
      } catch {}
    }
    const cw = ow * crop.w, ch = oh * crop.h, sx = ow * crop.x, sy = oh * crop.y;
    let side = max, q = quality, dataUrl = '', w = 0, h = 0;
    // Smanjuj dok slika ne bude ispod ~500 KB (prvo kvalitet, pa dimenzije).
    for (let step = 0; step < 6; step++) {
      const scale = Math.min(1, side / Math.max(cw, ch));
      w = Math.round(cw * scale); h = Math.round(ch * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, sx, sy, cw, ch, 0, 0, w, h);
      if (clean && !dark) { try { enhance(ctx, w, h); } catch {} }
      dataUrl = canvas.toDataURL('image/jpeg', q);
      canvas.width = canvas.height = 0; // oslobodi memoriju odmah (važno na telefonu)
      if (b64Bytes(dataUrl) <= maxBytes) break;
      if (q > 0.62) q -= 0.1; else side = Math.round(side * 0.85);
    }
    const base64 = dataUrl.split(',')[1];
    const cropped = crop.w < 1 || crop.h < 1;
    return { mime: 'image/jpeg', base64, preview: dataUrl, info: { ow, oh, origBytes: file.size, w, h, bytes: b64Bytes(dataUrl), quality: +q.toFixed(2), ...(cropped ? { crop: `${Math.round(crop.w * 100)}×${Math.round(crop.h * 100)} %` } : {}), ...(clean && !dark ? { clean: 1 } : {}) } };
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
    if (json && json.sheetKind === 'tab') song = { title: String(json.title || '').slice(0, 120), artist: cleanComposer(String(json.artist || '').slice(0, 120)), key: '', transpose: 0, sections: [{ name: '', lines: [{ text: '', chords: [] }] }] };
    else throw new GeminiError(t('gem.noSong'));
  }
  // delovi sa tablaturom za koje Gemini nije siguran gde pripadaju (indeksi posle normalizacije su isti)
  song.unplacedTabs = unplaced.filter((i) => song.sections[i] && song.sections[i].tabs);
  song.title = fixCaps(song.title); song.artist = fixCaps(song.artist); // nikad SVE VELIKIM jer je tako odštampano
  song.scanModel = res.model; // prikazuje se na „Proveri i ispravi“, ne čuva se u pesmi
  if (json.sheetKind === 'tab') song.sheetKind = 'tab'; // Gemini misli da je ovo TAB list (pitaj/pročitaj kao TAB)
  return song;
}

/** Jedan poziv za TAB stranu (dug odgovor: do 32 768 tokena). Vraća JSON ili null ako odgovor nije ceo / ispravan. */
async function askTab(apiKey, img, text, signal, onStatus, diag, { maxTokens = 32768, deadline = 0 } = {}) {
  const contents = [{ parts: [{ inline_data: { mime_type: img.mime, data: img.base64 } }, { text }] }];
  // dužina odgovora ograničena prema broju traženih taktova: kad se model „zaglavi“ i ponavlja iste brojeve,
  // odgovor se preseče za nekoliko sekundi umesto da se piše minutima
  const cfg = { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: maxTokens, mediaResolution: HIGH_RES };
  let res;
  try {
    res = await generate(apiKey, { contents, generationConfig: { ...cfg, responseSchema: TAB_SCHEMA } }, { signal, onStatus, diag, deadline });
  } catch (e) {
    if (!(e instanceof GeminiError) || e.code !== 'HTTP_400' || !e.model || !/schema|response_?schema|responseMimeType|field|maxOutputTokens/i.test(e.message)) throw e;
    res = await generate(apiKey, { contents, generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: maxTokens } }, { signal, onStatus, models: [e.model], diag, deadline });
  }
  try {
    const j = JSON.parse(textOf(res.data).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (j && typeof j === 'object') j.scanModel = res.model;
    return j && Array.isArray(j.bars) ? j : null;
  } catch { return null; } // odgovor prekinut (predugačak) — dočitava se po delovima
}

// Kompozitor sa lista — nikad izdavač, sajt ni aranžer (ako ga nema, ostaje prazno).
const NOT_COMPOSER = /(\barr\.|\barrang|\btranscri|\bedited\b|\bedit(ion|ed by)\b|\bpublish|\bmusic\s*(ltd|inc|co\b|publishing)|\bmusic$|\bsheet\s*music\b|\bfree\b|©|\(c\)|copyright|www\.|https?:|\.(com|net|org|de|fr|it|ru|es|rs)\b|\btabs?\b|\btablature\b|\bpage\b|\bstrana\b)/i;
export function cleanComposer(raw, j = {}) {
  let c = typeof raw === 'string' ? raw.trim() : '';
  if (!c) return '';
  c = c.replace(/^(music\s*(by|:)|komp(ozitor)?\s*:|composer\s*:|muzika\s*:)\s*/i, '').replace(/\s*[,;(\[]?\s*(arr\.|arranged|transcribed|obr\.|aranž).*$/i, '').trim();
  if (!c || c.length > 80 || NOT_COMPOSER.test(c)) return '';
  const same = (x) => typeof x === 'string' && x.trim() && x.trim().toLowerCase() === c.toLowerCase();
  if (same(j.publisher) || same(j.arranger)) return '';
  return c;
}

const TAB_PAGE_MS = 180000; // jedna strana najduže 3 min (uz čekanje na slobodan model); posle toga dalje sa pročitanim
const tabTokens = (bars) => 2000 + 700 * bars; // ~350 tokena po taktu ×2, plus mesto za kratko „razmišljanje“ modela

/** Jedan poziv u kratkom tekstu (kolone žica/prag, ritam računa aplikacija). Vraća isti oblik kao askTab ili null. */
// Slika PRE uputstva (preporuka za Gemini: model prvo „vidi“ list, pa čita šta da radi) i u visokoj rezoluciji
// (sitni brojevi u tablaturi). Ako model ne prihvati mediaResolution, šalje se bez nje (zapamti se po modelu).
const HIGH_RES = 'MEDIA_RESOLUTION_HIGH';
async function askTabText(apiKey, img, text, signal, onStatus, diag, { maxTokens = 6000, deadline = 0, expect = 24 } = {}) {
  const contents = [{ parts: [{ inline_data: { mime_type: img.mime, data: img.base64 } }, { text }] }];
  let seen = 0;
  const stream = {
    onText: (sofar) => {
      const got = (sofar.match(/^\s*T\s*\d{1,3}\s*[:.]/gim) || []).length;
      if (got !== seen) { seen = got; onStatus?.('progress', got, expect); }
      return looksStuck(sofar, expect); // ponavlja se u krug → prekini odmah (pročitano ostaje)
    },
  };
  const res = await generate(apiKey, { contents, generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens, mediaResolution: HIGH_RES } }, { signal, onStatus, diag, deadline, stream });
  if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const cand = res.data && res.data.candidates && res.data.candidates[0];
  // presečen odgovor (granica dužine, ponavljanje, prekid): poslednji red možda nije ceo — odbaci ga
  const j = parseTabText(textOf(res.data), { truncated: !!cand && (cand.finishReason === 'MAX_TOKENS' || cand.finishReason === 'PARTIAL'), loop: !!cand && cand.partial === 'LOOP' });
  if (j) { j.scanModel = res.model; if (cand.partial) j.partial = cand.partial; }
  return j;
}
const tabTextTokens = (bars) => 1500 + 160 * bars; // ~10 kolona × ~6 tokena po taktu, plus mesto za kratko „razmišljanje“

/**
 * TAB list → sirov JSON taktova (pesmu pravi tabSong.fromScan). Jedan zahtev po strani (ceo red taktova obično stigne
 * za nekoliko sekundi) i najviše jedan dopunski za taktove koji fale — besplatan Gemini ključ dozvoljava samo ~5
 * zahteva u minutu po modelu, pa je manje zahteva brže od mnogo malih. Zauzet / preopterećen / zaglavljen model:
 * generate() odmah pita drugi model ili sačeka koliko Google kaže. Svaka strana ima rok; što nije pročitano ostaje
 * prazan takt „nije pročitan“ — ništa se ne izmišlja i ništa pročitano se ne gubi.
 * onStatus: 'page' (i, n), 'range' (a, b, i, n), 'wait' (sekunde), ostalo kao generate().
 */
export async function scanTab(images, signal, onStatus, diag) {
  const list = Array.isArray(images) ? images : [images];
  const apiKey = await getApiKey();
  const out = { title: '', composer: '', key: '', sig: '', bpm: 0, bars: [], unsure: [] };
  let next = 1, model = '', anyAnswer = false, lastErr = null;
  const meta = (j) => {
    if (!j) return;
    anyAnswer = true;
    model = j.scanModel || model;
    if (!out.composer) out.composer = fixCaps(cleanComposer(j.composer, j));
    for (const k of ['title', 'key', 'sig']) if (!out[k] && typeof j[k] === 'string' && j[k].trim()) out[k] = k === 'title' ? fixCaps(j[k].trim()) : j[k].trim();
    if (!out.bpm && Number(j.bpm) > 0) out.bpm = Number(j.bpm);
  };
  // napomene samo za taktove koji su zaista uzeti iz tog odgovora (npr. strana 2 ponovi takt 16 sa „?“ — taj red se
  // ne uzima, pa ni njegova napomena ne sme da označi pravi takt 16 sa strane 1)
  const unsureOf = (j, a, b) => { for (const u of (j && Array.isArray(j.unsure) ? j.unsure : [])) if (u && u.bar >= a && u.bar <= b) out.unsure.push(u); };
  for (let pi = 0; pi < list.length; pi++) {
    const img = list[pi], N = list.length, t0 = Date.now();
    const left = () => TAB_PAGE_MS - (Date.now() - t0);
    // zahtev → odgovor ili null (nepotpun / isteklo / svi modeli zauzeti); ključ, mreža i otkazivanje prekidaju sve
    // kratak tekst (kolone žica/prag) — lak i brz zadatak; isti zahtev kao JSON samo kad tekst ne uspe (rezerva)
    const ask = async (text, bars, json = false, maxMs = Infinity) => {
      if (left() < 10000) return null;
      const deadline = Math.min(left(), maxMs);
      try {
        return json ? await askTab(apiKey, img, text, signal, onStatus, diag, { maxTokens: tabTokens(bars), deadline })
          : await askTabText(apiKey, img, text, signal, onStatus, diag, { maxTokens: tabTextTokens(bars), deadline, expect: bars });
      }
      catch (e) {
        if (e instanceof GeminiError && ['TIMEOUT', 'BUSY', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504'].includes(e.code)) { lastErr = e; return null; }
        throw e;
      }
    };
    onStatus?.('page', pi + 1, N);
    let j = await ask(TAB_TEXT_PROMPT + TAB_TEXT_PAGE(pi + 1, N, next), 24);
    if (!j && !(lastErr && lastErr.code === 'BUSY') && left() > 30000) j = await ask(TAB_PROMPT + TAB_PAGE(pi + 1, N, next), 24, true); // rezerva: stari način
    meta(j);
    const first = j && Number.isInteger(j.firstBar) && j.firstBar > 0 ? j.firstBar : next;
    const counted = j && Number.isInteger(j.pageBars) && j.pageBars > 0 && j.pageBars <= 80 ? j.pageBars : 0;
    const have = new Map();
    const take = (bars, a, b) => {
      let k = a;
      for (const x of bars || []) {
        const n = Number.isInteger(x.n) && x.n > 0 ? x.n : k; k = n + 1;
        if (n < a || n > b) continue;
        if (Array.isArray(x.notes) && x.notes.length && (!have.has(n) || x.notes.length > have.get(n).notes.length)) have.set(n, { ...x, n });
      }
    };
    take(j && j.bars, first, first + (counted || 80) - 1);
    unsureOf(j, first, first + (counted || 80) - 1);
    let last = counted ? first + counted - 1 : Math.max(first - 1, ...have.keys());
    const missing = () => { const m = []; for (let n = first; n <= last; n++) if (!have.has(n)) m.push(n); return m; };
    // jedan dopunski zahtev za sve što fali (prekinut ili „lenj“ odgovor)
    if (missing().length && (j || !counted)) {
      const m = missing(), a = m[0], b = m[m.length - 1];
      onStatus?.('range', a, b, pi + 1, N);
      const jj = await ask(TAB_TEXT_PROMPT + TAB_TEXT_PAGE(pi + 1, N, first) + TAB_TEXT_RANGE(a, b), b - a + 1);
      if (jj) { meta(jj); take(jj.bars, a, b); unsureOf(jj, a, b); }
    } else if (!j && !counted) {
      // strana uopšte nije pročitana i ne zna se koliko taktova ima: još jedan pokušaj cele strane
      const jj = await ask(TAB_TEXT_PROMPT + TAB_TEXT_PAGE(pi + 1, N, next), 24);
      meta(jj); take(jj && jj.bars, next, next + 79); unsureOf(jj, next, next + 79);
      last = Math.max(last, ...have.keys());
    }
    // Muzička provera: takt koji Gemini označi „?“, sa nejasnim brojevima, dve note na istoj žici, trajanjima koja
    // ne staju u takt, ili sa mnogo manje/više kolona nego ostali taktovi na strani → JEDAN dodatni zahtev samo za
    // te taktove (pažljivo, broj po broj). Novo čitanje se uzima samo ako je čisto; inače ostaje prvo + napomena.
    const cols = (x) => new Set(x.notes.map((y) => y.start)).size;
    const read = [...have.values()].filter((x) => x.notes.length).sort((x, y) => x.n - y.n);
    const counts = read.map(cols).sort((x, y) => x - y), mode = counts.length >= 4 ? counts[counts.length >> 1] : 0;
    const odd = new Set(mode >= 3 ? read.filter((x) => x.n !== read[read.length - 1].n && (cols(x) * 2 < mode || cols(x) > mode * 2)).map((x) => x.n) : []);
    const doubt = read.filter((x) => x.doubt || odd.has(x.n)).map((x) => x.n);
    if (doubt.length && doubt.length <= 8 && left() > 25000) {
      onStatus?.('recheck', doubt.join(', '));
      const jj = await ask(TAB_TEXT_PROMPT + TAB_TEXT_PAGE(pi + 1, N, first) + TAB_TEXT_BARS(doubt), doubt.length, false, 60000);
      const fixed = new Set();
      for (const x of (jj && jj.bars) || []) {
        if (!doubt.includes(x.n) || x.doubt || !x.notes.length) continue;
        if (odd.has(x.n) && !have.get(x.n).doubt && Math.abs(cols(x) - mode) >= Math.abs(cols(have.get(x.n)) - mode) && cols(x) !== cols(have.get(x.n))) continue; // ništa bolje
        have.set(x.n, x); fixed.add(x.n);
      }
      if (diag) diag.recheck = [...(diag.recheck || []), { bars: doubt, fixed: [...fixed] }];
      out.unsure = out.unsure.filter((u) => !fixed.has(u.bar));
      for (const n of odd) if (!fixed.has(n) && !have.get(n).doubt) out.unsure.push({ bar: n, why: t('tab.doubt') });
    } else for (const n of odd) out.unsure.push({ bar: n, why: t('tab.doubt') });
    for (const n of missing()) { have.set(n, { n, notes: [] }); out.unsure.push({ bar: n, why: t('tab.notRead') }); }
    out.bars.push(...[...have.values()].sort((x, y) => x.n - y.n));
    next = Math.max(next, last + 1);
  }
  if (!out.bars.some((b) => b.notes.length)) {
    if (lastErr && lastErr.code === 'BUSY') throw new GeminiError(t('gem.busyAll'), { code: 'BUSY' });
    throw new GeminiError(anyAnswer ? t('gem.noTab') : t('gem.timeout'), anyAnswer ? {} : { code: 'TIMEOUT' });
  }
  out.sig = out.sig || '4/4';
  out.scanModel = model;
  return out;
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
