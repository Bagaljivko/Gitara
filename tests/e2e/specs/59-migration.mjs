// v2.5.66: prelazak na novu Google vezu (nov Cloud projekat) — kroz pravu aplikaciju, sa simulatorom Google-a
// (tests/sim/driveSim.mjs): stari i novi klijent, stari i novi pomoćnik, skrivene fascikle po projektu.
// Proverava: uspešan prelazak (pesme, Gemini ključ, podešavanja na novoj vezi; kopija na uređaju), neuspelo slanje →
// „Pokušaj ponovo“ → uspeh, drugi nalog, dečji (nadzirani) nalog, nov korisnik bez ekrana, posle prelaska bez slanja na staru vezu.
import { readFileSync } from 'node:fs';
import { open, boot, expect, eq } from '../lib.mjs';
import { createSim, installSim } from '../../sim/driveSim.mjs';
export const name = 'Prelazak na novu Google vezu (uspeh, greške, drugi nalog, dečji nalog, nov korisnik)';
export const timeout = 240;

const rd = (root, p, k) => (new RegExp(`${k}\\s*=\\s*'([^']*)'`).exec(readFileSync(new URL(p, root), 'utf8')) || [])[1];
const KID_T = 'Zamoli roditelja da odobri prijavu';

export async function run(ctx) {
  const root = new URL('file://' + ctx.root.replace(/\/?$/, '/'));
  const OLD = { client: rd(root, 'src/oldAuth.js', 'OLD_CLIENT_ID'), helper: rd(root, 'src/oldAuth.js', 'OLD_TOKEN_HELPER') };
  const NEW = { client: rd(root, 'src/drive.js', 'CLIENT_ID'), key: rd(root, 'src/shareConfig.js', 'SHARE_API_KEY'), helper: rd(root, 'src/shareConfig.js', 'TOKEN_HELPER') };
  expect(OLD.client && NEW.client && OLD.client !== NEW.client, 'stari i novi klijent', { OLD, NEW });
  const sim = createSim({
    projects: { OLD: { apis: ['drive', 'youtube'] }, NEW: { apis: ['drive', 'youtube'] } },
    clients: { [OLD.client]: { project: 'OLD' }, [NEW.client]: { project: 'NEW' } },
    keys: { [NEW.key]: { project: 'NEW', apis: ['drive', 'youtube'] }, 'AIzaOLD-sim': { project: 'OLD' } },
    helpers: { [OLD.helper]: { client: OLD.client }, [NEW.helper]: { client: NEW.client } },
  });

  // korisnik koji je koristio sinhronizaciju na staroj vezi (stari ključ sačuvan kao u 2.5.65)
  async function oldUser(email, { kid = false, extra = null, dels = 0 } = {}) {
    sim.addUser(email);
    const tok = sim.issueToken(email, 'OLD', 'drive.file drive.appdata').access_token;
    const p = await open(ctx, 'phone', { mig: true, init: () => { window.__marliTest = { ...(window.__marliTest || {}), authStuckMs: 1500 }; } });
    const dev = await installSim(sim, p.context(), sim.device({ accounts: [email] }), { initScript: true });
    if (kid) dev.default = 'deny';
    await p.goto(ctx.base + '#/pesme'); await p.waitForTimeout(400);
    await p.evaluate(async ({ email, tok, extra, dels }) => {
      const db = await import('./src/db.js');
      for (let i = 0; i < 12; i++) await db.songs.save({ title: 'Stara ' + i, artist: 'Bend', sections: [{ name: 'S', lines: [{ text: 'tekst ' + i, chords: [{ chord: 'G', position: 0 }] }] }] });
      for (let i = 0; i < dels; i++) { const s = await db.songs.save({ title: 'Obrisana ' + i, artist: 'Bend', sections: [{ name: 'S', lines: [{ text: 'x' + i, chords: [] }] }] }); await db.songs.remove(s.id); } // ranije obrisane / spojene
      await db.settings.set('geminiKey', 'AIzaMigTestKey_0123456789abcdefghijk');
      await db.settings.set('practice', { v: 1, games: { pauk: { best: 77, plays: 5 } }, songs: {} });
      await db.settings.set('syncCfg', { on: true, email });
      await db.settings.set('driveToken', { t: tok, exp: Date.now() + 3500e3, s: 2, f: 1 });
      if (extra) await db.settings.set(extra.k, extra.v);
      await db.settings.set('mig', {}); // prvo pokretanje (pre ovih podataka) je zapisalo „nov korisnik“ — kao da je 2.5.65 već imala ove podatke
    }, { email, tok, extra, dels });
    await p.reload(); return { p, dev };
  }
  const gate = (p) => p.waitForSelector('#migGate', { timeout: 15000 }).then(() => true).catch(() => false);
  const h1 = (p) => p.evaluate(() => document.querySelector('#migGate h1')?.textContent || '');
  const mig = (p) => p.evaluate(async () => (await (await import('./src/db.js')).settings.get('mig', null)) || {});
  async function finish(p, n = 60) { for (let i = 0; i < n; i++) { const m = await mig(p); if (m.done) return m; const b = await p.$('#migGate [data-mg="go"]'); if (b && !/Zamoli/.test(await h1(p))) await b.click().catch(() => {}); await p.waitForTimeout(500); } return mig(p); }
  const newFiles = (email) => sim.listFiles({ owner: email, project: 'NEW', appData: true });

  // 1) uspeh: ekran bez „Kasnije“ i bez ✕; kopija na uređaju; sve na novoj vezi (pesme, Gemini ključ, Vežbe)
  {
    sim.addUser('a@x.test');
    const oldF = sim.seedFolder('a@x.test', 'OLD', 'Gitara');
    sim.seed('a@x.test', 'OLD', { name: 'Moja pesma.pdf', mimeType: 'application/pdf', parents: [oldF.id], content: '%PDF-1.4 test' });
    sim.seed('a@x.test', 'OLD', { name: 'MARLI – cela aplikacija.json', mimeType: 'application/json', parents: [oldF.id], content: '{"app":"marli"}' });
    const { p } = await oldUser('a@x.test');
    await p.evaluate(() => { window.__marliTest = { ...(window.__marliTest || {}), bgDelay: 0 }; });
    expect(await gate(p), 'ekran prelaska se ne pojavljuje', { errs: p.errs, mig: await mig(p), ls: await p.evaluate(() => ({ off: localStorage.getItem('marli-mig-off'), wd: navigator.webdriver })) });
    eq(await h1(p), 'MARLI je ažuriran', 'naslov');
    expect(!(await p.$('#migGate [data-mg="alt"]')) && !(await p.$('#migGate .close, #migGate [aria-label="Zatvori"]')), 'ekran ima „Kasnije“ ili ✕');
    const m = await finish(p);
    expect(m.done, 'prelazak nije završen', m);
    expect(!(await p.$('#migGate')), 'ekran ostaje posle uspeha');
    const copy = await p.evaluate(async () => { const db = await import('./src/db.js'); const E = await import('./src/syncEngine.js'); const c = await db.settings.get('migCopy', null); const d = c && (await E.gunzip(c.gz)); return { n: c && c.n, songs: d && d.songs && d.songs.length, local: (await db.songs.list()).length, stare: d && d.songs ? d.songs.filter((x) => /^Stara /.test(x.title)).length : 0, key: !!(d && JSON.stringify(d).includes('AIzaMigTestKey')) }; });
    expect(copy.n === copy.local && copy.songs === copy.local && copy.stare === 12 && copy.key, 'kopija na uređaju', copy);
    // posle prelaska (v2.5.67): u „MARLI“ se kopiraju samo PDF-ovi — stare rezervne kopije ostaju u „Gitara“
    for (let i = 0; i < 40 && !(await mig(p)).cleaned; i++) await p.waitForTimeout(500);
    const mm = await mig(p);
    expect(mm.oldFiles && mm.cleaned, 'posao posle prelaska nije završen', mm);
    const inNew = sim.listFiles({ owner: 'a@x.test', project: 'NEW', appData: false }).map((f) => f.name);
    expect(inNew.includes('Moja pesma.pdf'), 'PDF nije kopiran u „MARLI“', inNew);
    expect(!inNew.includes('MARLI – cela aplikacija.json'), 'stara rezervna kopija kopirana u „MARLI“', inNew);
    expect(sim.listFiles({ owner: 'a@x.test', project: 'OLD' }).some((f) => f.name === 'MARLI – cela aplikacija.json'), 'stara kopija obrisana iz „Gitara“');
    // čišćenje onoga što je 2.5.66 kopirao: rezervna kopija napravljena odmah posle prelaska se briše; ručno sačuvana kasnije ostaje
    const cl = await p.evaluate(async () => {
      const D = await import('./src/drive.js'); const db = await import('./src/db.js'); const M = await import('./src/migrate.js');
      await D.saveToFolder('MARLI – cela aplikacija.json', new Blob(['{"old":1}'], { type: 'application/json' }), 'application/json');
      const m = await db.settings.get('mig', null); await db.settings.set('mig', { ...m, cleaned: 0 });
      await M.cleanCopiedBackups();
      const after = (await D.folderFiles()).map((f) => f.name);
      return { after, n: (await db.settings.get('mig', null)).cleanedN };
    });
    expect(cl.n === 1 && !cl.after.includes('MARLI – cela aplikacija.json') && cl.after.includes('Moja pesma.pdf'), 'čišćenje kopija iz 2.5.66', cl);
    const files = newFiles('a@x.test');
    expect(files.length >= 1, 'nova skrivena fascikla je prazna', files.length);
    // nov uređaj, samo nova veza: dobija sve
    const q = await open(ctx, 'phone', { mig: true });
    const d2 = await installSim(sim, q.context(), sim.device({ accounts: ['a@x.test'] }), { initScript: true });
    await q.goto(ctx.base + '#/pesme'); await q.waitForTimeout(500);
    const got = await q.evaluate(async () => { const M = (n) => import(performance.getEntriesByType('resource').map((r) => r.name).find((x) => x.includes('/src/' + n)) || './src/' + n); const S = await M('sync.js'); await S.connectSync(); const db = await M('db.js'); const st = async () => (await db.songs.list()).filter((x) => /^Stara /.test(x.title)).length; for (let i = 0; i < 30 && (await st()) < 12; i++) await new Promise((r) => setTimeout(r, 500)); return { songs: await st(), key: await db.settings.get('geminiKey', ''), best: (((await db.settings.get('practice', null)) || {}).games || {}).pauk?.best }; });
    eq(got, { songs: 12, key: 'AIzaMigTestKey_0123456789abcdefghijk', best: 77 }, 'nov uređaj na novoj vezi');
    expect(d2 && !p.errs.length && !q.errs.length, 'greške', [...p.errs, ...q.errs]);
    // posle prelaska: „Preuzmi pesme iz stare veze“ samo preuzima — ništa ne upisuje na staru vezu
    const oldBefore = sim.listFiles({ owner: 'a@x.test', project: 'OLD' }).length;
    await p.go('#/podesavanja', 900);
    const r = await p.evaluate(async () => { try { return await (await import('./src/migrate.js')).pullFromOld(); } catch (e) { return 'err:' + (e && e.code); } });
    expect(typeof r === 'number', 'preuzimanje iz stare veze', r);
    eq(sim.listFiles({ owner: 'a@x.test', project: 'OLD' }).length, oldBefore, 'upis na staru vezu posle prelaska');
  }

  // 1b) (Mile, v2.5.69) mnogo ranije obrisanih pesama: prelazak ne pita za stara brisanja (pitanje je bilo ispod ekrana
  //     prelaska → „0 od 153“ zauvek) — završi se sam, bez dijaloga
  {
    const { p } = await oldUser('del@x.test', { dels: 15 });
    const tombs = await p.evaluate(async () => { const S = await import('./src/syncLocal.js').catch(() => null); return S ? 'ok' : 'nema'; });
    expect(await gate(p), 'ekran prelaska (brisanja)', { errs: p.errs, mig: await mig(p) });
    const m = await finish(p, 50);
    const asked = await p.evaluate(() => [...document.querySelectorAll('.modal-backdrop')].map((x) => x.innerText.slice(0, 80)));
    expect(m.done, 'prelazak sa mnogo starih brisanja nije završen (stoji na „0 od …“)', { asked, h1: await h1(p), tombs, m });
    expect(!asked.length, 'pitanje tokom prelaska', asked);
    const keys = newFiles('del@x.test').map((x) => x.appProperties && x.appProperties.k).filter(Boolean);
    expect(keys.length > 0, 'ništa na novoj vezi');
    await p.close();
  }

  // 2) slanje na novu vezu ne uspe → ekran greške sa „Pokušaj ponovo“ → uspeh; ništa izgubljeno, bez duplikata
  {
    const { p, dev: devB } = await oldUser('b@x.test');
    const f = sim.fail({ status: 500, reason: 'backendError', times: 40, match: (q) => q.project === 'NEW' && q.user === 'b@x.test' && q.method !== 'GET' });
    expect(await gate(p), 'ekran (greška)');
    await p.click('#migGate [data-mg="go"]');
    let sawRetry = false;
    for (let i = 0; i < 60 && !sawRetry; i++) { sawRetry = /Pokušaj ponovo/.test(await p.evaluate(() => document.querySelector('#migGate [data-mg="go"]')?.textContent || '')); await p.waitForTimeout(500); }
    expect(sawRetry, 'nema „Pokušaj ponovo“ posle neuspelog slanja', await h1(p));
    expect(!(await mig(p)).done, 'označeno kao gotovo iako slanje nije uspelo');
    f.cancel();
    const m = await finish(p);
    expect(m.done, 'posle ponovnog pokušaja nije završeno', m);
    const pops = devB.log.filter((x) => x.client_id === NEW.client && x.prompt !== 'none' && x.kind !== 'revoke').length;
    eq(pops, 1, 'Google prozor posle „Pokušaj ponovo“ (treba samo jedna prijava)');
    const keys = newFiles('b@x.test').map((x) => x.appProperties && x.appProperties.k).filter((k) => k && k !== 'snapshot');
    const dupK = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupK.length && process.env.MIGDBG) (await import('node:fs')).writeFileSync(process.env.MIGDBG, JSON.stringify({ dupK, files: newFiles('b@x.test').map((x) => [x.appProperties && x.appProperties.k, x.createdTime]), log: sim.log.filter((l) => l.project === 'NEW').map((l) => [l.t, l.ep, l.user, l.status, l.reason]) }, null, 0));
    expect(!dupK.length, 'duplikati na novoj vezi', { dupK, files: newFiles('b@x.test').filter((x) => dupK.includes(x.appProperties && x.appProperties.k)).map((x) => [x.appProperties.k.slice(0, 12), x.appProperties.h.slice(10, 16), x.createdTime.slice(14, 23), x.id.slice(0, 6)]), log: sim.log ? sim.log.filter((l) => l.user === 'b@x.test' && l.project === 'NEW').slice(0, 80).map((l) => l.ep + ':' + l.status + (l.reason ? ':' + l.reason : '')) : null });
    expect(!p.errs.length, 'greške', p.errs);
  }

  // 3) drugi nalog → ekran „izaberi …“ → pravi nalog → uspeh
  {
    sim.addUser('drugi@x.test');
    const { p, dev } = await oldUser('c@x.test');
    dev.accounts.push('drugi@x.test'); dev.next({ pick: 'drugi@x.test' });
    expect(await gate(p), 'ekran (drugi nalog)');
    await p.click('#migGate [data-mg="go"]');
    let sawAcct = false;
    for (let i = 0; i < 30 && !sawAcct; i++) { sawAcct = /c@x\.t|Izaberi|nalog/i.test(await h1(p)) && !/MARLI je ažuriran/.test(await h1(p)); await p.waitForTimeout(400); }
    expect(sawAcct, 'nema ekrana za drugi nalog', await h1(p));
    expect(!newFiles('drugi@x.test').length, 'podaci poslati na pogrešan nalog');
    const m = await finish(p);
    expect(m.done && m.acct && m.acct.email === 'c@x.test', 'pravi nalog', m.acct);
  }

  // 4) dečji nalog: roditelj nije odobrio → dečji ekran; „Nastavi dok čekaš“ → aplikacija radi; ponovo otvoreno → isti ekran;
  //    roditelj odobri → nastavlja se bez ijednog dodira (tiha prijava uspe)
  {
    const { p, dev } = await oldUser('dete@x.test', { kid: true });
    expect(await gate(p), 'ekran (dete)');
    await p.click('#migGate [data-mg="go"]');
    for (let i = 0; i < 20 && (await h1(p)) !== KID_T; i++) await p.waitForTimeout(300);
    eq(await h1(p), KID_T, 'dečji ekran');
    await p.click('#migGate [data-mg="alt"]'); await p.waitForTimeout(400);
    expect(!(await p.$('#migGate')), '„Nastavi dok čekaš“ ne zatvara ekran');
    eq(await p.evaluate(async () => (await (await import('./src/db.js')).songs.list()).filter((x) => /^Stara /.test(x.title)).length), 12, 'pesme dok čeka');
    await p.reload();
    expect(await gate(p), 'ekran posle ponovnog otvaranja');
    await p.waitForTimeout(800);
    eq(await h1(p), KID_T, 'posle ponovnog otvaranja — dečji ekran');
    await p.click('#migGate [data-mg="alt"]'); await p.waitForTimeout(300);
    sim.issueToken('dete@x.test', 'NEW', 'drive.file drive.appdata'); dev.default = 'approve'; // roditelj odobrio
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    let m = {};
    for (let i = 0; i < 40 && !m.done; i++) { m = await mig(p); const b = await p.$('#migGate [data-mg="go"]'); if (b && !/Zamoli/.test(await h1(p))) await b.click().catch(() => {}); await p.waitForTimeout(500); }
    expect(m.done, 'posle odobrenja se ne nastavlja samo', m);
    expect(!p.errs.length, 'greške', p.errs);
  }

  // 4b) dva uređaja istog naloga: prvi pređe (prijava), drugi pređe SAM — bez dugmeta i bez Google prozora
  {
    const { p: p1 } = await oldUser('dva@x.test');
    expect(await gate(p1), 'ekran (prvi uređaj)');
    const m1 = await finish(p1);
    expect(m1.done, 'prvi uređaj nije prešao', m1);
    for (let i = 0; i < 20 && !(await mig(p1)).handoff; i++) await p1.waitForTimeout(500);
    expect((await mig(p1)).handoff, 'prvi uređaj nije ostavio predaju', await mig(p1));
    const { p: p2, dev: d2 } = await oldUser('dva@x.test');
    const popupsBefore = d2.log.filter((x) => x.client_id === NEW.client && x.prompt !== 'none').length;
    let m2 = {};
    for (let i = 0; i < 40 && !m2.done; i++) { m2 = await mig(p2); await p2.waitForTimeout(500); } // bez ijednog dodira
    expect(m2.done, 'drugi uređaj nije prešao sam', { m2, h: await h1(p2) });
    eq(d2.log.filter((x) => x.client_id === NEW.client && x.prompt !== 'none').length, popupsBefore, 'drugi uređaj je otvorio Google prozor');
    eq(await p2.evaluate(async () => (await (await import('./src/db.js')).songs.list()).filter((x) => /^Stara /.test(x.title)).length), 24, 'pesme na drugom uređaju (svoje 12 + 12 sa prvog uređaja)');
    expect(!p1.errs.length && !p2.errs.length, 'greške', [...p1.errs, ...p2.errs]);
  }

  // 5) potpuno nov korisnik (nikad Google): bez ekrana, nikad stara prijava
  {
    const p = await open(ctx, 'phone', { mig: true });
    const dev = await installSim(sim, p.context(), sim.device({ accounts: ['nov@x.test'] }), { initScript: true });
    await boot(p, ctx, '#/pesme', 1500);
    expect(!(await p.$('#migGate')), 'nov korisnik vidi ekran prelaska');
    const m = await mig(p);
    expect(m.done && m.fresh, 'nov korisnik: prelazak nije označen kao nepotreban', m);
    expect(!dev.log.some((x) => x.client_id === OLD.client), 'nov korisnik: stari klijent je pozvan');
  }
}
