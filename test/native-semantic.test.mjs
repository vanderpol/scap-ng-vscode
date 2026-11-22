import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeSemantics } from '../dist/index.js';

test('rejects cmdlet wildcard selection before collection', () => {
  const value = { assessment: { tests: { t: { capability: 'windows.cmdlet', object: { capability: 'windows.cmdlet', select: { fields: { '*': { selection_match: 'one_or_more', equals: '*' } } } } } } } };
  const errors = validateNativeSemantics(value);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rule, 'windows.cmdlet.select_no_wildcard');
  assert.match(errors[0].message, /before collection/);
});

test('preserves explicit and null cmdlet selection', () => {
  for (const select of [null, { fields: { Name: { selection_match: 'one_or_more', equals: 'Name' } } }]) {
    const value = { assessment: { tests: { t: { capability: 'windows.cmdlet', object: { capability: 'windows.cmdlet', select } } } } };
    assert.deepEqual(validateNativeSemantics(value), []);
  }
});

test('rejects dynamic selection fail-closed and unrelated wildcard data', () => {
  const dynamic = { assessment: { tests: { t: { capability: 'windows.cmdlet', object: { capability: 'windows.cmdlet', select: { fields: { Name: { selection_match: 'one_or_more', variable: 'names' } } } } } } } };
  assert.equal(validateNativeSemantics(dynamic)[0].code, 'cmdlet-select-dynamic');
  const unrelated = { assessment: { tests: { t: { capability: 'windows.cmdlet', object: { capability: 'windows.cmdlet', parameters: { fields: { '*': { selection_match: 'one_or_more', equals: '*' } } } } } } } };
  assert.deepEqual(validateNativeSemantics(unrelated), []);
});
