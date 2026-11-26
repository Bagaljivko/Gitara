// v2.4.37: Tekst za pesmu bez teksta (npr. sa lista akorada): „Pronađi tekst“ (besplatan otvoren servis LRCLIB — zahtev
// šalje uređaj korisnika tek na njegov dodir), „Nalepi“ (kopiran tekst) i „Tekst pesme ↗“ (pretraga u pregledaču).
// Pre čuvanja: provera — akordi pesme raspoređeni po delovima teksta. Tekst ostaje samo u pesmi korisnika.
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';

const API = 'https://lrclib.net/api/search';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const lyricsSearchUrl = (song) => 'https://www.google.com/search?q=' + encodeURIComponent([song.artist, song.title, 'lyrics'].filter(Boolean).join(' '));

/** Kandidati sa servisa: [{ title, artist, dur, raw, synced }] — najbolji prvi (isti naslov i izvođač, ima tekst). */
export async function searchLyrics(song, { signal } = {}) {
  const q = new URLSearchParams({ track_name: song.title || '', ...(song.artist ? { artist_name: song.artist } : {}) });
  const r = await fetch(API + '?' + q.toString(), { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('lyrics ' + r.status);
  const list = await r.json();
  const T = norm(song.title), A = norm(song.artist);
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && !x.instrumental && (x.plainLyrics || x.syncedLyrics))
    .map((x) => ({ title: String(x.trackName || ''), artist: String(x.artistName || ''), dur: Math.round(Number(x.duration) || 0), raw: String(x.syncedLyrics || x.plainLyrics || ''), synced: !!x.syncedLyrics,
      score: (norm(x.trackName) === T ? 3 : norm(x.trackName).includes(T) ? 1 : 0) + (A && norm(x.artistName) === A ? 3 : A && norm(x.artistName).includes(A) ? 1 : 0) + (x.syncedLyrics ? 0.5 : 0) - (/live|remix|demo|version|edit/i.test(x.trackName || '') ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** Provera pre čuvanja: akordi pesme raspoređeni po tekstu. 'save' | 'next' | null. */
async function preview(song, fit, head) {
  const S = await import('./songs.js'); const F = await import('./songformat.js');
  const shown = F.transposeSong({ ...song, sections: fit.sections }, (song.transpose || 0) - (song.capo || 0));
  const p = dialog({ title: t('lyr.foundT'), html: true, className: 'yt-ask lyr-dlg',
    body: `${head ? `<div class="set-grp"><div class="tch-row"><span class="sr-ic">✓</span><span><b>${esc(head.b)}</b><small>${esc(head.s)}</small></span></div></div>` : ''}
      <p class="muted small lyr-note">${esc(t('lyr.checkNote'))}</p>
      <div class="lyrics lyr-prev">${S.renderSectionsHTML(shown.sections)}</div>`,
    buttons: [{ label: head && head.more ? t('lyr.notIt') : t('common.cancel'), value: head && head.more ? 'next' : null }, { label: t('lyr.save'), value: 'save', kind: 'primary' }] });
  return p;
}

async function saveFit(stored, fit, save) {
  stored.sections = fit.sections;
  await save();
  toast(t('lyr.saved'));
  return true;
}

/** „Pronađi tekst“: pretraga, pa provera; „Nije to“ = sledeći rezultat. true ako je tekst sačuvan. */
export async function findLyrics(stored, save) {
  const { fitLyrics } = await import('./lyricsFit.js');
  toast(t('lyr.searching'));
  let list = [];
  try { list = await searchLyrics(stored); } catch { list = null; }
  if (!list || !list.length) {
    const v = await dialog({ title: t(list ? 'lyr.noneT' : 'lyr.offT'), body: t(list ? 'lyr.none' : 'lyr.off'), buttons: [{ label: t('common.close'), value: null }, { label: t('lyr.paste'), value: 'paste' }, { label: t('lyr.web'), value: 'web', kind: 'primary' }] });
    if (v === 'paste') return pasteLyrics(stored, save);
    if (v === 'web') window.open(lyricsSearchUrl(stored), '_blank', 'noopener');
    return false;
  }
  const bpm = Number(stored.bpm) || 0;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    const fit = fitLyrics(stored, x.raw, { bpm });
    if (!fit) continue;
    const mm = x.dur ? `${Math.floor(x.dur / 60)}:${String(x.dur % 60).padStart(2, '0')}` : '';
    const v = await preview(stored, fit, { b: `${x.artist} — ${x.title}`, s: [mm, t('lyr.parts', { n: fit.matched }), x.synced ? t('lyr.timed') : ''].filter(Boolean).join(' · '), more: i + 1 < list.length });
    if (v === 'save') return saveFit(stored, fit, save);
    if (v !== 'next') return false;
  }
  toast(t('lyr.noMore'));
  return false;
}

/** „Nalepi“: kopiran tekst (jedan dodir čita klipbord; ako pregledač ne da — polje za lepljenje), pa provera. */
export async function pasteLyrics(stored, save) {
  const { fitLyrics } = await import('./lyricsFit.js');
  let txt = '';
  try { if (navigator.clipboard && navigator.clipboard.readText) txt = await navigator.clipboard.readText(); } catch {}
  if (!txt || txt.trim().split('\n').length < 2) {
    const p = dialog({ title: t('lyr.pasteT'), html: true, className: 'lyr-dlg', body: `<p class="muted small">${esc(t('lyr.pasteHint'))}</p><textarea id="lyrTxt" rows="10" style="width:100%" aria-label="${esc(t('lyr.pasteT'))}"></textarea>`,
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('lyr.next'), value: 'ok', kind: 'primary' }] });
    const box = [...document.querySelectorAll('.modal-backdrop')].pop(); const ta = box.querySelector('#lyrTxt');
    setTimeout(() => ta.focus(), 50);
    if ((await p) !== 'ok') return false;
    txt = ta.value;
  }
  const fit = fitLyrics(stored, txt, { bpm: Number(stored.bpm) || 0 });
  if (!fit) { toast(t('lyr.cant'), 'error'); return false; }
  const v = await preview(stored, fit, null);
  return v === 'save' ? saveFit(stored, fit, save) : false;
}

/** Kartica „Pesma nema tekst“ na ekranu pesme. */
export const lyricsCardHTML = () => `<div class="set-grp lyr-card" id="sLyr"><div class="tch-row"><span class="sr-ic">🎤</span><span><b>${esc(t('lyr.cardT'))}</b><small>${esc(t('lyr.cardS'))}</small></span></div>
  <div class="lyr-btns"><button class="btn small primary" data-lyr="find">🔎 ${esc(t('lyr.find'))}</button><button class="btn small" data-lyr="paste">${esc(t('lyr.paste'))}</button><button class="btn small" data-lyr="web">${esc(t('lyr.web'))}</button></div></div>`;
