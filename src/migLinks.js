// v2.5.66: prelazak na novu Google vezu — veze sa drugim ljudima (nastavnik ↔ učenici, deljeni linkovi).
// Fajl koji je napravila STARA veza nova veza ne može da menja. Zato: nov fajl na novoj vezi (isti sadržaj), a u stari
// fajl (starom vezom) upiše se „preseljeno na …“. Druga strana (bilo koja verzija ≥ 2.5.66) sama prati belešku — bez
// novog povezivanja, bez ponovnog slanja. Stari fajl zadržava i sav stari sadržaj (stara verzija aplikacije i dalje radi).
// Svaki korak se pamti (settings 'mig'.links), pa se posle prekida nastavlja; ništa se ne briše.
import { settings, songs as db } from './db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 350; // razmak između upisa (Google: oko 3 upisa u sekundi po nalogu)
const ID = /^[\w-]{6,}$/;

async function state() { const m = (await settings.get('mig', null)) || {}; return { ...m, links: { box: {}, plan: {}, voice: {}, shares: {}, ...(m.links || {}) } }; }
async function save(links) { const m = (await settings.get('mig', null)) || {}; await settings.set('mig', { ...m, links }); }
async function pace() { const G = await import('./driveGate.js'); while (G.cooling()) await sleep(Math.min(60000, G.coolLeft() + 500)); await sleep(GAP); }

/** Ima li ovaj uređaj veze sa drugima koje treba preseliti (bez mreže). */
export async function linksNeeded() {
  const tm = await import('./teach.js');
  const tc = await tm.getTeacher().catch(() => ({}));
  if (tc && tc.on && (await tm.getStudents()).some((s) => (s.box && s.box.f) || s.planFile)) return true;
  const m = await tm.getMyTeacher().catch(() => null);
  if (m && m.prog && m.prog.fileId && m.prog.on) return true;
  const S = await import('./shareService.js');
  return (await S.getShares()).some((r) => r && r.fileId && !r.v2);
}

/**
 * Preseli sve veze. onProgress(done, total). Vraća { ok, needOld, failed, total }.
 * needOld = stari ključ nije dostupan bez prozora (ekran „Još jedan korak“).
 */
export async function moveLinks(onProgress = () => {}) {
  const O = await import('./oldAuth.js');
  if (!(await O.oldTokenSilent('file'))) return { ok: false, needOld: true, failed: 0, total: 0 };
  const S = await import('./shareService.js'); const tm = await import('./teach.js'); const B = await import('./teachBox.js');
  const st0 = await state(); const L = st0.links;
  const tc = await tm.getTeacher().catch(() => ({}));
  const students = tc && tc.on ? await tm.getStudents() : [];
  const me = await tm.getMyTeacher().catch(() => null);
  const shares = (await S.getShares()).filter((r) => r && r.fileId && !r.v2);
  const voices = [];
  if (tc && tc.on) for (const s of await db.all()) for (const c of s.cmts || []) if (c && c.voice && ID.test(c.voice) && !L.voice[c.voice]) voices.push({ song: s, c });
  const total = students.length * 2 + voices.length + shares.length + (me && me.prog && me.prog.fileId ? 1 : 0);
  let done = 0, failed = 0;
  const tick = () => onProgress(++done, total);
  const oldNote = async (oldId, obj) => { try { await O.oldWrite(oldId, JSON.stringify(obj)); return true; } catch (e) { if (e && e.code === 'notfound') return true; throw e; } };

  // 1) nastavnik: sanduče i plan svakog učenika
  for (const st of students) {
    try {
      if (st.box && st.box.needPtr && st.box.prev && !L.box[st.id]) {
        // sanduče je već napravljeno na novoj vezi (slanje dok je stari fajl bio nedostupan) — samo beleška u staro
        await pace();
        const cur = await S.readData(st.box.prev);
        if (cur === null) throw Object.assign(new Error('read'), { code: 'retry' });
        if (!cur.gone && cur.type === 'box') await oldNote(st.box.prev, { ...cur, moved: st.box.f, at: Date.now(), items: [...(cur.items || []), { key: 'moved', kind: 'moved', f: st.box.f, at: Date.now() }] });
        await tm.updateStudent(st.id, { box: { ...st.box, needPtr: 0, v2: 1 } });
        L.box[st.id] = st.box.f; await save(L);
      } else if (st.box && st.box.f && !L.box[st.id] && !st.box.v2) {
        await pace();
        const oldId = st.box.f;
        const cur = await S.readData(oldId);
        if (cur === null) throw Object.assign(new Error('read'), { code: 'retry' });
        const body = cur && !cur.gone && cur.type === 'box' ? cur : { app: 'marli', type: 'box', v: 1, tid: tc.id, sid: st.id, at: Date.now(), items: [] };
        const newId = L.boxNew?.[st.id] || (await S.putData('', JSON.stringify({ ...body, at: Date.now() }), { name: 'MARLI – za učenika.json' }));
        if (!newId) throw Object.assign(new Error('put'), { code: 'retry' });
        (L.boxNew = L.boxNew || {})[st.id] = newId; await save(L);
        await pace();
        if (!cur.gone) await oldNote(oldId, { ...body, moved: newId, at: Date.now(), items: [...(body.items || []), { key: 'moved', kind: 'moved', f: newId, at: Date.now() }] });
        await tm.updateStudent(st.id, { box: { ...st.box, f: newId, prev: oldId, v2: 1, at: Date.now() } });
        L.box[st.id] = newId; await save(L);
      }
      tick();
      const s2 = await tm.getStudent(st.id);
      if (s2 && s2.planFile && !L.plan[st.id] && !s2.planV2) {
        await pace();
        const oldId = s2.planFile;
        const cur = await S.readData(oldId);
        if (cur === null) throw Object.assign(new Error('read'), { code: 'retry' });
        if (cur.gone || cur.type !== 'plan') { L.plan[st.id] = '-'; await save(L); }
        else {
          const newId = L.planNew?.[st.id] || (await S.putData('', JSON.stringify({ ...cur, at: Date.now() }), { name: 'MARLI – plan.json' }));
          if (!newId) throw Object.assign(new Error('put'), { code: 'retry' });
          (L.planNew = L.planNew || {})[st.id] = newId; await save(L);
          await pace();
          await oldNote(oldId, { ...cur, moved: newId, at: Date.now() });
          await tm.updateStudent(st.id, { planFile: newId, planPrev: oldId, planV2: 1 });
          if (s2.box && s2.box.f) await B.boxPut(st.id, [{ key: 'plan', kind: 'plan', f: newId }], { interactive: false }).catch(() => false);
          L.plan[st.id] = newId; await save(L);
        }
      }
      tick();
    } catch (e) { if (e && e.code === 'auth') return { ok: false, needOld: true, failed, total }; failed++; done += 1; }
  }
  // 2) nastavnik: glasovni komentari (zvuk je samo na nastavnikovom Drive-u) — nov fajl, učenik dobija nov id kroz sanduče
  for (const { song, c } of voices) {
    try {
      if (L.voice[c.voice]) { tick(); continue; }
      await pace();
      const d = await S.readData(c.voice);
      if (d === null) throw Object.assign(new Error('read'), { code: 'retry' });
      if (d.gone || d.type !== 'voice') { L.voice[c.voice] = '-'; await save(L); tick(); continue; }
      const newId = await S.putData('', JSON.stringify(d), { name: 'MARLI – glasovni komentar.json' });
      if (!newId) throw Object.assign(new Error('put'), { code: 'retry' });
      L.voice[c.voice] = newId; await save(L);
      const cur = await db.get(song.id);
      if (cur) await db.put({ ...cur, cmts: (cur.cmts || []).map((x) => (x && x.voice === c.voice ? { ...x, voice: newId, voiceOld: c.voice } : x)) });
      const sid = song.student || (cur && cur.student);
      if (sid && c.key) await B.boxPut(sid, [{ key: c.key, kind: 'cmt', id: c.id, f: String(song.src || '').split(':')[0], text: c.text || '', voice: newId, name: song.title || '', re: 1 }], { interactive: false }).catch(() => false);
      tick();
    } catch (e) { if (e && e.code === 'auth') return { ok: false, needOld: true, failed, total }; failed++; tick(); }
  }
  // 3) učenik: fajl napretka (nastavnik ga čita)
  if (me && me.prog && me.prog.fileId && me.prog.on && !L.prog) {
    try {
      await pace();
      const oldId = me.prog.fileId;
      const cur = await S.readData(oldId);
      const P = await import('./progress.js');
      // nov fajl: syncProgress sa praznim id-jem napravi nov (na novoj vezi)
      await tm.setMyTeacher({ ...me, prog: { ...me.prog, fileId: '', prev: oldId } });
      const newId = await P.syncProgress({ force: true });
      if (!newId) { await tm.setMyTeacher({ ...(await tm.getMyTeacher()), prog: { ...me.prog } }); throw Object.assign(new Error('put'), { code: 'retry' }); }
      await pace();
      if (cur && !cur.gone && cur.type === 'progress') await oldNote(oldId, { ...cur, moved: newId, at: Date.now() });
      L.prog = newId; await save(L);
      tick();
    } catch (e) { if (e && e.code === 'auth') return { ok: false, needOld: true, failed, total }; failed++; tick(); }
  }
  // 4) deljeni linkovi (i „proveri sa nastavnikom“, snimci za nastavnika — sve su deljeni fajlovi)
  const moved = {};
  for (const r of shares) {
    try {
      if (L.shares[r.fileId]) { moved[r.fileId] = L.shares[r.fileId]; tick(); continue; }
      await pace();
      const n = await S.republishShare(r);
      if (n) {
        await pace();
        await oldNote(r.fileId, { app: 'gitara', moved: n.id });
        L.shares[r.fileId] = n; moved[r.fileId] = n; await save(L);
      } else { L.shares[r.fileId] = { id: '' }; await save(L); } // pesma više ne postoji — stari link ostaje kakav je
      tick();
    } catch (e) { if (e && e.code === 'auth') return { ok: false, needOld: true, failed, total }; failed++; tick(); }
  }
  if (Object.keys(moved).length) await S.replaceShares(moved);
  return { ok: failed === 0, needOld: false, failed, total };
}
