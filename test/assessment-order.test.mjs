import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentSectionOrder, assessmentSectionBeforeKey, orderGeneratedAssessment } from '../dist/assessment-order.js';

test('Assessment section policy orders generated automated and manual documents independently', () => {
  assert.deepEqual([...assessmentSectionOrder('automated')].slice(-6), ['evaluate', 'tests', 'shared_objects', 'variables', 'inputs', 'references']);
  assert.deepEqual([...assessmentSectionOrder('manual')].slice(-5), ['procedure', 'evidence', 'evidence_guidance', 'response', 'references']);
  const generated = orderGeneratedAssessment({ references: [], tests: {}, evaluate: {}, id: 'x', variables: {}, shared_objects: {}, inputs: {} }, 'automated');
  assert.deepEqual(Object.keys(generated), ['id', 'evaluate', 'tests', 'shared_objects', 'variables', 'inputs', 'references']);
  assert.equal(assessmentSectionBeforeKey(['id', 'tests', 'references'], 'evaluate', 'automated'), 'tests');
  assert.equal(assessmentSectionBeforeKey(['id', 'references'], 'inputs', 'automated'), 'references');
});
