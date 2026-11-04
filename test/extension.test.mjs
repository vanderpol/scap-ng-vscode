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
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.searchIndex'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.createGuidedAssessment'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.configureYamlSchemas'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.openAssessmentStudio'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.showBuildInfo'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.diagnoseYaml'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.showYamlStatus'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.testRegex'));
  assert.ok(packageJson.contributes.menus['editor/context'].some(menu => menu.command === 'scapNg.testRegex'));
  assert.ok(packageJson.contributes.menus['editor/title'].some(menu => menu.command === 'scapNg.openAssessmentStudio'));
  assert.deepEqual(packageJson.contributes.customEditors[0].selector.map(s => s.filenamePattern), ['**/*.assessment.yaml', '**/*.assessment.yml']);
  assert.equal(profile.schemaVersion, '0.4.0');
  assert.match(profile.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(profile.manifestSha256, /^[a-f0-9]{64}$/);
});

test('offline VSIX runtime dependency closure is present for cold activation', () => {
  for (const dependency of ['yaml', 'ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string']) {
    assert.ok(readFileSync(new URL(`../node_modules/${dependency}/package.json`, import.meta.url)), dependency);
  }
});
