// Delovi pesme + TAB: prati li igra arpeđo? Sintetički zvuk taktova 1–8 „Romance“ (žice zvone jedna preko druge,
// bas + melodija zajedno, mikrofon telefona) kroz isti detektor i proveru kao u igri: svaki novi napad se sudi po
// sebi (ne pada zato što prethodna žica još zvoni), pogrešan prag se ne prihvata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, createHitLog, matchArp, ARPEGGIO } from '../src/practiceListen.js';
import { fromScan, practiceItems } from '../src/tabSong.js';
import { SR, room, addPluck, phoneMic, frames } from './helpers/phoneMic.mjs';
import { romanceScan } from './helpers/romance.mjs';

const tab = fromScan(romanceScan()).tab;

/** Zvuk taktova kao da ih svira gitarista (tempo u četvrtinama/min), uz eventualnu zamenu nekih nota. */
function render(items, bpm, { swap = new Map(), lead = 1.2 } = {}) {
  const q = 60 / bpm, last = Math.max(...items.map((it) => it.beat)) * q + lead + 3;
  // svaka žica posebno (nov trzaj iste žice priguši samo nju), pa zbir — kao prava gitara
  const sig = room(last, 0.0006), strings = new Map(), lastOn = new Map();
  for (const it of items.filter((x) => x.kind === 'note')) {
    const t = lead + it.beat * q, midi = swap.get(it) ?? it.midi;
    const amp = it.s === 0 ? 0.05 : it.follow ? 0.03 : 0.045; // bas, unutrašnje žice tiše, melodija
    if (!strings.has(it.s)) strings.set(it.s, new Float32Array(sig.length));
    const prev = lastOn.get(it.s);
    addPluck(strings.get(it.s), t + (it.follow ? 0.004 : 0), midi, amp, { dur: 2.6, restrike: prev != null && t - prev < 2.6 });
    lastOn.set(it.s, t);
  }
  for (const st of strings.values()) for (let i = 0; i < sig.length; i++) sig[i] += st[i];
  return { sig: phoneMic(sig), q, lead };
}
/**
 * Presuda kao u igri (pTab): napad bas+melodija → melodija bez basa; nejasno prvo čitanje (blizu, mala razlika) →
 * ustaljen zvuk ~150–230 ms posle napada, pa ponovo.
 */
function judge(it, h, slice) {
  const check = (seg) => matchArp(seg, h.sr, it.midi, h.a4, it.group.length > 0);
  const r = check(h.seg);
  if (r.ok) return true;
  if (r.margin <= -0.12) return false; // jasno druga nota
  return check(Float32Array.from(slice(h.at + 150, h.at + 230))).ok;
}
/** Isto kao igra: napad → najbliža nota (u prozoru) → da li se čuje neka od nota tog napada (bas ili melodija). */
function follow(items, { sig, q, lead }) {
  const det = createDetector({ ...ARPEGGIO, ...(globalThis.DET || {}) }), log = createHitLog();
  const heads = items.filter((it) => it.kind === 'note' && !it.follow);
  const res = heads.map(() => 'missed'), when = heads.map((it) => (lead + it.beat * q) * 1000);
  let extra = 0;
  // kao u igri: odmah posle napada (~90 ms) — nota najbliža trenutku napada, pa provera zvuka tog napada
  frames(sig, (buf, now) => {
    const ev = det.process(buf, SR, now);
    if (ev.onset) log.onset({ at: ev.onset.at });
    if (!ev.pluck) return;
    log.pluck(ev.pluck);
    const h = log.hits[log.hits.length - 1];
    let k = -1;
    for (let i = 0; i < heads.length; i++) if (res[i] === 'missed' && Math.abs(h.at - when[i]) <= 70 && (k < 0 || Math.abs(h.at - when[i]) < Math.abs(h.at - when[k]))) k = i;
    if (k < 0) { extra++; return; }
    res[k] = judge(heads[k], h, (from, to) => det.tracker.lowpass(sig.subarray(Math.round(from * SR / 1000), Math.round(to * SR / 1000)), SR)) ? 'ok' : 'wrong';
  });
  return { ok: res.filter((x) => x === 'ok').length, n: heads.length, missed: res.filter((x) => x === 'missed').length, wrong: res.filter((x) => x === 'wrong').length, extra, res };
}

test('bars 1–8 at a slow practice tempo (50 BPM): every arpeggio note is heard and accepted while others ring', () => {
  const items = practiceItems(tab, [0, 1, 2, 3, 4, 5, 6, 7]);
  const r = follow(items, render(items, 50));
  if (process.env.TABDBG) { const hs = items.filter((it) => it.kind === 'note' && !it.follow); console.log('slow', r.res.map((x, i) => (x === 'ok' ? '' : `${x[0]}:b${hs[i].bar + 1}@${(hs[i].beat % 3).toFixed(2)}/s${6 - hs[i].s}f${hs[i].f}${hs[i].group.length ? '+bass' : ''}`)).filter(Boolean).join(' ')); }
  assert.ok(r.ok >= r.n * 0.95, `accepted ${r.ok}/${r.n} (missed ${r.missed}, wrong ${r.wrong})`);
  assert.ok(r.extra <= 2, `${r.extra} extra attacks`);
});

test('bars 1–8 at the full tempo (~72 BPM, 9 notes per bar): still followed', () => {
  const items = practiceItems(tab, [0, 1, 2, 3, 4, 5, 6, 7]);
  const r = follow(items, render(items, 72));
  if (process.env.TABDBG) { const hs = items.filter((it) => it.kind === 'note' && !it.follow); console.log(r.res.map((x, i) => (x === 'ok' ? '' : `${x[0]}:b${hs[i].bar + 1}@${(hs[i].beat % 3).toFixed(2)}/s${6 - hs[i].s}f${hs[i].f}${hs[i].group.length ? '+bass' : ''}`)).filter(Boolean).join(' ')); }
  assert.ok(r.ok >= r.n * 0.9, `accepted ${r.ok}/${r.n} (missed ${r.missed}, wrong ${r.wrong})`);
});

test('a wrong fret in the melody (one fret off) is not accepted, even with the right strings ringing around it', () => {
  const items = practiceItems(tab, [0, 1]);
  const heads = items.filter((it) => it.kind === 'note' && !it.follow && it.s === 5 && it.f > 0);
  const swap = new Map(heads.map((it) => [it, it.midi + 1]));
  const r = follow(items, render(items, 50, { swap }));
  const melodyWrong = heads.filter((it) => r.res[items.filter((x) => x.kind === 'note' && !x.follow).indexOf(it)] === 'wrong').length;
  assert.ok(melodyWrong >= heads.length - 1, `${melodyWrong}/${heads.length} wrong melody notes rejected`);
});
