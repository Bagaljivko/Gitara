// Mali UI pomoćnici: escape, toast, modalni dijalozi.
import { t } from './i18n.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

let toastTimer = null;
export function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast ' + type), 3200);
}

/**
 * Modalni dijalog. buttons: [{ label, value, kind: 'primary'|'danger'|'' }]
 * Vraća Promise sa vrednošću kliknutog dugmeta (ili null za zatvaranje).
 */
export function dialog({ title = '', body = '', html = false, buttons = [{ label: t('common.ok'), value: true, kind: 'primary' }], className = '', dismissible = true }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      ${title ? `<h2 class="modal-title">${esc(title)}</h2>` : ''}
      <div class="modal-body">${html ? body : `<p>${esc(body)}</p>`}</div>
      <div class="modal-actions">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
    </div>`;
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(null); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) { if (dismissible) close(null); return; }
      const b = e.target.closest('[data-i]');
      if (b) close(buttons[+b.dataset.i].value);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    const primary = wrap.querySelector('.btn.primary') || wrap.querySelector('.btn');
    primary && primary.focus();
  });
}

export const confirmDialog = (title, body, okLabel = t('common.yes'), kind = 'primary') =>
  dialog({ title, body, buttons: [{ label: t('common.cancel'), value: false }, { label: okLabel, value: true, kind }] });

/** Izbor više fajlova odjednom (npr. više fotografija). Vraća niz (može biti prazan). */
export function pickFiles(accept, capture) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = !capture;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

/** Otvara izbor fajla i vraća File ili null. */
export function pickFile(accept, capture) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

/** Deli fajl preko sistemskog menija; ako nije podržano, preuzima ga. */
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // u suprotnom padamo na preuzimanje
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
