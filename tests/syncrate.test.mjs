// v2.2: sinhronizacija ne zasipa Google Drive — „uspori“ (403 rateLimitExceeded / 429) = samo jedan novi pokušaj,
// upisi najviše 2 odjednom sa razmakom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrive } from '../src/syncDrive.js';
import { createEngine } from '../src/syncEngine.js';
import { memDrive, memDevice } from './helpers/syncFakes.mjs';

const res = (status, body = {}) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });

test('rate limit (403 rateLimitExceeded): 2 attempts, then RETRY for the scheduler', async () => {
  let n = 0;
  const d = createDrive(async () => 'tok', { baseDelay: 1, fetchFn: async () => { n++; return res(403, { error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }); } });
  await assert.rejects(() => d.startToken(), (e) => e.code === 'RETRY' && /rateLimitExceeded/.test(e.message));
  assert.equal(n, 2);
});

test('429: also 2 attempts; server error 503 keeps the normal retries', async () => {
  let n = 0;
  let d = createDrive(async () => 'tok', { baseDelay: 1, fetchFn: async () => { n++; return res(429); } });
  await assert.rejects(() => d.startToken());
  assert.equal(n, 2);
  n = 0;
  d = createDrive(async () => 'tok', { baseDelay: 1, fetchFn: async () => { n++; return res(503); } });
  await assert.rejects(() => d.startToken());
  assert.equal(n, 5);
});

test('uploads: at most 2 at once and spaced out', async () => {
  const drive = memDrive();
  let live = 0, peak = 0; const starts = [];
  const put = drive.remote.put.bind(drive.remote);
  drive.remote.put = async (...a) => { live++; peak = Math.max(peak, live); starts.push(Date.now()); await new Promise((r) => setTimeout(r, 40)); try { return await put(...a); } finally { live--; } };
  const A = memDevice('A');
  const eng = createEngine(A.local, drive.remote, { node: 'A', ask: async () => true });
  await eng.sync(); // prvi krug (snapshot)
  for (let i = 0; i < 8; i++) A.edit('song:s' + i, { id: 's' + i, title: 'P' + i, sections: [] });
  starts.length = 0; peak = 0;
  await eng.sync();
  assert.ok(starts.length >= 8, 'all sent: ' + starts.length);
  assert.ok(peak <= 2, 'peak concurrency ' + peak);
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  assert.ok(gaps.every((g) => g >= 250), 'gaps ' + gaps.join(','));
});
