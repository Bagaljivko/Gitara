// v2.4.35: PDF lista akorada (izmišljen, napravljen u testu): uvoz uzima i nacrtano — ritam iz strelica, hvatove iz
// dijagrama — i savete: „Practise this“ → korak „Sa lista“ na putu kroz pesmu, „Watch out for … after the C“ → promena C → D.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'List akorada (PDF): ritam iz strelica, hvatovi iz dijagrama, saveti → koraci na putu kroz pesmu';
export const timeout = 150;

async function makePdf(p, { title = 'Sunny Road', link = true } = {}) {
  return p.evaluate(async ({ title, link }) => {
    if (!window.jspdf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = './vendor/jspdf.umd.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const T = (s, x, y, size, o) => { doc.setFontSize(size); doc.text(s, x, y, o); };
    T('THE SONG PATH  LEVEL 1', 52, 50, 8.5); T('Song 2 of 10', 490, 50, 8.5);
    T(title, 52, 90, 32); T('Capo 2nd fret', 470, 94, 10);
    T('Some Band', 52, 110, 13); T('Standard tuning', 460, 110, 10);
    T('CHORDS', 52, 160, 8.5);
    const SS = 14, FS = 17;
    const dia = (name, x0, top, frets, fingers) => {
      T(name, x0 + 2.5 * SS, top - 20, 15, { align: 'center' });
      for (let s = 0; s < 6; s++) doc.line(x0 + s * SS, top, x0 + s * SS, top + 4 * FS);
      for (let f = 1; f <= 4; f++) doc.line(x0, top + f * FS, x0 + 5 * SS, top + f * FS);
      frets.forEach((f, s) => { const x = x0 + s * SS; if (f > 0) T(String(fingers[s]), x, top + (f - 0.5) * FS + 2.5, 7.5, { align: 'center' }); if (f < 0) { doc.line(x - 3, top - 6, x + 3, top - 12); doc.line(x - 3, top - 12, x + 3, top - 6); } });
    };
    dia('G', 80, 200, [3, 2, 0, 0, 3, 3], [2, 1, 0, 0, 3, 4]);
    dia('C', 220, 200, [-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]);
    dia('D', 360, 200, [-1, -1, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]);
    T('STRUM', 52, 300, 8.5);
    const labs = ['1', '2', '&', '3', '&', '4', '&'], dirs = ['D', 'D', 'U', '-', 'U', 'D', 'U'], ly = 356;
    labs.forEach((l, k) => {
      const x = 160 + k * 44; T(l, x, ly, 7.5, { align: 'center' });
      doc.line(x, ly - 37, x, ly - 15);
      if (dirs[k] === 'D') { doc.line(x - 5, ly - 20, x, ly - 13); doc.line(x, ly - 13, x + 5, ly - 20); }
      if (dirs[k] === 'U') { doc.line(x - 5, ly - 32, x, ly - 39); doc.line(x, ly - 39, x + 5, ly - 32); }
    });
    T('The Campfire strum, easy and even. One go per chord box.', 150, 376, 9.5);
    T('WATCH OUT FOR', 52, 410, 8.5);
    T('1. The D in the verse. It comes in quick after the C.', 52, 426, 9.5);
    T('PRACTISE THIS', 52, 460, 8.5);
    T('The verse on its own: G, C, D, round and round.', 52, 476, 9.5);
    doc.addPage();
    T('THE SONG', 52, 60, 8.5);
    const SW = link ? {} : { G: 'Am', C: 'F', D: 'E' }; // druga pesma (bez linka) — drugi akordi, da ne bude ista pesma
    const row = (y, chs, rep) => { chs.forEach((c, k) => T(SW[c] || c, 130 + k * 60, y, 11)); if (rep) T(rep, 450, y, 11); };
    T('INTRO', 52, 100, 9); row(100, ['G', 'C', 'D'], '×2');
    T('VERSE', 52, 140, 9); row(140, ['G', 'C', 'D', 'G']); row(160, ['C', 'D', 'G']);
    T('CHORUS', 52, 200, 9); row(200, ['C', 'G', 'D', 'G']);
    T('THE PLAY THROUGH', 52, 240, 8.5);
    ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus'].forEach((n, k) => T(n, 60 + k * 70, 262, 9));
    if (link) { T('Watch', 52, 700, 12); T('Learn it with me in the video.', 52, 716, 9.5); doc.link(52, 690, 200, 30, { url: 'https://www.youtube.com/watch?v=LESSONabc12' }); }
    return [...new Uint8Array(doc.output('arraybuffer'))];
  }, { title, link });
}

export async function run(ctx) {
  for (const dev of ['phone', 'desktop']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/pesme', 900);
    const bytes = await makePdf(p);
    // uvoz kao i svaki drugi PDF (red za PDF-ove)
    p.evaluate(async (b) => { const Q = await import('./src/pdfQueue.js'); await Q.importPdfs([new File([new Uint8Array(b)], 'sunny-road.pdf', { type: 'application/pdf' })]); }, bytes).catch(() => {});
    await p.waitForSelector('.modal-backdrop .btn.primary', { timeout: 20000 });
    await p.click('.modal-backdrop .btn.primary');
    let song = null;
    for (let i = 0; i < 40 && !song; i++) { await p.waitForTimeout(500); song = await p.evaluate(async () => { const { songs } = await import('./src/db.js'); const x = (await songs.list()).find((s) => s.title === 'Sunny Road'); return x ? songs.get(x.id) : null; }); }
    expect(song, dev + ': pesma nije uvezena');
    eq(song.capo, 2, dev + ': kapodaster');
    expect(song.yt && /LESSONabc12/.test(song.yt.tutorial || '') && !song.yt.listen, dev + ': video lekcija sa lista (link) povezana', song.yt);
    eq(song.strum && song.strum.steps, 'D-DU-UDU', dev + ': ritam iz strelica');
    eq(song.strum && song.strum.id, 'folk', dev + ': poznat obrazac (Folk)');
    const gIdx = await p.evaluate(async () => { const C = await import('./src/chords.js'); return C.matchVoicing('G', [3, 2, 0, 0, 3, 3]); });
    expect(gIdx > 0 && song.shapes && song.shapes.G === gIdx && song.shapes.C === undefined, dev + ': hvat G sa lista (320033), C podrazumevan', song.shapes);
    // ekran pesme: dijagram G je hvat sa lista
    await p.go('#/pesma/' + song.id, 1500);
    const gDia = await p.evaluate(() => !!document.querySelector('.diagram-row .diagram-btn[data-chord="G"]'));
    expect(gDia, dev + ': nema dijagrama G na pesmi');
    // put kroz pesmu: „Sa lista: The verse on its own“ i promena C → D (sa lista)
    await p.go('#/vezbe/pesma/' + song.id, 1800);
    const st = await p.evaluate(() => ({ pt: document.querySelector('.lp-nd[data-plan="pt"]')?.innerText.replace(/\s+/g, ' ') || '', chg: document.querySelector('.lp-nd[data-plan="chg"]')?.innerText.replace(/\s+/g, ' ') || '' }));
    expect(/Sa lista: The verse on its own/.test(st.pt) && /G → C → D/.test(st.pt), dev + ': korak „Sa lista“', st);
    expect(/C → D \(sa lista\)/.test(st.chg), dev + ': promena sa lista', st);
    await p.click('.lp-nd[data-plan="pt"]'); await p.waitForTimeout(1500);
    const pr = await p.evaluate(() => ({ h: decodeURIComponent(location.hash), seq: [...document.querySelectorAll('.cs-seq [data-i] b')].map((b) => b.textContent).join(',') }));
    expect(/promena\?song=.*ch=G-C-D&k=pt/.test(pr.h) && pr.seq === 'G,C,D', dev + ': vežba sa lista otvara Promene sa tim nizom', pr);
    // jedan PDF bez linka (ekran za proveru) → posle čuvanja „Dodaj video uz pesmu?“: lekcija (nalepi link), pa Gotovo
    const b2 = await makePdf(p, { title: 'Quiet Lane', link: false });
    await p.go('#/pesme', 800);
    // kao korisnik: „+“ → Uvezi → izbor fajla (radi i u ugrađenoj kopiji — isti modul kao aplikacija)
    await p.click('#lAdd'); await p.waitForSelector('[data-addk="import"]', { timeout: 5000 });
    const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }), p.click('[data-addk="import"]')]);
    await fc.setFiles({ name: 'quiet-lane.pdf', mimeType: 'application/pdf', buffer: Buffer.from(b2) });
    await p.waitForSelector('#eSave', { timeout: 20000 }).catch(async () => { throw new Error('nema #eSave: ' + await p.evaluate(() => location.hash + ' | ' + [...document.querySelectorAll('.modal-backdrop, .toast')].map((m) => m.className + ':' + m.innerText.slice(0, 160)).join(' / '))); }); await p.waitForTimeout(400);
    await p.click('#eSave');
    await p.waitForSelector('.yt-ask [data-yk="tutorial"]', { timeout: 10000 }).catch(async () => { throw new Error('nema .yt-ask: ' + await p.evaluate(() => location.hash + ' | ' + [...document.querySelectorAll('.modal-backdrop, .toast')].map((m) => m.className + ':' + m.innerText.slice(0, 120)).join(' / '))); });
    const ask = await p.evaluate(() => [...document.querySelectorAll('.yt-ask [data-yk]')].map((r) => r.innerText.replace(/\s+/g, ' ')));
    expect(ask.length === 2 && /Video lekcija/.test(ask[0]) && /Uz video/.test(ask[1]), dev + ': prozor „Dodaj video“', ask);
    await p.click('.yt-ask [data-yk="tutorial"]');
    await p.waitForSelector('.yt-sheet', { timeout: 10000 });
    await p.evaluate(() => { const f = document.querySelector('.yt-paste'); f.hidden = false; f.querySelector('input').value = 'https://youtu.be/QUIETless12'; f.querySelector('[data-paste]').click(); });
    await p.waitForSelector('.yt-ask [data-yk="tutorial"]', { timeout: 10000 }); await p.waitForTimeout(300);
    const linked = await p.evaluate(() => document.querySelector('.yt-ask [data-yk="tutorial"]').innerText.replace(/\s+/g, ' '));
    expect(/povezano/.test(linked), dev + ': lekcija označena kao povezana', linked);
    await p.evaluate(() => [...document.querySelectorAll('.yt-ask .btn')].find((b) => /Gotovo/.test(b.textContent)).click());
    await p.waitForTimeout(1500);
    const q2 = await p.evaluate(async () => { const { songs } = await import('./src/db.js'); const m = /^#\/pesma\/([^/?]+)/.exec(location.hash); const s = m && (await songs.get(decodeURIComponent(m[1]))); return { h: location.hash, title: s && s.title, yt: s && s.yt, strum: s && s.strum && s.strum.id }; });
    expect(q2.yt && /QUIETless12/.test(q2.yt.tutorial || '') && /^#\/pesma\//.test(q2.h) && q2.strum === 'folk' && q2.title === 'Quiet Lane', dev + ': lekcija sačuvana, otvorena pesma', q2);
    expect(!p.errs.length, dev + ': greške', p.errs);
    await p.close();
  }
}
