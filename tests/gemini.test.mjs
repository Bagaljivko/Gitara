import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankModels, usableModels } from '../src/gemini.js';

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
