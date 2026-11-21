import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { MetadataPack } from '../dist/metadata.js';
import { createAssistedAssessment } from '../dist/assisted-draft.js';

const baseCases = JSON.parse(readFileSync(new URL('./fixtures/ai-authoring-cases.json', import.meta.url), 'utf8'));
const expandedCases = JSON.parse(readFileSync(new URL('./fixtures/ai-authoring-expanded.json', import.meta.url), 'utf8'));
const cases = [...baseCases, ...expandedCases];
const pack = new MetadataPack('.external/editor-pack', JSON.parse(readFileSync('schema-profile.json', 'utf8')));

test('AI authoring benchmark fixtures are persistent, unique, and replayable offline', () => {
  assert.ok(cases.length >= 250);
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  for (const item of cases) {
    assert.ok(item.title && item.checkText && item.expected, item.id);
    const result = createAssistedAssessment(pack, { title: item.title, checkText: item.checkText, platform: item.platform });
    assert.ok(result.document?.assessment, `${item.id}: missing Assessment document`);
    assert.deepEqual(parseDocument(result.yaml).errors, [], `${item.id}: invalid generated YAML`);
    assert.equal(result.diagnostics.length, 0, `${item.id}: offline diagnostics`);
  }
});
