// v2.4.21: obaveštenja oko povezivanja — učenik: „Povezan si sa …“ + tura (4 kartice, jednom); nastavnik: pozdrav
// „Povezani ste: Ana“ (jednom) + tura, „Ana: primljeno ✓“ (stiglo), učenik „Mile je primio tvoj snimak ✓“;
// povezan učenik bez velikog QR dugmeta (ostaje u ⋯); Pesme → „🔥 Najviše sviram“ (telefon čip, računar grupa).
import { open, boot, addSong, expect, fakeDrive } from '../lib.mjs';
export const name = 'povezivanje: obaveštenja i tura; primljeno; QR sakriven; Najviše sviram';
export const timeout = 200;
const SHOT = process.env.MARLI_SHOTS ? '/tmp/claude-0/-home-user/5acc3b3c-c7ec-5fc4-b0ba-484df35f0a2c/scratchpad/mk10/' : '';
export async function run(ctx) {
  // ---------- učenik prihvata poziv ----------
  const s = await open(ctx, 'phone', { init: () => { window.__marliTest = { ...(window.__marliTest || {}), noHints: true }; } });
  await boot(s, ctx, '#/tuner', 900);
  await s.evaluate(async () => {
    const V = await import('./src/teachView.js');
    const p = V.acceptInvite('#poziv/T1/S1?n=Mile&b=');
    for (let i = 0; i < 40 && !document.querySelector('.modal-backdrop #invProg'); i++) await new Promise((r) => setTimeout(r, 50));
    document.querySelector('#invProg').checked = false; document.querySelector('#invProg').dispatchEvent(new Event('change'));
    [...document.querySelectorAll('.modal-backdrop .btn')].find((b) => b.classList.contains('primary')).click();
    await p;
  });
  await s.waitForTimeout(1500);
  const st1 = await s.evaluate(async () => ({ hash: location.hash, notes: (await (await import('./src/notify.js')).list()).map((n) => n.t), tour: !!document.querySelector('.tr-dim'), k: document.querySelector('.tr-k')?.textContent || '' }));
  expect(st1.notes.some((x) => /Povezan si sa nastavnikom: Mile/.test(x)), 'učenik: nema obaveštenja „Povezan si“', st1);
  expect(st1.tour && /1 od 4/.test(st1.k), 'učenik: tura se ne pokazuje', st1);
  if (SHOT) await s.screenshot({ path: SHOT + 'tura.png' });
  for (let i = 0; i < 3; i++) { await s.click('.tr-go'); await s.waitForTimeout(150); }
  expect(/Kreni/.test(await s.textContent('.tr-go')), 'učenik: poslednja kartica');
  await s.click('.tr-go'); await s.waitForTimeout(300);
  await s.go('#/pesme', 600); await s.go('#/od-nastavnika', 1500);
  expect(!(await s.$('.tr-dim')), 'učenik: tura se ponovo pokazala (treba samo jednom)');
  await s.click('#tTour'); await s.waitForTimeout(400);
  expect(await s.$('.tr-dim'), 'učenik: „Šta sve mogu…“ ne otvara turu');
  await s.keyboard.press('Escape');
  // učenik: nastavnik je primio snimak (stavka „rcv“ u sanduču)
  const drive = {};
  await fakeDrive(s, drive);
  drive.BOX = JSON.stringify({ type: 'box', tid: 'T1', items: [{ key: 'rcv:r1', kind: 'rcv', name: 'Tišina — refren', at: Date.now() }] });
  const rcv = await s.evaluate(async () => { const M = await import('./src/teach.js'); const m = await M.getMyTeacher(); await M.setMyTeacher({ ...m, box: 'BOX' }); const B = await import('./src/teachBox.js'); await B.checkBox({ force: true }); return (await (await import('./src/notify.js')).list()).map((n) => n.t + ' | ' + n.s); });
  expect(rcv.some((x) => /Mile je primio tvoj snimak ✓ \| Tišina — refren/.test(x)), 'učenik: nema „primio tvoj snimak“', rcv);
  // ---------- nastavnik ----------
  const t = await open(ctx, 'phone'); await boot(t, ctx, '#/tuner', 900);
  const r = await t.evaluate(async () => {
    const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' });
    const a = await M.addStudent({ name: 'Ana' }); await M.updateStudent(a.id, { box: { f: 'BX', at: Date.now() }, sent: [{ key: 'set:inl1', name: '6 pesama', at: Date.now() }] });
    const B = await import('./src/teachBox.js'); const st = await M.getStudent(a.id);
    await B.ingestOut(st, [{ id: 'hello', type: 'hello', at: Date.now() }]);
    await B.ingestOut(await M.getStudent(a.id), [{ id: 'hello2', type: 'hello', at: Date.now() }]); // drugi pozdrav — bez novog obaveštenja
    await B.ingestOut(await M.getStudent(a.id), [{ id: 'g1', type: 'got', keys: ['set:inl1'], at: Date.now() }]);
    return { id: a.id, notes: (await (await import('./src/notify.js')).list()).map((n) => n.t + ' | ' + n.s) };
  });
  expect(r.notes.filter((x) => /Povezani ste: Ana/.test(x)).length === 1, 'nastavnik: „Povezani ste“ treba tačno jednom', r.notes);
  expect(r.notes.some((x) => /Ana: primljeno ✓ \| 6 pesama/.test(x)), 'nastavnik: nema „primljeno“', r.notes);
  await t.go('#/ucenik/' + encodeURIComponent(r.id), 1600);
  const tv = await t.evaluate(() => ({ tour: !!document.querySelector('.tr-dim'), qr: !!document.querySelector('#tQr') }));
  expect(tv.tour, 'nastavnik: tura se ne pokazuje na stranici učenika');
  expect(!tv.qr, 'nastavnik: povezan učenik i dalje ima veliko QR dugme');
  await t.keyboard.press('Escape'); await t.waitForTimeout(200);
  await t.click('#tMore'); await t.waitForTimeout(400);
  expect(await t.evaluate(() => [...document.querySelectorAll('.modal-backdrop .btn')].some((b) => /Ponovo poveži/.test(b.textContent))), 'nastavnik: nema „Ponovo poveži“ u ⋯');
  // ---------- Najviše sviram ----------
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/tuner', 900);
    const ids = [];
    for (const ti of ['Tišina', 'Ruža', 'Zemlja']) ids.push(await addSong(p, { title: ti }));
    await p.evaluate(async (ids) => { const { settings } = await import('./src/db.js'); await settings.set('activity', { v: 1, dev: { d: { s: { [ids[0]]: { p: 600000, x: 300000 }, [ids[1]]: { p: 3600000, x: 1200000 }, [ids[2]]: { p: 60000 } }, g: {}, days: {} } } }); }, ids);
    await p.goto(ctx.base + '#/pesme'); await p.waitForTimeout(1500);
    if (dev === 'desk') {
      await p.click('[data-g="top"]'); await p.waitForTimeout(600);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.dt-title b')].map((b) => b.textContent));
      expect(rows.join() === 'Ruža,Tišina', 'računar: Najviše sviram (redosled, bez kratkih)', rows);
    } else {
      await p.click('#lChips [data-chip="auto:top"]'); await p.waitForTimeout(600);
      const L = await p.evaluate(() => [...document.querySelectorAll('#lList .song-item')].map((x) => x.querySelector('.song-title').textContent + ' ' + (x.querySelector('.lib-top')?.textContent || '')));
      if (SHOT) await p.screenshot({ path: SHOT + 'top.png' });
      expect(L.length === 2 && /^Ruža .*1 h 20/.test(L[0]) && /^Tišina .*15 min/.test(L[1]), 'telefon: Najviše sviram (redosled, vreme)', L);
    }
  }
  expect(!s.errs.length && !t.errs.length, 'greške', [s.errs, t.errs]);
}
