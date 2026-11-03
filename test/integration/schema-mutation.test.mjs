import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MetadataPack } from '../../dist/index.js';
import { GuidedCatalog } from '../../dist/guided.js';
import { completionChoices } from '../../dist/completion.js';
import { modelFor, assessmentEditorModel } from '../../dist/structured-model.js';

const directory = process.env.SCAP_NG_METADATA_PACK;
const sampleRoot = process.env.SCAP_NG_SAMPLE_ROOT;
if (!directory || !sampleRoot) throw new Error('Select SCAP_NG_METADATA_PACK and SCAP_NG_SAMPLE_ROOT explicitly');
const pin = JSON.parse(readFileSync(new URL('../../schema-profile.json', import.meta.url)));

function mutatedPack() {
  const root = mkdtempSync(join(tmpdir(), 'scap-ng-schema-mutation-test-'));
  cpSync(directory, root, { recursive: true });
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const resource = manifest.resources.find(value => value.kind === 'schema' && value.uri.endsWith('/assessment.schema.json'));
  const schemaPath = join(root, resource.path);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const classSchema = schema.properties.assessment.properties.class;
  classSchema.enum.push('fixture-class');
  classSchema.description = 'Fixture class description from the mutated canonical schema.';
  classSchema.default = 'inventory';
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n');
  const bytes = readFileSync(schemaPath);
  resource.bytes = bytes.length;
  resource.sha256 = createHash('sha256').update(bytes).digest('hex');
  const capabilityResource = manifest.resources.find(value => value.kind === 'schema' && value.uri.endsWith('/capabilities/windows.registry.schema.json'));
  const capabilityPath = join(root, capabilityResource.path);
  const capabilitySchema = JSON.parse(readFileSync(capabilityPath, 'utf8'));
  capabilitySchema.$defs.object.properties.hive.oneOf[0].allOf[2].properties.equals.oneOf[0].enum.push('fixture-hive');
  capabilitySchema.$defs.object.properties.fixture_selector = {
    description: 'Fixture selector from the mutated capability schema.',
    type: 'object',
    'x-scap-ng-authoring': { version: 1, context: 'selector_comparison' }
  };
  capabilitySchema.$defs.state_predicate.oneOf.push({
    required: ['fixture_state'],
    properties: { fixture_state: { type: 'object', description: 'Fixture state from the mutated capability schema.' } }
  });
  writeFileSync(capabilityPath, JSON.stringify(capabilitySchema, null, 2) + '\n');
  const capabilityBytes = readFileSync(capabilityPath);
  capabilityResource.bytes = capabilityBytes.length;
  capabilityResource.sha256 = createHash('sha256').update(capabilityBytes).digest('hex');
  manifest.capabilities['fixture.capability'] = { ...manifest.capabilities['windows.registry'] };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(manifestPath, manifestBytes);
  const profile = { ...pin, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex') };
  return { root, pack: new MetadataPack(root, profile), profile };
}

test('schema mutation drives native completion, Graphical controls, hover metadata and capability catalog', () => {
  const { root, pack } = mutatedPack();
  try {
    const prefix = 'assessment:\n  class: ';
    assert.ok(completionChoices(pack, prefix, prefix.length).some(choice => choice.value === 'fixture-class'));
    const catalog = new GuidedCatalog(pack);
    assert.ok(catalog.capabilities().some(choice => choice.value === 'fixture.capability'));
    const objectPrefix = 'assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {';
    assert.ok(completionChoices(pack, objectPrefix, objectPrefix.length).some(choice => choice.value === 'fixture_selector'));
    const hiveValuePrefix = 'assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {hive: {equals: ';
    assert.ok(completionChoices(pack, hiveValuePrefix, hiveValuePrefix.length).some(choice => choice.value === 'fixture-hive'));
    const fieldsPrefix = 'assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      require:\n        fields: {';
    assert.ok(completionChoices(pack, fieldsPrefix, fieldsPrefix.length).some(choice => choice.value === 'fixture_state'));
    const sample = readFileSync(join(sampleRoot, 'fixtures/current-v04/windows-server-2025-lock-screen.assessment.yaml'), 'utf8');
    const model = modelFor({ getText: () => sample, version: 1 }, pack);
    const classField = model.fields.find(field => field.path.join('.') === 'assessment.class');
    assert.deepEqual(classField.choices, ['compliance', 'vulnerability', 'patch', 'inventory', 'miscellaneous', 'fixture-class']);
    assert.equal(classField.description, 'Fixture class description from the mutated canonical schema.');
    assert.equal(classField.suggested, 'inventory');
    assert.equal(classField.hasSuggestion, true);
    const graphical = assessmentEditorModel({ getText: () => sample, version: 1 }, pack);
    const graphicalClass = graphical.fields.find(field => field.path.join('.') === 'assessment.class');
    assert.deepEqual(graphicalClass.choices, classField.choices);
    assert.equal(graphicalClass.description, classField.description);
    assert.equal(graphicalClass.suggested, 'inventory');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
