// Deljenje iz YouTube aplikacije (Android): „Podeli“ → Gitara. Otvara se kratak izbor pesme (sa pretragom);
// dodir na pesmu veže video za nju (ako već ima drugi video — prvo pitanje). Posle se otvara ta pesma.
import { t } from './i18n.js';
import { esc, toast, dialog } from './ui.js';
import { songs as db } from './db.js';
import { cleanYoutubeUrl, youtubeId } from './songformat.js';
import { srCompare } from './collate.js';

/** YouTube adresa iz podeljenog sadržaja (YouTube šalje link u tekstu, ponekad i naslov). */
export function sharedYoutubeUrl(params) {
  for (const k of ['su', 'sx', 'st']) {
    const v = params.get(k) || '';
    for (const m of v.match(/https?:\/\/\S+/g) || [v]) {
      const u = cleanYoutubeUrl(m.replace(/[)\].,;!?]+$/, ''));
      if (u && youtubeId(u)) return { url: 'https://youtu.be/' + youtubeId(u), title: (params.get('st') || '').trim() };
    }
  }
  return null;
}

export async function linkShared(params) {
  const hit = sharedYoutubeUrl(params);
  if (!hit) { toast(t('pa.shareNone'), 'error'); return; }
  const list = (await db.list()).filter((s) => !s.demo).sort((a, b) => srCompare(a.title, b.title));
  const songId = await pickSong(list, hit.title);
  if (!songId) return;
  const song = await db.get(songId);
  if (!song) return;
  const cur = song.yt && song.yt.listen;
  if (cur && youtubeId(cur) !== youtubeId(hit.url)) {
    const ok = await dialog({ title: t('pa.replaceTitle'), body: t('pa.replaceBody', { title: song.title }), buttons: [{ label: t('common.cancel'), value: false }, { label: t('pa.replace'), value: true, kind: 'primary' }] });
    if (!ok) return;
  }
  song.yt = { ...(song.yt || {}), listen: hit.url };
  if (song.ytSync && song.ytSync.v !== youtubeId(hit.url)) delete song.ytSync;
  await db.put(song);
  toast(t('pa.linkedTo', { title: song.title }));
  location.hash = '#/pesma/' + encodeURIComponent(songId);
}

function pickSong(list, sharedTitle) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop sheet-backdrop';
    wrap.innerHTML = `<div class="sheet yts-sheet" role="dialog" aria-modal="true" aria-label="${esc(t('pa.shareTitle'))}">
      <div class="sheet-grip"></div>
      <h2 class="sheet-title">${esc(t('pa.shareTitle'))}</h2>
      <p class="small muted">${sharedTitle ? `<b>${esc(sharedTitle.slice(0, 120))}</b><br>` : ''}${esc(t('pa.shareHint'))}</p>
      <input type="search" class="yts-q" placeholder="${esc(t('pa.shareSearch'))}" aria-label="${esc(t('pa.shareSearch'))}" autocomplete="off">
      <div class="yts-list"></div>
    </div>`;
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.__close = () => done(null);
    const box = wrap.querySelector('.yts-list');
    const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');
    const draw = (q) => {
      const f = fold(q);
      const rows = list.filter((s) => !f || fold(s.title + ' ' + (s.artist || '')).includes(f)).slice(0, 200);
      box.innerHTML = rows.length ? rows.map((s) => `<button class="yts-row" data-id="${esc(s.id)}"><b>${esc(s.title)}</b>${s.artist ? `<span>${esc(s.artist)}</span>` : ''}</button>`).join('')
        : `<p class="small muted">${esc(list.length ? t('lib.noResults', { q }) : t('pa.shareEmpty'))}</p>`;
    };
    wrap.addEventListener('click', (e) => {
      const r = e.target.closest('[data-id]');
      if (r) return done(r.dataset.id);
      if (!e.target.closest('.sheet')) done(null);
    });
    wrap.querySelector('.yts-q').addEventListener('input', (e) => draw(e.target.value));
    document.body.appendChild(wrap);
    draw('');
  });
}
