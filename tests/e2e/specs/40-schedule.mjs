// v2.4.24: raspored — redovan termin (dan, vreme, trajanje, ponavljanje), sledeći čas se sam računa i šalje učeniku,
// pomeri/otkaži jedan čas (učenik obavešten), .ics za kalendar telefona, „Raspored“ (telefon lista, računar mreža),
// rođendan u nedelji, učenik: sledeći čas sa „Dodaj u kalendar“ i „Ne mogu da dođem“ → nastavniku 🔔.
import { open, boot, expect, fakeDrive, overflowCheck } from '../lib.mjs';
export const name = 'raspored: redovan termin, pomeri/otkaži, kalendar (Google / .ics), učenik — sledeći čas, ne mogu da dođem';
export const timeout = 220;
const SHOT = process.env.MARLI_SHOTS || '';
export async function run(ctx) {
  const drive = {};
  for (const dev of ['phone', 'desk']) {
    const t = await open(ctx, dev); await fakeDrive(t, drive); await boot(t, ctx, '#/tuner', 900);
    const ids = await t.evaluate(async () => {
      const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' });
      const a = await M.addStudent({ name: 'Ana' }); await M.updateStudent(a.id, { box: { f: 'BOX_ANA' } });
      const b = await M.addStudent({ name: 'Marko' });
      const now = new Date(); await M.updateStudent(b.id, { bd: { d: now.getDate(), m: now.getMonth() + 1 }, next: Date.now() + 2 * 3600e3 });
      return [a.id, b.id];
    });
    // redovan termin kroz dijalog: utorak 17:30, 60 min, svake nedelje
    await t.go('#/ucenik/' + ids[0], 1200);
    await t.evaluate((id) => import('./src/lessons.js').then((L) => { window.__slot = L.nextFlow(id); }), ids[0]);
    await t.waitForTimeout(500);
    await t.click('.sch-dlg [data-dow="1"]'); await t.fill('#schHm', '17:30'); await t.selectOption('#schDur', '60');
    if (SHOT && dev === 'phone') await t.screenshot({ path: SHOT + 'termin.png' });
    await t.click('.modal-backdrop .btn.primary'); await t.waitForTimeout(1200);
    const r = await t.evaluate(async (id) => {
      const M = await import('./src/teach.js'); const st = await M.getStudent(id); const S = await import('./src/schedule.js');
      const d = new Date(st.next);
      const ics = S.icsFor({ title: 'Čas', start: st.next, dur: 60, every: 1, uid: 'x' });
      return { slot: st.slot, next: st.next, dow: (d.getDay() + 6) % 7, hm: `${d.getHours()}:${d.getMinutes()}`, ics, box: JSON.parse(localStorage.getItem('__x') || 'null') };
    }, ids[0]);
    expect(r.slot && r.slot.dow === 1 && r.slot.dur === 60 && r.dow === 1 && r.hm === '17:30' && r.next > Date.now(), dev + ': termin i sledeći čas', r);
    expect(/RRULE:FREQ=WEEKLY;INTERVAL=1/.test(r.ics) && /BEGIN:VALARM/.test(r.ics), dev + ': .ics bez ponavljanja/podsetnika', r.ics);
    const box = JSON.parse(drive.BOX_ANA || '{}'); const les = (box.items || []).find((x) => x.kind === 'lesson');
    expect(les && les.next === r.next && les.dur === 60 && les.every === 1, dev + ': sledeći čas nije poslat učeniku', les);
    // Raspored
    await t.go('#/raspored', 1500);
    const sv = await t.evaluate(() => ({ h: document.querySelector('.sch-view h1')?.textContent, ev: document.querySelectorAll('[data-occ]').length, bd: [...document.querySelectorAll('.sch-mark.bd, .sch-gm')].length }));
    expect(sv.h === 'Raspored' && sv.bd >= 1, dev + ': raspored (naslov, rođendan)', sv);
    const o = await overflowCheck(t); expect(!o.items.length, dev + ': izlazi van ekrana', o);
    // pomeri sledeći čas (+1 dan) — učenik dobija novo vreme
    const moved = await t.evaluate(async (id) => {
      const M = await import('./src/teach.js'); const S = await import('./src/schedule.js'); const st = await M.getStudent(id);
      const occ = S.occurrences(st, Date.now(), Date.now() + 15 * 864e5)[0]; const slot = S.cleanSlot(st.slot); slot.moved[occ.key] = occ.ts + 864e5;
      await M.updateStudent(id, { slot }); await S.refreshNext({ only: id }); return { want: occ.ts + 864e5, next: (await M.getStudent(id)).next };
    }, ids[0]);
    const les2 = (JSON.parse(drive.BOX_ANA || '{}').items || []).find((x) => x.kind === 'lesson');
    expect(moved.next === moved.want && les2.next === moved.want, dev + ': pomeren čas nije poslat', [moved, les2]);
    if (dev === 'phone') {
      await t.go('#/raspored?w=0', 1200);
      if (SHOT) await t.screenshot({ path: SHOT + 'raspored.png' });
    } else if (SHOT) await t.screenshot({ path: SHOT + 'raspored-desk.png' });
    // „Ne mogu da dođem“ od učenika → zvonce
    const nt = await t.evaluate(async (id) => { const M = await import('./src/teach.js'); const B = await import('./src/teachBox.js'); await B.ingestOut(await M.getStudent(id), [{ id: 'c1', type: 'cant', ts: Date.now() + 864e5, at: Date.now() }]); return (await (await import('./src/notify.js')).list()).map((n) => n.t); }, ids[0]);
    expect(nt.some((x) => /Ana ne može da dođe na čas/.test(x)), dev + ': nema obaveštenja „ne može da dođe“', nt);
    expect(!t.errs.length, dev + ': greške', t.errs);
  }
  // ---------- učenik: sledeći čas ----------
  const s = await open(ctx, 'phone'); await fakeDrive(s, drive); await boot(s, ctx, '#/tuner', 900);
  await s.evaluate(async () => { const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Mile', tid: 'T1', sid: 'S1', box: 'BOX_ANA' }); });
  drive.BOX_ANA = JSON.stringify({ ...JSON.parse(drive.BOX_ANA), type: 'box', tid: 'T1' });
  await s.evaluate(async () => (await import('./src/teachBox.js')).checkBox({ force: true }));
  await s.go('#/od-nastavnika', 1500);
  const sc = await s.evaluate(() => ({ card: document.querySelector('.les-card')?.innerText || '', cal: !!document.querySelector('[data-lcal]'), cant: !!document.querySelector('[data-lcant]') }));
  expect(/60 min/.test(sc.card) && /Svake nedelje/.test(sc.card) && sc.cal && sc.cant, 'učenik: kartica sledećeg časa', sc);
  if (SHOT) await s.screenshot({ path: SHOT + 'ucenik.png' });
  // v2.5.61: „Dodaj u kalendar“ → Google kalendar (popunjen, svake nedelje) ili drugi kalendar (.ics)
  await s.click('[data-lcal]'); await s.waitForTimeout(700);
  const gc = await s.evaluate(() => { const a = document.querySelector('.cal-dlg [data-cal="g"]'); const u = a ? new URL(a.href) : null; return { ics: !!document.querySelector('.cal-dlg [data-cal="ics"]'), host: u && u.host, blank: a && a.target, text: u && u.searchParams.get('text'), dates: u && u.searchParams.get('dates'), recur: u && u.searchParams.get('recur') }; });
  expect(gc.host === 'calendar.google.com' && gc.blank === '_blank' && gc.ics && /Mile/.test(gc.text) && /^\d{8}T173000\/\d{8}T183000$/.test(gc.dates) && gc.recur === 'RRULE:FREQ=WEEKLY;INTERVAL=1', 'učenik: Google kalendar (popunjen) i drugi kalendar', gc);
  await s.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()));
  expect(!s.errs.length, 'učenik: greške', s.errs);
}
