import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const profile = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url)));
test('P0 extension manifest exposes offline Assessment Studio and exact pin descriptor', () => {
  assert.equal(packageJson.main, './dist/extension.js');
  assert.equal(packageJson.publisher, 'vanderpol');
  assert.ok(packageJson.contributes.viewsContainers.activitybar.some(v => v.id === 'scapNg.assessmentStudio'));
  assert.equal(packageJson.contributes.views['scapNg.assessmentStudio'][0].id, 'scapNg.assessmentStudio');
  assert.equal(packageJson.contributes.customEditors[0].viewType, 'scapNg.assessment');
  assert.deepEqual(packageJson.contributes.customEditors[0].selector.map(s => s.filenamePattern), ['**/*.assessment.yaml', '**/*.assessment.yml']);
  assert.equal(profile.schemaVersion, '0.4.0');
  assert.match(profile.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(profile.manifestSha256, /^[a-f0-9]{64}$/);
});
