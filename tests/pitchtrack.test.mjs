import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PitchTracker } from '../src/pitchtrack.js';

const SR = 48000, WIN = 4096, HOP = 960; // 20 ms, kao u aplikaciji

// Pseudo-slučajan šum (determinističan)
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function render(seconds, fn, noise = 0.0012) {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / SR) + rnd() * noise;
  return out;
}
function pluck(f, amp, start, decay = 1.1) {
  return (t) => {
    if (t < start) return 0;
    const tt = t - start, env = amp * Math.exp(-tt * decay) * Math.min(1, tt * 400);
    return env * (Math.sin(2 * Math.PI * f * tt) + 0.5 * Math.sin(4 * Math.PI * f * tt) + 0.25 * Math.sin(6 * Math.PI * f * tt));
  };
}
function run(signal, sensitivity = 'medium') {
  const tr = new PitchTracker({ sensitivity });
  const res = [];
  for (let s = 0; s + WIN <= signal.length; s += HOP) {
    const now = ((s + WIN) / SR) * 1000;
    res.push({ now, ...tr.process(signal.subarray(s, s + WIN), SR, now) });
  }
  return res;
}
const tracking = (r) => r.filter((x) => x.state === 'tracking');
const stable = (r) => r.filter((x) => x.state === 'tracking' && x.stable);
// Najduži niz „stabilno i u opsegu ±5 centi“ (ms) — ovo pali zeleno posle 1 s
function longestGreen(r) {
  let best = 0, start = -1;
  for (const x of r) {
    if (x.state === 'tracking' && x.stable && Math.abs(x.cents) <= 5) { if (start < 0) start = x.now; best = Math.max(best, x.now - start); } else start = -1;
  }
  return best;
}

// Ton počinje u 1,5 s (posle merenja buke). Prozor je 4096 uzoraka (85 ms), pa je to najraniji mogući trenutak.
const T0 = 1500 + (WIN / SR) * 1000 * 0;

test('plucked A2: needle moves right away, green-ready after ~100 ms, follows the whole ring', () => {
  const f = 110 * Math.pow(2, 3 / 1200);
  const r = run(render(9, pluck(f, 0.3, 1.5)));
  const tr = tracking(r), st = stable(r);
  assert.ok(tr.length > 0, 'never tracked');
  const first = tr[0].now - T0, firstStable = st[0].now - T0;
  console.log(`  A2: first reading ${first.toFixed(0)} ms, stable ${firstStable.toFixed(0)} ms, tracked ${(tr[tr.length - 1].now - tr[0].now).toFixed(0)} ms`);
  assert.ok(first < 120, 'first reading too slow: ' + first);
  assert.ok(firstStable - first <= 140, 'stability too slow: ' + (firstStable - first));
  assert.ok(tr.every((x) => x.sid === 1), 'wrong string');
  assert.ok(tr[tr.length - 1].now - tr[0].now > 3000, 'stopped following too early');
  assert.ok(st.slice(0, 50).every((x) => Math.abs(x.cents - 3) < 2), 'cents off');
  assert.equal(r[r.length - 1].state, 'idle', 'should release after fading');
});

test('soft pluck (amp 0.006, ~14 dB above room noise) is caught on Srednja', () => {
  const r = run(render(4, pluck(146.83, 0.006, 1.5)));
  console.log(`  soft D3: tracked ${tracking(r).length} frames, stable ${stable(r).length}, longest green ${longestGreen(r).toFixed(0)} ms`);
  assert.ok(stable(r).length > 20);
  assert.ok(tracking(r).every((x) => x.sid === 2));
  assert.ok(longestGreen(r) >= 1000, 'should be able to mark string as tuned');
});

test('very soft pluck: Visoka catches it, Niska ignores it', () => {
  const sig = render(4, pluck(196, 0.0035, 1.5));
  const hi = run(sig, 'high'), lo = run(sig, 'low');
  console.log(`  very soft G3: high=${stable(hi).length} stable frames, low=${tracking(lo).length} frames`);
  assert.ok(stable(hi).length > 20);
  assert.equal(tracking(lo).length, 0);
});

test('quiet high E string is picked up and can turn green', () => {
  const r = run(render(4, pluck(329.63, 0.012, 1.5)));
  console.log(`  quiet E4: first ${(tracking(r)[0].now - T0).toFixed(0)} ms, stable frames ${stable(r).length}, green ${longestGreen(r).toFixed(0)} ms`);
  assert.ok(stable(r).length > 30);
  assert.ok(tracking(r).every((x) => x.sid === 5));
  assert.ok(longestGreen(r) >= 1000);
});

test('fading note is followed far into the decay', () => {
  // Brzo gašenje (kao tanka žica): -35 dB za ~2 s
  const r = run(render(6, pluck(246.94, 0.2, 1.5, 2.0)));
  const tr = tracking(r);
  const dur = tr[tr.length - 1].now - tr[0].now;
  const lastAmp = 0.2 * Math.exp(-((tr[tr.length - 1].now - 1500) / 1000) * 2.0);
  console.log(`  fading B3: tracked ${dur.toFixed(0)} ms, until amplitude ${(20 * Math.log10(lastAmp / 0.2)).toFixed(1)} dB below attack`);
  assert.ok(dur > 1800, 'released too early: ' + dur);
  assert.ok(tr.every((x) => x.sid === 4));
  assert.ok(stable(r).every((x) => Math.abs(x.cents) < 3), 'readings drift while fading');
});

test('adaptive floor: noisy room does not trigger, a normal pluck still does', () => {
  const quiet = render(3, () => 0, 0.012);
  assert.equal(tracking(run(quiet)).length, 0);
  const r = run(render(4, pluck(110, 0.08, 1.5), 0.012));
  assert.ok(stable(r).length > 20, 'pluck missed in noisy room');
});

// Govor: slogovi sa promenljivom visinom (spuštanje/podizanje), formantni prizvuci, pauze
function speech(seconds, base = 120, s0 = 7) {
  seed = s0;
  const syl = [];
  let t = 1.2;
  while (t < seconds - 0.3) {
    const len = 0.12 + ((rnd() + 1) / 2) * 0.16;
    const f0 = base * (0.85 + ((rnd() + 1) / 2) * 0.6);
    const slope = rnd() * 1.2 * f0; // Hz/s — govorna intonacija klizi ~do 15 polutonova/s
    syl.push({ t, len, f0, slope });
    t += len + 0.04 + ((rnd() + 1) / 2) * 0.1;
  }
  return (time) => {
    const s = syl.find((x) => time >= x.t && time < x.t + x.len);
    if (!s) return 0;
    const tt = time - s.t;
    const ph = 2 * Math.PI * (s.f0 * tt + 0.5 * s.slope * tt * tt) + 2 * Math.PI * 3 * Math.sin(2 * Math.PI * 6 * tt) / 6;
    const env = Math.sin(Math.PI * tt / s.len);
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(h * ph) / h * (h === 3 || h === 4 ? 1.6 : 1);
    return 0.15 * env * v;
  };
}

for (const [name, base] of [['male', 110], ['female', 210]]) {
  test(`speech (${name}) never turns a string green`, () => {
    for (const [sens, s0] of [['low', 3], ['medium', 7], ['medium', 11], ['high', 19]]) {
      const r = run(render(8, speech(8, base, s0)), sens);
      const tr = tracking(r);
      console.log(`  speech ${name} @${sens}: ${tr.length}/${r.length} frames moved the needle, ${stable(r).length} stable, longest green ${longestGreen(r).toFixed(0)} ms`);
      assert.ok(longestGreen(r) < 1000, 'speech would mark a string');
      assert.ok(tr.length < r.length * 0.2, 'needle reacts to speech too much');
    }
  });
}

test('voice-like glide with vibrato is not marked as tuned', () => {
  const sig = render(3, (t) => {
    if (t < 1 || t > 2.5) return 0;
    const tt = t - 1;
    const ph = 2 * Math.PI * (150 * tt + 25 * tt * tt - (8 / (2 * Math.PI * 5.5)) * Math.cos(2 * Math.PI * 5.5 * tt));
    return 0.2 * Math.min(1, tt * 50) * (Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.4 * Math.sin(3 * ph));
  });
  const r = run(sig, 'high');
  assert.ok(longestGreen(r) < 1000);
});

test('noise burst never moves the needle', () => {
  const sig = render(3, (t) => (t > 1.5 && t < 2.2 ? rnd() * 0.2 : 0));
  assert.equal(tracking(run(sig)).length, 0);
});

test('steady tone far from any string (C3) is ignored', () => {
  for (const sens of ['low', 'medium', 'high']) assert.equal(tracking(run(render(3, pluck(130.81, 0.3, 1.5)), sens)).length, 0);
});

test('nothing reacts during the first 300 ms while the room is measured', () => {
  const r = run(render(2, pluck(110, 0.3, 0.05)));
  assert.ok(tracking(r).every((x) => x.now > 300));
});
