// v2.4.14: slanje više pesama — pesme idu PRAVO u sanduče (jedan fajl, bez deljenog fajla i „javnog“ prava, do 300 pesama),
// učenik ih prima jednim čitanjem (sa oznakom „od nastavnika“), nastavnik vidi „✓ stiglo“; „Pošalji ponovo“; sanduče ispod
// 1,5 MB; „Pošalji kao link“ (bez Google-a) uvozi kao od nastavnika; učenik „Proveri sada“.
import { open, boot, expect, fakeDrive } from '../lib.mjs';
export const name = 'slanje više pesama u sanduče (bez deljenog fajla), stiglo, ponovo, link, Proveri sada';
export const timeout = 240;
export async function run(ctx) {
  const drive = {};
  const T = await open(ctx, 'desk', { init: () => localStorage.setItem('marli-teach-tour', '1') });
  await fakeDrive(T, drive); await boot(T, ctx, '#/tuner', 900);
  const ids = await T.evaluate(async () => {
    const M = await import('./src/teach.js'); const { songs } = await import('./src/db.js');
    const tc = await M.setTeacher({ on: true, name: 'Mile' });
    const s = await M.addStudent({ name: 'Ana' }); await M.updateStudent(s.id, { box: { f: 'BOX_ANA', at: Date.now() }, prog: { fileId: 'PROG_ANA' } });
    const list = [];
    for (let i = 0; i < 5; i++) list.push(await songs.save({ title: 'Pesma ' + (i + 1), artist: 'Bajaga', sections: [{ name: 'Strofa', lines: [{ text: 'la la ' + i, chords: [{ position: 0, chord: 'G' }, { position: 3, chord: 'D', g: true }, { position: 5, chord: 'Em' }] }] }] }));
    list.push(await songs.save({ title: 'Nepotpuna', sections: [{ name: 'Tab' }, { name: 'Strofa', lines: [{ text: 'tekst', chords: [{ position: 0, chord: 'Am' }] }] }] })); // kao Miletova pesma: jedan deo bez redova
    window.__marliTest = { ...(window.__marliTest || {}), publish: async () => { throw new Error('deljeni fajl ne sme da se koristi'); } };
    const V = await import('./src/teachView.js');
    await V.sendMenu([await M.getStudent(s.id)], { kind: 'set', name: '6 pesama', share: { key: 'pick:x', kind: 'set', name: '6 pesama', songs: list, what: 'set' } });
    return { tid: tc.id, sid: s.id, songIds: list.map((x) => x.id) };
  });
  const box = JSON.parse(drive.BOX_ANA || '{}');
  const it = (box.items || []).find((x) => x.kind === 'set');
  expect(it && it.d && !it.f && it.n === 6 && !it._ids, 'pesme nisu u sanduču (ili je korišćen deljeni fajl)', it);
  // ---- učenik: jedno čitanje sanduča → 6 pesama + set lista, oznaka „od nastavnika“, potvrda „stiglo“ ----
  const S = await open(ctx, 'phone'); await fakeDrive(S, drive); await boot(S, ctx, '#/tuner', 900);
  const got = await S.evaluate(async (ids) => {
    const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Mile', tid: ids.tid, sid: ids.sid, box: 'BOX_ANA', prog: { on: true, fileId: 'PROG_ANA' } });
    const B = await import('./src/teachBox.js'); const n = await B.checkBox({ force: true });
    await new Promise((r) => setTimeout(r, 2500)); // „stiglo“ se šalje u grupi
    const { songs } = await import('./src/db.js'); const all = (await songs.all()).filter((x) => x.fromT);
    const C = await import('./src/collections.js'); const sets = (await C.getSetlists()).filter((x) => x.fromT);
    return { n, songs: all.length, set: sets[0] && sets[0].songIds.length, brk: all.some((x) => (x.sections[0].lines[0] || { chords: [] }).chords.some((c) => c.g)) };
  }, ids);
  expect(got.n === 1 && got.songs === 6 && got.set === 6 && got.brk, 'učenik nije primio 6 pesama iz sanduča', got);
  const prog = JSON.parse(drive.PROG_ANA || '{}');
  expect((prog.out || []).some((o) => o.type === 'got' && o.keys.includes(it.key)), 'nema potvrde „stiglo“ u fajlu napretka', prog.out);
  // „Proveri sada“ kod učenika
  await S.go('#/od-nastavnika', 1800);
  expect(await S.$('#tBoxNow') && /✓/.test(await S.evaluate(() => document.getElementById('tBoxLast')?.textContent || '')), 'nema „Proveri sada“ / poslednje provere');
  // ---- nastavnik: „✓ stiglo“ ----
  await T.evaluate(async (sid) => { const M = await import('./src/teach.js'); await (await import('./src/progress.js')).studentProgress(await M.getStudent(sid), { fresh: true }); }, ids.sid);
  await T.go('#/ucenik/' + ids.sid, 1800);
  expect(/stiglo/.test(await T.evaluate(() => document.querySelector('#tLes .les-sent')?.innerText || '')), 'nastavnik ne vidi „stiglo“', await T.evaluate(() => document.querySelector('#tLes .les-sent')?.innerText));
  // „Pošalji ponovo“ (iste pesme kao nova stavka)
  const re = await T.evaluate(async ([sid, key]) => { const B = await import('./src/teachBox.js'); return B.resend(sid, key); }, [ids.sid, it.key]);
  expect(re && JSON.parse(drive.BOX_ANA).items.filter((x) => x.kind === 'set' && x.d).length === 2, 'Pošalji ponovo ne radi');
  // budžet sanduča: najstarijim stavkama se skidaju pesme kad pređe ~1,5 MB
  const sz = await T.evaluate(async (sid) => {
    const B = await import('./src/teachBox.js'); const big = 'd' + 'x'.repeat(500000);
    for (let i = 0; i < 4; i++) await B.boxPut(sid, [{ key: 'set:big' + i, kind: 'set', name: 'Veliko ' + i, d: big, n: 1, at: Date.now() + i }]);
    return true;
  }, ids.sid);
  const bx = JSON.parse(drive.BOX_ANA);
  expect(sz && JSON.stringify(bx).length < 1600000 && bx.items.find((x) => x.key === 'set:big3').d, 'sanduče nije ispod budžeta (ili je najnovija stavka ostala bez pesama)', JSON.stringify(bx).length);
  // „Pošalji kao link“ — pesme u linku, učenik uvozi kao od nastavnika
  const url = await T.evaluate(async (songIds) => {
    let u = ''; navigator.share = async (d) => { u = d.url; };
    const { songs } = await import('./src/db.js'); const B = await import('./src/teachBox.js');
    await B.shareSongsAsLink([await songs.get(songIds[0]), await songs.get(songIds[1])], 'Za Anu');
    return u;
  }, ids.songIds);
  expect(/#g=/.test(url) && url.length < 7000, 'link sa pesmama', url.length);
  expect(url.startsWith('https://bagaljivko.github.io/Gitara/#g='), 'link nije na adresi aplikacije', url.slice(0, 60));
  await S.goto(S.url().split('#')[0] + url.slice(url.indexOf('#'))); await S.waitForTimeout(1800);
  await S.click('#shAdd'); await S.waitForTimeout(1200);
  const linkSet = await S.evaluate(async () => { const C = await import('./src/collections.js'); return (await C.getSetlists()).filter((x) => x.fromT && x.name === 'Za Anu').length; });
  expect(linkSet === 1, 'link od nastavnika nije uvezen kao „od nastavnika“');
}
