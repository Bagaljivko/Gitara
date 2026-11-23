// Kod tunera se ne menja bez odobrenja: otisak fajlova mora da se poklapa sa odobrenim (tuner-files.json).
// Posle ODOBRENE izmene: node tests/e2e/run.mjs --approve-tuner (ili ručno obnovi tuner-files.json).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../lib.mjs';
export const name = 'kod tunera isti kao odobreni (otisak fajlova)';
export const FILES = ['tuner.js', 'pitchtrack.js', 'tunerSettings.js', 'tunerWave.js', 'tunings.js', 'headstockKnobs.js', 'deskTuner.js', 'audio.js'];
export async function run(ctx) {
  const now = Object.fromEntries(FILES.map((f) => [f, createHash('sha256').update(readFileSync(join(ctx.root, 'src', f))).digest('hex').slice(0, 16)]));
  const file = join(ctx.root, 'tests/e2e/tuner-files.json');
  if (process.argv.includes('--approve-tuner')) { writeFileSync(file, JSON.stringify(now, null, 1) + '\n'); ctx.note.push('otisak obnovljen'); return; }
  const ok = JSON.parse(readFileSync(file, 'utf8'));
  const diff = FILES.filter((f) => ok[f] !== now[f]);
  expect(!diff.length, 'izmenjen kod tunera (traži odobrenje)', diff);
  ctx.note.push(FILES.length + ' fajlova');
}
