// MARLI browser testovi (e2e): zajednički alati. Pokretanje: node tests/e2e/run.mjs (vidi README.md ovde).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const { chromium, devices } = require('playwright');

/** Uređaji na kojima se aplikacija proverava (telefon, telefon položeno, tablet uspravno/položeno, računar). */
export const DEVICES = {
  phone: { ...devices['Pixel 7'] },
  phoneLand: { viewport: { width: 851, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tabPort: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tabLand: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desk: { viewport: { width: 1440, height: 900 } },
};

export class Fail extends Error { constructor(msg, detail) { super(msg); this.detail = detail; } }
/** Provera: ako uslov nije ispunjen, test pada sa porukom i detaljima. */
export function expect(cond, msg, detail) { if (!cond) throw new Fail(msg, detail); }
export const eq = (a, b, msg) => expect(JSON.stringify(a) === JSON.stringify(b), `${msg}: očekivano ${JSON.stringify(b)}, dobijeno ${JSON.stringify(a)}`);

/**
 * Nova stranica na uređaju. Podrazumevano: obilazak viđen, nema saveta pri prvoj poseti, „Šta je novo“ viđeno.
 * opts: { fresh: true } — kao potpuno nov korisnik; { hints: true } — saveti uključeni; { lang: 'en' }; { init: fn, arg }
 */
export async function open(ctx, dev = 'phone', opts = {}) {
  const c = await ctx.browser.newContext({ ...DEVICES[dev], serviceWorkers: 'block' });
  await c.addInitScript((o) => {
    if (!o.fresh) { localStorage.setItem('gitara-tour', '1'); localStorage.setItem('gitara-upgraded', '9'); localStorage.setItem('marli-seen-ver', o.ver); localStorage.setItem('marli-fs-off', 'test'); }
    if (o.lang) localStorage.setItem('gitara-lang', o.lang);
    if (!o.hints) window.__marliTest = { ...(window.__marliTest || {}), noHints: true };
  }, { fresh: !!opts.fresh, hints: !!opts.hints, lang: opts.lang || '', ver: ctx.ver });
  if (opts.init) await c.addInitScript(opts.init, opts.arg);
  const p = await c.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::|youtube|googleapis|google\.com|gstatic|Failed to load resource/i.test(m.text())) p.errs.push('console: ' + m.text().slice(0, 200)); });
  p.go = async (hash, wait = 900) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(wait); };
  ctx.opened.push(c);
  return p;
}

/** Učita aplikaciju i čeka da se pokrene. */
export async function boot(p, ctx, hash = '#/tuner', wait = 900) { await p.goto(ctx.base + hash); await p.waitForTimeout(wait); }

/** Pesma sa akordima (više delova) — vraća id. */
export async function addSong(p, o = {}) {
  return p.evaluate(async (o) => {
    const { songs } = await import('./src/db.js');
    const C = o.chords || ['G', 'D', 'Em', 'C'];
    const lines = o.lines || 6, secs = o.sections || 2;
    const sections = Array.from({ length: secs }, (_, s) => ({ name: s % 2 ? 'Refren' : 'Strofa ' + (s / 2 + 1), type: s % 2 ? 'chorus' : 'verse',
      lines: Array.from({ length: lines }, (_, l) => ({ text: o.text ? o.text(l, s) : `Ovo je stih broj ${l + 1} u delu ${s + 1} pesme`, chords: [0, 12, 24].map((pos, k) => ({ pos, position: pos, chord: C[(l + k) % C.length] })) })) }));
    const s = await songs.save({ title: o.title || 'Pesma', artist: o.artist || 'Izvođač', key: o.key, bpm: o.bpm || 90, strum: o.strum === null ? undefined : (o.strum || { id: 'pop', sig: '4/4', steps: 'D-DUD-DU' }), sections, ...(o.extra || {}) });
    return s.id;
  }, { ...o, text: undefined, hasText: !!o.text });
}
export async function addSongs(p, n, base = {}) {
  return p.evaluate(async ({ n, base }) => {
    const { songs } = await import('./src/db.js'); const ids = []; const C = ['G', 'D', 'Em', 'C', 'Am', 'F', 'E', 'A'];
    for (let i = 0; i < n; i++) {
      const s = await songs.save({ title: (base.title || 'Pesma') + ' ' + String(i).padStart(3, '0'), artist: ['Bijelo Dugme', 'Riblja Čorba', 'EKV', 'Azra', 'Bajaga'][i % 5], bpm: 80 + (i % 40), strum: { id: 'pop', sig: '4/4', steps: 'D-DUD-DU' },
        sections: [{ name: 'Strofa', type: 'verse', lines: Array.from({ length: base.lines || 4 }, (_, l) => ({ text: `Stih ${l + 1} pesme ${i}`, chords: [{ pos: 0, position: 0, chord: C[(i + l) % 8] }, { pos: 8, position: 8, chord: C[(i + l + 1) % 8] }] })) }] });
      ids.push(s.id);
    }
    return ids;
  }, { n, base });
}

/** Elementi koji izlaze desno van ekrana (a nisu u delu koji se namerno pomera vodoravno). */
export function overflowCheck(p) {
  return p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll('body *')].filter((e) => {
      const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0 && r.right > W + 2)) return false;
      const cs = getComputedStyle(e); if (cs.position === 'fixed' || cs.visibility === 'hidden') return false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o !== 'visible') return false; }
      return true;
    });
    return { page: document.scrollingElement.scrollWidth > W + 1, items: bad.slice(0, 5).map((e) => (e.id ? '#' + e.id : (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : e.tagName)) + '@' + Math.round(e.getBoundingClientRect().right)) };
  });
}

/** Tekst ključa umesto prevoda (npr. „pr.title“) vidljiv na ekranu. */
export function rawKeys(p) {
  return p.evaluate(() => {
    const rx = /^(?:[a-z][a-zA-Z]{1,8}\.){1,3}[a-zA-Z0-9]{2,}$/; const r = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const s = n.textContent.trim(); if (rx.test(s) && !/\.(js|com|org|net|rs|io|ai|png|pdf|gitara|mp3)$/i.test(s) && n.parentElement && n.parentElement.offsetParent) r.push(s); }
    return r.slice(0, 8);
  });
}

/** Merni podaci: čvorovi i osluškivači (posle čišćenja memorije). */
export async function metrics(p) {
  const cdp = await p.context().newCDPSession(p); await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage'); await p.waitForTimeout(250);
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  await cdp.detach(); return { nodes: m.Nodes, listeners: m.JSEventListeners, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1) };
}
export async function throttle(p, rate) { const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate }); return cdp; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lažni mikrofon za igre: getUserMedia vraća zvuk iz Web Audio (ton sa višim harmonicima, kao žica).
 * U stranici: window.__tone(midi) svira notu, window.__tone(null) tišina.
 */
export function fakeMic() {
  const orig = navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c || !c.audio) return orig(c);
    const ac = new AudioContext(); await ac.resume().catch(() => {});
    const out = ac.createMediaStreamDestination(); const g = ac.createGain(); g.gain.value = 0; g.connect(out);
    const oscs = [1, 2, 3].map((h, i) => { const o = ac.createOscillator(); const gg = ac.createGain(); gg.gain.value = [0.6, 0.25, 0.12][i]; o.connect(gg); gg.connect(g); o.start(); return { o, h }; });
    window.__tone = (midi) => {
      const t = ac.currentTime;
      if (midi == null) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.01); return; }
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      oscs.forEach(({ o, h }) => o.frequency.setValueAtTime(f * h, t));
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.005); g.gain.setTargetAtTime(0.25, t + 0.05, 0.3);
    };
    window.__micReady = true;
    return out.stream;
  };
}

/** Isti modul koji je aplikacija učitala (objavljena kopija ima ?v=… u adresi — drugi uvoz bi bio druga kopija modula). */
export function appModule(p, name) {
  return p.evaluateHandle((name) => { const u = performance.getEntriesByType('resource').map((r) => r.name).find((x) => x.includes('/src/' + name)); return import(u || './src/' + name); }, name);
}

/**
 * Lažni Google Drive za nastavu (sanduče, napredak): pisanje ide u memoriju stranice (__marliTest.putData),
 * čitanje javnih fajlova ide iz zajedničkog skladišta testa (drive), pa dva pregledača razmenjuju fajlove.
 */
export async function fakeDrive(p, drive) {
  await p.exposeFunction('__drivePut', (k, v) => { drive[k] = v; });
  await p.addInitScript(() => { let n = 0; window.__marliTest = { ...(window.__marliTest || {}), putData: async (id, text) => { const k = id || 'F' + Date.now().toString(36) + (n++); await window.__drivePut(k, text); return k; } }; });
  await p.route(/googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media/, (r) => { const id = decodeURIComponent(/files\/([^?]+)/.exec(r.request().url())[1]); const v = drive[id]; return v ? r.fulfill({ status: 200, contentType: 'application/json', body: v }) : r.fulfill({ status: 404, body: '' }); });
  p.pullDrive = async () => {};
}
