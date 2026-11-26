// v2.5.1: rezervna kopija nosi SVE — napravi kopiju cele aplikacije, obriši sve, vrati, proveri da je sve tu:
// pesma sa hvatovima / MARLI putem / komentarima / ritmom, napredak (i koraci puta kroz pesmu, „tutorijal“), akordi koje
// znam, kursevi, set liste, folderi, učenik sa slikom (slika u svojoj listi), oznaka na uređaju. Plus: sažeta (gzip)
// kopija se čita, a kopija sa 300 pesama ostaje razumne veličine.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'rezervna kopija: sve se vraća (pesme, napredak, kursevi, učenici sa slikom), gzip, veličina';
export const timeout = 120;

export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/podesavanja', 900);
  const r = await p.evaluate(async () => {
    const { songs, settings } = await import('./src/db.js');
    const T = await import('./src/teach.js');
    const B = await import('./src/backups.js');
    const D = await import('./src/drive.js');
    const sec = [{ name: 'Strofa', type: 'verse', lines: [{ text: 'jedan stih', chords: [{ pos: 0, chord: 'G' }, { pos: 6, chord: 'C' }] }] }];
    const s = await songs.save({ title: 'Puna pesma', artist: 'A', sections: sec, capo: 2, bpm: 88, strum: { id: 'folk', sig: '4/4', steps: 'D-DU-UDU' },
      yt: { tutorial: 'https://www.youtube.com/watch?v=abcdefghijk' }, shapes: { G: 1, Fmaj7: 2 }, grips: { D: 'x5x07x/010030' }, marli: 'marli-1', cmts: [{ id: 'c1', at: 5, text: 'lepo' }], folders: ['f1'] });
    await settings.set('folders', [{ id: 'f1', name: 'Moj folder' }]);
    await settings.set('setlists', [{ id: 'sl1', name: 'Subota', songIds: [s.id], createdAt: 1 }]);
    await settings.set('courses', [{ v: 1, id: 'c1', name: 'Leto', ic: '📚', items: [{ s: s.id }], updatedAt: 1 }]);
    await settings.set('practice', { v: 1, games: { pauk: { best: 80, plays: 3 } }, songs: { [s.id]: { all: { best: 91 }, ak: { best: 90 }, chg: { best: 85 }, rp: { best: 70 }, tut: { best: 100 } } } });
    await settings.set('knownChords', ['G', 'C', 'D']);
    const st = await T.addStudent({ name: 'Ana' });
    await T.updateStudent(st.id, { photo: 'data:image/jpeg;base64,' + 'A'.repeat(4000), memo: 'beleška' });
    localStorage.setItem('gitara-pr-level-pauk', '3');
    const rawStu = (await settings.get('students', []))[0];
    const data = await B.buildFull();
    const json = JSON.stringify(data);
    // obriši sve
    await songs.clear();
    for (const k of ['folders', 'setlists', 'courses', 'practice', 'knownChords', 'students', 'studentPhotos']) await settings.remove(k);
    localStorage.removeItem('gitara-pr-level-pauk');
    // vrati (preko sažete kopije — kao dnevna kopija sa Drive-a)
    const E = await import('./src/syncEngine.js');
    const back = await D.readJsonMaybeGz(await E.gzip(JSON.parse(json)));
    await B.applyFull(back);
    const got = (await songs.all()).find((x) => x.title === 'Puna pesma') || {};
    const pr = (await settings.get('practice', {})).songs || {};
    const stu = (await T.getStudents())[0] || {};
    // veličina: 300 pesama
    const many = { ...data, songs: Array.from({ length: 300 }, (_, i) => ({ ...data.songs[0], id: 'x' + i, title: 'Pesma ' + i, sections: Array.from({ length: 6 }, (_, k) => ({ name: 'Deo ' + k, lines: Array.from({ length: 6 }, (_, l) => ({ text: `Stih ${i}-${k}-${l} sa malo reči za probu ${Math.random().toString(36).slice(2, 9)}`, chords: [{ pos: 0, chord: 'G' }, { pos: 12, chord: 'Em' }] })) })) })) };
    const raw = JSON.stringify(many).length, gz = (await E.gzip(many)).length;
    return {
      song: { shapes: got.shapes, grips: got.grips, marli: got.marli, cmts: (got.cmts || []).map((c) => c.text), strum: got.strum && got.strum.steps, yt: !!(got.yt && got.yt.tutorial), capo: got.capo, folders: got.folders },
      steps: Object.keys(pr[got.id] || {}).sort(),
      known: await settings.get('knownChords', []),
      courses: ((await settings.get('courses', [])) || []).map((c) => c.items.length),
      sets: ((await settings.get('setlists', [])) || []).map((x) => x.name),
      stu: { name: stu.name, memo: stu.memo, photo: (stu.photo || '').length, rawPhoto: 'photo' in rawStu },
      level: localStorage.getItem('gitara-pr-level-pauk'),
      size: { raw, gz },
    };
  });
  eq(r.song, { shapes: { G: 1, Fmaj7: 2 }, grips: { D: 'x5x07x/010030' }, marli: 'marli-1', cmts: ['lepo'], strum: 'D-DU-UDU', yt: true, capo: 2, folders: ['f1'] }, 'pesma posle vraćanja');
  eq(r.steps, ['ak', 'all', 'chg', 'rp', 'tut'], 'napredak pesme (i koraci puta)');
  eq(r.known, ['G', 'C', 'D'], 'akordi koje znam');
  eq(r.courses, [1], 'kursevi'); eq(r.sets, ['Subota'], 'set liste');
  expect(r.stu.name === 'Ana' && r.stu.memo === 'beleška' && r.stu.photo > 4000, 'učenik sa slikom', r.stu);
  expect(!r.stu.rawPhoto, 'slika učenika je i dalje u spisku učenika (treba u svojoj listi)', r.stu);
  expect(r.level === '3', 'oznake na uređaju (nivo igre)', r.level);
  expect(r.size.gz * 4 < r.size.raw, 'sažeta kopija nije dovoljno manja', r.size);
  ctx.note.push(`300 pesama: ${Math.round(r.size.raw / 1024)} KB → gzip ${Math.round(r.size.gz / 1024)} KB`);
  await p.close();
}
