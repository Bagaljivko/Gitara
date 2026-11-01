import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PitchTracker } from '../src/pitchtrack.js';

const SR = 48000, WIN = 4096, HOP = 960; // 20 ms

// Pseudo-slučajan šum (determinističan)
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function render(seconds, fn) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / SR) + rnd() * 0.0012;
  return out;
}
function pluck(f, amp, start, decay = 1.1) {
  return (t) => {
    if (t < start) return 0;
    const tt = t - start, env = amp * Math.exp(-tt * decay) * Math.min(1, tt * 400);
    return env * (Math.sin(2 * Math.PI * f * tt) + 0.5 * Math.sin(4 * Math.PI * f * tt) + 0.25 * Math.sin(6 * Math.PI * f * tt));
  };
}
function run(signal) {
  const tr = new PitchTracker();
  const res = [];
  for (let s = 0; s + WIN <= signal.length; s += HOP) {
    const now = ((s + WIN) / SR) * 1000;
    res.push({ now, ...tr.process(signal.subarray(s, s + WIN), SR, now) });
  }
  return res;
}

test('plucked A2 locks after ~200 ms and keeps following while it rings', () => {
  const f = 110 * Math.pow(2, 3 / 1200);
  const r = run(render(5, pluck(f, 0.3, 1)));
  const locked = r.filter((x) => x.state === 'locked');
  assert.ok(locked.length > 0, 'never locked');
  const firstLock = locked[0].now;
  assert.ok(firstLock > 1180 && firstLock < 1500, 'lock time ' + firstLock);
  assert.ok(locked.every((x) => x.sid === 1), 'wrong string');
  const last = locked[locked.length - 1];
  assert.ok(last.now - firstLock > 2000, 'stopped following too early: ' + (last.now - firstLock));
  const ringing = locked.filter((x) => x.now < firstLock + 2000).map((x) => x.cents);
  assert.ok(ringing.every((c) => Math.abs(c - 3) < 2), 'cents ' + Math.min(...ringing) + '..' + Math.max(...ringing));
  console.log('tail cents', locked.slice(-8).map((x) => x.cents.toFixed(1)).join(' '));
  assert.equal(r[r.length - 1].state, 'idle', 'should release after fading');
});

test('quiet high E string is still picked up', () => {
  const r = run(render(3, pluck(329.63, 0.012, 0.5)));
  const locked = r.filter((x) => x.state === 'locked');
  assert.ok(locked.length > 10, 'locked frames ' + locked.length);
  assert.ok(locked.every((x) => x.sid === 5));
});

test('voice-like glide with vibrato never locks', () => {
  const sig = render(2.5, (t) => {
    if (t < 0.5 || t > 2) return 0;
    const tt = t - 0.5;
    const f = 150 + 50 * tt + 8 * Math.sin(2 * Math.PI * 5.5 * tt); // klizanje + vibrato
    const ph = 2 * Math.PI * (150 * tt + 25 * tt * tt - (8 / (2 * Math.PI * 5.5)) * Math.cos(2 * Math.PI * 5.5 * tt));
    return 0.2 * Math.min(1, tt * 50) * (Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.4 * Math.sin(3 * ph)) * (f > 0 ? 1 : 0);
  });
  assert.ok(run(sig).every((x) => x.state !== 'locked'));
});

test('noise burst never locks', () => {
  const sig = render(2, (t) => (t > 0.5 && t < 1.2 ? rnd() * 0.2 : 0));
  assert.ok(run(sig).every((x) => x.state !== 'locked'));
});

test('steady tone far from any string (C3) is ignored', () => {
  const r = run(render(3, pluck(130.81, 0.3, 0.5)));
  assert.ok(r.every((x) => x.state !== 'locked'));
});
