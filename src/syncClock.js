// Hibridni logički sat za izmene na ovom uređaju (glavna nit). Mali modul — učitava se uz bazu, bez ostatka
// sinhronizacije. Verzija nove izmene je uvek veća od verzije koju zamenjuje (i kad je sat uređaja iza drugog).
const pad = (n, w) => String(n).padStart(w, '0');
const parse = (h) => { const [l, c] = String(h || '').split(':'); return { l: Number(l) || 0, c: Number(c) || 0 }; };
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let node = null, last = null;
function init() {
  if (node) return;
  node = ls.get('gitara-node');
  if (!node) { node = Math.random().toString(36).slice(2, 10); ls.set('gitara-node', node); }
  last = parse(ls.get('gitara-hlc'));
}
/** Identitet ovog uređaja (za sat i za Web Worker). */
export function deviceNode() { init(); return node; }
/** Nova verzija, veća od `after` (verzija stavke koja se menja) i od svih prethodnih ovde. */
export function nextVersion(after = '') {
  init();
  const a = parse(after), t = Date.now();
  let l = Math.max(last.l, a.l, t), c;
  c = l === last.l && l === a.l ? Math.max(last.c, a.c) + 1 : l === last.l ? last.c + 1 : l === a.l ? a.c + 1 : 0;
  last = { l, c };
  ls.set('gitara-hlc', `${pad(l, 16)}:${pad(c, 4)}`);
  return `${pad(l, 16)}:${pad(c, 4)}:${node}~ui`;
}
