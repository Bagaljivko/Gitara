// v2.5.70 (Mile): posle prelaska — YouTube linkovi i slike učenika pregaženi starijom kopijom sa uređaja koji danima nije
// sinhronizovao vraćaju se SAMI. Samo dodaje: postojeći link/slika se ne menja, obrisana pesma ostaje obrisana, a stara
// kopija uređaja koji je prešao sam (via auto) se ne koristi. Jednom po uređaju.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'Posle prelaska: vraćanje pregaženih YouTube linkova i slika učenika (samo dodaje)';
export const timeout = 90;

export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/pesme', 900);
  const setup = (via) => p.evaluate(async (via) => {
    const db = await import('./src/db.js'); const B = await import('./src/backups.js'); const E = await import('./src/syncEngine.js');
    for (const s of await db.songs.all()) await db.songs.remove(s.id);
    const mk = (title, yt) => db.songs.save({ title, artist: 'A', ...(yt ? { yt } : {}), sections: [{ name: 'S', lines: [{ text: 'tekst ' + title, chords: [{ chord: 'G', position: 0 }] }] }] });
    const a = await mk('Sa linkom', { listen: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' });
    const b = await mk('Druga', { listen: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' });
    const c = await mk('Obrisana', { listen: 'https://www.youtube.com/watch?v=ccccccccccc' });
    const d = await mk('Moj novi link', { listen: 'https://www.youtube.com/watch?v=ddddddddddd' });
    await db.settings.set('students', [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Marko' }, { id: 'u3', name: 'Iva' }]);
    await db.settings.set('studentPhotos', [{ id: 'u1', u: 'data:image/jpeg;base64,AAA1' }, { id: 'u2', u: 'data:image/jpeg;base64,AAA2' }]);
    // kopija pre prelaska (kao u migrate.js)
    const data = await B.buildFull();
    await db.settings.set('migCopy', { at: Date.now(), n: data.songs.length, gz: await E.gzip(data) });
    // posle prelaska: starija kopija sa drugog uređaja pregazila (bez linkova, bez slika); 'Druga' ima sačuvanu „Prethodnu verziju“
    const strip = async (s) => { const { yt, ...rest } = await db.songs.get(s.id); await db.songs.save(rest); };
    await strip(a); await strip(b);
    await db.versions.save('song:' + b.id, { ...b }, 'conflict');
    await db.songs.remove(c.id);
    await db.songs.save({ ...(await db.songs.get(d.id)), yt: { listen: 'https://www.youtube.com/watch?v=eeeeeeeeeee' } }); // posle prelaska izabran drugi snimak
    await db.settings.set('studentPhotos', [{ id: 'u2', u: 'data:image/jpeg;base64,NOVA' }]); // Ana bez slike, Marko ima novu
    await db.settings.set('mig', { done: true, doneAt: Date.now(), started: Date.now() - 60000, via, copy: { n: 4 } });
    return { a: a.id, b: b.id, c: c.id, d: d.id };
  }, via);
  const heal = () => p.evaluate(async () => (await import('./src/migrate.js')).healAfterMove());
  const state = (ids) => p.evaluate(async (ids) => {
    const db = await import('./src/db.js');
    const y = async (id) => { const s = await db.songs.get(id); return s ? (s.yt && s.yt.listen) || '' : null; };
    return { a: await y(ids.a), b: await y(ids.b), c: await y(ids.c), d: await y(ids.d), ph: (await db.settings.get('studentPhotos', [])).map((x) => x.id + ':' + x.u.slice(-4)).sort(), mig: await db.settings.get('mig', null) };
  }, ids);

  // 1) uređaj koji je vodio prelazak (prijava): kopija + prethodne verzije
  let ids = await setup('prijava');
  let r = await heal();
  let s = await state(ids);
  eq(r, { yt: 2, ph: 1 }, 'vraćeno (prijava)');
  expect(s.a.endsWith('aaaaaaaaaaa') && s.b.endsWith('bbbbbbbbbbb'), 'pregaženi linkovi nisu vraćeni', s);
  eq(s.c, null, 'obrisana pesma se vratila');
  expect(s.d.endsWith('eeeeeeeeeee'), 'postojeći (noviji) link zamenjen starim', s);
  eq(s.ph, ['u1:AAA1', 'u2:NOVA'], 'slike učenika');
  expect(s.mig.healed, 'nije zapamćeno da je popravka urađena');
  eq(await heal(), null, 'popravka se ponavlja');

  // 2) uređaj koji je prešao sam (auto): stara kopija se NE koristi — samo „Prethodna verzija“ (dokaz da je pregaženo)
  ids = await setup('auto');
  r = await heal();
  s = await state(ids);
  eq(r, { yt: 1, ph: 0 }, 'vraćeno (auto)');
  expect(s.a === '' && s.b.endsWith('bbbbbbbbbbb'), 'auto uređaj koristio staru kopiju', s);
  eq(s.ph, ['u2:NOVA'], 'auto uređaj vratio slike iz stare kopije');
  expect(!p.errs.length, 'greške', p.errs);
  await p.close();
}
