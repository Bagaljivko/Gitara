// PDF izvoz (samo na zahtev korisnika). jsPDF + ugrađen Unicode font (DejaVu Sans Mono) za č, ć, š, ž, đ.
import monoUrl from 'dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url';
import monoBoldUrl from 'dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url';
import { getVoicings } from './chords.js';
import { songChords } from './songformat.js';

async function fontBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('font');
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Deli liniju (akordi + tekst) na više redova ako je preduga. */
export function wrapPair(chords, text, max) {
  const out = [];
  let cs = [...chords].sort((a, b) => a.position - b.position);
  let t = text || '';
  let guard = 0;
  while (guard++ < 50) {
    const chordEnd = cs.reduce((m, c) => Math.max(m, c.position + c.chord.length), 0);
    if (t.length <= max && chordEnd <= max) { out.push([cs, t]); break; }
    let cut = t.length > max ? t.lastIndexOf(' ', max) : max;
    if (cut <= 0) cut = Math.min(max, Math.max(t.length, 1));
    // ne seci tako da akord prelazi granicu
    const head = cs.filter((c) => c.position < cut);
    const tail = cs.filter((c) => c.position >= cut);
    out.push([head, t.slice(0, cut)]);
    const shift = t[cut] === ' ' ? cut + 1 : cut;
    t = t.slice(shift);
    cs = tail.map((c) => ({ ...c, position: Math.max(0, c.position - shift) }));
    if (!t && !cs.length) break;
  }
  return out;
}

function chordLineString(chords) {
  let s = '';
  for (const c of chords) {
    let pos = c.position;
    if (s.length && pos < s.length + 1) pos = s.length + 1;
    s = s.padEnd(pos, ' ') + c.chord;
  }
  return s;
}

function drawDiagram(doc, x, y, name, accent) {
  const v = getVoicings(name)[0];
  const sw = 3.2, fh = 4, w = sw * 5;
  doc.setFont('Mono', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20);
  doc.text(name, x + w / 2, y, { align: 'center' });
  const top = y + 5;
  doc.setDrawColor(60);
  if (!v) {
    doc.setFont('Mono', 'normal');
    doc.setFontSize(6);
    doc.text('—', x + w / 2, top + 8, { align: 'center' });
    return;
  }
  doc.setLineWidth(0.2);
  for (let i = 0; i <= 5; i++) doc.line(x, top + i * fh, x + w, top + i * fh);
  for (let i = 0; i < 6; i++) doc.line(x + i * sw, top, x + i * sw, top + 5 * fh);
  if (v.baseFret === 1) { doc.setLineWidth(1); doc.line(x, top, x + w, top); doc.setLineWidth(0.2); }
  else { doc.setFont('Mono', 'normal'); doc.setFontSize(6.5); doc.text(String(v.baseFret), x + w + 1.2, top + fh * 0.75); }
  doc.setFontSize(5.5);
  v.frets.forEach((f, i) => {
    const sx = x + i * sw;
    if (f === -1) { doc.setLineWidth(0.25); doc.line(sx - 0.9, top - 2.9, sx + 0.9, top - 1.1); doc.line(sx + 0.9, top - 2.9, sx - 0.9, top - 1.1); }
    else if (f === 0) { doc.setLineWidth(0.25); doc.circle(sx, top - 2, 0.9, 'S'); }
  });
  doc.setFillColor(...accent);
  if (v.barre) {
    const by = top + (v.barre.fret - v.baseFret + 0.5) * fh;
    doc.roundedRect(x + v.barre.from * sw - 1.4, by - 1.4, (v.barre.to - v.barre.from) * sw + 2.8, 2.8, 1.4, 1.4, 'F');
  }
  v.frets.forEach((f, i) => {
    if (f <= 0) return;
    if (v.barre && f === v.barre.fret && i >= v.barre.from && i <= v.barre.to) return;
    doc.circle(x + i * sw, top + (f - v.baseFret + 0.5) * fh, 1.4, 'F');
  });
}

/** Pravi PDF i vraća Blob. */
export async function songToPdf(song, { transposeLabel = '' } = {}) {
  const [{ jsPDF }, mono, monoBold] = await Promise.all([import('jspdf'), fontBase64(monoUrl), fontBase64(monoBoldUrl)]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('DejaVuSansMono.ttf', mono);
  doc.addFont('DejaVuSansMono.ttf', 'Mono', 'normal');
  doc.addFileToVFS('DejaVuSansMono-Bold.ttf', monoBold);
  doc.addFont('DejaVuSansMono-Bold.ttf', 'Mono', 'bold');
  doc.setProperties({ title: song.title || 'Pesma', subject: song.artist || '', creator: 'Gitara' });

  const accent = [196, 120, 10];
  const M = 16, PW = 210, PH = 297, bottom = PH - 14;
  let y = M + 4;

  doc.setFont('Mono', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15);
  const titleLines = doc.splitTextToSize(song.title || 'Bez naslova', PW - 2 * M);
  doc.text(titleLines, M, y);
  y += titleLines.length * 8;
  doc.setFont('Mono', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90);
  const meta = [song.artist, song.key ? `Tonalitet: ${song.key}` : '', transposeLabel].filter(Boolean).join('  ·  ');
  if (meta) { doc.text(meta, M, y); y += 6; }
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.6);
  doc.line(M, y, PW - M, y);
  y += 7;

  // Dijagrami akorda
  const chords = songChords(song);
  const cellW = 24, cellH = 31;
  const perRow = Math.floor((PW - 2 * M + 4) / cellW);
  chords.forEach((c, i) => {
    const col = i % perRow;
    if (col === 0 && i > 0) y += cellH;
    if (y + cellH > bottom) { doc.addPage(); y = M; }
    drawDiagram(doc, M + col * cellW + 2, y + 3, c, accent);
  });
  if (chords.length) y += cellH + 2;

  // Tekst sa akordima
  const fs = 10.5;
  doc.setFontSize(fs);
  doc.setFont('Mono', 'normal');
  const charW = doc.getTextWidth('M');
  const maxChars = Math.floor((PW - 2 * M) / charW);
  const lh = fs * 0.3528 * 1.25;

  const ensure = (h) => { if (y + h > bottom) { doc.addPage(); y = M + 2; } };

  for (const sec of song.sections || []) {
    if (sec.name) {
      ensure(lh * 3);
      y += 2;
      doc.setFont('Mono', 'bold');
      doc.setFontSize(fs);
      doc.setTextColor(...accent);
      doc.text(sec.name, M, y);
      y += lh + 0.5;
    }
    for (const line of sec.lines || []) {
      for (const [cs, t] of wrapPair(line.chords || [], line.text || '', maxChars)) {
        const hasC = cs.length > 0, hasT = !!t.trim();
        ensure((hasC ? lh : 0) + lh);
        if (hasC) {
          doc.setFont('Mono', 'bold');
          doc.setTextColor(...accent);
          doc.text(chordLineString(cs), M, y);
          y += lh;
        }
        if (hasT || !hasC) {
          doc.setFont('Mono', 'normal');
          doc.setTextColor(25);
          if (hasT) doc.text(t, M, y);
          y += lh;
        }
      }
    }
    y += lh * 0.6;
  }

  // Broj strane
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('Mono', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`${song.title || ''}  —  ${p}/${pages}`, PW / 2, PH - 8, { align: 'center' });
  }
  return doc.output('blob');
}
