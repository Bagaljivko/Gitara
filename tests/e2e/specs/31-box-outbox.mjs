// v2.4.11 (Mile: „poslao 6 pesama, ništa nije stiglo“; „veza sa učenicima ne radi kako treba“):
// sanduče koje trenutno ne može da se pročita (Google usporio) se NE prepisuje samo novim stavkama — čeka u „odlaznom“
// i šalje se samo čim Google dozvoli, uz staro što je već bilo u sanduču; greška pri pakovanju se vidi (nije tiho).
import { open, boot, expect, fakeDrive } from '../lib.mjs';
export const name = 'nastavnik: sanduče se ne briše kad Google uspori, odlazno se šalje kasnije, greška slanja se vidi';
export async function run(ctx) {
  const drive = { BOX_ANA: JSON.stringify({ app: 'marli', type: 'box', v: 1, tid: 'T', sid: 'S', at: 1, items: [{ key: 'song:OLD', kind: 'song', name: 'Stara pesma', f: 'OLD', at: 1 }] }) };
  const p = await open(ctx, 'desk', { init: () => localStorage.setItem('marli-teach-tour', '1') });
  await fakeDrive(p, drive);
  let slow = true;
  await p.route(/googleapis\.com\/drive\/v3\/files\/BOX_ANA\?alt=media/, (r) => (slow
    ? r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } }) })
    : r.fallback()));
  await boot(p, ctx, '#/tuner', 900);
  const sid = await p.evaluate(async () => { const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' }); const s = await M.addStudent({ name: 'Ana' }); await M.updateStudent(s.id, { box: { f: 'BOX_ANA', at: Date.now() } }); return s.id; });
  const r1 = await p.evaluate(async (sid) => {
    localStorage.removeItem('marli-drive-cool');
    const B = await import('./src/teachBox.js');
    const ok = await B.boxPut(sid, [{ key: 'set:NEW', kind: 'set', name: '6 pesama', f: 'NEW' }]);
    return { ok, n: await B.pendingCount(sid) };
  }, sid);
  expect(r1.ok && r1.n === 1, 'stavka nije u odlaznom kad Google uspori', r1);
  expect(JSON.parse(drive.BOX_ANA).items.length === 1 && JSON.parse(drive.BOX_ANA).items[0].key === 'song:OLD', 'sanduče je prepisano (stara stavka obrisana)', drive.BOX_ANA);
  // stranica učenika pokazuje „čeka slanje“
  await p.go('#/ucenik/' + sid, 1800);
  expect(await p.$('#tLes .les-pend'), 'nema „Čeka slanje“ na stranici učenika');
  // Google ponovo dozvoljava → odlazno se pošalje, staro ostaje
  slow = false;
  const r2 = await p.evaluate(async (sid) => { localStorage.removeItem('marli-drive-cool'); const B = await import('./src/teachBox.js'); const n = await B.flushOutbox(); return { n, left: await B.pendingCount(sid) }; }, sid);
  const items = JSON.parse(drive.BOX_ANA).items.map((x) => x.key);
  expect(r2.n === 1 && r2.left === 0 && items.includes('song:OLD') && items.includes('set:NEW'), 'odlazno nije poslato kako treba', { r2, items });
  // greška pri slanju se vidi (ranije: tiho, „poslato“ a ništa nije stiglo)
  const toast = await p.evaluate(async (sid) => {
    window.__marliTest = { ...(window.__marliTest || {}), publish: async () => { throw new TypeError("Cannot read properties of undefined (reading 'map')"); } };
    const V = await import('./src/teachView.js'); const M = await import('./src/teach.js');
    await V.sendMenu([await M.getStudent(sid)], { kind: 'set', name: 'Set', share: { key: 'pick:x', kind: 'set', songs: [] } });
    return document.getElementById('toast')?.textContent || '';
  }, sid);
  expect(/nije|failed|uspel/i.test(toast), 'greška slanja se ne vidi', toast);
}
