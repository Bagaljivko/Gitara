// Abecedni redosled po srpskoj latinici: A B C Č Ć D Dž Đ E … S Š T U V Z Ž.
// (Samo 'sr' u pregledaču sledi ćirilični redosled i stavlja Č pre C, Š pre S, Ž pre Z.)
const col = (() => { try { return new Intl.Collator('sr-Latn', { sensitivity: 'base', numeric: true }); } catch { return null; } })();
export const srCompare = (a, b) => (col ? col.compare(String(a || ''), String(b || '')) : String(a || '').localeCompare(String(b || '')));
