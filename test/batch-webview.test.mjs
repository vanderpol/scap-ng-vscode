import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function loadBatchHtmlFactory() {
  const source = readFileSync('dist/extension.js', 'utf8');
  const start = source.indexOf('function benchmarkBatchAutomationHtml');
  const end = source.indexOf('\nasync function openBenchmarkBatchAutomationPanel', start);
  assert.ok(start >= 0 && end > start, 'batch webview factory must be present in the build');
  const factorySource = source.slice(start, end);
  return new Function('escapeHtml', 'scriptJson', `${factorySource}; return benchmarkBatchAutomationHtml;`)(
    value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])),
    value => JSON.stringify(value ?? null).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  );
}

test('batch automation webview script is executable with source text containing newlines and script-like data', () => {
  const html = loadBatchHtmlFactory()('AI review Rules (1)', 'ai', [{
    uri: 'file:///rule.yaml', ruleId: 'rule-1', title: 'Rule </script>', sourceLabel: 'manual procedure',
    status: 'generating', phase: 'queued', checkText: 'First line\nSecond line', platform: 'Ubuntu'
  }]);
  const match = html.match(/<script nonce="batch-automation">([\s\S]*?)<\/script>/);
  assert.ok(match, 'batch HTML must contain its executable script');
  assert.doesNotThrow(() => new Function(match[1]));
  assert.match(match[1], /Immutable procedure\/check text sent to the generator/);
  assert.match(match[1], /auditText\.textContent/);
  assert.match(match[1], /Automatic effort/);
  assert.match(match[1], /not a final manual-only decision/);
  assert.match(html, /Cancel All/);
  assert.match(html, /Accept all eligible and link/);
  assert.match(html, /Review next/);
  assert.match(match[1], /approveAll/);
  assert.match(match[1], /nextReview/);
  assert.match(match[1], /linkable===true/);
  assert.match(match[1], /manual-only/);
  assert.match(match[1], /Cancel Rule/);
  assert.match(match[1], /cancelEntry/);
  assert.match(match[1], /cancelAll/);
  assert.match(match[1], /scrollState/);
  assert.match(match[1], /restoreScrollState/);
  assert.match(match[1], /row.disabled=batchRunning/);
  assert.match(match[1], /open.disabled=batchRunning/);
  assert.match(match[1], /link.disabled=batchRunning/);
});
