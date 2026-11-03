import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluckedString } from '../src/ks.js';
import { yin } from '../src/audio.js';

test('plucked string model is in tune (reference tones for the tuner)', () => {
  const sr = 48000;
  for (const f of [73.42, 82.41, 110, 146.83, 196, 246.94, 329.63]) {
    const s = pluckedString(sr, f, { duration: 1.2, seed: 5 });
    const r = yin(s.subarray(Math.round(0.3 * sr), Math.round(0.3 * sr) + 4096), sr, { minFreq: 60, maxFreq: 1000 });
    const cents = 1200 * Math.log2(r.freq / f);
    assert.ok(Math.abs(cents) < 1, `${f} Hz off by ${cents.toFixed(2)} cents`);
  }
});

test('plucked string is normalized, rings and fades out without a click', () => {
  const sr = 48000;
  const s = pluckedString(sr, 110, { duration: 2, seed: 9 });
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  assert.ok(Math.abs(peak - 1) < 1e-6);
  assert.equal(s[s.length - 1], 0);
  const rms = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += s[i] * s[i]; return Math.sqrt(t / (b - a)); };
  assert.ok(rms(sr, sr + 4800) > 0.01, 'still ringing after 1 s');
});
