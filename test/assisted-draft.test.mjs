import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { MetadataPack } from '../dist/metadata.js';
import { createAssistedAssessment } from '../dist/assisted-draft.js';

const pack = new MetadataPack('.external/editor-pack', JSON.parse(readFileSync('schema-profile.json', 'utf8')));

test('assisted registry draft is deterministic, annotated, and pinned-schema valid', () => {
  const result = createAssistedAssessment(pack, {
    title: 'Prevent lock screen slide show',
    checkText: 'Set the registry value "NoLockScreenSlideshow" under HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization to 1.'
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  assert.match(result.yaml, /best guess only/);
  assert.equal(result.document.assessment.tests['prevent-lock-screen-slide-show-test'].capability, 'windows.registry');
  assert.equal(result.document.assessment.tests['prevent-lock-screen-slide-show-test'].require.fields.value.equals, 1);
  assert.deepEqual(parseDocument(result.yaml).errors, []);
});

test('assisted fallback produces a schema-valid manual procedure instead of inventing automation', () => {
  const checkText = 'Review the supplied evidence and confirm the requirement with the system owner.';
  const result = createAssistedAssessment(pack, { title: 'Unrecognized requirement', checkText });
  assert.equal(result.generatedMode, 'manual');
  assert.equal(result.confidence, 'low');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.document.assessment.procedure, checkText);
  assert.match(result.yaml, /No supported automated selector pattern/);
});
