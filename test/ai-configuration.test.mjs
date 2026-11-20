import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiAssistanceModes,
  aiAssistanceModeDescription,
  aiAssistanceModeLabel,
  aiEndpointError,
  normalizeAiAssistanceMode
} from '../dist/ai-configuration.js';

test('AI assistance configuration is opt-in and has stable mode labels', () => {
  assert.deepEqual(aiAssistanceModes, ['offline', 'local', 'vscode', 'remote']);
  assert.equal(normalizeAiAssistanceMode(undefined), 'offline');
  assert.equal(normalizeAiAssistanceMode('not-a-mode'), 'offline');
  for (const mode of aiAssistanceModes) {
    assert.ok(aiAssistanceModeLabel(mode));
    assert.ok(aiAssistanceModeDescription(mode));
  }
});

test('AI endpoint policy fails closed before provider integration', () => {
  assert.equal(aiEndpointError('offline', 'not a URL'), undefined);
  assert.equal(aiEndpointError('vscode', 'not a URL'), undefined);
  assert.equal(aiEndpointError('local', ''), undefined);
  assert.equal(aiEndpointError('local', 'http://127.0.0.1:11434/v1'), undefined);
  assert.equal(aiEndpointError('local', 'http://localhost:8080'), undefined);
  assert.match(aiEndpointError('local', 'https://example.test') ?? '', /loopback/i);
  assert.match(aiEndpointError('remote', 'http://example.test') ?? '', /HTTPS/i);
  assert.equal(aiEndpointError('remote', 'https://enterprise.example.test/ai'), undefined);
  assert.match(aiEndpointError('remote', 'not a URL') ?? '', /valid URL/i);
});
