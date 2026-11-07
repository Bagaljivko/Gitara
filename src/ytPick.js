// YouTube uz pesmu: „Slušaj“ (original) i „Tutorial“. Prvi put: izbor snimka u aplikaciji (pretraga naslov + izvođač,
// 4–5 rezultata sa sličicom, kanalom i trajanjem, ili nalepljen link). Snimak se veže za pesmu (sinhronizuje se),
// pa svaki sledeći dodir odmah pušta taj snimak. Pretraga: YouTube Data API sa javnim ključem iz shareConfig.js;
// ako nije uključena / nema mreže, otvara se YouTube pretraga i link se nalepi.
// Kvota: pretraga košta 100 jedinica od 10.000 dnevno, zajedničkih za sve korisnike ključa. Zato se rezultati čuvaju
// uz pesmu (ytFound — ista pesma se nikad ne traži dvaput, ni na drugom telefonu), a kad se kvota potroši, tiho se
// otvara obična YouTube pretraga „izvođač naslov“ (bez poruke o grešci) do ponoći po pacifičkom vremenu (reset kvote).
import { esc, toast } from './ui.js';
import { t } from './i18n.js';
import { SHARE_API_KEY } from './shareConfig.js';
import { cleanYoutubeUrl, youtubeId } from './songformat.js';

const API = 'https://www.googleapis.com/youtube/v3';
const query = (song, kind) => [song.artist, song.title, kind === 'tutorial' ? 'guitar lesson' : ''].filter(Boolean).join(' ');
export const ytSearchUrl = (song, kind) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query(song, kind));
const isoDur = (s) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || ''); if (!m) return ''; const h = +m[1] || 0, mi = +m[2] || 0, se = +m[3] || 0; return (h ? h + ':' + String(mi).padStart(2, '0') : mi) + ':' + String(se).padStart(2, '0'); };
const unesc = (s) => { const d = document.createElement('textarea'); d.innerHTML = s; return d.value; };

const QK = 'gitara-ytquota';
const ptDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // kvota se resetuje u ponoć PT
const quotaOut = () => { try { return localStorage.getItem(QK) === ptDay(); } catch { return false; } };
const markQuota = () => { try { localStorage.setItem(QK, ptDay()); } catch {} };
const openSearch = (song, kind) => window.open(ytSearchUrl(song, kind), '_blank', 'noopener');
export class YtQuotaError extends Error {}
const thumbOf = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
// Snimci za koje je YouTube javio da ne smeju u drugim aplikacijama (pamti se na uređaju, da se više ne nude)
const BK = 'gitara-yt-blocked';
export const ytBlocked = () => { try { return JSON.parse(localStorage.getItem(BK) || '[]'); } catch { return []; } };
export const markYtBlocked = (id) => { try { localStorage.setItem(BK, JSON.stringify([...new Set([id, ...ytBlocked()])].slice(0, 200))); } catch {} };
// …i oni za koje je provereno da sviraju u aplikaciji (bez ponovne provere)
const OK = 'gitara-yt-ok';
export const ytOk = () => { try { return JSON.parse(localStorage.getItem(OK) || '[]'); } catch { return []; } };
export const markYtOk = (id) => { try { localStorage.setItem(OK, JSON.stringify([...new Set([id, ...ytOk()])].slice(0, 300))); } catch {} };
// Zemlja korisnika (za snimke blokirane po zemljama): iz jezika pregledača (sr-RS → RS), inače po vremenskoj zoni
function userCountry() {
  for (const l of navigator.languages || [navigator.language || '']) { const m = /-([A-Z]{2})\b/.exec(l || ''); if (m) return m[1]; }
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  return { 'Europe/Belgrade': 'RS', 'Europe/Zagreb': 'HR', 'Europe/Sarajevo': 'BA', 'Europe/Podgorica': 'ME', 'Europe/Skopje': 'MK', 'Europe/Ljubljana': 'SI', 'Europe/Vienna': 'AT', 'Europe/Berlin': 'DE', 'Europe/Zurich': 'CH' }[tz] || '';
}
const regionBlocked = (rr, c) => !!(rr && c && ((Array.isArray(rr.blocked) && rr.blocked.includes(c)) || (Array.isArray(rr.allowed) && !rr.allowed.includes(c))));

/** Pretraga (5 rezultata) + trajanje. Baca YtQuotaError kad je dnevna kvota potrošena, inače grešku ako API nije dostupan. */
export async function searchYt(q, { signal, embeddable = false } = {}) {
  const key = globalThis.__gitaraYtKey || SHARE_API_KEY;
  // „Uz video“: samo snimci koje vlasnik dozvoljava da se puštaju u drugim aplikacijama (mnoge izdavačke kuće to brane)
  const emb = embeddable ? '&videoEmbeddable=true&videoSyndicated=true' : '';
  const r = await fetch(`${API}/search?part=snippet&type=video&maxResults=${embeddable ? 8 : 5}${emb}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`, { signal });
  if (!r.ok) {
    let reason = '';
    try { reason = ((await r.json()).error.errors || [])[0].reason || ''; } catch {}
    if (r.status === 429 || /quota|dailyLimit|rateLimit/i.test(reason)) throw new YtQuotaError(reason || String(r.status));
    throw new Error('yt ' + r.status);
  }
  const items = ((await r.json()).items || []).filter((x) => x.id && x.id.videoId && !(embeddable && ytBlocked().includes(x.id.videoId)));
  let out = items.map((x) => ({ id: x.id.videoId, title: unesc(x.snippet.title || ''), channel: unesc(x.snippet.channelTitle || ''), dur: '' }));
  try { // trajanje + (za „Uz video“) da li sme van YouTube-a i da li je blokiran u našoj zemlji — isti, jeftin zahtev
    const d = await fetch(`${API}/videos?part=contentDetails${embeddable ? ',status' : ''}&id=${out.map((x) => x.id).join(',')}&key=${encodeURIComponent(key)}`, { signal });
    if (d.ok) {
      const c = embeddable ? userCountry() : '';
      for (const v of (await d.json()).items || []) {
        const o = out.find((x) => x.id === v.id); if (!o) continue;
        o.dur = isoDur(v.contentDetails && v.contentDetails.duration);
        if (embeddable && ((v.status && v.status.embeddable === false) || regionBlocked(v.contentDetails && v.contentDetails.regionRestriction, c))) { o.bad = true; markYtBlocked(o.id); }
      }
    }
  } catch {}
  out = out.filter((x) => !x.bad);
  return out.slice(0, 5).map(({ bad, ...x }) => x);
}

/**
 * Panel odozdo: rezultati pretrage + „Nalepi link“. Vraća izabran link (i odmah ga otvara — dodir je korisnikov) ili null.
 * cached: ranije nađeni rezultati (bez pretrage); onFound(list): nova pretraga je uspela (da se sačuva uz pesmu).
 */
export function pickVideo(song, kind, { cached = null, onFound = null, open = true, noSearch = false } = {}) {
  return new Promise((resolve) => {
    let ctrl = new AbortController();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop sheet-backdrop';
    wrap.innerHTML = `<div class="sheet yt-sheet" role="dialog" aria-modal="true" aria-label="${esc(t(kind === 'tutorial' ? 'yt.pickTutorial' : 'yt.pickListen'))}">
      <div class="sheet-grip"></div>
      <h2 class="sheet-title">${esc(t(kind === 'tutorial' ? 'yt.pickTutorial' : 'yt.pickListen'))}</h2>
      <form class="yt-q yt-search"><input type="search" enterkeyhint="search" value="${esc(query(song, kind))}" aria-label="${esc(t('yt.searchLabel'))}" autocomplete="off"><button class="btn small" type="submit">${esc(t('yt.searchBtn'))}</button></form>
      <div class="yt-results"><div class="yt-loading"><span class="spinner"></span> ${esc(t('yt.searching'))}</div></div>
      <div class="yt-paste"><input type="url" inputmode="url" placeholder="${esc(t('yt.pastePh'))}" autocomplete="off"><button class="btn small primary" data-paste>${esc(t('common.save'))}</button></div>
    </div>`;
    const done = (url) => { ctrl.abort(); wrap.remove(); resolve(url); };
    // „Uz video“: pre povezivanja video se tiho proba (nevidljiv plejer, bez zvuka, ~1 s). Ne sme u aplikaciji →
    // red se označi i lista ostaje otvorena; nikad se ne poveže video koji neće da svira.
    let checking = false;
    async function checkAndLink(row, id, url) {
      if (checking) return;
      if (ytOk().includes(id)) return done(url);
      if (ytBlocked().includes(id)) { markRow(row, 'bad'); toast(t('yt.cantEmbedToast'), 'error'); return; }
      checking = true;
      markRow(row, 'checking');
      const { probeVideo } = await import('./playAlong.js');
      const res = await probeVideo(id);
      checking = false;
      if (res === 'blocked' || res === 'gone') { markYtBlocked(id); markRow(row, 'bad'); toast(t(res === 'gone' ? 'pa.gone' : 'yt.cantEmbedToast'), 'error'); return; }
      if (res === 'ok') markYtOk(id);
      done(url);
    }
    function markRow(row, state) {
      if (!row) return;
      row.classList.toggle('checking', state === 'checking');
      row.classList.toggle('bad', state === 'bad');
      row.disabled = state === 'bad';
      let tag = row.querySelector('.yt-state');
      if (!tag) { tag = document.createElement('span'); tag.className = 'yt-state'; row.querySelector('.yt-meta').appendChild(tag); }
      tag.innerHTML = state === 'checking' ? `<span class="spinner"></span> ${esc(t('yt.checking'))}` : esc(t('yt.cantEmbed'));
    }
    wrap.__close = () => done(null);
    wrap.addEventListener('click', (e) => {
      const r = e.target.closest('[data-vid]');
      if (r) {
        const url = 'https://youtu.be/' + r.dataset.vid;
        if (open) { window.open(url, '_blank', 'noopener'); return done(url); }
        checkAndLink(r, r.dataset.vid, url);
        return;
      }
      if (e.target.closest('[data-open-search]')) { window.open(ytSearchUrl(song, kind), '_blank', 'noopener'); return; }
      if (e.target.closest('[data-clip]')) {
        // „Nalepi link“: jedan dodir čita kopirani link (bez kucanja); ako pregledač ne da, polje za ručno lepljenje
        (navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : Promise.reject())
          .then((txt) => { const u = cleanYoutubeUrl((String(txt).match(/https?:\/\/\S+/) || [''])[0]); if (u) done(u); else toast(t('yt.clipNone'), 'error'); })
          .catch(() => { const f = wrap.querySelector('.yt-paste'); f.hidden = false; f.querySelector('input').focus(); });
        return;
      }
      if (e.target.closest('[data-paste]')) {
        const u = cleanYoutubeUrl(wrap.querySelector('.yt-paste input').value);
        if (!u) { toast(t('yt.bad'), 'error'); return; }
        if (!open && youtubeId(u)) { checkAndLink(null, youtubeId(u), u); return; }
        return done(u);
      }
      if (!e.target.closest('.sheet')) done(null);
    });
    document.body.appendChild(wrap);
    const box = wrap.querySelector('.yt-results');
    // pretraga se može promeniti i ponoviti (polje gore)
    wrap.querySelector('.yt-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const qq = wrap.querySelector('.yt-search input').value.trim();
      if (!qq) return;
      ctrl.abort(); ctrl = new AbortController();
      wrap.querySelector('.yt-search input').blur();
      box.innerHTML = `<div class="yt-loading"><span class="spinner"></span> ${esc(t('yt.searching'))}</div>`;
      run(searchYt(qq, { signal: ctrl.signal, embeddable: !open }).then((list) => { if (onFound) onFound(list, qq); return list; }));
    });
    const run = (p) => p.then((list) => {
      box.innerHTML = list.length ? list.map((v) => `<button class="yt-res" data-vid="${esc(v.id)}">
        <span class="yt-thumb"><img src="${esc(thumbOf(v.id))}" alt="" loading="lazy">${v.dur ? `<i>${esc(v.dur)}</i>` : ''}</span>
        <span class="yt-meta"><b>${esc(v.title)}</b><span>${esc(v.channel)}</span></span></button>`).join('') : `<p class="small muted">${esc(t('yt.noResults'))}</p>`;
    }).catch((e) => {
      if (e && e.name === 'AbortError') return;
      if (e instanceof YtQuotaError) markQuota();
      if (e instanceof YtQuotaError && open) {
        // dnevna kvota potrošena: tiho obična YouTube pretraga (dodir je bio pre par sekundi, pregledač dozvoljava prozor)
        done(null); openSearch(song, kind); return;
      }
      // pretraga nije dostupna: YouTube pretraga u novom prozoru + nalepi link ovde
      wrap.querySelector('.yt-q').hidden = true;
      wrap.querySelector('.yt-paste').hidden = true;
      box.innerHTML = `<div class="yt-steps">
        <button class="yt-step yt-go" data-open-search><span class="yt-n">1</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/></svg><b>${esc(t('yt.openSearch'))}</b></button>
        <p class="yt-how"><span class="yt-n">2</span>${esc(t('yt.howCopy'))}</p>
        <button class="yt-step yt-clip" data-clip><span class="yt-n">3</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h-1.2a3 3 0 0 0-5.6 0H8a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-4-1a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm4 18H8V5h1v2h6V5h1v15z"/></svg><b>${esc(t('yt.pasteBtn'))}</b></button>
      </div>`;
      // povratak iz YouTube-a: istakni „Nalepi link“
      const back = () => { if (!document.hidden) wrap.querySelector('.yt-clip')?.classList.add('hot'); };
      document.addEventListener('visibilitychange', back);
      ctrl.signal.addEventListener('abort', () => document.removeEventListener('visibilitychange', back));
    });
    run(noSearch ? Promise.reject(new Error('no-search')) : cached ? Promise.resolve(cached) : searchYt(query(song, kind), { signal: ctrl.signal, embeddable: !open }).then((list) => { if (onFound) onFound(list); return list; }));
  });
}

/** Meni → „Slušaj“/„Tutorial“: povezan snimak se odmah pušta; inače (ili change) izbor snimka, pa se pamti uz pesmu. */
export async function ytAction(kind, stored, save, { change = false, open = true } = {}) {
  const cur = stored.yt && stored.yt[kind];
  if (cur && !change) { window.open(cur, '_blank', 'noopener'); return; }
  const q = query(stored, kind);
  const hit = stored.ytFound && stored.ytFound[kind];
  const okHit = hit && hit.q === q && (open || hit.e) ? hit.v.filter((v) => open || !ytBlocked().includes(v.id)) : null;
  const cached = okHit && okHit.length ? okHit.map((v) => ({ id: v.id, title: v.t, channel: v.c, dur: v.d })) : null;
  // kvota već potrošena danas: bez pretrage, odmah YouTube (sinhrono, u istom dodiru)
  // („Uz video“: bez napuštanja aplikacije — panel sa „Otvori YouTube“ + „Nalepi link“)
  if (!cached && quotaOut() && open) { openSearch(stored, kind); return; }
  const url = await pickVideo(stored, kind, {
    cached, open, noSearch: !cached && quotaOut(),
    onFound: (list, qq = q) => {
      stored.ytFound = { ...(stored.ytFound || {}), [kind]: { q: qq, ...(open ? {} : { e: 1 }), v: list.map((v) => ({ id: v.id, t: v.title, c: v.channel, d: v.dur })) } };
      Promise.resolve(save()).catch(() => {});
    },
  });
  if (!url) return;
  stored.yt = { ...(stored.yt || {}), [kind]: url };
  if (kind === 'listen' && stored.ytSync && stored.ytSync.v !== youtubeId(url)) delete stored.ytSync; // usklađivanje važi samo za stari video
  await save();
  toast(t('yt.linked'));
}
