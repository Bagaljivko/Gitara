// v2.4.10: poređenje dva snimka iz „Samo sviraj“ (Moji snimci): ujednačenost, tempo, promene akorda u minuti, trajanje.
// Dugme na snimku: „⇄ Uporedi sa drugim snimkom“ → izbor (podrazumevano prethodni) → tabela ranije · sada.
import { t } from './i18n.js';
import { esc, dialog } from './ui.js';
import { songs as db } from './db.js';

const dShort = (ts) => { const d = new Date(ts); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmt = (k, v) => (v == null ? '—' : k === 'steady' ? v + ' %' : k === 'bpm' ? v + ' BPM' : k === 'dur' ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : String(v));

export async function attach(box, song) {
  if (!box) return;
  if (!song || !song.recording) { box.innerHTML = ''; return; }
  const others = (await db.all()).filter((s) => s.recording && !s.deleted && s.id !== song.id);
  if (!others.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<button type="button" class="btn small rc-btn" id="rcGo">⇄ ${esc(t('rc.btn'))}</button>`;
  box.querySelector('#rcGo').onclick = () => compareFlow(song, others);
}

async function compareFlow(song, others) {
  others.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const at = song.createdAt || Date.now();
  const def = others.find((s) => (s.createdAt || 0) < at) || others[0];
  let pick = def.id;
  const p = dialog({ title: t('rc.pickT'), html: true, className: 'tch-dlg rc-dlg', body: `<p class="muted small">${esc(t('rc.pickSub'))}</p>
    <div class="bulk-list rc-list">${others.slice(0, 40).map((s) => `<button type="button" class="bulk-it${s.id === pick ? ' on' : ''}" data-rc="${esc(s.id)}"><span class="bulk-cb">${s.id === pick ? '✓' : ''}</span><span class="bulk-t"><b>${esc(s.title || '')}</b><small class="muted">${esc(dShort(s.createdAt || 0))}</small></span></button>`).join('')}</div>`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: t('rc.go'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-rc]'); if (!b) return; pick = b.dataset.rc; box.querySelectorAll('[data-rc]').forEach((x) => { const on = x.dataset.rc === pick; x.classList.toggle('on', on); x.querySelector('.bulk-cb').textContent = on ? '✓' : ''; }); });
  if ((await p) !== 'ok') return;
  const other = others.find((s) => s.id === pick); if (!other) return;
  const [older, newer] = (other.createdAt || 0) <= at ? [other, song] : [song, other];
  const { compareRecs } = await import('./recTools.js');
  const rows = compareRecs(older.recording, newer.recording);
  const arrow = (d) => (d > 0 ? '<em class="rc-up">▲</em>' : d < 0 ? '<em class="rc-down">▼</em>' : '');
  const good = rows.filter((r) => r.d > 0).length, bad = rows.filter((r) => r.d < 0).length;
  await dialog({ title: t('rc.title'), html: true, className: 'tch-dlg rc-dlg', body: `
    <table class="rc-tbl"><thead><tr><th></th><th>${esc(t('rc.before'))}<small>${esc(dShort(older.createdAt || 0))}</small></th><th>${esc(t('rc.now'))}<small>${esc(dShort(newer.createdAt || 0))}</small></th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(t('rc.k.' + r.k))}</td><td>${esc(fmt(r.k, r.a))}</td><td><b>${esc(fmt(r.k, r.b))}</b> ${arrow(r.d)}</td></tr>`).join('')}</tbody></table>
    <p class="rc-sum">${esc(good && !bad ? t('rc.better') : bad && !good ? t('rc.worse') : good || bad ? t('rc.mixed') : t('rc.same'))}</p>
    <p class="muted small">${esc(t('rc.note'))}</p>`, buttons: [{ label: t('common.close'), value: null }] });
}
