import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataPack, GuidedCatalog, createGuidedAssessment, generatedTestTitle } from '../../dist/index.js';
const pin = JSON.parse(readFileSync(new URL('../../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(process.env.SCAP_NG_METADATA_PACK ?? '.external/editor-pack', pin);

test('guided catalog is vocabulary/schema-driven and preserves exact logic distinctions', () => {
  const catalog = new GuidedCatalog(pack);
  assert.equal(catalog.platforms().find(option => option.value === 'windows').label, 'Windows');
  assert.deepEqual(catalog.objectFields('windows.registry').map(field => field.name), ['hive', 'key', 'name']);
  assert.deepEqual(catalog.objectRequirements('windows.registry').map(requirement => requirement.fields), [['hive', 'key', 'name']]);
  assert.deepEqual(catalog.objectRequirements('unix.file').map(requirement => requirement.fields), [['full_path'], ['directory', 'name']]);
  assert.ok(catalog.objectFields('windows.registry').find(field => field.name === 'hive').enumValues.includes('local_machine'));
  assert.deepEqual(catalog.objectFields('windows.registry').find(field => field.name === 'hive').operations.map(option => option.value), ['equals']);
  assert.ok(catalog.objectFields('windows.registry').find(field => field.name === 'key').operations.some(option => option.value === 'matches_regex'));
  assert.ok(catalog.resultFields('linux.partition').some(field => field.name === 'mount_options'));
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
  const itemUri = 'https://scap-ng.dev/schema/v0.4.0/assessment-language.schema.json#/$defs/canonical_all_items_requirement/properties/item_requirement';
  const fieldUri = 'https://scap-ng.dev/schema/v0.4.0/assessment-language.schema.json#/$defs/canonical_all_items_requirement/properties/field_requirement';
  const context = { documentVersion: pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] };
  assert.deepEqual(automated.document.assessment.tests['registry-value-test'].require.item_requirement, pack.newObjectDefaults(itemUri, {}, context));
  assert.deepEqual(automated.document.assessment.tests['registry-value-test'].require.field_requirement, pack.describe(fieldUri, context).suggested);
  assert.deepEqual(Object.keys(automated.document.assessment.tests['registry-value-test'].require), ['item_requirement', 'field_requirement', 'fields']);
  const incomplete = createGuidedAssessment(pack, { platform: 'windows', id: 'incomplete-registry-assessment', title: 'Incomplete registry', mode: 'automated', className: 'compliance', tests: [
    { id: 'incomplete-registry-test', title: 'Incomplete registry', capability: 'windows.registry', object: { hive: { equals: 'local_machine' } }, presenceOnly: true }
  ] });
  assert.deepEqual(Object.keys(incomplete.document.assessment.tests['incomplete-registry-test'].object), ['hive']);
  assert.doesNotMatch(incomplete.yaml, /replace me/i);
});

test('guided authoring generates a native test_title when the optional summary is blank', () => {
  const title = generatedTestTitle(pack, {
    capability: 'windows.registry',
    object: { hive: { equals: 'local_machine' }, key: { equals: 'SOFTWARE\\Policies' } },
    fields: { type: { equals: 'dword' } }
  });
  assert.match(title, /^Check .*Windows Registry/);
  assert.match(title, /hive equals local_machine/);
  assert.match(title, /type equals dword/);
  const generatedDraft = { capability: 'windows.registry', object: { hive: { equals: 'local_machine' }, key: { equals: 'SOFTWARE\\Policies' }, name: { equals: 'PolicyValue' } }, fields: { type: { equals: 'dword' } } };
  const generated = createGuidedAssessment(pack, { platform: 'windows', id: 'generated-summary-assessment', title: 'Generated summary', mode: 'automated', className: 'compliance', tests: [
    { id: 'generated-summary-test', title: '  ', ...generatedDraft }
  ] });
  assert.equal(generated.diagnostics.length, 0);
  assert.equal(generated.document.assessment.tests['generated-summary-test'].test_title, generatedTestTitle(pack, generatedDraft));
});
