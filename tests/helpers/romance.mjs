// „Romance D'Amour“ (Anonymous) — odgovor Gemini-ja za TAB skeniranje dve strane (32 takta, 3/4), kakav bi stigao
// za list sa Capotasto Music. Taktovi 1–8 su tačno po listu (podaci za proveru); ostali su verodostojni, uz:
//  • takt 16 pročitan na obe strane (preklapanje) — mora ostati jedan
//  • takt 26 koji Gemini nije pouzdano pročitao (unsure)
//  • takt 30 kome fali poslednji otkucaj (ne popunjava 3/4) — mora biti označen
// Note: s = žica (1 = e), f = prag, start/len u četvrtinama (triola osmina = 0.333).
const T = (x) => +x.toFixed(3);
function arp(bass, mel, b, g, extra = {}) {
  const notes = [{ s: bass[0], f: bass[1], start: 0, len: 3 }];
  for (let k = 0; k < 3; k++) {
    notes.push({ s: 1, f: mel[k], start: k, len: 1, ...(extra.fi && extra.fi[k] ? { finger: extra.fi[k] } : {}) });
    notes.push({ s: 2, f: b, start: T(k + 1 / 3), len: 0.333 });
    notes.push({ s: 3, f: g, start: T(k + 2 / 3), len: 0.333 });
  }
  return notes;
}
const E = [6, 0], A = [5, 0], Bb = [5, 2];
export const BARS_1_8 = [
  { bass: E, mel: [7, 7, 7], b: 0, g: 0 },
  { bass: E, mel: [7, 5, 3], b: 0, g: 0 },
  { bass: E, mel: [3, 2, 0], b: 0, g: 0 },
  { bass: E, mel: [0, 3, 7], b: 0, g: 0 },
  { bass: E, mel: [12, 12, 12], b: 0, g: 0 },
  { bass: E, mel: [12, 10, 8], b: 0, g: 0 },
  { bass: A, mel: [8, 7, 5], b: 5, g: 5, barre: '1/2 BV' },
  { bass: A, mel: [5, 7, 8], b: 5, g: 5, barre: '1/2 BV' },
];
export function romanceScan() {
  const bars = [];
  const add = (n, bass, mel, b, g, o = {}) => bars.push({ n, notes: arp(bass, mel, b, g, o), ...(o.barre ? { barre: [{ label: o.barre }] } : {}), ...(o.key ? { key: o.key } : {}), ...(o.rs ? { repeatStart: true } : {}), ...(o.re ? { repeatEnd: true, times: 2 } : {}) });
  BARS_1_8.forEach((x, i) => add(i + 1, x.bass, x.mel, x.b, x.g, { barre: x.barre, ...(i === 6 ? { fi: [4, 3, 1] } : {}) }));
  add(9, Bb, [7, 8, 7], 7, 8, { barre: 'BVII' });
  add(10, Bb, [11, 8, 7], 7, 8, { barre: 'BVII' });
  add(11, E, [7, 5, 3], 0, 0);
  add(12, E, [3, 2, 0], 0, 0);
  add(13, Bb, [2, 3, 2], 4, 2, { barre: 'BII' });
  add(14, Bb, [2, 4, 0], 4, 2);
  add(15, E, [0, 0, 0], 0, 0);
  add(16, E, [0, 0, 0], 0, 0, { re: true });
  // strana 2: počinje ponovljenim taktom 16 (preklapanje), slabije pročitanim
  bars.push({ n: 16, notes: [{ s: 6, f: 0, start: 0, len: 3 }, { s: 1, f: 0, start: 0, len: 1 }] });
  add(17, E, [4, 4, 4], 0, 1, { key: 'E', rs: true });
  add(18, E, [4, 2, 0], 0, 1);
  add(19, E, [0, 4, 7], 0, 1);
  add(20, E, [12, 12, 12], 9, 9, { barre: 'BIX' });
  add(21, E, [12, 11, 9], 9, 9, { barre: 'BIX' });
  add(22, Bb, [9, 7, 9], 7, 8, { barre: 'BVII' });
  add(23, Bb, [7, 9, 7], 7, 8, { barre: 'BVII' });
  add(24, Bb, [7, 9, 11], 7, 8);
  add(25, E, [12, 11, 9], 9, 9);
  add(26, E, [9, 7, 5], 5, 6, { barre: 'BV' });
  add(27, A, [5, 4, 2], 5, 6, { barre: 'BV' });
  add(28, A, [2, 2, 2], 2, 2, { barre: 'BII' });
  add(29, Bb, [2, 4, 2], 4, 4, { barre: 'BII' });
  add(30, E, [0, 0, 0], 0, 1);
  add(31, Bb, [2, 2, 2], 4, 2, { barre: 'BII' });
  add(32, E, [0, 0, 0], 0, 1, { re: true });
  // takt 30: fali poslednji otkucaj (dve note i bas samo za dva otkucaja)
  const b30 = bars.find((x) => x.n === 30);
  b30.notes = b30.notes.filter((n) => n.start < 2).map((n) => (n.len === 3 ? { ...n, len: 2 } : n));
  return {
    sheetKind: 'tab', title: "Romance D'Amour", composer: 'Anonymous', key: 'Em', sig: '3/4', bpm: 0, bars,
    unsure: [{ bar: 26, why: 'Prag na G žici je mutan (6 ili 8).' }],
  };
}
