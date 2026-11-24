// v2.4.11 (iz dijagnostike): Google „403 rateLimitExceeded“ nije obrisan fajl — plan nastavnika ostaje, napredak nije
// „ne deli“; zajednička pauza (sanduče i ostali pozadinski poslovi čekaju, preživi ponovno otvaranje); deljenje pesme
// kojoj fale delovi ne pada.
import { open, boot, expect } from '../lib.mjs';
export const name = 'Drive „uspori“ ≠ obrisano, zajednička pauza, deljenje nepotpune pesme';
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx);
  let hits = 0;
  await p.route(/googleapis\.com\/drive\/v3\/files\/PLAN_FILE/, (r) => { hits++; r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute'", errors: [{ reason: 'rateLimitExceeded' }] } }) }); });
  const r = await p.evaluate(async () => {
    const M = await import('./src/teach.js'); const P = await import('./src/plan.js'); const S = await import('./src/shareService.js'); const G = await import('./src/driveGate.js');
    localStorage.removeItem('marli-drive-cool');
    await M.setMyTeacher({ name: 'Profa', tid: 't1', sid: 's1', planFile: 'PLAN_FILE', plan: { at: 1, name: 'Plan', tasks: [{ id: 'a', kind: 'game', game: 'pauk' }] } });
    const d = await S.readData('PLAN_FILE');
    const cool = G.cooling();
    localStorage.removeItem('marli-drive-cool');
    await P.refreshPlan({ force: true });
    const after = await M.getMyTeacher();
    return { d, cool, plan: !!(after.plan && after.planFile) };
  });
  expect(r.d === null, '403 rateLimitExceeded se čita kao „obrisano“', r);
  expect(r.cool, '403 rateLimitExceeded ne pokreće zajedničku pauzu');
  expect(r.plan, 'plan nastavnika je obrisan kad Google uspori (403)');
  // za vreme pauze sanduče se ne čita (ni posle ponovnog otvaranja)
  const before = hits;
  const box = await p.evaluate(async () => {
    const G = await import('./src/driveGate.js'); G.noteRate();
    const M = await import('./src/teach.js'); await M.setMyTeacher({ ...(await M.getMyTeacher()), box: 'PLAN_FILE' });
    localStorage.removeItem('marli-last-box');
    const B = await import('./src/teachBox.js'); return B.checkBox();
  });
  expect(box === 0 && hits === before, 'sanduče se čita i dok Google traži pauzu', { box, hits, before });
  await p.reload(); await p.waitForTimeout(1500);
  expect(await p.evaluate(async () => (await import('./src/driveGate.js')).cooling()), 'pauza ne preživi ponovno otvaranje');
  // deljenje pesme kojoj fale delovi (ranije: TypeError reading 'map')
  const pk = await p.evaluate(async () => { const C = await import('./src/shareCode.js'); try { const pkg = C.makePackage([{ title: 'Bez delova' }, { title: 'X', sections: [{ name: 'A' }] }], 'Set'); return pkg.s.length; } catch (e) { return String(e); } });
  expect(pk === 2, 'paket sa nepotpunom pesmom', pk);
}
