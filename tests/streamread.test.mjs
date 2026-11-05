import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSSE, looksStuck } from '../src/streamRead.js';

const enc = new TextEncoder();
const ev = (text, finishReason) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] })}\r\n\r\n`;
function stream(parts, { hangAfter = false, delay = 5 } = {}) {
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      if (i < parts.length) { await new Promise((r) => setTimeout(r, delay)); c.enqueue(enc.encode(parts[i++])); return; }
      if (hangAfter) return new Promise(() => {}); // server stane, veza ostaje otvorena
      c.close();
    },
  });
}

test('SSE: text accumulates across chunks (even split mid-event), finishReason kept, thoughts ignored', async () => {
  const whole = ev('NASLOV: X\n') + `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: 'razmišljam' }, { text: 'T1: 6/0 2/0\n' }] } }] })}\r\n\r\n` + ev('T2: 6/0', 'STOP');
  const r = await readSSE(stream([whole.slice(0, 17), whole.slice(17, 90), whole.slice(90)]));
  assert.equal(r.text, 'NASLOV: X\nT1: 6/0 2/0\nT2: 6/0'); assert.equal(r.finishReason, 'STOP'); assert.equal(r.chunks, 3);
});

test('SSE: a server that stops sending is cut after the idle time — what arrived is kept', async () => {
  const r = await readSSE(stream([ev('T1: 6/0\n'), ev('T2: 5/0\n')], { hangAfter: true }), { idleMs: 150 });
  assert.ok(r.idle); assert.equal(r.text, 'T1: 6/0\nT2: 5/0\n');
});

test('SSE: caller stops a looping answer; outer abort keeps the partial text', async () => {
  const parts = [ev('T1: 6/0\n'), ev('T2: 6/0\n'), ev('T3: 6/0\n'), ev('T1: 6/0\n'), ev('T2: 6/0\n'), ev('T3: 6/0\n'), ev('T4: x\n')];
  const r = await readSSE(stream(parts), { onText: (t) => looksStuck(t) });
  assert.ok(r.stopped); assert.ok(r.text.startsWith('T1: 6/0\nT2: 6/0\nT3: 6/0\nT1')); assert.ok(!r.text.includes('T4'));
  const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 60);
  const r2 = await readSSE(stream([ev('T1: 6/0\n')], { hangAfter: true }), { signal: ctrl.signal, idleMs: 5000 });
  assert.ok(r2.aborted); assert.equal(r2.text, 'T1: 6/0\n');
});

test('looksStuck: normal answers pass; endless line, circling bar numbers and far too many bars are stuck', () => {
  const ok = Array.from({ length: 16 }, (_, i) => `T${i + 1}: 6/0+1/7 2/0 3/0`).join('\n');
  assert.equal(looksStuck(ok, 16), false);
  assert.equal(looksStuck('T1: ' + '6/0 '.repeat(120), 16), true);
  assert.equal(looksStuck(ok + '\n' + 'T5: 6/0\nT6: 6/0\nT5: 6/0\nT6: 6/0', 16), true);
  assert.equal(looksStuck(Array.from({ length: 60 }, (_, i) => `T${i + 1}: 6/0`).join('\n'), 16), true);
});
