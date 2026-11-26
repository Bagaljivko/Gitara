// v2.4.34: lagana provera „dve verzije iste pesme“ (lista pesama i ekran pesme) — prozor za poređenje (songMerge.js)
// se učitava tek na „Uporedi“.
import { songs as db, settings } from './db.js';

export const IGN = 'dupIgnore';

/** Ključ za poređenje: mala slova, bez kvačica, bez „(live)“ i sličnog u zagradi, bez interpunkcije. */
export function normKey(s) {
  return String(s || '').toLowerCase().replace(/[đð]/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
const dupKey = (s) => normKey(s.title) + '|' + normKey(s.artist);
export const pairKey = (a, b) => [a, b].sort().join('|');

/** Parovi istih pesama: [{ a, b }] — a je od nastavnika (ako jeste), b tvoja. Bez učeničkih pesama (nastavnik), primera i TAB-a sa akordima. */
export async function findDups(list = null) {
  const all = (list || (await db.list())).filter((s) => !s.demo && !s.student && normKey(s.title));
  const ign = new Set((await settings.get(IGN, [])) || []);
  const groups = new Map();
  for (const s of all) { const k = dupKey(s) + '|' + (s.type === 'tab' ? 't' : 'c'); (groups.get(k) || groups.set(k, []).get(k)).push(s); }
  const out = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((x, y) => (y.fromT ? 1 : 0) - (x.fromT ? 1 : 0) || (y.updatedAt || 0) - (x.updatedAt || 0));
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      if (ign.has(pairKey(g[i].id, g[j].id))) continue;
      out.push({ a: g[i], b: g[j] });
      i = j = g.length; // jedan par po pesmi
    }
  }
  return out;
}
/** Par za ovu pesmu (ekran pesme). */
export async function dupOf(id) { return (await findDups()).find((p) => p.a.id === id || p.b.id === id) || null; }

