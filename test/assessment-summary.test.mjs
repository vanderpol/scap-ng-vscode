import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanReadableAssessmentSummary } from '../dist/assessment-summary.js';

test('Assessment summary explains the authored Test, Object, Require, and Evaluate', () => {
  const summary = humanReadableAssessmentSummary({ assessment: {
    tests: {
      "registry-test": {
        test_title: 'Registry test',
        capability: 'windows.registry',
        object: { hive: { equals: 'local_machine' }, key: { equals: 'SOFTWARE\\Policies' }, name: { equals: 'Setting' } },
        require: {
          item_requirement: { items_found: 'one_or_more', items_satisfying: 'every' },
          field_requirement: { values_found: 'one_or_more', values_matching: 'every' },
          fields: { type: { equals: 'dword' }, value: { equals: 1 } }
        }
      }
    },
    evaluate: { test: 'registry-test' }
  } });
  assert.match(summary, /Windows registry collector/);
  assert.match(summary, /HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Setting/);
  assert.match(summary, /at least one item/);
  assert.match(summary, /type equals “dword” and value equals 1/);
  assert.match(summary, /requires “Registry test” to pass/);
  assert.doesNotMatch(summary, /authoring validation|scanner execution|provider/);
});

test('Assessment summary fails soft when a draft has no parsed Assessment', () => {
  assert.equal(humanReadableAssessmentSummary({ yaml: 'not parsed' }), undefined);
});
