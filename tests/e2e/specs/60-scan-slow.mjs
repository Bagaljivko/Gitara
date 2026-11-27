// v2.5.69: skeniranje pesme kad Gemini ćuti (u špicu ponekad po minut): odgovor stiže u delovima, model koji ne napiše
// ni slovo za FIRST_MS se zamenjuje drugim (automatski izbor modela), odgovor presečen na pola → drugi model,
// status „Gemini piše…“ čim tekst krene; izabran model (ne automatski) se ne menja.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'Skeniranje: model koji ćuti → drugi model, presečen odgovor, „piše…“';
export const timeout = 90;

const SONG = { title: 'Zakuni se', artist: 'S. Krila', key: 'G', sections: [{ name: 'Strofa', lines: [{ text: 'Zakuni se ljubavi na ranjenu noć', chords: [{ position: 0, chord: 'G' }, { position: 11, chord: 'D' }] }] }] };
const sse = (parts) => parts.map((t, i) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, ...(i === parts.length - 1 ? { finishReason: 'STOP' } : {}) }] })}\r\n\r\n`).join('');

export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/pesme', 900);
  const asked = [];
  // ponašanje po modelu: 'silent' = ne odgovara nikad, 'cut' = pola JSON-a pa stane, 'ok' = cela pesma u 3 dela
  let plan = {};
  await p.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const u = route.request().url();
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }) });
    const m = /models\/([^:]+):(\w+)/.exec(u); asked.push(m[1] + ':' + m[2]);
    const how = plan[m[1]] || 'ok';
    const json = JSON.stringify(SONG);
    if (how === 'silent') { await new Promise((r) => setTimeout(r, 20000)); return route.abort().catch(() => {}); }
    if (how === 'cut') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([json.slice(0, 40)]).replace(/,"finishReason":"STOP"/, '') }).catch(() => {});
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([json.slice(0, 30), json.slice(30, 80), json.slice(80)]) }).catch(() => {});
  });
  const scan = (sel) => p.evaluate(async (sel) => {
    globalThis.__gitaraFirstMs = 2500; globalThis.__gitaraIdleMs = 2500;
    const { settings } = await import('./src/db.js');
    await settings.set('geminiKey', 'AIzaTEST0000000000000000000000000000000'); await settings.set('geminiModel', sel); await settings.set('geminiLastModel', 'gemini-3.6-flash');
    const G = await import('./src/gemini.js');
    const st = [], diag = { attempts: [] }, t0 = performance.now();
    try {
      const s = await G.scanSong([{ mime: 'image/jpeg', base64: 'AAAA' }], undefined, (k, m) => st.push(k + (m ? ':' + m : '')), diag);
      return { ok: true, title: s.title, model: s.scanModel, st, ms: performance.now() - t0, att: diag.attempts.map((a) => a.model + ' ' + a.status) };
    } catch (e) { return { ok: false, err: String(e.message || e), code: e.code, st, ms: performance.now() - t0, att: diag.attempts.map((a) => a.model + ' ' + a.status) }; }
  }, sel);

  // 1) prvi model ćuti → posle ~2.5 s drugi model, pesma stiže
  plan = { 'gemini-3.6-flash': 'silent' }; asked.length = 0;
  let r = await scan('auto');
  expect(r.ok && r.title === 'Zakuni se', 'ćutljiv model: pesma nije stigla', r);
  expect(r.model !== 'gemini-3.6-flash' && r.ms < 12000, 'ćutljiv model nije zamenjen na vreme', r);
  expect(asked.every((a) => a.endsWith(':streamGenerateContent')), 'pesma se ne čita u delovima', asked);
  expect(r.st.includes('writing') && r.st.some((s) => s.startsWith('switch')), 'nema „piše…“ ili prelaska na drugi model', r.st);
  expect(r.st.lastIndexOf('writing') > r.st.lastIndexOf('reading'), '„čita…“ prepisalo „piše…“', r.st);

  // 2) odgovor presečen na pola → drugi model (ne „neispravan odgovor“)
  plan = { 'gemini-3.6-flash': 'cut' }; asked.length = 0;
  r = await scan('auto');
  expect(r.ok && r.title === 'Zakuni se' && r.model !== 'gemini-3.6-flash', 'presečen odgovor nije pokušan kod drugog modela', r);

  // 3) sve radi → prvi model, bez prelaska
  plan = {}; asked.length = 0;
  r = await scan('auto');
  expect(r.ok && r.model === 'gemini-3.6-flash' && !r.st.some((s) => s.startsWith('switch')), 'normalno skeniranje promenilo model', r);
  eq(asked.length, 1, 'normalno skeniranje: broj zahteva');

  // 4) izabran model (ne automatski): kratak rok se ne primenjuje — ne odustaje posle 2.5 s
  plan = {}; asked.length = 0;
  r = await scan('gemini-3.5-flash');
  expect(r.ok && r.model === 'gemini-3.5-flash', 'izabran model ne radi', r);

  await p.close();
}
