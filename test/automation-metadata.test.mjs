import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAutomationDispositions, writeAutomationDispositions } from '../dist/automation-metadata.js';

test('editor automation disposition metadata round-trips independently of Rule YAML', () => {
  const root = mkdtempSync(join(tmpdir(), 'scap-ng-automation-metadata-'));
  try {
    const entries = new Map([['rule-one', { disposition: 'manual-only', source_hash: 'abc123', reason: 'Requires human judgment' }]]);
    writeAutomationDispositions(root, entries);
    assert.deepEqual(readAutomationDispositions(root).get('rule-one'), entries.get('rule-one'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
