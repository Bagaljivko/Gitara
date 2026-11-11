// v2.1: Vežbe → „Ritam i promene“ — drži zadati ritam i menjaj akorde na vreme, korak po korak.
// Koraci: svaki akord sam (samo ritam) → promene na 4 takta → na 2 → na svaki takt → ceo niz na ciljnom tempu.
// Sledeći korak se otvara posle čistih rundi. Dve ocene: promene (na vreme + čuje se akord) i ritam (svaki udarac
// na vreme; gore/dole mikrofon ne može da razlikuje — strelice su da znaš kako).
// Izvori: nastavnik (akordi po imenu, hvat po želji, ritam, koliko rundi po koraku, cilj tempo — stiže kroz sanduče),
// „Napravi mi“ (lestvica od 4 vežbe, svaka dodaje jednu novu stvar), „Iz pesme“ (akordi, ritam i tempo pesme).
// Vežbe se čuvaju u settings 'rpList' (sinhronizuje se); napredak vežbe od nastavnika ide nastavniku (fajl napretka).
import { strum } from './synth.js';
import { chordNotes, PATTERNS, patternName } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { dn } from './naming.js';
import { esc } from './ui.js';
import { getVoicings } from './chords.js';
import { trackGame, chordItem, chordFingers } from './practiceTrack.js';
import { checkChord } from './pChords.js';
import * as CS from './chordSeq.js';
import { settings, events } from './db.js';
import { t as tt } from './i18n.js';

const KEY = 'rpList', LS = 'marli-rp';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clip = (s, n) => String(s || '').trim().slice(0, n);
const r5 = (v) => Math.round(v / 5) * 5;
const clampB = (v, d) => Math.max(40, Math.min(200, Math.round(Number(v) || d)));
const PAT = (id) => PATTERNS.find((p) => p.id === id && p.sig === '4/4');
/** Ritmovi za ovu vežbu (uvek neki obrazac — „samo na 1“ je Promena akorda). */
export const RP_RHYTHMS = ['downs', 'slowpop', 'eighths', 'folk', 'pop', 'ballad44', 'rock', 'reggae', 'boomchick'].filter((id) => PAT(id));
const STEPS_RE = /^[DUx-]{4,16}$/;
/** Obrazac (koraci „D-DU-UDU“) za id ili sopstveni obrazac iz pesme. */
export const stepsOf = (ex) => (ex.steps && STEPS_RE.test(ex.steps) ? ex.steps : (PAT(ex.rhythm) || PAT('downs')).steps);
export const arrows = (steps) => steps.split('').map((c) => (c === 'D' ? '↓' : c === 'U' ? '↑' : c === 'x' ? '×' : ' ')).join('').replace(/ +/g, ' ').trim();
export const rhythmName = (ex) => (ex.steps && !ex.rhythm ? tt('rp.songRhythm') : patternName(PAT(ex.rhythm) || PAT('downs')));
const chordsLabel = (ex) => ex.chords.map((x) => dn(x.c)).join(' – ');

// ---------------- podaci ----------------
export async function list() { return ((await settings.get(KEY, [])) || []).filter((x) => x && x.id && Array.isArray(x.chords)); }
async function put(arr) { await settings.set(KEY, arr.slice(0, 120)); }
export async function getEx(id) { return (await list()).find((x) => x.id === id) || null; }
export async function saveEx(ex) { const all = await list(); await put([ex, ...all.filter((x) => x.id !== ex.id)]); return ex; }
export async function removeEx(id) { await put((await list()).filter((x) => x.id !== id)); }
const PLAN0 = { solo: 2, b16: 3, b8: 3, b4: 0, fin: 2 };
/** Očisti vežbu iz bilo kog izvora (sanduče, sinhronizacija, graditelj). */
export function cleanRp(x) {
  if (!x || typeof x !== 'object') return null;
  const chords = (Array.isArray(x.chords) ? x.chords : []).slice(0, 8).map((c) => (typeof c === 'string' ? { c } : c)).filter((c) => c && CS.known(c.c))
    .map((c) => { const n = getVoicings(c.c).length; const v = Math.max(0, Math.min(n - 1, Math.round(Number(c.v) || 0))); return v ? { c: clip(c.c, 10), v } : { c: clip(c.c, 10) }; });
  if (!chords.length) return null;
  const p = x.plan || {}; const k = (v, d) => Math.max(0, Math.min(6, Math.round(Number(v ?? d) || 0)));
  const plan = { solo: k(p.solo, PLAN0.solo), b16: k(p.b16, PLAN0.b16), b8: k(p.b8, PLAN0.b8), b4: k(p.b4, PLAN0.b4), fin: Math.max(1, k(p.fin, PLAN0.fin)) };
  if (chords.length < 2) { plan.b16 = plan.b8 = plan.b4 = 0; }
  const target = clampB(x.target, 80), start = Math.min(target, clampB(x.start, Math.max(50, target - 20)));
  const src = ['t', 'gen', 'song', 'me', 'sent'].includes(x.src) ? x.src : 'me';
  const out = { id: clip(x.id, 40) || uid(), name: clip(x.name, 60), chords, rhythm: RP_RHYTHMS.includes(x.rhythm) ? x.rhythm : (x.steps && STEPS_RE.test(x.steps) ? '' : 'downs'), plan, start, target, src, at: Number(x.at) || Date.now() };
  if (!out.rhythm && x.steps) out.steps = String(x.steps);
  if (x.fromT) out.fromT = { tid: clip(x.fromT.tid, 40), name: clip(x.fromT.name, 60) };
  if (x.song && x.song.id) out.song = { id: clip(x.song.id, 60), title: clip(x.song.title, 80), artist: clip(x.song.artist, 60), sec: clip(x.song.sec, 40) };
  if (Array.isArray(x.pair) && x.pair.length === 2 && x.pair.every(CS.known)) out.pair = x.pair.map((c) => clip(c, 10));
  if (Array.isArray(x.to)) out.to = x.to.map((s) => clip(s, 40)).slice(0, 60);
  if (x.gen) out.gen = clip(x.gen, 20);
  const pr = x.prog || {};
  out.prog = { step: Math.max(0, Math.round(Number(pr.step) || 0)), clean: Array.isArray(pr.clean) ? pr.clean.map((n) => Math.max(0, Math.round(Number(n) || 0))).slice(0, 12) : [] };
  return out;
}
/** Učenik: vežba stigla od nastavnika (isti id = izmena; napredak ostaje ako se akordi nisu promenili). */
export async function receive(raw, fromT) {
  const old = await getEx(raw && raw.id);
  const ex = cleanRp({ ...raw, src: 't', fromT, prog: old && chordsLabel(old) === (raw.chords || []).map((c) => dn(c.c || c)).join(' – ') ? old.prog : null });
  if (!ex) return null;
  await saveEx(ex);
  return ex;
}

// ---------------- koraci ----------------
const everyLabel = (b) => tt(b === 16 ? 'rp.e16' : b === 8 ? 'rp.e8' : 'rp.e4');
/** Koraci vežbe: [{ k, n, every, from, to, chords }] — svaka sledeća dodaje jednu stvar. */
export function stepsList(ex) {
  const uniq = [...new Set(ex.chords.map((x) => x.c))];
  const S = [], P = ex.plan;
  if (P.solo) S.push({ k: 'solo', n: P.solo * uniq.length, every: 16, chords: uniq.map((c) => ex.chords.find((x) => x.c === c)) });
  if (ex.pair) S.push({ k: 'pair', n: 3, every: 8, chords: ex.pair.map((c) => ex.chords.find((x) => x.c === c) || { c }) });
  const chg = [[16, P.b16], [8, P.b8], [4, P.b4]].filter(([, n]) => n > 0 && ex.chords.length >= 2);
  const L = ex.chords.length;
  chg.forEach(([every, n], i) => { const cnt = chg.length === 1 ? L : Math.round(2 + ((L - 2) * i) / (chg.length - 1)); S.push({ k: 'chg', n, every, chords: ex.chords.slice(0, Math.max(2, cnt)) }); });
  const lastEvery = chg.length ? chg[chg.length - 1][0] : ex.song ? 4 : 8;
  if (ex.chords.length >= 2) S.push({ k: 'full', n: P.fin, every: lastEvery, chords: ex.chords });
  // tempo: samo ritam na početnom; promene postepeno ka cilju; poslednji korak ide do cilja
  const ramp = S.filter((s) => s.k === 'pair' || s.k === 'chg' || s.k === 'full'); const m = ramp.length, a = ex.start, b = ex.target;
  S.forEach((s) => { if (s.k === 'solo') { s.from = s.to = a; return; } const i = ramp.indexOf(s); s.from = r5(a + ((b - a) * i) / m); s.to = i === m - 1 ? b : r5(a + ((b - a) * (i + 1)) / m); if (s.to < s.from) s.to = s.from; });
  if (ex.song) S.push({ k: 'video', n: 1 });
  return S;
}
const stepBpm = (s, c) => (s.n <= 1 || s.from === s.to ? s.to : r5(s.from + ((s.to - s.from) * Math.min(c, s.n - 1)) / (s.n - 1)));
export function stepTitle(ex, s) {
  const arrow = (q) => q.map((x) => dn(x.c)).join(' → ');
  if (s.k === 'solo') return s.chords.length === 1 ? tt('rp.st.solo1', { c: dn(s.chords[0].c) }) : tt('rp.st.solo');
  if (s.k === 'pair') return tt('rp.st.pair', { a: dn(s.chords[0].c), b: dn(s.chords[1].c) });
  if (s.k === 'chg') return `${arrow(s.chords)} ${everyLabel(s.every)}`;
  if (s.k === 'full') return ex.song ? `${ex.song.sec || tt('rp.st.sec')}: ${s.chords.map((x) => dn(x.c)).join(' ')}` : tt('rp.st.full', { bpm: s.to });
  return tt('rp.st.video');
}
export function stepSub(ex, s) {
  const bp = s.from === s.to ? `${s.to} BPM` : `${s.from} → ${s.to} BPM`;
  if (s.k === 'solo') return s.chords.length === 1 ? `${tt('rp.bars4')} · ${bp}` : `${s.chords.map((x) => dn(x.c)).join(', ')} · ${bp}`;
  if (s.k === 'pair') return `${everyLabel(s.every).replace(/^na /, '')} · ${bp}`;
  if (s.k === 'chg') return `${tt('rp.onOne')} · ${bp}`;
  if (s.k === 'full') return ex.song ? `${tt('rp.inOrder')} · ${bp}` : ex.fromT ? tt('rp.goalT') : tt('rp.goal');
  return tt('rp.opensVideo');
}
/** Napredak: koliko čistih rundi u svakom koraku; korak je završen kad ima n čistih. */
export function progressOf(ex) {
  const S = stepsList(ex); const clean = ex.prog.clean || [];
  const cur = Math.min(S.length - 1, ex.prog.step || 0);
  const done = (ex.prog.step || 0) >= S.length || (S[S.length - 1].k === 'video' && (ex.prog.step || 0) >= S.length - 1 && clean[S.length - 1] >= 1);
  return { S, clean, cur, done };
}

// ---------------- „Napravi mi“: lestvica (svaka sledeća dodaje samo jednu novu stvar) ----------------
const LADDERS = [
  [{ g: 'gc', ch: ['G', 'C'], rh: 'downs', bpm: 60, d: 'rp.gen.d1' }, { g: 'gcd', ch: ['G', 'C', 'D'], rh: 'eighths', bpm: 70, d: 'rp.gen.d2' }, { g: 'emcgd', ch: ['Em', 'C', 'G', 'D'], rh: 'pop', bpm: 80, d: 'rp.gen.d3' }],
  [{ g: 'ame', ch: ['Am', 'E'], rh: 'downs', bpm: 60, d: 'rp.gen.d1' }, { g: 'dag', ch: ['D', 'A', 'G'], rh: 'eighths', bpm: 70, d: 'rp.gen.d2b' }, { g: 'camfg', ch: ['C', 'Am', 'F', 'G'], rh: 'pop', bpm: 80, d: 'rp.gen.d3b' }],
];
export async function ladder(alt = 0) {
  const base = LADDERS[alt % LADDERS.length].map((x) => ({ ...x }));
  // 4.: tvoja najteža promena (iz akorda tvojih pesama), u ritmu sa pauzom
  let lib = []; try { lib = (await CS.libraryChords(10)).filter(CS.known); } catch {}
  let pair = alt % 2 ? ['C', 'F'] : ['Am', 'F'];
  if (lib.length >= 2) { const h = CS.hardest(CS.cleanSeq(lib.slice(0, 8), 4)); if (h) pair = [h.a, h.b]; }
  base.push({ g: 'hard-' + pair.join(''), ch: pair, rh: 'folk', bpm: 70, d: 'rp.gen.d4', hard: pair });
  return base;
}
const genEx = (x) => cleanRp({ id: 'gen-' + x.g, name: x.ch.map(dn).join(' – '), chords: x.ch, rhythm: x.rh, start: Math.max(50, x.bpm - 10), target: x.bpm, src: 'gen', gen: x.g, plan: { solo: 1, b16: x.ch.length > 2 ? 2 : 2, b8: 2, b4: x.ch.length > 2 ? 0 : 0, fin: 2 } });

// ---------------- „Iz pesme“ ----------------
async function fromSong(t) {
  const { songs } = await import('./db.js'); const { dialog, toast } = await import('./ui.js');
  const lib = (await songs.all()).filter((s) => !s.deleted && !s.demo && (s.sections || []).some((x) => (x.lines || []).some((l) => (l.chords || []).length))).sort((a, b) => String(a.title).localeCompare(String(b.title), 'sr'));
  if (!lib.length) { toast(t('ex.noSongs')); return null; }
  const id = await dialog({ title: t('ex.pickSong'), className: 'dlg-stack', buttons: [...lib.slice(0, 60).map((s) => ({ label: s.title + (s.artist ? ' — ' + s.artist : ''), value: s.id })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
  const song = lib.find((s) => s.id === id); if (!song) return null;
  const secs = (song.sections || []).map((sec, i) => ({ name: sec.name || t('ex.part', { n: i + 1 }), ch: (sec.lines || []).flatMap((l) => [...(l.chords || [])].sort((a, b) => a.position - b.position).map((c) => c.chord)).filter(CS.known) })).filter((x) => x.ch.length >= 2);
  if (!secs.length) { toast(t('ex.noChords')); return null; }
  const si = secs.length === 1 ? 0 : await dialog({ title: song.title, className: 'dlg-stack', buttons: [...secs.map((x, k) => ({ label: `${x.name}: ${x.ch.slice(0, 6).map(dn).join(' ')}${x.ch.length > 6 ? ' …' : ''}`, value: k })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
  if (si == null) return null;
  const ch = secs[si].ch.filter((c, k, a) => !k || c !== a[k - 1]).slice(0, 8);
  const shapes = song.shapes || {};
  const bpm = clampB(song.bpm, 80);
  const st = song.strum || null;
  const rh = st && RP_RHYTHMS.includes(st.id) ? st.id : st && st.steps && STEPS_RE.test(st.steps) && (!st.sig || st.sig === '4/4') ? '' : 'pop';
  const h = CS.hardest(CS.cleanSeq(ch, 4));
  return cleanRp({ id: 'song-' + song.id + '-' + si, name: song.title, chords: ch.map((c) => ({ c, v: shapes[c] || 0 })), rhythm: rh, steps: rh ? undefined : st.steps, start: Math.max(45, r5(bpm * 0.6)), target: bpm, src: 'song',
    song: { id: song.id, title: song.title, artist: song.artist || '', sec: secs[si].name }, pair: h ? [h.a, h.b] : null, plan: { solo: 1, b16: 0, b8: 0, b4: 0, fin: 3 } });
}

// ---------------- nastavnik: pošalji ----------------
export async function sendToStudents(ex, t) {
  const { toast } = await import('./ui.js');
  const T = await import('./teach.js'); const students = await T.getStudents();
  if (!students.length) { toast(t('tch.emptyBody')); return false; }
  const { pickMany } = await import('./setlistsView.js');
  const ids = await pickMany(t('rp.sendTitle'), students.map((s) => ({ value: s.id, label: s.name })), students.length === 1 ? [students[0].id] : []);
  if (!ids || !ids.length) return false;
  const B = await import('./teachBox.js');
  const send = { id: ex.id, name: ex.name, chords: ex.chords, rhythm: ex.rhythm, steps: ex.steps, plan: ex.plan, start: ex.start, target: ex.target, at: Date.now() };
  const ok = [], wait = [];
  for (const sid of ids) { const st = students.find((s) => s.id === sid); if (!(st.box && st.box.f)) { wait.push(st); continue; } if (await B.boxPut(sid, [{ key: 'rp:' + ex.id, kind: 'rp', rp: send, name: ex.name || chordsLabel(ex), at: Date.now() }]).catch(() => false)) ok.push(st); }
  if (ok.length) { await saveEx({ ...ex, src: 'sent', to: [...new Set([...(ex.to || []), ...ok.map((s) => s.id)])] }); toast(t('ex.sent', { who: ok.map((s) => s.name).join(', ') })); }
  if (wait.length) toast(t('box.notConn', { name: wait.map((s) => s.name).join(', ') }), 'error');
  return !!ok.length;
}

// ---------------- igra ----------------
export function createGame(api) {
  const { t } = api;
  let st = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } })();
  const saveSt = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch {} };
  let all = [], teacher = false, myT = null, alt = st.alt || 0, lad = [], students = [];
  let cur = null; // { ex, si } — korak koji se svira
  let drill = null; // [a, b] — „Vežbaj C → G“ (ne broji se u korake)
  let draft = st.draft && cleanRp(st.draft) || cleanRp({ chords: ['G', 'C', 'D'], rhythm: 'folk', target: 90, src: 'me' });
  api.stage.hidden = true;
  api.opts.innerHTML = `<p class="muted">${t('common.loading')}</p>`;

  const tabs = () => [...(myT || all.some((x) => x.src === 't') ? [{ id: 't', ic: '🎓', l: t('rp.tab.t') }] : []), { id: 'gen', ic: '✨', l: t('rp.tab.gen') }, { id: 'song', ic: '♪', l: t('rp.tab.song') }, ...(teacher ? [{ id: 'mk', ic: '＋', l: t('rp.tab.mk') }] : [])];
  async function load() {
    all = await list();
    try { teacher = !!((await settings.get('teacher', null)) || {}).on; myT = await settings.get('myTeacher', null); } catch {}
    if (teacher) { try { students = await (await import('./teach.js')).getStudents(); } catch { students = []; } }
    lad = await ladder(alt);
    if (!st.tab || !tabs().some((x) => x.id === st.tab)) st.tab = all.some((x) => x.src === 't') ? 't' : teacher ? 'mk' : 'gen';
    // otvori vežbu iz obaveštenja / linka (#/vezbe/rp?ex=…)
    const want = api.params && api.params.get && api.params.get('ex');
    if (want && all.some((x) => x.id === want)) { const x = all.find((y) => y.id === want); st.open = x.id; st.tab = x.src === 't' ? 't' : x.src === 'song' ? 'song' : x.src === 'gen' ? 'gen' : 'mk'; }
  }

  function cardHTML(ex, { back = '' } = {}) {
    const { S, clean, cur: ci, done } = progressOf(ex);
    const who = ex.fromT ? ex.fromT.name || t('tch.teacher') : ex.song ? ex.song.artist : '';
    const sub = [who, `${t('rp.rhythm')} „${rhythmName(ex)}“`, ex.song ? `${ex.target} BPM` : t('rp.goalBpm', { bpm: ex.target })].filter(Boolean).join(' · ');
    const rows = S.map((s, i) => {
      const c = Math.min(clean[i] || 0, s.n), state = i < ci || done ? 'done' : i === ci ? 'cur' : 'lock';
      const num = state === 'done' ? '✓' : state === 'cur' ? String(i + 1) : '🔒';
      const cnt = s.k === 'video' ? '▶' : `${state === 'done' ? s.n : c}/${s.n}`;
      return `<button type="button" class="rx-step ${state}" data-st="${i}"${state === 'lock' ? ' aria-disabled="true"' : ''}><span class="rx-num">${num}</span><span class="rx-tx"><b>${esc(stepTitle(ex, s))}</b><small>${esc(stepSub(ex, s))}</small></span><span class="rx-cnt">${cnt}</span></button>`;
    }).join('');
    const go = done ? t('rp.again') : S[ci].k === 'video' ? t('rp.st.video') : (clean[ci] || ci ? t('rp.cont', { n: ci + 1 }) : t('rp.go'));
    const second = ex.src === 'song' ? `<button type="button" class="btn" data-act="song">${t('rp.otherSong')}</button>` : back ? `<button type="button" class="btn" data-act="${back}">${t(back === 'ladder' ? 'rp.tab.gen' : 'rp.list')}</button>` : '';
    return `<div class="rx-card" data-ex="${esc(ex.id)}">
      <div class="rx-h"><b>${esc(ex.song ? ex.song.title : chordsLabel(ex))}</b><small>${esc(sub)}</small></div>
      <div class="rx-dg">${ex.chords.filter((x, k, a) => a.findIndex((y) => y.c === x.c) === k).slice(0, 6).map((x) => `<span>${chordSVG(x.c, { voicing: x.v || 0 })}</span>`).join('')}</div>
      <div class="pr-optlabel">${t(ex.song ? 'rp.stepsSong' : 'rp.steps')}</div>
      <div class="rx-steps">${rows}</div>
      <div class="rx-acts">${second}<button type="button" class="btn primary" data-act="go">▶ ${esc(go)}</button></div>
    </div>`;
  }
  function listRows(xs) {
    return `<div class="rx-list">${xs.map((x) => { const p = progressOf(x); return `<button type="button" class="rx-row" data-open="${esc(x.id)}"><span class="rx-tx"><b>${esc(x.song ? x.song.title : x.name || chordsLabel(x))}</b><small>${esc([x.song ? chordsLabel(x) : '', x.fromT ? x.fromT.name : '', `${t('rp.rhythm')} „${rhythmName(x)}“`].filter(Boolean).join(' · '))}</small></span><span class="rx-cnt${p.done ? ' ok' : ''}">${p.done ? '✓' : t('rp.stepOf', { n: p.cur + 1, of: p.S.length })}</span></button>`; }).join('')}</div>`;
  }
  function bodyHTML() {
    const open = st.open && all.find((x) => x.id === st.open);
    if (st.tab === 't') {
      const xs = all.filter((x) => x.src === 't');
      if (!xs.length) return `<p class="muted rx-empty">${t('rp.noT')}</p>`;
      if (open && open.src === 't') return cardHTML(open, { back: xs.length > 1 ? 'list' : '' });
      return xs.length === 1 ? cardHTML(xs[0]) : listRows(xs);
    }
    if (st.tab === 'gen') {
      if (open && open.src === 'gen') return cardHTML(open, { back: 'ladder' });
      return `<p class="muted rx-lead">${t('rp.gen.lead')}</p><div class="rx-ladder">${lad.map((x, i) => { const ex = all.find((y) => y.id === 'gen-' + x.g); const p = ex ? progressOf(ex) : null; return `<button type="button" class="rx-lad${i === 0 ? ' first' : ''}" data-gen="${i}"><b>${i + 1} · ${esc(x.ch.map(dn).join(' – '))}, ${esc(t('rp.gen.r.' + x.rh))}</b><small>${esc(t(x.d, x.hard ? { a: dn(x.hard[0]), b: dn(x.hard[1]) } : {}))} · ${esc(arrows(PAT(x.rh).steps))} · ${x.bpm} BPM</small>${p ? `<span class="rx-cnt${p.done ? ' ok' : ''}">${p.done ? '✓' : t('rp.stepOf', { n: p.cur + 1, of: p.S.length })}</span>` : ''}</button>`; }).join('')}</div>
        <div class="rx-acts"><button type="button" class="btn" data-act="alt">↻ ${t('rp.gen.other')}</button><button type="button" class="btn primary" data-act="gen1">▶ ${t('rp.gen.from', { n: Math.max(1, lad.findIndex((x) => { const e = all.find((y) => y.id === 'gen-' + x.g); return !e || !progressOf(e).done; }) + 1 || 1) })}</button></div>`;
    }
    if (st.tab === 'song') {
      const xs = all.filter((x) => x.src === 'song');
      if (open && open.src === 'song') return cardHTML(open);
      return `<p class="muted rx-lead">${t('rp.song.lead')}</p>${xs.length ? listRows(xs) : ''}<div class="rx-acts"><button type="button" class="btn primary" data-act="song">♪ ${t('rp.song.pick')}</button></div>`;
    }
    // nastavnik: nova vežba (akordi po imenu, hvat po želji, ritam, rundi po koraku, cilj tempo) + poslate
    if (open && (open.src === 'sent' || open.src === 'me')) return cardHTML(open, { back: 'list' });
    const d = draft, P = d.plan;
    const stepRow = (k, n, l, s) => `<div class="rx-plan"><span class="rx-num">${n}</span><span class="rx-tx"><b>${esc(l)}</b><small>${esc(P[k] ? s : t('rp.off'))}</small></span><span class="rx-pm"><button type="button" data-pm="${k}" data-d="-1" aria-label="−">−</button><b>${P[k] || ''}</b><button type="button" data-pm="${k}" data-d="1" aria-label="+">+</button></span></div>`;
    const sent = all.filter((x) => x.src === 'sent' || x.src === 'me');
    return `<div class="rx-card rx-mk">
      <div class="pr-optlabel">${t('rp.mk.chords')}</div>
      <div class="cs-seq rx-chs">${d.chords.map((x, i) => { const n = getVoicings(x.c).length; return `<button type="button" class="cs-cb" data-ch="${i}"><b>${esc(dn(x.c))}</b><small>${esc(t('rp.shape', { n: (x.v || 0) + 1, of: n }))} ▾</small></button>`; }).join('')}${d.chords.length < 8 ? `<button type="button" class="cs-cb add" data-add="1">+ ${t('cs.chord')}</button>` : ''}</div>
      <div class="pr-optlabel">${t('rp.rhythm')}</div>
      <div class="rx-rhs"><button type="button" class="rx-rh active" data-rhpick="1"><b>${esc(patternName(PAT(d.rhythm) || PAT('downs')))} ▾</b><span>${esc(arrows(stepsOf(d)))}</span></button></div>
      <div class="pr-optlabel">${t('rp.steps')}</div>
      ${stepRow('solo', 1, t('rp.st.solo'), t('rp.mk.perChord'))}${stepRow('b16', 2, t('rp.mk.e16'), t('rp.mk.rounds'))}${stepRow('b8', 3, t('rp.mk.e8'), t('rp.mk.rounds'))}${stepRow('b4', 4, t('rp.mk.e4'), t('rp.mk.rounds'))}
      <div class="pr-optlabel">${t('rp.mk.target')}</div>
      <div class="seg-tabs rx-bpm">${[70, 80, 90, 100, 120].map((b) => `<button type="button" data-tg="${b}" class="${d.target === b ? 'active' : ''}">${b}</button>`).join('')}</div>
      <div class="rx-acts"><button type="button" class="btn" data-act="try">▶ ${t('rp.mk.try')}</button><button type="button" class="btn primary" data-act="send">↗ ${t('rp.mk.send')}</button></div>
    </div>
    ${sent.length ? `<div class="pr-optlabel">${t('rp.mk.sent')}</div><div class="rx-list">${sent.map((x) => `<button type="button" class="rx-row" data-open="${esc(x.id)}"><span class="rx-tx"><b>${esc(x.name || chordsLabel(x))}</b><small>${esc([`${t('rp.rhythm')} „${rhythmName(x)}“`, t('rp.goalBpm', { bpm: x.target })].join(' · '))}</small>${(x.to || []).length ? `<span class="rx-who">${(x.to || []).map((sid) => { const s = students.find((y) => y.id === sid); if (!s) return ''; const r = (s.rp || {})[x.id]; return `<i>${esc(s.name)}: ${r ? (r.step >= r.of ? '✓' : esc(t('rp.stepOf', { n: Math.min(r.of, r.step + 1), of: r.of }))) : '–'}</i>`; }).join('')}</span>` : ''}</span></button>`).join('')}</div>` : ''}`;
  }
  function drawOpts() {
    const T = tabs();
    api.opts.innerHTML = `<div class="rx-tabs" role="tablist">${T.map((x) => `<button type="button" role="tab" class="chip${st.tab === x.id ? ' active' : ''}" data-tab="${x.id}" aria-selected="${st.tab === x.id}"><span aria-hidden="true">${x.ic}</span> ${esc(x.l)}</button>`).join('')}</div>
      <div class="rx-body">${bodyHTML()}</div>
      <p class="rx-info small">${t('rp.info')}</p>`;
  }
  const saveDraft = () => { st.draft = draft; saveSt(); };

  api.opts.addEventListener('click', async (e) => {
    if (api.running) return;
    const g = (s) => e.target.closest(s);
    const tab = g('[data-tab]'), op = g('[data-open]'), act = g('[data-act]'), stp = g('[data-st]'), gen = g('[data-gen]');
    if (tab) { st.tab = tab.dataset.tab; st.open = null; saveSt(); drawOpts(); return; }
    if (op) { st.open = op.dataset.open; saveSt(); drawOpts(); return; }
    if (gen) { const x = lad[+gen.dataset.gen]; let ex = all.find((y) => y.id === 'gen-' + x.g); if (!ex) { ex = genEx(x); await saveEx(ex); all = await list(); } st.open = ex.id; saveSt(); drawOpts(); return; }
    const card = e.target.closest('[data-ex]'); const ex = card ? all.find((x) => x.id === card.dataset.ex) : null;
    if (stp && ex) { const { S, cur: ci, done } = progressOf(ex); const i = +stp.dataset.st; if (i > ci && !done) { (await import('./ui.js')).toast(t('rp.locked')); return; } return playStep(ex, i, S); }
    if (act) {
      const a = act.dataset.act;
      if (a === 'go' && ex) { const p = progressOf(ex); if (p.done) { ex.prog = { step: 0, clean: [] }; await saveEx(ex); } return playStep(ex, p.done ? 0 : p.cur, p.S); }
      if (a === 'ladder' || a === 'list') { st.open = null; saveSt(); drawOpts(); return; }
      if (a === 'alt') { alt = (alt + 1) % 2; st.alt = alt; saveSt(); lad = await ladder(alt); drawOpts(); return; }
      if (a === 'gen1') { const x = lad.find((y) => { const e2 = all.find((z) => z.id === 'gen-' + y.g); return !e2 || !progressOf(e2).done; }) || lad[0]; let e2 = all.find((y) => y.id === 'gen-' + x.g); if (!e2) { e2 = genEx(x); await saveEx(e2); all = await list(); } st.open = e2.id; saveSt(); drawOpts(); const p = progressOf(e2); return playStep(e2, p.done ? 0 : p.cur, p.S); }
      if (a === 'song') { const x = await fromSong(t); if (!x) return; const old = all.find((y) => y.id === x.id); await saveEx(old ? { ...x, prog: old.prog } : x); all = await list(); st.tab = 'song'; st.open = x.id; saveSt(); drawOpts(); return; }
      if (a === 'try' || a === 'send') {
        const ex2 = cleanRp({ ...draft, id: a === 'try' ? 'me-' + uid() : uid(), name: chordsLabel(draft), src: 'me', prog: null });
        if (a === 'send') { if (await sendToStudents(ex2, t)) { all = await list(); drawOpts(); } return; }
        await saveEx(ex2); all = await list(); st.open = ex2.id; saveSt(); drawOpts(); const p = progressOf(ex2); return playStep(ex2, 0, p.S);
      }
    }
    // graditelj (nastavnik)
    const ch = g('[data-ch]'), add = g('[data-add]'), rh = g('[data-rh]'), pm = g('[data-pm]'), tg = g('[data-tg]');
    if (ch) {
      const i = +ch.dataset.ch, x = draft.chords[i], vs = getVoicings(x.c);
      const { dialog } = await import('./ui.js');
      const v = await dialog({ title: dn(x.c), className: 'dlg-stack', buttons: [...vs.map((y, k) => ({ label: `${(k === (x.v || 0)) ? '✓ ' : ''}${t('rp.shape', { n: k + 1, of: vs.length })} · ${y.frets.map((f) => (f < 0 ? 'x' : f)).join('')}${y.barre ? ' · barre' : ''}`, value: 'v' + k })), { label: t('cs.remove'), value: 'del', kind: 'danger' }, { label: t('common.cancel'), value: null, kind: 'ghost' }] });
      if (v === 'del') { if (draft.chords.length <= 1) return; draft.chords = draft.chords.filter((_, k) => k !== i); }
      else if (v && v[0] === 'v') draft.chords = draft.chords.map((y, k) => (k === i ? { c: y.c, v: +v.slice(1) } : y));
      else return;
      draft = cleanRp(draft); saveDraft(); drawOpts(); return;
    }
    if (add) { const r = await CS.askChord({ b: 4 }); if (r && !r.del) { draft = cleanRp({ ...draft, chords: [...draft.chords, { c: r.c }] }); saveDraft(); drawOpts(); } return; }
    if (g('[data-rhpick]')) {
      const { dialog } = await import('./ui.js');
      const v = await dialog({ title: t('cs.rhythm'), className: 'dlg-stack', buttons: [...RP_RHYTHMS.map((id) => ({ label: `${id === draft.rhythm ? '✓ ' : ''}${patternName(PAT(id))}  ${arrows(PAT(id).steps)}`, value: id })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
      if (v) { draft = { ...draft, rhythm: v }; saveDraft(); drawOpts(); }
      return;
    }
    if (rh) { draft = { ...draft, rhythm: rh.dataset.rh }; saveDraft(); drawOpts(); return; }
    if (pm) { const k = pm.dataset.pm; draft = cleanRp({ ...draft, plan: { ...draft.plan, [k]: (draft.plan[k] || 0) + +pm.dataset.d } }); saveDraft(); drawOpts(); return; }
    if (tg) { const b = +tg.dataset.tg; draft = cleanRp({ ...draft, target: b, start: Math.max(50, b - 20) }); saveDraft(); drawOpts(); }
  });

  function playStep(ex, si, S) {
    const s = S[si];
    if (s.k === 'video') return openVideo(ex, si);
    cur = { ex, si }; drill = null;
    return api.startCustom(() => game.start(api.bpm));
  }
  async function openVideo(ex, si) {
    const cleanArr = [...(ex.prog.clean || [])]; cleanArr[si] = 1;
    ex.prog = { step: Math.max(ex.prog.step || 0, si + 1), clean: cleanArr }; await saveEx(ex);
    try { sessionStorage.setItem('marli-open-pa', ex.song.id); } catch {}
    location.hash = '#/pesma/' + encodeURIComponent(ex.song.id);
  }

  // ---- runda ----
  let lastItems = [], lastRound = null;
  function buildItems(ex, s, clean) {
    const steps = stepsOf(ex), slot = 4 / steps.length;
    const strums = (beat, beats) => { const out = []; for (let k = 0; k * 4 < beats; k++) [...steps].forEach((c, i) => { const b = k * 4 + i * slot; if (b >= beats || c === '-' || b === 0) return; const it = { kind: 'strum', beat: beat + b, dir: c === 'U' ? 'U' : 'D', winBeats: Math.min(0.5, slot / 2), winCap: 160 }; if (c === 'x') { it.muted = true; it.deco = true; } out.push(it); }); return out; };
    let seq, cycles = 1, end = true;
    if (drill) seq = drill.map((c) => ex.chords.find((x) => x.c === c) || { c });
    else if (s.k === 'solo') { seq = [s.chords[clean % s.chords.length]]; end = false; }
    else seq = s.chords;
    const every = drill ? 8 : s.k === 'solo' ? 16 : s.every;
    const cyc = seq.length * every;
    if (seq.length > 1) cycles = Math.max(1, Math.round(48 / cyc));
    const out = []; let beat = 0;
    for (let k = 0; k < cycles; k++) for (const x of seq) { out.push(chordItem(x.c, beat, every, { voicing: x.v || 0 })); out.push(...strums(beat, every)); beat += every; }
    if (end && seq.length > 1) { out.push(chordItem(seq[0].c, beat, 4, { voicing: seq[0].v || 0 })); out.push(...strums(beat, 4)); }
    return out;
  }
  // dve ocene iz rezultata runde: promene (blok akorda pogođen na vreme) i ritam (udarci obrasca)
  function scores(items) {
    const ch = items.filter((x) => x.kind === 'chord'), sm = items.filter((x) => x.kind === 'strum' && !x.deco);
    const pct = (a, f) => (a.length ? Math.round((a.filter(f).length / a.length) * 100) : 100);
    const chordPct = pct(ch.slice(1), (x) => x.state === 'hit' && x.kindHit === 'hit') ; // prvi akord nije promena
    const chordHit = pct(ch, (x) => x.state === 'hit');
    const rhythmPct = pct(sm, (x) => x.state === 'hit' && x.kindHit === 'hit');
    const rhythmHit = pct(sm, (x) => x.state === 'hit');
    const early = sm.filter((x) => x.kindHit === 'early'), late = sm.filter((x) => x.kindHit === 'late');
    const avg = (a) => Math.round(a.reduce((s, x) => s + Math.abs(x.dt || 0), 0) / Math.max(1, a.length) / 10) * 10;
    const tips = [];
    if (early.length + late.length >= Math.max(2, sm.length * 0.2)) tips.push(early.length >= late.length ? t('rp.tip.rush', { ms: avg(early) }) : t('rp.tip.drag', { ms: avg(late) }));
    let worst = null; const m = new Map();
    ch.forEach((it, i) => { if (!i || it.chord === ch[i - 1].chord) return; const k = ch[i - 1].chord + '>' + it.chord; const e = it.state === 'miss' ? 2 : it.kindHit === 'late' ? 1 : it.kindHit === 'early' ? 1 : 0; const o = m.get(k) || { e: 0, n: 0, late: 0 }; o.e += e; o.n++; if (it.kindHit === 'late') o.late++; m.set(k, o); });
    for (const [k, o] of m) { const v = o.e / o.n; if (v > 0.3 && (!worst || v > worst.v)) worst = { k, v, late: o.late }; }
    if (worst) { const [a, b] = worst.k.split('>'); tips.push(t(worst.late ? 'rp.tip.lateChg' : 'rp.tip.missChg', { a: dn(a), b: dn(b) })); }
    return { chordPct: Math.min(chordPct, chordHit), rhythmPct: Math.min(rhythmPct, rhythmHit), rhythmHit, tips, worst: worst ? worst.k.split('>') : null };
  }
  async function report(ex, S) {
    if (ex.src !== 't') return;
    try { const B = await import('./teachBox.js'); const step = Math.min(S.length, ex.prog.step || 0); await B.outPush({ id: 'rp:' + ex.id + ':' + step, type: 'rp', ex: ex.id, name: ex.name || chordsLabel(ex), step, of: S.length }, { interactive: false }); } catch {}
  }

  const game = trackGame(api, {
    levels: [{ id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: 70, min: 40, max: 200, step: 5 },
    noTempo: true,
    noStart: true,
    firstBpm: 60,
    round() {
      if (!cur) { const ex = all.find((x) => x.id === st.open) || null; if (!ex) throw new Error(t('rp.pick')); cur = { ex, si: progressOf(ex).cur }; }
      const { ex, si } = cur; const S = stepsList(ex); const s = S[Math.min(si, S.length - 1)];
      const clean = (ex.prog.clean || [])[si] || 0;
      const bpm = drill ? Math.max(45, r5(stepBpm(s, clean) * 0.85)) : stepBpm(s, clean);
      const its = buildItems(ex, s, clean); lastItems = its; lastRound = { ex, si, S, s, bpm };
      return { items: its, bpm, lagMs: 350 + 90 + 80, fingersOf: chordFingers, hintOf: (it) => (it.kind === 'chord' ? t('pr.promena.hint', { c: it.label }) : ''), key: null };
    },
    listen(round, input) {
      const otherOf = (c) => { const q = lastRound ? lastRound.s.chords?.map((x) => x.c) || [] : []; return q.find((x) => x !== c) || null; };
      return {
        chords: true,
        onOnset: (o) => setTimeout(() => input(o.at, (it) => {
          if (it.kind === 'strum') return { ok: true };
          const r = checkChord(api.listener, it.chord, otherOf(it.chord));
          return r.ok ? r : { ok: false, text: t('pr.promena.notClearShort', { c: it.label }) };
        }), 350),
      };
    },
    async onRoundEnd(stats, round, ctl) {
      const R = lastRound; if (!R) return false;
      const { ex, si, S, s } = R;
      const sc = scores(lastItems);
      const isClean = sc.chordPct >= 80 && sc.rhythmPct >= 70;
      await api.finish({ score: stats.score, tempo: R.bpm, accuracy: stats.accuracy, quiet: true, noTempoUp: true });
      const wasDrill = !!drill; drill = null;
      let stepDone = false;
      if (!wasDrill && isClean) {
        const fresh = (await getEx(ex.id)) || ex; const c = [...(fresh.prog.clean || [])]; c[si] = (c[si] || 0) + 1;
        let step = fresh.prog.step || 0; if (c[si] >= s.n && si >= step) { step = si + 1; stepDone = true; }
        fresh.prog = { step, clean: c }; Object.assign(ex, fresh); await saveEx(fresh);
        if (stepDone) report(fresh, S);
      }
      all = await list(); drawOpts();
      const n = Math.min((ex.prog.clean || [])[si] || 0, s.n);
      const next = S[si + 1];
      const allDone = stepDone && !next;
      const title = wasDrill ? t('rp.res.drill') : allDone ? t('rp.res.all') : stepDone ? t('rp.res.step', { n: si + 1 }) : isClean ? t('rp.res.clean', { c: n, n: s.n }) : t('rp.res.notYet');
      const lines = [
        { label: esc(t('rp.sc.chg')), value: `<span class="rx-sc ${sc.chordPct >= 80 ? 'ok' : 'lo'}">${sc.chordPct}%</span>` },
        { label: esc(t('rp.sc.rh')), value: `<span class="rx-sc ${sc.rhythmPct >= 70 ? 'ok' : 'lo'}">${sc.rhythmPct}%</span>` },
      ];
      const tNote = ex.src === 't' && stepDone ? t('rp.res.tSees', { t: ex.fromT?.name || t('tch.teacher'), n: Math.min(S.length, ex.prog.step), of: S.length }) : '';
      const note = [esc(stepTitle(ex, s)) + (wasDrill ? '' : ` — ${n}/${s.n}`), ...sc.tips.map(esc), !isClean && !wasDrill ? esc(t('rp.res.need')) : '', esc(tNote)].filter(Boolean).join('<br>');
      const buttons = [];
      if (stepDone && next) buttons.push({ id: 'next', label: '▶ ' + (next.k === 'video' ? t('rp.st.video') : t('rp.stepN', { n: si + 2 })), primary: true });
      if (sc.worst && !wasDrill) buttons.push({ id: 'drill', label: t('rp.drill', { a: dn(sc.worst[0]), b: dn(sc.worst[1]) }) });
      if (!stepDone) buttons.push({ id: 'again', label: wasDrill ? t('rp.backStep', { n: si + 1 }) : isClean ? '▶ ' + t('rp.nextRound') : t('pr.trk.again'), primary: !buttons.some((b) => b.primary) });
      buttons.push({ id: 'back', label: t('pr.trk.back') });
      const choice = await ctl.track.results({ title, stars: null, score: null, lines, note, buttons });
      if (choice === 'back') { ctl.close(); api.stop(); drawOpts(); return true; }
      if (choice === 'next') { if (next.k === 'video') { ctl.close(); api.stop(); openVideo(ex, si + 1); return true; } cur = { ex, si: si + 1 }; api.restart(); return true; }
      if (choice === 'drill') { drill = sc.worst; api.restart(); return true; }
      api.restart();
      return true;
    },
    demo: {
      bpm: 70,
      intro: t('rp.demo1'),
      items: () => { const out = []; ['G', 'C', 'G'].forEach((c, k) => { out.push(chordItem(c, k * 4, 4)); [1, 2, 3].forEach((b) => out.push({ kind: 'strum', beat: k * 4 + b, dir: 'D', winBeats: 0.5, winCap: 160 })); }); return out; },
      fingersOf: chordFingers,
      play: (it) => { if (it.kind === 'chord') demoChord = it.chord; strum(0, it.dir || 'D', { notes: chordNotes(demoChord), group: 'practice' }); },
      captions: { 0: t('rp.demo2'), 4: t('rp.demo3'), 8: t('rp.demo4') },
    },
  });
  let demoChord = 'G';
  load().then(drawOpts).catch(() => drawOpts());
  events.addEventListener('settings-changed', onSet);
  api.onCleanup(() => events.removeEventListener('settings-changed', onSet));
  function onSet(e) { const k = e && e.detail; if (!api.running && (k === KEY || k === 'students' || k === 'teacher')) load().then(drawOpts).catch(() => {}); }
  return game;
}
