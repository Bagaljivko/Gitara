// Vežbe → „Delovi pesme“ za TAB pesmu (prebiranje): delovi po strukturi (fraze od ~4 takta, ponavljanja, deo u
// svakom tonalitetu), „Najteže“ = najviše skokova ruke i barre-a. Na stazi su tačne note iz tablature (žica, prag,
// pravo vreme) u bojama prstiju; barre je blaga traka preko žica. Žice zvone jedna preko druge: svaki nov trzaj se
// sudi po svom napadu (nikad ne pada zato što prethodna žica još zvoni); bas i melodija zajedno su jedan trzaj.
// „Čekaj me“ čeka na svaku notu; Normalno: počinje sporije, posle čistog prolaza malo brže; napredak po delu.
import { useTabTexts } from './tabText.js';
import { tabParts, partDifficulty, practiceItems, playOrder, barInfo } from './tabSong.js';
import { partName, keyLabel, barreLabel, DEFAULT_TAB_BPM } from './tabView.js';
import { trackGame, noteHint } from './practiceTrack.js';
import { createHitLog, matchArp } from './practiceListen.js';
import { noteLabel } from './practiceBoard.js';
import { pluck } from './synth.js';
import { songPracticeUI } from './songPracticeUI.js';

useTabTexts();
const MAX_PASSES = 6;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createTabGame(api, song, songId) {
  const { t, esc } = api;
  const tab = song.tab;
  const parts = tabParts(tab);
  const phrases = parts.filter((p) => p.kind === 'bars');
  if (!phrases.length || !tab.bars.some((b) => b.notes.length)) {
    api.stage.innerHTML = `<p class="muted center">${t('pr.tab.noNotes')}</p>`;
    return { noTempo: true, noStart: true, beats: 0, start() { api.stopNow(); }, stop() {} };
  }
  const songBpm = Number(song.bpm) || DEFAULT_TAB_BPM;
  const stats = () => (api.allStats.songs || {})[songId] || {};
  const diffs = phrases.map((p) => partDifficulty(tab, p));
  const hardest = phrases.length > 1 ? phrases[diffs.indexOf(Math.max(...diffs))] : null;
  const whole = { id: 'all', kind: 'all' };
  const all = [...parts, whole];
  const partKey = `gitara-pr-part-${songId}`;
  let part = all.find((p) => String(p.id) === localStorage.getItem(partKey)) || hardest || phrases[0];
  const startTempo = (p) => Math.min(api.gradCap ?? songBpm, (stats()[String(p.id)] || {}).lastTempo || Math.max(40, Math.round((songBpm * 0.6) / 5) * 5));
  const label = (p) => (p.id === 'all' ? t('pr.pesma.whole') : partName(p));
  const barsOf = (p) => (p.id === 'all' ? playOrder(tab) : Array.from({ length: p.to - p.from + 1 }, (_, k) => p.from + k));
  const info = barInfo(tab);

  const grad = () => api.speed === 'grad';
  const cap = () => api.gradCap ?? songBpm; // „Postepeno ubrzavaj“: najviše do izabrane brzine
  const findPart = (id) => all.find((p) => String(p.id) === String(id));
  // „Poslušaj“: deo jednom, tačne note iz tablature, u trenutnom tempu vežbe
  let listening = null, listenId = null;
  async function listenPart(id) {
    const was = listenId;
    if (listening) { listening.stop(); listening = null; listenId = null; ui.draw(); if (String(was) === String(id)) return; }
    const p = findPart(id); if (!p) return;
    const [sp, pl] = await Promise.all([import('./songPlay.js'), import('./songPlayer.js')]);
    const tl = sp.tabTimeline(song);
    let from = 0, to = tl.total;
    if (p.id !== 'all') {
      const k0 = tl.segs.findIndex((x) => x.ref.bar === p.from);
      const k1 = tl.segs.findIndex((x, k) => k >= k0 && x.ref.bar === p.to);
      if (k0 < 0 || k1 < 0) return;
      from = tl.segs[k0].beat; to = tl.segs[k1].beat + tl.segs[k1].len;
    }
    listenId = p.id;
    listening = pl.playOnce(tl, { bpm: api.bpm || songBpm, from, to, onEnd: () => { listening = null; listenId = null; ui.draw(); } });
    ui.draw();
  }
  window.addEventListener('gitara-mic', () => { if (listening) { listening = null; listenId = null; ui.draw(); } });
  api.onCleanup?.(() => { listening?.stop(); listening = null; });
  function choose(p) {
    part = p;
    try { localStorage.setItem(partKey, String(part.id)); } catch {}
    if (grad()) api.setBpm(startTempo(part));
  }
  // Grupe: deo po tonalitetu („Prvi deo (e-mol)“) kao naslov, ispod njega ceo taj deo pa fraze od ~4 takta
  const keyParts = parts.filter((p) => p.kind === 'key');
  const row = (p) => ({ id: p.id, label: p.kind === 'key' ? t('pr.tab.wholeKey') : label(p), sub: p.kind === 'key' ? t('tab.bars', { a: p.from + 1, b: p.to + 1 }) : '', hard: p === hardest, noNext: p.kind === 'key' });
  const groups = keyParts.length
    ? keyParts.map((k) => ({ title: partName(k), rows: [row(k), ...phrases.filter((p) => p.from >= k.from && p.to <= k.to).map(row)] }))
    : [{ rows: phrases.map(row) }];
  const keys = [...new Set(info.map((x) => x.key).filter(Boolean))].map(keyLabel).join(' → ');
  const ui = songPracticeUI({
    api,
    head: { title: song.title, artist: song.artist, meta: [t('pr.tab.info', { n: tab.bars.length, sig: tab.sig }), keys, t('pr.pesma.songTempo', { bpm: songBpm })].filter(Boolean).join(' · ') },
    groups,
    wholeId: 'all',
    recOf: (id) => stats()[String(id)],
    listeningId: () => listenId,
    onListen: listenPart,
    onStart: (id) => { const p = findPart(id); if (!p) return; listening?.stop(); listening = null; listenId = null; choose(p); api.restart(); },
  });
  const drawOpts = () => ui.draw();
  api.stage.hidden = true;

  // Note za stazu: tačne pozicije; red iznad vrata pokazuje broj takta
  const toItems = (bars) => practiceItems(tab, bars).map((it) => {
    if (it.kind === 'barre') return { ...it, label: barreLabel(it) };
    const o = { ...it, ring: true, group: undefined };
    if (it.lyric !== undefined) o.lyric = t('tab.bar', { n: it.lyric });
    return o;
  }); // grupe (bas uz melodiju) se ponovo vezuju u link() — kopije moraju da pokazuju jedna na drugu
  function link(items) {
    // practiceItems pravi glavu napada pa njene pratioce odmah iza; poveži kopije istim redom
    const out = items;
    for (let i = 0; i < out.length; i++) {
      const it = out[i];
      if (it.kind !== 'note' || it.follow) continue;
      const g = [];
      for (let j = i + 1; j < out.length && out[j].kind === 'note' && out[j].follow && out[j].beat === it.beat; j++) g.push(out[j]);
      it.group = g;
    }
    return out;
  }
  let passes = 0;
  const build = () => {
    const items = link(toItems(barsOf(part)));
    return {
      items,
      key: [songId, String(part.id)],
      lagMs: 180,
      hintOf: (it) => noteHint(t, it),
      fingersOf: (it) => [...new Set([it.finger, ...(it.group || []).map((g) => g.finger)].filter((f) => f > 0))],
      extra: (st) => (st.clean && (st.tempo >= cap() || !grad())
        ? [...(part.id !== 'all' ? [{ id: 'nextPart', label: t('pr.pesma.nextPart'), primary: true }] : []), { id: 'whole', label: t('pr.pesma.whole'), primary: part.id === 'all' }]
        : []),
    };
  };

  return trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: startTempo(part), min: 30, max: Math.round(songBpm * 1.35), step: 5, normal: songBpm, gradMax: songBpm },
    noStart: true, // počinje se iz „Sviraj celu pesmu“ ili iz panela dela
    initialTempo: startTempo(part),
    firstBpm: startTempo(part),
    round() { passes = 0; return build(); },
    listen(round, input) {
      const log = createHitLog();
      return {
        arpeggio: true,
        // Svaki trzaj po svom napadu: najbliža nota po vremenu; bas uz melodiju = sudi se melodija (bez basa).
        // Nejasno prvo čitanje (blizu, mala razlika) → ustaljen zvuk ~0,2 s posle trzaja, pa ponovo.
        onPluck: (p) => {
          log.onset({ at: p.at }); log.pluck(p);
          const h = log.hits[log.hits.length - 1];
          const run = (steadied) => input(h.at, (it) => {
            const r = matchArp(h.seg, h.sr, it.midi, h.a4, (it.group || []).length > 0);
            if (r.ok) return { ok: true };
            if (!steadied && r.margin > -0.12 && api.listener) { api.listener.steady(p.rawAt ?? p.at, (sg) => { log.steadied(h, sg); run(true); }); return { pending: true }; }
            const g = log.midiOf(h, it.midi);
            return { ok: false, text: g != null ? t('pr.trk.wrong', { n: noteLabel(g) }) : '', heard: g };
          });
          run(false);
        },
      };
    },
    async onRoundEnd(st, round, ctl) {
      if (st.beginner) return false;
      passes++;
      if ((st.clean && (st.tempo >= cap() || !grad())) || passes >= MAX_PASSES) return false;
      await api.save({ score: st.score, tempo: st.tempo, accuracy: st.accuracy }, round.key);
      const nb = st.clean && grad() ? Math.min(cap(), st.tempo + 5) : st.tempo;
      api.setBpm(nb);
      ctl.track.pop(st.clean && nb > st.tempo ? t('pr.pesma.faster', { bpm: nb }) : t('pr.pesma.again', { n: passes + 1 }), st.clean ? 'hit' : 'late');
      await wait(1500);
      if (!api.running || !ctl.track) return true;
      await ctl.next(build());
      return true;
    },
    onChoice(choice, round, ctl) {
      if (choice === 'nextPart') {
        const k = phrases.indexOf(part);
        choose(phrases[(k + 1) % phrases.length] || phrases[0]);
        api.restart();
      } else if (choice === 'whole') { choose(whole); api.restart(); }
      else ctl.close();
    },
    demo: {
      bpm: 60,
      intro: t('pr.tab.demo1'),
      items: () => link(toItems(barsOf(part).slice(0, 2))).filter((it) => it.kind !== 'note' || it.beat < 6),
      fingersOf: (it) => [...new Set([it.finger, ...(it.group || []).map((g) => g.finger)].filter((f) => f > 0))],
      play: (it) => { for (const n of [it, ...(it.group || [])]) pluck(440 * Math.pow(2, (n.midi - 69) / 12), { gain: 0.5, duration: 2, group: 'practice' }); },
      captions: { 0: t('pr.tab.demo2'), 3: t('pr.tab.demo3'), 9: t('pr.tab.demo4') },
    },
  });
}
