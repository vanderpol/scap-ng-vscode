import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataPack, GuidedCatalog, createGuidedAssessment } from '../../dist/index.js';
const pin = JSON.parse(readFileSync(new URL('../../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(process.env.SCAP_NG_METADATA_PACK ?? '.external/editor-pack', pin);

test('guided catalog is vocabulary/schema-driven and preserves exact logic distinctions', () => {
  const catalog = new GuidedCatalog(pack);
  assert.equal(catalog.platforms().find(option => option.value === 'windows').label, 'Windows');
  assert.equal(catalog.modes().some(option => option.value === 'manual'), true);
  assert.deepEqual(catalog.logicalOperators().map(option => option.value), ['and', 'or', 'one', 'xor']);
  assert.match(catalog.logicalOperators().find(option => option.value === 'one').label, /Exactly one/);
  assert.match(catalog.logicalOperators().find(option => option.value === 'xor').description, /odd parity/);
});

test('guided manual and automated Windows Registry drafts validate against pinned 0.4 schema', () => {
  const manual = createGuidedAssessment(pack, { platform: 'windows', id: 'manual-review-assessment', title: 'Manual review', mode: 'manual', className: 'compliance', procedure: 'Review the local policy.', response: { type: 'manual-review', choices: [{ value: 'yes', label: 'Yes', outcome: 'true' }, { value: 'no', label: 'No', outcome: 'false' }], allow_comment: true, allow_evidence: true } });
  assert.deepEqual(manual.diagnostics, []); assert.match(manual.yaml, /procedure:/);
  const automated = createGuidedAssessment(pack, { platform: 'windows', id: 'registry-check-assessment', title: 'Registry check', mode: 'automated', className: 'compliance', evaluate: 'xor', tests: [
    { id: 'registry-value-test', title: 'Registry value', capability: 'windows.registry', object: { hive: { equals: 'local_machine' }, key: { equals: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization' }, name: { equals: 'NoLockScreenSlideshow' } }, fields: { type: { equals: 'dword' }, value: { equals: 1 } } },
    { id: 'registry-presence-test', title: 'Registry presence', capability: 'windows.registry', object: { hive: { equals: 'local_machine' }, key: { equals: 'SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization' }, name: { equals: 'NoLockScreenSlideshow' } }, presenceOnly: true }
  ] });
  assert.deepEqual(automated.diagnostics, []); assert.deepEqual(automated.document.assessment.evaluate.xor, [{ test: 'registry-value-test' }, { test: 'registry-presence-test' }]);
  assert.deepEqual(Object.keys(automated.document.assessment.tests['registry-value-test'].require), ['item_requirement', 'field_requirement', 'fields']);
});
