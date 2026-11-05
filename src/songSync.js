// Spajanje pesama iz rezervne kopije (Drive ili fajl) sa pesmama na uređaju — po ID-u, nikad druga kopija:
//  • isti ID → ostaje novija verzija (updatedAt); polja koja postoje samo na uređaju se zadržavaju
//  • obrisana pesma (oznaka brisanja ovde ili u kopiji) se ne vraća, osim ako je menjana posle brisanja
//  • pesma bez poklapanja ID-a, a sa potpuno istim sadržajem kao neka postojeća → ne dodaje se (stari duplikati)
import { songs as db, newSongId } from './db.js';
import { contentKey } from './songIdentity.js';

/** Vraća { added, updated, skipped }. `deleted` = oznake brisanja iz kopije ({ id: vreme }). */
export async function mergeSongs(list, { deleted = {} } = {}) {
  await db.markDeleted(deleted);
  const tombs = await db.deleted();
  const local = await db.all();
  const byId = new Map(local.map((s) => [s.id, s]));
  const keys = new Set(local.map(contentKey));
  let added = 0, updated = 0, skipped = 0;
  const now = Date.now();
  for (const s0 of list) {
    const s = { ...s0, id: s0.id || newSongId(), createdAt: s0.createdAt || now, updatedAt: s0.updatedAt || s0.createdAt || now };
    const tomb = tombs[s.id];
    if (tomb && s.updatedAt <= tomb) { skipped++; continue; }
    const cur = byId.get(s.id);
    if (cur) {
      if (s.updatedAt > (cur.updatedAt || 0)) { if (await db.put({ ...cur, ...s })) { updated++; byId.set(s.id, { ...cur, ...s }); } }
      else skipped++;
      continue;
    }
    const k = contentKey(s);
    if (keys.has(k)) { skipped++; continue; }
    if (await db.put(s, { force: !!tomb })) { added++; keys.add(k); byId.set(s.id, s); }
  }
  return { added, updated, skipped };
}

// ---- Jednokratno čišćenje postojećih duplikata (posle greške sa duplim čuvanjem / spajanjem kopije) ----
// Briše se samo TAČAN duplikat: isti naslov, izvođač, tekst, akordi (sa mestom), tablature, kapodaster, transpozicija
// i štimovanje. Pesme koje samo liče ostaju. Od svake grupe ostaje jedna: ona sa napretkom u Vežbama / u setlisti, inače
// najstarija; folderi, napredak i setliste se prenose na nju.
const DEDUPE_KEY = 'dedupeV1';
const exactKey = (s) => contentKey(s) + '|' + [s.capo || 0, s.transpose || 0, s.tuning || ''].join(',');
const plays = (p) => Object.values(p || {}).reduce((a, r) => a + ((r && r.plays) || 0), 0);

/** Vraća broj uklonjenih kopija (0 ako je već urađeno). */
export async function cleanupDuplicates({ settings }) {
  if (await settings.get(DEDUPE_KEY, false)) return 0;
  const all = await db.all();
  const groups = new Map();
  for (const s of all) { const k = exactKey(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const practice = (await settings.get('practice', null)) || null;
  const setlists = (await settings.get('setlists', [])) || [];
  const inSetlist = new Set(setlists.flatMap((x) => x.songIds || []));
  let removed = 0, prChanged = false, slChanged = false;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const score = (s) => plays(practice?.songs?.[s.id]) * 10 + (inSetlist.has(s.id) ? 5 : 0);
    g.sort((a, b) => score(b) - score(a) || (a.createdAt || 0) - (b.createdAt || 0));
    const keep = g[0], drop = g.slice(1);
    const folders = [...new Set(g.flatMap((s) => s.folders || []))];
    if (folders.length !== (keep.folders || []).length) await db.put({ ...keep, folders });
    for (const d of drop) {
      if (practice?.songs?.[d.id]) {
        const to = (practice.songs[keep.id] = practice.songs[keep.id] || {});
        for (const [pk, r] of Object.entries(practice.songs[d.id])) if (!to[pk] || (r.plays || 0) > (to[pk].plays || 0)) to[pk] = r;
        delete practice.songs[d.id]; prChanged = true;
      }
      for (const sl of setlists) {
        if (!(sl.songIds || []).includes(d.id)) continue;
        sl.songIds = sl.songIds.map((x) => (x === d.id ? keep.id : x)).filter((x, i, a) => a.indexOf(x) === i);
        slChanged = true;
      }
      await db.remove(d.id);
      removed++;
    }
  }
  if (prChanged) await settings.set('practice', practice);
  if (slChanged) await settings.set('setlists', setlists);
  await settings.set(DEDUPE_KEY, true);
  return removed;
}
