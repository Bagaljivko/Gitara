// „Podeli“ za set listu ili pesmu — isti način za oboje. Paket (samo sadržaj pesama) ide:
//  1) kao link (#g=…, sažet „deflate“-om) kroz meni telefona za deljenje — kad je dovoljno kratak za poruke;
//     drugi telefon ga otvori jednim dodirom (i bez instalirane aplikacije), Gitara pokaže „Uvezi …“;
//  2) inače kao .gitara fajl kroz isti meni (WhatsApp, Viber, e-pošta…), uz kratko uputstvo za uvoz;
//  3) rezerva bez menija za deljenje: link se kopira, odnosno fajl se preuzme.
import { t, songsCount } from './i18n.js';
import { toast, dialog, esc } from './ui.js';
import { songs as db } from './db.js';
import { makePackage, shareLink, shareFileText, LINK_MAX, FILE_EXT, FILE_MIME } from './shareCode.js';
import { safeFileName } from './songformat.js';

/** Podeli pesme (jednu ili set listu: setName). Vraća način: 'link' | 'file' | 'copied' | 'downloaded' | null. */
export async function shareSongs(songs, { setName = null, title } = {}) {
  const pkg = makePackage(songs, setName);
  const name = title || setName || songs[0]?.title || 'Gitara';
  const text = setName != null ? t('share.textSet', { name, n: songsCount(songs.length) }) : t('share.textSong', { name });
  const url = await shareLink(pkg);
  if (url.length <= LINK_MAX) {
    if (navigator.share) {
      try { await navigator.share({ title: name, text, url }); return 'link'; } catch (e) { if (e && e.name === 'AbortError') return null; }
    }
    try { await navigator.clipboard.writeText(url); toast(t('share.copied')); return 'copied'; } catch {}
    await dialog({ title: t('link.copyTitle'), html: true, body: `<textarea class="link-box" readonly rows="4">${esc(url)}</textarea>` });
    return 'copied';
  }
  // predugačko za poruku: fajl (isti sadržaj)
  const file = new File([await shareFileText(pkg)], safeFileName(name) + FILE_EXT, { type: FILE_MIME });
  const note = `${text}\n${t('share.fileHint', { url: location.origin + location.pathname })}`;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ title: name, text: note, files: [file] }); return 'file'; } catch (e) { if (e && e.name === 'AbortError') return null; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('share.fileSaved'));
  return 'downloaded';
}

/** Podeli set listu po ID-u (pesme redom; obrisane se preskaču). */
export async function shareSetlist(sl) {
  const list = (await Promise.all(sl.songIds.map((id) => db.get(id).catch(() => null)))).filter(Boolean);
  if (!list.length) { toast(t('sl.noSongs'), 'error'); return null; }
  return shareSongs(list, { setName: sl.name });
}
