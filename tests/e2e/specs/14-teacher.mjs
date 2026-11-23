// Nastava: uključi nastavnika, dodaj učenika, Učenici i stranica učenika; učenik: Moj nastavnik na Vežbama.
import { open, boot, expect } from '../lib.mjs';
export const name = 'Nastava: nastavnik (učenici, stranica učenika), učenik (kartica nastavnika)';
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev, { init: () => localStorage.setItem('marli-teach-tour', '1') });
    await boot(p, ctx);
    const sid = await p.evaluate(async () => { const T = await import('./src/teach.js'); await T.setTeacher({ on: true, name: 'Nastavnik Test' }); const s = await T.addStudent({ name: 'Ana Učenica' }); return s.id; });
    await p.go('#/ucenici', 1500);
    expect(await p.evaluate(() => document.body.innerText.includes('Ana Učenica')), dev + ': učenik nije na listi Učenici');
    await p.go('#/ucenik/' + encodeURIComponent(sid), 1500);
    expect(await p.evaluate(() => document.body.innerText.includes('Ana Učenica')), dev + ': stranica učenika');
    await p.go('#/vezbe', 1600);
    expect(await p.evaluate(() => !!document.querySelector('#prTeach')?.textContent.trim()), dev + ': Nastava na Vežbama (nastavnik)');
  }
  const s = await open(ctx, 'phone');
  await boot(s, ctx);
  await s.evaluate(async () => { const T = await import('./src/teach.js'); await T.setMyTeacher({ name: 'Profa Mika', tid: 't1' }); });
  await s.go('#/vezbe', 1600);
  expect(await s.evaluate(() => document.querySelector('#prTeach')?.innerText.includes('Profa Mika')), 'učenik: kartica nastavnika na Vežbama');
}
