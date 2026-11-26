// v2.4.26: „Pevaj uz tekst“ — samo delovi sa tekstom, više delova zaredom (od–do, i delovi između), cela pesma redom
// (ponovljeni refren i instrumental); „Spremi se“ 5 s pre početka (dodir = odmah, Stop/odlazak prekida); Ritam: kartica staje.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'Pevaj uz tekst: od–do i cela pesma redom, „Spremi se“ 5 s, kartica ritma staje na telefon';
export const timeout = 120;
export async function run(ctx) {
  const p = await open(ctx, 'phone', { init: () => localStorage.setItem('marli-songbar', JSON.stringify(['rhythm', 'metro', 'tempo'])) });
  await boot(p, ctx, '#/tuner', 900);
  const id = await p.evaluate(async () => {
    const { songs } = await import('./src/db.js');
    const L = (text, cs) => ({ text, chords: cs.map(([pos, chord]) => ({ pos, position: pos, chord })) });
    const ver = (n, a) => ({ name: 'Strofa ' + n, type: 'verse', lines: [L('Mrak se spustio u kap rano jutro', [[0, a], [18, 'C']])] });
    const ref = () => ({ name: 'Refren', type: 'chorus', lines: [L('Nocas zvezde padat ce', [[0, 'D'], [12, 'G']])] });
    const ins = () => ({ name: 'Instrumental', type: 'other', lines: [L('', [[0, 'Am'], [4, 'C'], [8, 'G'], [12, 'Am'], [16, 'E']])] });
    const s = await songs.save({ title: 'Duga', artist: 'X', bpm: 100, suggestStrum: { id: 'pop' }, sections: [ver(1, 'Am'), ref(), ins(), ver(2, 'Em'), ref()] });
    return s.id;
  });
  await p.go('#/vezbe/pesma/' + encodeURIComponent(id) + '?m=sing', 1800);
  const chips = () => p.evaluate(() => [...document.querySelectorAll('[data-sk]')].map((b) => b.textContent + (b.classList.contains('active') ? '*' : '')));
  await p.click('[data-sk="0"]'); await p.waitForTimeout(200);
  const c0 = await chips();
  eq(c0.join('|'), 'Strofa 1*|Refren 1|Strofa 2|Refren 2|Cela pesma', 'dugmad: samo delovi sa tekstom (ponovljeni refren numerisan) + Cela pesma');
  expect(await p.evaluate(() => /Dodirni još jedan deo/.test(document.querySelector('.sg-rhint')?.textContent || '')), 'nema uputstva za više delova');
  // od Strofe 1 do Strofe 2: i refren i instrumental između
  await p.click('[data-sk="3"]'); await p.waitForTimeout(250);
  const r = await p.evaluate(() => ({ sel: document.querySelector('.sg-sum')?.textContent, act: [...document.querySelectorAll('[data-sk].active')].map((b) => b.dataset.sk).join(), hint: !!document.querySelector('.sg-rhint') }));
  expect(/Strofa 1 → Strofa 2/.test(r.sel) && /4 dela/.test(r.sel) && r.act === '0,1,3' && !r.hint, 'od–do: Strofa 1 → Strofa 2, 4 dela (sa instrumentalom)', r);
  // sledeći dodir = opet jedan deo
  await p.click('[data-sk="1"]'); await p.waitForTimeout(200);
  eq(await p.evaluate(() => [...document.querySelectorAll('[data-sk].active')].map((b) => b.dataset.sk).join()), '1', 'posle raspona dodir bira jedan deo');
  await p.click('[data-sk="all"]'); await p.waitForTimeout(200);
  expect(await p.evaluate(() => { const x = document.querySelector('.sg-sum')?.textContent || ''; return /Cela pesma/.test(x) && /5 delova/.test(x); }), 'cela pesma: 5 delova redom (i ponovljeni refren)');
  // pamti izbor
  await p.go('#/tuner', 500); await p.go('#/vezbe/pesma/' + encodeURIComponent(id) + '?m=sing', 1500);
  expect((await chips()).at(-1) === 'Cela pesma*', 'izbor se ne pamti');
  // Spremi se: 5, odbrojava; Stop/odlazak prekida bez starta
  await p.click('#prGo'); await p.waitForTimeout(300);
  const g = await p.evaluate(() => ({ n: document.querySelector('.gr-n')?.textContent, first: document.querySelector('.gr-ch small b')?.textContent, sg: !!document.querySelector('.sg-wrap') }));
  expect(g.n === '5' && g.first === 'Am' && g.sg, '„Spremi se“: 5 s, prvi akord Am, tekst iza', g);
  await p.waitForTimeout(1200);
  expect(Number(await p.evaluate(() => document.querySelector('.gr-n')?.textContent)) <= 4, 'odbrojavanje ne ide');
  await p.go('#/tuner', 700);
  const after = await p.evaluate(() => ({ gr: !!document.querySelector('.gr-dim'), sg: !!document.querySelector('.sg-wrap') }));
  expect(!after.gr && !after.sg, 'odlazak sa ekrana: odbrojavanje i igra ostaju', after);
  // tok cele pesme: instrumental red i nazivi delova
  await p.go('#/vezbe/pesma/' + encodeURIComponent(id) + '?m=sing', 1500);
  await p.click('#prGo'); await p.waitForTimeout(300); await p.click('.gr-go'); await p.waitForTimeout(1500);
  const run1 = await p.evaluate(() => ({ head: document.querySelector('.sg-lyr .sg-head')?.textContent, gr: !!document.querySelector('.gr-dim') }));
  expect(run1.head === 'Strofa 1' && !run1.gr, 'cela pesma: naziv dela iznad teksta', run1);
  const lines = await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); const { songParts } = await import('./src/pSong.js'); const { singLines } = await import('./src/pSing.js');
    const seq = songParts(await songs.get(id), { dedupe: false }); return singLines(seq.flatMap((p, k) => p.chords.map((c) => ({ ...c, sec: k })))).map((l) => (l.ins ? 'ins' + l.segs.length : 'txt')); }, id);
  eq(lines.join(), 'txt,txt,ins4,ins1,txt,txt', 'instrumental: redovi sa najviše 4 akorda');
  await p.click('.sg-x'); await p.waitForTimeout(300);
  // Delovi pesme (trka) takođe imaju „Spremi se“
  await p.go('#/vezbe/pesma/' + encodeURIComponent(id), 1800);
  await p.evaluate(() => document.querySelector('[data-plan="all"]')?.click()); await p.waitForTimeout(600);
  // v2.5.6: trka nema odbrojavanje uspravno — „Okreni telefon“ kaže da odbrojavanje kreće kad se telefon okrene
  const g2 = await p.evaluate(() => ({ dim: !!document.querySelector('.gr-dim'), rot: document.querySelector('.trk-rot-ready')?.textContent || '' }));
  expect(!g2.dim && /5 s/.test(g2.rot), 'Cela pesma (trka): jedno odbrojavanje, kreće kad se telefon okrene', g2);
  await p.evaluate(() => document.getElementById('prGo')?.click()); await p.waitForTimeout(300);
  // Ritam: kartica u dva reda staje u ekran, ceo naziv
  await p.go('#/pesma/' + id, 1500);
  await p.click('#sChips [data-sheet="rhythm"]'); await p.waitForTimeout(300);
  const pop = await p.evaluate(() => { const el = document.querySelector('.chip-pop.cp-rh'); const r = el.getBoundingClientRect(); const n = el.querySelector('.cp-name'); return { l: r.left, rr: r.right, w: innerWidth, full: n.scrollWidth <= n.clientWidth + 1, ar: el.querySelectorAll('.cp-ar i').length, apply: !!el.querySelector('[data-rapply]'), change: !!el.querySelector('[data-rchange]') }; });
  expect(pop.l >= 0 && pop.rr <= pop.w && pop.full && pop.ar === 8 && pop.apply && pop.change, 'Ritam: kartica izlazi iz ekrana ili seče naziv', pop);
}
