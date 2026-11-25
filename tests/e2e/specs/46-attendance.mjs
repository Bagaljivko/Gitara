// v2.4.32: dolasci na časove po učeniku i mesecu — sami iz rasporeda (prošli = bio/la), otkazani u rasporedu,
// beleška sa časa = bio/la; nastavnik menja ✓ / ✗ / otkazano; „+ Dodaj čas“ van rasporeda; Raspored: prošao čas → Bio / Nije došao.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'dolasci na časove: po mesecima, sami iz rasporeda, ✓ / ✗ / otkazano, dodaj čas, iz rasporeda';
export const timeout = 150;
export async function run(ctx) {
  for (const dev of ['phone', 'desktop']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/tuner', 900);
    const r = await p.evaluate(async () => {
      const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' });
      const a = await M.addStudent({ name: 'Ana' });
      // termin svakog dana u nedelji kao danas, od pre 5 nedelja, u 00:01 (pa su prošli časovi sigurno prošli)
      const now = new Date(); const dow = (now.getDay() + 6) % 7;
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 35).getTime();
      const S = await import('./src/schedule.js'); const k = S.dkey;
      const occ = S.occurrences({ id: a.id, slot: { dow, hm: '00:01', dur: 45, every: 1, from, off: {}, moved: {} } }, from, Date.now());
      const off = {}; off[occ[1].key] = 1; // drugi čas otkazan
      await M.updateStudent(a.id, { slot: { dow, hm: '00:01', dur: 45, every: 1, from, off, moved: {} } });
      return { id: a.id, keys: occ.map((o) => o.key), month: now.getMonth() };
    });
    // izračunato: svi prošli = bio/la, otkazan = otkazano
    const m0 = await p.evaluate(async ({ id }) => { const A = await import('./src/attendance.js'); const T = await import('./src/teach.js'); const st = await T.getStudent(id); const d = new Date(); const all = []; for (let k = 2; k >= 0; k--) { const x = new Date(d.getFullYear(), d.getMonth() - k, 1); all.push(...(await A.monthLessons(st, x.getFullYear(), x.getMonth()))); } return all.map((o) => o.s).join(''); }, r);
    expect(/^y+$/.test(m0.replace('x', '')) && (m0.match(/x/g) || []).length === 1 && m0.length >= 5, dev + ': dolasci iz rasporeda (prošli ✓, otkazan –)', m0);
    // profil: red „Dolasci na časove“
    await p.go('#/ucenik/' + r.id, 1500);
    const row = await p.evaluate(() => [...document.querySelectorAll('[data-sp="att"]')].map((x) => x.innerText.replace(/\s+/g, ' ')).join('|'));
    expect(/Dolasci na časove/.test(row) && /bio\/la \d+ od \d+/.test(row), dev + ': red „Dolasci“ na profilu', row);
    await p.click('[data-sp="att"]'); await p.waitForTimeout(500);
    const before = await p.evaluate(() => ({ rows: document.querySelectorAll('.att-r').length, hist: document.querySelectorAll('.att-hb').length, sum: document.querySelector('.att-sum')?.innerText.replace(/\s+/g, ' ') }));
    expect(before.rows >= 1 && before.hist === 6, dev + ': prozor dolazaka (časovi meseca, 6 meseci)', before);
    // označi prvi prošli čas ovog meseca kao „nije došao“
    const firstPast = await p.evaluate(() => { const r = [...document.querySelectorAll('.att-r.s-y')][0]; return r ? r.dataset.k : ''; });
    if (firstPast) {
      await p.click(`.att-r[data-k="${firstPast}"] [data-set="n"]`); await p.waitForTimeout(400);
      expect(await p.evaluate((k) => document.querySelector(`.att-r[data-k="${k}"]`).classList.contains('s-n'), firstPast), dev + ': ✗ nije došao se ne upisuje');
    }
    // + Dodaj čas (van rasporeda) — juče u 12:00
    await p.click('[data-add]'); await p.waitForTimeout(300);
    const y = await p.evaluate(() => { const d = new Date(Date.now() - 864e5); const p2 = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T12:00`; });
    await p.fill('#attWhen', y); await p.click('.modal-backdrop:last-child .btn.primary'); await p.waitForTimeout(600);
    const ex = await p.evaluate(() => [...document.querySelectorAll('.att-r')].some((r) => /van rasporeda/.test(r.innerText)));
    expect(ex, dev + ': dodat čas van rasporeda se ne vidi');
    await p.click('.att-dlg [data-x]'); await p.waitForTimeout(600);
    // Raspored: prošao čas → Bio / Nije došao
    await p.go('#/raspored', 1500);
    const past = await p.$('.sch-c.past, .sch-ev');
    if (past && dev === 'phone') {
      await p.evaluate(() => document.querySelector('.sch-c.past')?.click()); await p.waitForTimeout(400);
      const btns = await p.evaluate(() => [...document.querySelectorAll('.modal-backdrop:last-child .btn')].map((b) => b.textContent.trim()).join('|'));
      expect(/Bio\/la je/.test(btns) && /Nije došao/.test(btns) && !/Pomeri/.test(btns), dev + ': prošao čas u rasporedu nudi Bio / Nije došao', btns);
      await p.keyboard.press('Escape');
    }
    expect(!p.errs.length, dev + ': greške', p.errs);
    await p.close();
  }
}
