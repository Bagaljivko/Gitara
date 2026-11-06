// Naslov / izvođač / kompozitor ODŠTAMPAN VELIKIM SLOVIMA („IN MY LIFE“) se ne čuva tako, nego normalno
// („In My Life“). Dira se samo tekst u kome nema nijednog malog slova; „AC/DC“, „ABBA“ i sl. su kratki i ostaju.
const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'from', 'with', 'as', 'vs', 'i', 'u', 'na', 'sa', 'za', 'od', 'do', 'o', 'po', 'pa', 'ni', 'da', 'de', 'la', 'le', 'el', 'del', 'di', 'du', 'des', 'von', 'van', 'y']);
const ROMAN = /^(?=[IVX])X{0,3}(IX|IV|V?I{0,3})$/;
const cap = (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1);

/** „IN MY LIFE“ → „In My Life“, „ROMANCE D'AMOUR“ → „Romance D'Amour“, „SONATA NO. IV“ → „Sonata No. IV“. */
export function fixCaps(s) {
  if (typeof s !== 'string') return s;
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters.length < 5 || letters !== letters.toLocaleUpperCase() || letters === letters.toLocaleLowerCase()) return s;
  let first = true;
  return s.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok) || !/\p{L}/u.test(tok)) return tok;
    const core = tok.replace(/^[^\p{L}\d]+|[^\p{L}\d.]+$/gu, '');
    if (ROMAN.test(core.replace(/\.$/, '')) && core !== 'I' || core === 'I' && !first) { first = false; return tok; } // rimski broj (i „I“ usred naslova)
    const low = tok.toLocaleLowerCase();
    const word = low.replace(/^[^\p{L}]+/u, '');
    let out;
    if (!first && SMALL.has(word.replace(/[^\p{L}]+$/u, ''))) out = low;
    else out = low.replace(/\p{L}/u, (c) => c.toLocaleUpperCase());
    out = out.replace(/([-/(„"])(\p{L})/gu, (m, p, c) => p + c.toLocaleUpperCase()); // delovi sa crticom, u zagradi
    out = out.replace(/\b(\p{L})'(\p{L})/gu, (m, a, b) => a + "'" + b.toLocaleUpperCase()); // d'Amour, O'Brien
    first = /[:.!?–—]$/.test(tok);
    return out;
  }).join('');
}
