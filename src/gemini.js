// Google Gemini API — poziva se direktno iz pregledača sa korisnikovim ključem.
// Ključ se nikad ne nalazi u kodu; čuva se samo u IndexedDB na uređaju.
import { settings } from './db.js';
import { normalizeSong } from './songformat.js';

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export class GeminiError extends Error {}

export const getApiKey = () => settings.get('geminiKey', '');

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

Vrati ISKLJUČIVO JSON ovog oblika:
{ "title": "", "artist": "", "key": "", "sections": [ { "name": "", "lines": [ { "chords": [ { "chord": "Am", "position": 0 } ], "text": "" } ] } ] }`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    artist: { type: 'STRING' },
    key: { type: 'STRING' },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
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

async function call(apiKey, body, signal) {
  if (!apiKey) throw new GeminiError('Nisi uneo Gemini API ključ. Otvori „Podešavanja“ i unesi ključ.');
  if (navigator.onLine === false) throw new GeminiError('Nema internet veze. Skeniranje pesama radi samo kada si povezan na internet.');
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new GeminiError('Nije moguće povezati se sa Gemini servisom. Proveri internet vezu i pokušaj ponovo.');
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error.status)) || '';
    const reason = JSON.stringify(data && data.error && data.error.details || '');
    if (res.status === 400 && /API_KEY_INVALID|API key not valid/i.test(msg + reason)) throw new GeminiError('API ključ nije ispravan. Proveri da li si ga dobro kopirao u „Podešavanjima“.');
    if (res.status === 401 || res.status === 403) throw new GeminiError('Ključ nema dozvolu za Gemini API. Napravi novi ključ u Google AI Studio.');
    if (res.status === 429) throw new GeminiError('Dostignuto je ograničenje besplatne verzije. Sačekaj minut-dva i pokušaj ponovo.');
    if (res.status >= 500) throw new GeminiError('Gemini servis je trenutno preopterećen ili nedostupan. Pokušaj ponovo za malo.');
    if (res.status === 400 && /location|region|country/i.test(msg)) throw new GeminiError('Gemini API nije dostupan u tvojoj zemlji/regionu.');
    throw new GeminiError('Gemini je vratio grešku' + (msg ? `: ${msg}` : '.'));
  }
  return data;
}

function textOf(data) {
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) throw new GeminiError('Gemini je odbio da obradi sliku. Probaj sa drugom fotografijom.');
    throw new GeminiError('Gemini nije vratio odgovor. Pokušaj ponovo.');
  }
  return (cand.content && cand.content.parts || []).map((p) => p.text || '').join('');
}

/** Mali test poziv za proveru ključa. */
export async function testKey(apiKey) {
  const data = await call(apiKey, {
    contents: [{ parts: [{ text: 'Odgovori samo rečju: OK' }] }],
    generationConfig: { maxOutputTokens: 5, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
  });
  if (!data || !data.candidates) throw new GeminiError('Neočekivan odgovor od Gemini servisa.');
  return true;
}

/** Smanjuje sliku (max 2000px) i vraća { mime, base64 }. */
export async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new GeminiError('Slika ne može da se učita. Probaj drugu fotografiju (JPG ili PNG).'));
      i.src = url;
    });
    const max = 2000;
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
export async function scanSong(image, signal) {
  const apiKey = await getApiKey();
  const data = await call(apiKey, {
    contents: [{ parts: [{ text: SCAN_PROMPT }, { inline_data: { mime_type: image.mime, data: image.base64 } }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  }, signal);
  let text = textOf(data).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let json;
  try { json = JSON.parse(text); } catch { throw new GeminiError('Gemini nije vratio ispravan odgovor. Pokušaj ponovo ili slikaj jasnije.'); }
  try {
    return normalizeSong(json);
  } catch {
    throw new GeminiError('Na slici nije pronađena pesma. Slikaj papir izbliza, uz dobro osvetljenje.');
  }
}
