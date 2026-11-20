import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testOpenAiCompatibleGateway } from '../dist/ai-remote.js';

test('GenAI gateway probe fails closed without a key and sends no request', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not be called'); };
  try {
    const result = await testOpenAiCompatibleGateway('https://api.genai.mil/v1', '');
    assert.equal(result.ok, false);
    assert.match(result.message, /No stored remote API key/i);
    assert.equal(called, false);
  } finally { globalThis.fetch = original; }
});

test('GenAI gateway probe uses the OpenAI-compatible models endpoint', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'gemini-test' }] }) };
  };
  try {
    const result = await testOpenAiCompatibleGateway('https://api.genai.mil/v1', 'STARK_test_key');
    assert.equal(result.ok, true);
    assert.equal(result.models, 1);
    assert.deepEqual(result.modelIds, ['gemini-test']);
    assert.equal(request.url, 'https://api.genai.mil/v1/models');
    assert.equal(request.options.headers.Authorization, 'Bearer STARK_test_key');
    assert.equal(request.options.method, 'GET');
  } finally { globalThis.fetch = original; }
});
