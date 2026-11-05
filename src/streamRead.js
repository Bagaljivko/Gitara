// Čitanje Gemini odgovora dok stiže (streamGenerateContent?alt=sse): tekst raste deo po deo. Pozivalac vidi napredak,
// može da zaustavi „zaglavljen“ odgovor (ponavljanje) i zadržava sve što je stiglo i kad odgovor stane na pola.
// Čista logika nad ReadableStream-om (proverava se testovima u Node-u).

/**
 * body: ReadableStream bajtova (SSE). onText(tekstDoSada) → true = dosta (npr. ponavljanje): prekini i vrati dosadašnje.
 * idleMs: bez novog dela toliko dugo → prekini (vraća dosadašnje). signal: spoljni prekid (rok) → vraća dosadašnje.
 * Vraća { text, finishReason, stopped, idle, aborted, chunks, error }.
 */
export async function readSSE(body, { onText = () => false, idleMs = 30000, signal = null } = {}) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', finishReason = '', stopped = false, idle = false, aborted = false, chunks = 0, error = null;
  let idleT = 0, wake = null;
  const cancel = () => { try { reader.cancel(); } catch {} };
  const arm = () => { clearTimeout(idleT); idleT = setTimeout(() => { idle = true; cancel(); wake && wake(); }, idleMs); };
  const onAbort = () => { aborted = true; cancel(); wake && wake(); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  arm();
  try {
    while (!idle && !aborted && !stopped) {
      const r = await Promise.race([reader.read(), new Promise((res) => { wake = () => res({ done: true }); })]);
      if (r.done) break;
      arm();
      buf += dec.decode(r.value, { stream: true });
      let k;
      while ((k = buf.search(/\r?\n\r?\n/)) >= 0) {
        const ev = buf.slice(0, k); buf = buf.slice(k).replace(/^\r?\n\r?\n/, '');
        const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.error) { error = j.error; continue; }
        const c = j.candidates && j.candidates[0];
        if (!c) continue;
        chunks++;
        text += ((c.content && c.content.parts) || []).map((p) => (p.thought ? '' : p.text || '')).join('');
        if (c.finishReason) finishReason = c.finishReason;
        if (onText(text)) { stopped = true; cancel(); break; }
      }
    }
  } catch (e) { if (!idle && !aborted && !stopped) error = { message: String((e && e.message) || e) }; }
  finally { clearTimeout(idleT); if (signal) signal.removeEventListener('abort', onAbort); }
  return { text, finishReason, stopped, idle, aborted, chunks, error };
}

/** Odgovor u tabličnom tekstu („T1: …“ red po takt) se „zaglavio“: isti ili unazad brojevi taktova, ili predug red. */
export function looksStuck(text, expectedBars = 40) {
  const lines = text.split('\n');
  if ((lines[lines.length - 1] || '').length > 400) return true; // jedan beskrajan red (pravi takt ima najviše ~250 znakova)
  const nums = lines.map((l) => /^\s*T\s*(\d{1,3})\s*[:.]/i.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  if (nums.length > expectedBars * 1.5 + 6) return true; // mnogo više taktova nego što strana ima
  for (let i = 3; i < nums.length; i++) if (nums[i] <= nums[i - 3]) return true; // brojevi se vrte u krug
  return false;
}
