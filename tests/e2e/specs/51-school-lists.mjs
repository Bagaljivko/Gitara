// v2.5: Škola (Progres · Vežbe · Kursevi, pamti karticu) i Pesme · Liste: pametne liste, Moje liste, meni (desni klik / dugi
// pritisak) → Prikaži kao čip, brisanje „Lista i pesme“ (pesma i u setlisti ostaje neoznačena) i Poništi vraća sve.
import { open, boot, addSong, expect, eq } from '../lib.mjs';
export const name = 'Škola (Progres · Vežbe · Kursevi) i Liste: meni liste, čip, brisanje sa izborom i Poništi (telefon)';
export const timeout = 120;

export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/pesme', 900);
  const clk = (sel, o) => p.click(sel, { timeout: 8000, ...o }).catch((e) => { throw new Error('klik ' + sel + ': ' + e.message.split('\n')[0]); });
  // Škola
  const nav = await p.evaluate(() => document.querySelector('a[href="#/vezbe"]')?.textContent.trim() || '');
  expect(/Škola/.test(nav), 'glavni tab nije Škola', nav);
  await p.go('#/vezbe', 1200);
  const tabs = await p.evaluate(() => ({ t: [...document.querySelectorAll('.pr-tabs [data-pt]')].map((b) => b.textContent.trim()), on: document.querySelector('.pr-tabs .active')?.dataset.pt }));
  eq(tabs, { t: ['Progres', 'Vežbe', 'Kursevi'], on: 'n' }, 'kartice Škole');
  await clk('[data-pt="v"]'); await p.waitForTimeout(400);
  expect(await p.evaluate(() => document.querySelectorAll('.pr-cards .pr-card').length >= 6 && !!document.querySelector('.pr-cards')?.offsetParent), 'Vežbe: igre se ne vide');
  await clk('[data-pt="k"]'); await p.waitForTimeout(800);
  expect(await p.evaluate(() => /Moji kursevi/i.test(document.querySelector('#prCourses')?.innerText || '')), 'Kursevi: prazno');
  await p.reload(); await p.waitForTimeout(1200);
  expect(await p.evaluate(() => document.querySelector('.pr-tabs .active')?.dataset.pt === 'k'), 'Škola ne pamti karticu');

  // Liste
  const a = await addSong(p, { title: 'Alfa', extra: { folders: ['fT'] } });
  const b = await addSong(p, { title: 'Beta', extra: { folders: ['fT'] } });
  await p.evaluate(async (ids) => { const { settings } = await import('./src/db.js'); await settings.set('folders', [{ id: 'fT', name: 'Proba' }]); await settings.set('setlists', [{ id: 'sT', name: 'Subota', songIds: [ids[1]], createdAt: Date.now() }]); }, [a, b]);
  await p.reload(); await p.waitForTimeout(900);
  await p.go('#/pesme?tab=sl', 1200);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#lSlPane .tch-row b')].map((x) => x.textContent));
  expect(rows.includes('Proba') && rows.includes('Subota'), 'Liste: nema foldera ili setliste', rows);
  // desni klik → Prikaži kao čip
  await clk('#lSlPane [data-lst="f:fT"]', { button: 'right' }); await p.waitForSelector('.modal-backdrop [data-m="pin"]');
  await clk('.modal-backdrop [data-m="pin"]'); await p.waitForTimeout(800);
  await clk('[data-lt="songs"]'); await p.waitForTimeout(500);
  const chips = await p.evaluate(() => [...document.querySelectorAll('#lChips [data-chip]')].map((x) => x.dataset.chip));
  expect(chips.includes('fT'), 'čip se ne vidi posle „Prikaži kao čip“', chips);
  // obriši listu i pesme: Beta je i u setlisti → neoznačena
  await clk('[data-lt="sl"]'); await p.waitForTimeout(800);
  await clk('#lSlPane [data-more="f:fT"]'); await p.waitForSelector('.modal-backdrop [data-m="del"]');
  await clk('.modal-backdrop [data-m="del"]'); await p.waitForTimeout(500);
  await clk('.modal-backdrop button:has-text("Lista i pesme (2)")'); await p.waitForTimeout(600);
  const checks = await p.evaluate(() => [...document.querySelectorAll('.modal-backdrop .pick-row')].map((r) => r.querySelector('span').textContent.trim().split(' ')[0] + ':' + r.querySelector('input').checked).sort());
  eq(checks, ['Alfa:true', 'Beta:false'], 'pesma iz druge liste nije označena');
  await clk('.modal-backdrop .btn.danger'); await p.waitForTimeout(1200);
  const after = await p.evaluate(async () => { const { songs, settings } = await import('./src/db.js'); return { n: (await songs.all()).filter((s) => !s.demo).map((s) => s.title).sort(), f: ((await settings.get('folders', [])) || []).map((x) => x.id) }; });
  expect(!after.f.includes('fT') && after.n.includes('Beta') && !after.n.includes('Alfa'), 'brisanje: pogrešno', after);
  await clk('#toast .toast-action'); await p.waitForTimeout(1500);
  const back = await p.evaluate(async () => { const { songs, settings } = await import('./src/db.js'); return { n: (await songs.all()).map((s) => s.title), f: ((await settings.get('folders', [])) || []).map((x) => x.id) }; });
  expect(back.f.includes('fT') && back.n.includes('Alfa'), 'Poništi nije vratio listu i pesmu', back);
  await p.close();
}
