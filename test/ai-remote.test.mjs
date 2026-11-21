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

test('OpenAI-compatible completion sends the structured request and extracts text', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"generated_mode":"manual-only"}' } }] }) };
  };
  try {
    const { requestOpenAiCompatibleChat } = await import('../dist/ai-remote.js');
    const result = await requestOpenAiCompatibleChat('https://api.genai.mil/v1', 'STARK_key', 'gemini-test', [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }]);
    assert.equal(result, '{"generated_mode":"manual-only"}');
    assert.equal(request.url, 'https://api.genai.mil/v1/chat/completions');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer STARK_key');
    assert.deepEqual(JSON.parse(request.options.body).messages, [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }]);
  } finally { globalThis.fetch = original; }
});

test('OpenAI-compatible completion rejects insecure endpoints before network use', async () => {
  const { requestOpenAiCompatibleChat } = await import('../dist/ai-remote.js');
  await assert.rejects(() => requestOpenAiCompatibleChat('http://example.test/v1', 'key', 'model', []), /HTTPS/i);
});

test('OpenAI-compatible tool-capable completion executes local tools and resumes the conversation', async () => {
  const original = globalThis.fetch;
  const requests = [];
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    calls++;
    const body = calls === 1
      ? { choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'scap_ng_search_capabilities', arguments: JSON.stringify({ query: 'ssh banner' }) } }] } }] }
      : { choices: [{ message: { content: '{"generated_mode":"manual-only"}' } }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    const { requestOpenAiCompatibleChatWithTools } = await import('../dist/ai-remote.js');
    const result = await requestOpenAiCompatibleChatWithTools(
      'https://api.genai.mil/v1', 'STARK_key', 'gemini-test',
      [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }],
      [{ type: 'function', function: { name: 'scap_ng_search_capabilities', description: 'search', parameters: { type: 'object' } } }],
      (name, args) => ({ name, args, source: 'offline-test' })
    );
    assert.equal(result, '{"generated_mode":"manual-only"}');
    assert.equal(requests.length, 2);
    const first = JSON.parse(requests[0].options.body);
    const second = JSON.parse(requests[1].options.body);
    assert.equal(first.tools[0].function.name, 'scap_ng_search_capabilities');
    assert.equal(second.messages.at(-1).role, 'tool');
    assert.equal(second.messages.at(-1).tool_call_id, 'call-1');
    assert.match(second.messages.at(-1).content, /offline-test/);
  } finally { globalThis.fetch = original; }
});
