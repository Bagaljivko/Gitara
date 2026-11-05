import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankModels, usableModels, cleanComposer } from '../src/gemini.js';

test('model ranking: newest Flash, then Flash-Lite, then others; stable before preview', () => {
  const r = rankModels(['gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash-preview', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest']);
  assert.deepEqual(r, ['gemini-3.8-flash', 'gemini-3.8-flash-preview', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
});

test('only Gemini generateContent models that take images are offered', () => {
  const api = [
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] },
    { name: 'models/gemma-3-27b-it', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
  ];
  assert.deepEqual(usableModels(api), ['gemini-3.8-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
});

test('composer from the sheet: printed composer kept; publisher, arranger and sites never used', () => {
  assert.equal(cleanComposer('Anonymous'), 'Anonymous');
  assert.equal(cleanComposer('Trad.'), 'Trad.');
  assert.equal(cleanComposer('F. Tárrega'), 'F. Tárrega');
  assert.equal(cleanComposer('Music: J. S. Bach'), 'J. S. Bach');
  assert.equal(cleanComposer('Anonymous, arr. John Smith'), 'Anonymous');
  assert.equal(cleanComposer('Capotasto Music'), '');
  assert.equal(cleanComposer('www.free-scores.com'), '');
  assert.equal(cleanComposer('Free sheet music'), '');
  assert.equal(cleanComposer('Arranged by John Smith'), '');
  assert.equal(cleanComposer('© 2010 Hal Leonard Publishing'), '');
  assert.equal(cleanComposer('Guitar Tabs Universe'), '');
  assert.equal(cleanComposer('John Smith', { arranger: 'John Smith' }), '');
  assert.equal(cleanComposer('Mel Bay', { publisher: 'Mel Bay' }), '');
  assert.equal(cleanComposer(''), '');
  assert.equal(cleanComposer(undefined), '');
});
