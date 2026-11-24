import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortPlanningSeconds, recommendCodexReasoningEffort, resolveCodexReasoningEffort } from '../dist/codex-effort.js';

test('automatic Codex effort keeps a simple one-predicate check fast', () => {
  const result = recommendCodexReasoningEffort({
    title: 'Verify passwd exists',
    checkText: 'Verify that the file /etc/passwd is present on the system.'
  });
  assert.equal(result.effort, 'low');
  assert.match(result.reason, /short, single objective/i);
  assert.equal(effortPlanningSeconds(result.effort), 90);
});

test('automatic Codex effort reserves High for multi-step organizational and edge-case checks', () => {
  const result = recommendCodexReasoningEffort({
    title: 'Synchronize clocks to an authorized time source',
    platform: 'amazon-linux-2023',
    checkText: `Verify Amazon Linux chrony specifies maxpoll no greater than 16.\n$ grep maxpoll /etc/chrony.conf\nIf the option is missing or the line is commented out, this is a finding.\nVerify chrony uses an authorized USNO or DoW server.\n$ grep server /etc/chrony.conf`,
    ruleYaml: 'rule:\n  assessment_choices:\n    manual: {}'
  });
  assert.equal(result.effort, 'high');
  assert.ok(result.signals.some(signal => /organization-defined/i.test(signal)));
  assert.equal(effortPlanningSeconds(result.effort), 240);
});

test('automatic selection is explicit and resolved before the Codex CLI request', () => {
  const result = resolveCodexReasoningEffort('auto', {
    title: 'Verify service active',
    checkText: 'Verify that apparmor.service is active.'
  });
  assert.equal(result.selection, 'automatic');
  assert.equal(result.effort, 'low');
  assert.match(result.reason, /Automatic selection/i);
  assert.equal(resolveCodexReasoningEffort('high', { checkText: 'anything' }).selection, 'configured');
});
