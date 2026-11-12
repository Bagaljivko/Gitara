// v2.3.2: obilasci — kratki prvi (telefon / računar), „Sve što MARLI ume“ (telefon / računar) i „Obilazak za nastavnike“.
// Spotlight na pravi element ekrana + panel (Korak n od N, Nazad / Dalje / Preskoči). Aplikacija sama prelazi na karticu.
// Obilazak za nastavnike radi na primer-podacima prikazanim u panelu — ništa se ne upisuje u tvoje podatke.
// Pamti se gde si stao; ponovo: Podešavanja → O aplikaciji.
import { getLang } from './i18n.js';
import { esc } from './ui.js';
import { TOURS } from './tourSteps.js';

const POS = 'marli-tour-pos', SEEN = 'gitara-tour';
const L = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? (getLang() === 'en' ? x.en ?? x.sr : x.sr) : x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isDesk = () => document.body.classList.contains('desk-shell') || (typeof matchMedia === 'function' && matchMedia('(min-width: 1100px) and (hover: hover) and (pointer: fine)').matches);
export const tourSeen = () => { try { return !!localStorage.getItem(SEEN); } catch { return true; } };
const UI = {
  step: { sr: 'Korak {n} od {m}', en: 'Step {n} of {m}' }, next: { sr: 'Dalje ›', en: 'Next ›' }, back: { sr: '‹ Nazad', en: '‹ Back' },
  skip: { sr: 'Preskoči', en: 'Skip' }, done: { sr: 'Gotovo', en: 'Done' }, ok: { sr: '✓ Već podešeno', en: '✓ Already set up' },
};
const fmt = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');

let cur = null; // { tour, steps, i, back, ctx }

/** Pokreni obilazak: 'first' | 'full' | 'teacher' (telefon/računar se bira sam). opts.resume = nastavi gde je stao. */
export async function startTour(kind = 'first', { resume = false } = {}) {
  stop(false);
  const dev = isDesk() ? 'desk' : 'phone';
  const id = kind === 'teacher' ? 'teacher' : `${kind}-${dev}`;
  const def = TOURS[id]; if (!def) return;
  const ctx = await context();
  const steps = def.filter((s) => !s.when || s.when(ctx));
  let i = 0;
  if (resume) { try { const p = JSON.parse(localStorage.getItem(POS) || 'null'); if (p && p.id === id && p.i < steps.length) i = p.i; } catch {} }
  const back = document.createElement('div');
  back.className = 'tg-back' + (dev === 'desk' ? ' desk' : '');
  back.innerHTML = '<div class="tg-shade"></div><div class="tg-hole" hidden></div><div class="tg-panel" role="dialog" aria-modal="true" aria-labelledby="tgTitle"></div>';
  document.body.appendChild(back);
  cur = { id, kind, steps, i, back, ctx, cleanup: [] };
  addEventListener('resize', place); addEventListener('keydown', onKey, true);
  await show();
}
/** Stanje uređaja / naloga za filtriranje i oznake „✓ Već podešeno“. */
async function context() {
  const ctx = { desk: isDesk(), level: '', key: false, sync: false, teacher: false, student: false, standalone: false };
  try { ctx.level = localStorage.getItem('marli-level') || ''; } catch {}
  try { const { settings } = await import('./db.js'); ctx.key = !!(await settings.get('geminiKey', '')); ctx.teacher = !!((await settings.get('teacher', null)) || {}).on; ctx.student = !!(await settings.get('myTeacher', null)); } catch {}
  try { ctx.sync = !!(await import('./sync.js')).syncState().on; } catch {}
  try { ctx.standalone = (await import('./install.js')).isStandalone(); } catch {}
  return ctx;
}
function onKey(e) { if (!cur) return; if (e.key === 'Escape') { e.preventDefault(); stop(true); } if (e.key === 'ArrowRight' && !/input|textarea/i.test(e.target.tagName)) go(1); if (e.key === 'ArrowLeft' && !/input|textarea/i.test(e.target.tagName)) go(-1); }
function stop(done) {
  if (!cur) return;
  const c = cur; cur = null;
  c.cleanup.forEach((f) => { try { f(); } catch {} });
  c.back.remove();
  removeEventListener('resize', place); removeEventListener('keydown', onKey, true);
  try { if (done) { localStorage.setItem(SEEN, '1'); localStorage.removeItem(POS); } } catch {}
}
async function go(d) {
  if (!cur) return;
  const s = cur.steps[cur.i];
  cur.cleanup.forEach((f) => { try { f(); } catch {} }); cur.cleanup = [];
  if (d > 0 && s.onNext) await s.onNext(cur.ctx);
  const n = cur.i + d;
  if (n >= cur.steps.length) { const fin = cur.steps[cur.i].finish; stop(true); if (fin) fin(); return; }
  if (n < 0) return;
  cur.i = n;
  try { localStorage.setItem(POS, JSON.stringify({ id: cur.id, i: cur.i })); } catch {}
  await show();
}
async function show() {
  const c = cur; if (!c) return;
  const s = c.steps[c.i], panel = c.back.querySelector('.tg-panel');
  if (s.route && location.hash !== s.route) { location.hash = s.route; await sleep(450); }
  if (s.open) { try { await s.open(); } catch {} await sleep(250); }
  if (cur !== c) return;
  const n = c.i + 1, m = c.steps.length, last = c.i === m - 1;
  const done = s.done && s.done(c.ctx);
  const bar = m <= 12 ? `<span class="tg-dots">${c.steps.map((_, k) => `<i class="${k === c.i ? 'on' : k < c.i ? 'past' : ''}"></i>`).join('')}</span>` : `<span class="tg-prog"><i style="width:${Math.round((n / m) * 100)}%"></i></span>`;
  panel.innerHTML = `<div class="tg-top"><span class="tg-step">${esc(L(s.label) || fmt(L(UI.step), { n, m }))}</span>${bar}</div>
    ${s.badge ? `<div class="tg-badge">${esc(L(s.badge))}</div>` : ''}
    <h2 id="tgTitle">${s.ic ? `<span class="tg-ic" aria-hidden="true">${s.ic}</span>` : ''}${esc(L(s.title))}</h2>
    ${done ? `<div class="tg-ok">${esc(L(UI.ok))}</div>` : ''}
    <div class="tg-body">${L(s.html) || ''}</div>
    ${s.demo ? `<div class="tg-demo">${L(s.demo)}</div>` : ''}
    ${s.choices ? `<div class="tg-choices">${s.choices.map((ch, k) => `<button type="button" class="tg-choice" data-ch="${k}">${ch.ic ? `<span class="ic">${ch.ic}</span>` : ''}<span><b>${esc(L(ch.label))}</b>${ch.sub ? `<small>${esc(L(ch.sub))}</small>` : ''}</span></button>`).join('')}</div>` : ''}
    ${s.live ? `<div class="tg-live"><button type="button" class="btn tg-mic">🎤 ${esc(L({ sr: 'Uključi mikrofon', en: 'Turn on the microphone' }))}</button><span class="tg-meter"><i></i></span><b class="tg-heard"></b></div>` : ''}
    ${s.actions && !done ? `<div class="tg-acts">${s.actions.map((a, k) => `<button type="button" class="btn${a.primary ? ' primary' : ''}" data-act="${k}">${esc(L(a.label))}</button>`).join('')}</div>` : ''}
    <div class="tg-bar">${last ? '' : `<button type="button" class="tg-skip">${esc(L(UI.skip))}</button>`}<span class="sp"></span>${c.i ? `<button type="button" class="btn tg-prev">${esc(L(UI.back))}</button>` : ''}${s.choices && s.choiceOnly ? '' : `<button type="button" class="btn primary tg-next">${esc(L(last ? (s.doneLabel || UI.done) : UI.next))}</button>`}</div>`;
  panel.querySelector('.tg-skip')?.addEventListener('click', () => stop(true));
  panel.querySelector('.tg-prev')?.addEventListener('click', () => go(-1));
  panel.querySelector('.tg-next')?.addEventListener('click', () => go(1));
  // dok radnja otvara svoj prozor (nalepi link, Google prijava…) obilazak se skloni, pa se vrati
  const aside = async (fn) => { c.back.hidden = true; try { await fn(); } catch {} finally { c.back.hidden = false; } };
  panel.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', async () => { const ch = s.choices[+b.dataset.ch]; if (ch.run) await aside(() => ch.run(c.ctx)); if (cur === c) go(ch.stay ? 0 : 1); }));
  panel.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => { const a = s.actions[+b.dataset.act]; await aside(() => a.run(c.ctx, panel)); if (a.next && cur === c) go(1); else if (cur === c && a.refresh) { c.ctx = await context(); show(); } }));
  if (s.live) panel.querySelector('.tg-mic')?.addEventListener('click', (e) => { e.currentTarget.hidden = true; startLive(s.live, panel); });
  if (s.target) await waitFor(s.target, 2500);
  if (cur !== c) return;
  place();
  panel.querySelector('.tg-next, .tg-choice, [data-act]')?.focus({ preventScroll: true });
}
async function waitFor(sel, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const e = document.querySelector(sel); if (e && e.getBoundingClientRect().width) return e; await sleep(100); } return null; }
/** Rupa oko cilja + panel na suprotnoj strani (gore ili dole); bez cilja panel je u sredini. */
function place() {
  if (!cur) return;
  const s = cur.steps[cur.i], hole = cur.back.querySelector('.tg-hole'), panel = cur.back.querySelector('.tg-panel'), shade = cur.back.querySelector('.tg-shade');
  const el = s.target ? document.querySelector(s.target) : null;
  panel.style.top = panel.style.bottom = '';
  panel.classList.remove('top', 'bottom', 'mid');
  if (el) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect(), pad = 6;
    hole.hidden = false; shade.hidden = true;
    Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const below = r.top + r.height / 2 < innerHeight / 2;
    panel.classList.add(below ? 'bottom' : 'top');
  } else { hole.hidden = true; shade.hidden = false; panel.classList.add('mid'); }
}
// Mikrofon: jačina zvuka („čujem te ✓“) ili prepoznavanje note E („Tačno! ✓“)
async function startLive(kind, panel) {
  const c = cur;
  let A; try { A = await import('./audio.js'); } catch { return; }
  let mic;
  try { mic = await A.openMic(); } catch (e) { const h = panel.querySelector('.tg-heard'); if (h) h.textContent = (e && e.message) || 'Mikrofon nije dostupan'; return; }
  if (cur !== c) { A.closeMic(); return; }
  const an = mic.ctx.createAnalyser(); an.fftSize = 4096; mic.source.connect(an);
  const buf = new Float32Array(an.fftSize);
  let raf = 0, okFor = 0, last = performance.now(), hit = false;
  const meter = panel.querySelector('.tg-meter i'), heard = panel.querySelector('.tg-heard');
  const loop = () => {
    an.getFloatTimeDomainData(buf);
    const lv = A.rms(buf), now = performance.now(), dt = now - last; last = now;
    if (meter) meter.style.transform = `scaleX(${Math.min(1, lv * 12).toFixed(2)})`;
    if (kind === 'level') {
      okFor = lv > 0.015 ? okFor + dt : Math.max(0, okFor - dt);
      if (okFor > 300 && !hit) { hit = true; heard.textContent = L({ sr: 'Čujem te ✓', en: 'I can hear you ✓' }); heard.classList.add('ok'); }
    } else if (lv > 0.01 && !hit) {
      const f = A.yin(buf, mic.ctx.sampleRate);
      if (f > 0) {
        const midi = 69 + 12 * Math.log2(f / 440), pc = ((Math.round(midi) % 12) + 12) % 12;
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'H', 'C'];
        if (pc === 4 && Math.abs(midi - Math.round(midi)) < 0.45) { okFor += dt; if (okFor > 250) { hit = true; heard.textContent = L({ sr: 'Tačno! To je E ✓', en: 'Correct! That is E ✓' }); heard.classList.add('ok'); } }
        else { okFor = 0; heard.textContent = L({ sr: `Čujem ${names[pc]} — probaj praznu E žicu`, en: `I hear ${names[pc]} — try the open E string` }); }
      }
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
  c.cleanup.push(() => { cancelAnimationFrame(raf); try { mic.source.disconnect(an); } catch {} A.closeMic(); });
}
/** Za testove i „Obilazak“ u O aplikaciji. */
export const tourRunning = () => (cur ? { id: cur.id, i: cur.i, n: cur.steps.length } : null);
