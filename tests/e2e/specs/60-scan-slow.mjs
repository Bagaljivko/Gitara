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
    if (how === 'slow') { await new Promise((r) => setTimeout(r, 6000)); return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([json]) }).catch(() => {}); }
    if (how === 'silent') { await new Promise((r) => setTimeout(r, 20000)); return route.abort().catch(() => {}); }
    if (how === 'cut') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([json.slice(0, 40)]).replace(/,"finishReason":"STOP"/, '') }).catch(() => {});
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([json.slice(0, 30), json.slice(30, 80), json.slice(80)]) }).catch(() => {});
  });
  const scan = (sel, firstMs = 2500) => p.evaluate(async ([sel, firstMs]) => {
    globalThis.__gitaraFirstMs = firstMs; globalThis.__gitaraIdleMs = 2500;
    const { settings } = await import('./src/db.js');
    await settings.set('geminiKey', 'AIzaTEST0000000000000000000000000000000'); await settings.set('geminiModel', sel); await settings.set('geminiLastModel', 'gemini-3.6-flash');
    const G = await import('./src/gemini.js'); G._coolForTests.clear(); // svaki slučaj od početka (bez „hlađenja“ iz prethodnog)
    const st = [], diag = { attempts: [] }, t0 = performance.now();
    try {
      const s = await G.scanSong([{ mime: 'image/jpeg', base64: 'AAAA' }], undefined, (k, m) => st.push(k + (m ? ':' + m : '')), diag);
      return { ok: true, title: s.title, model: s.scanModel, st, ms: performance.now() - t0, att: diag.attempts.map((a) => a.model + ' ' + a.status) };
    } catch (e) { return { ok: false, err: String(e.message || e), code: e.code, st, ms: performance.now() - t0, att: diag.attempts.map((a) => a.model + ' ' + a.status) }; }
  }, [sel, firstMs]);

  // 1) prvi model ćuti → posle ~2.5 s drugi model, pesma stiže
  plan = { 'gemini-3.6-flash': 'silent' }; asked.length = 0;
  let r = await scan('auto');
  expect(r.ok && r.title === 'Zakuni se', 'ćutljiv model: pesma nije stigla', r);
  expect(r.model !== 'gemini-3.6-flash' && r.ms < 12000, 'ćutljiv model nije zamenjen na vreme', r);
  expect(asked.every((a) => a.endsWith(':streamGenerateContent')), 'pesma se ne čita u delovima', asked);
  expect(r.st.includes('writing') && r.st.some((s) => s.startsWith('switch')), 'nema „piše…“ ili prelaska na drugi model', r.st);
  expect(r.st.lastIndexOf('writing') > r.st.lastIndexOf('reading'), '„čita…“ prepisalo „piše…“', r.st);

  // 1b) v2.5.70: prvi model spor (ćuti) → drugi kreće paralelno posle HEDGE_MS, a prvi se ne prekida; pobeđuje brži
  plan = { 'gemini-3.6-flash': 'slow' }; asked.length = 0;
  await p.evaluate(() => { globalThis.__gitaraHedgeMs = 1000; });
  r = await scan('auto', 60000);
  await p.evaluate(() => { globalThis.__gitaraHedgeMs = 0; });
  expect(r.ok && r.model !== 'gemini-3.6-flash' && r.ms < 5000, 'spor model: drugi nije krenuo paralelno', r);
  eq(asked.length, 2, 'paralelno: broj zahteva');

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


  // 5) v2.5.70: „Otkaži“ ostavlja izveštaj (otkazano posle X s); aplikacija zatvorena usred skeniranja → „prekinuto“
  plan = { 'gemini-3.6-flash': 'silent', 'gemini-3.5-flash': 'silent', 'gemini-2.5-flash': 'silent' };
  await p.evaluate(async () => {
    globalThis.__gitaraFirstMs = 60000;
    const c = document.createElement('canvas'); c.width = 400; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 500); g.fillStyle = '#000'; g.font = '30px serif'; g.fillText('G   D', 40, 100); g.fillText('tekst pesme', 40, 140);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    localStorage.removeItem('gitara-lastscan');
    (await import('./src/songEditor.js')).scanFiles([new File([blob], 'p.jpg', { type: 'image/jpeg' })]);
  });
  await p.waitForSelector('[data-a="scan"]', { timeout: 5000 }); await p.click('[data-a="scan"]');
  await p.waitForSelector('#scanCancel', { timeout: 5000 }); await p.waitForTimeout(2500);
  const running = await p.evaluate(() => !!localStorage.getItem('gitara-scanrun'));
  await p.click('#scanCancel'); await p.waitForTimeout(300);
  const rep = await p.evaluate(() => ({ last: JSON.parse(localStorage.getItem('gitara-lastscan') || 'null'), run: localStorage.getItem('gitara-scanrun') }));
  expect(running, 'nema zapisa „u toku“ dok skeniranje traje');
  expect(rep.last && /otkazano/.test(rep.last.text) && /Otkazano posle \d+ s/.test(rep.last.text), 'otkazano skeniranje bez izveštaja', rep);
  expect(!rep.run, 'zapis „u toku“ ostao posle otkazivanja');
  const cut = await p.evaluate(async () => {
    localStorage.removeItem('gitara-lastscan');
    localStorage.setItem('gitara-scanrun', JSON.stringify({ at: Date.now() - 200000, text: 'Vreme: x · kod: prekinuto' }));
    const D = await import('./src/diag.js'); const a = D.lastScan();
    localStorage.setItem('gitara-scanrun', JSON.stringify({ at: Date.now() - 5000, text: 'u toku' })); const b = D.lastScan();
    localStorage.removeItem('gitara-scanrun');
    return { a: a && a.text, b: b && b.text };
  });
  expect(/prekinuto/.test(cut.a || ''), 'prekinuto skeniranje se ne vidi u dijagnostici', cut);
  expect(!/u toku/.test(cut.b || ''), 'skeniranje koje još traje prikazano kao prekinuto', cut);
  await p.close();
}
