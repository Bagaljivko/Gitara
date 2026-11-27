// v2.5.63: manje zahteva prema Google Drive-u (zajednički limit svih korisnika) — bez gubitka podataka:
// „uspori“ = jedan novi pokušaj (ne tri); dnevna kopija bez duple pretrage; „Vrati sve“ ponovo šalje samo razlike;
// plan i napredak učenika se ne čitaju pri brzom ponovnom otvaranju; „marli-last-…“ je samo na ovom uređaju.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'Drive: manje zahteva (uspori, kopija, vraćanje samo razlika, plan/napredak ne pri svakom otvaranju)';
export const timeout = 120;
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/podesavanja', 900);
  await p.evaluate(async () => { const { settings } = await import('./src/db.js'); await settings.set('drive', { connected: true, folderId2: 'FOLD' }); await settings.set('driveToken2', { t: 'tok', exp: Date.now() + 3600e3, s: 1, f: 1 }); });
  const hits = []; let rate = true;
  await p.route(/googleapis\.com\/upload\/drive\/v3\/files/, (r) => { hits.push('up'); return rate ? r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":{"code":429,"errors":[{"reason":"rateLimitExceeded"}]}}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'N1', modifiedTime: new Date().toISOString() }) }); });
  await p.route(/googleapis\.com\/drive\/v3\/files/, (r) => { const u = r.request().url(); hits.push(/files\/FOLD/.test(u) ? 'folder' : /alt=media/.test(u) ? 'read' : /\?.*q=/.test(u) ? 'search' : 'other'); return /files\/FOLD/.test(u) ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"FOLD"}' }) : /alt=media/.test(u) ? r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: '{"files":[]}' }); });
  await p.reload(); await p.waitForTimeout(1200);
  // 1) „uspori“: dva zahteva (prvi + jedan novi pokušaj), pa zajednička pauza
  hits.length = 0;
  const r1 = await p.evaluate(async () => { localStorage.removeItem('marli-drive-cool'); const D = await import('./src/drive.js'); try { await D.saveNamedQuiet('x.json', '{}', 'application/json', []); return 'ok'; } catch (e) { return e.code; } });
  const ups = hits.filter((h) => h === 'up').length;
  expect(r1 === 'rate' && ups === 2, '„uspori“: najviše 2 zahteva', { r1, ups, hits: [...hits] });
  await p.waitForTimeout(300);
  expect(await p.evaluate(async () => (await import('./src/driveGate.js')).cooling()), '„uspori“ ne pokreće zajedničku pauzu');
  // 2) dnevna kopija: poznat spisak → bez nove pretrage, folder se proverava jednom po pokretanju
  rate = false; hits.length = 0;
  await p.evaluate(async () => { localStorage.removeItem('marli-drive-cool'); const D = await import('./src/drive.js'); await D.saveNamedQuiet('a.json', '{}', 'application/json', []); await D.saveNamedQuiet('b.json', '{}', 'application/json', []); });
  eq(hits.filter((h) => h === 'search').length, 0, 'dnevna kopija ponovo traži fajl po imenu');
  expect(hits.filter((h) => h === 'folder').length <= 1 && hits.filter((h) => h === 'up').length === 2, 'folder proveren više puta / slanje', [...hits]);
  // 3) „Vrati sve“ iz iste kopije: nijedna pesma nije ponovo za slanje, nijedna nije označena kao obrisana
  const rs = await p.evaluate(async () => {
    const { songs } = await import('./src/db.js'); const B = await import('./src/backups.js');
    for (let i = 0; i < 5; i++) await songs.save({ title: 'P' + i, artist: 'A', sections: [{ name: 'S', lines: [{ text: 'tekst ' + i, chords: [] }] }] });
    const data = await B.buildFull();
    const meta = async () => { const db = await new Promise((r) => { const q = indexedDB.open('gitara'); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const q = db.transaction('sync').objectStore('sync').getAll(); q.onsuccess = () => r(q.result); }); };
    const db = await new Promise((r) => { const q = indexedDB.open('gitara'); q.onsuccess = () => r(q.result); });
    await new Promise((r) => { const tx = db.transaction('sync', 'readwrite'); const s = tx.objectStore('sync'); const q = s.getAll(); q.onsuccess = () => { for (const m of q.result) s.put({ ...m, dirty: false }); }; tx.oncomplete = r; });
    await B.applyFull(data);
    const after = (await meta()).filter((m) => m.dirty && m.key.startsWith('song:'));
    return { dirty: after.length, deleted: after.filter((m) => m.deleted).length, n: (await songs.all()).length };
  });
  expect(rs.dirty === 0 && rs.deleted === 0 && rs.n === 5, 'vraćanje iste kopije ponovo šalje pesme / javlja brisanje', rs);
  // 4) plan i napredak: ne pri brzom ponovnom otvaranju; „marli-last-…“ nije u rezervnoj kopiji
  const pl = await p.evaluate(async () => {
    const T = await import('./src/teach.js'); await T.setMyTeacher({ name: 'M', tid: 't', sid: 's', planFile: 'PLANFILE1' });
    const P = await import('./src/plan.js'); localStorage.removeItem('marli-drive-cool');
    await P.refreshPlan(); const B = await import('./src/backups.js'); const d = await B.buildFull();
    return { inBk: Object.keys(d.local || {}).filter((k) => k.startsWith('marli-last-')) };
  });
  hits.length = 0;
  await p.evaluate(async () => (await import('./src/plan.js')).refreshPlan());
  eq(hits.filter((h) => h === 'read').length, 0, 'plan pročitan ponovo odmah');
  eq(pl.inBk, [], '„marli-last-…“ u rezervnoj kopiji');
  hits.length = 0;
  await p.evaluate(async () => (await import('./src/plan.js')).refreshPlan({ force: true }));
  expect(hits.filter((h) => h === 'read').length === 1, 'nov plan (force) se ne čita', [...hits]);
  expect(!p.errs.length, 'greške', p.errs);
  await p.close();
}
