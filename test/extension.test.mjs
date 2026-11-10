import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const profile = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url)));
const authoringSidebarSource = readFileSync(new URL('../src/authoring-sidebar.ts', import.meta.url), 'utf8');
test('P0 extension manifest exposes offline Assessment Studio and exact pin descriptor', () => {
  assert.equal(packageJson.main, './dist/extension.js');
  assert.equal(packageJson.publisher, 'vanderpol');
  assert.ok(packageJson.contributes.viewsContainers.activitybar.some(v => v.id === 'scapNg-assessmentStudio'));
  assert.ok(packageJson.contributes.viewsContainers.secondarybar.some(v => v.id === 'scapNg-authoring'));
  assert.match(packageJson.contributes.viewsContainers.activitybar.find(v => v.id === 'scapNg-assessmentStudio').id, /^[A-Za-z0-9_-]+$/);
  assert.equal(packageJson.contributes.views['scapNg-assessmentStudio'][0].id, 'scapNg-assessmentStudio');
  assert.deepEqual(packageJson.contributes.views['scapNg-assessmentStudio'].map(view => view.id), ['scapNg-assessmentStudio']);
  assert.ok(packageJson.contributes.views['scapNg-authoring'].some(view => view.id === 'scapNg-authoringSidebar'));
  assert.equal(packageJson.contributes.views['scapNg-authoring'].find(view => view.id === 'scapNg-authoringSidebar').type, 'webview');
  assert.equal(packageJson.contributes.customEditors[0].viewType, 'scapNg.assessment');
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.searchIndex'));
  assert.ok(packageJson.contributes.menus['view/title'].some(menu => menu.command === 'scapNg.searchIndex' && menu.when === 'view == scapNg-assessmentStudio'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.createGuidedAssessment'));
  assert.deepEqual(packageJson.contributes.configuration.properties['scapNg.assessmentEditor'].enum, ['yaml', 'graphical']);
  assert.equal(packageJson.contributes.configuration.properties['scapNg.assessmentEditor'].default, 'yaml');
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.configureYamlSchemas'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.openAssessmentStudio'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.openAssessmentAuthoringPrototype'));
  assert.ok(packageJson.contributes.menus['editor/title'].some(menu => menu.command === 'scapNg.openAssessmentAuthoringPrototype'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.showBuildInfo'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.diagnoseYaml'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.showYamlStatus'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.testRegex'));
  assert.ok(packageJson.contributes.menus['editor/context'].some(menu => menu.command === 'scapNg.testRegex'));
  assert.ok(packageJson.contributes.menus['editor/title'].some(menu => menu.command === 'scapNg.testRegex'));
  assert.ok(packageJson.contributes.commands.some(command => command.command === 'scapNg.testObject'));
  assert.ok(packageJson.contributes.menus['editor/context'].some(menu => menu.command === 'scapNg.testObject'));
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

test('Authoring sidebar does not alter the workbench layout or expose absolute paths in help context', () => {
  assert.doesNotMatch(authoringSidebarSource, /id=\"minimize\"|id=\"maximize\"|toggleMaximizedAuxiliaryBar|toggleMaximize/);
  assert.doesNotMatch(readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), /authoringSidebar\.autoReveal|maybeRevealAuthoring/);
  assert.doesNotMatch(authoringSidebarSource, /id=\"helpContext\"|model\.editor\.fileName|model\.editor\.path\|\|/);
  assert.match(authoringSidebarSource, /id=\"optionsBody\"/);
  assert.match(authoringSidebarSource, /yaml-only/);
  assert.match(authoringSidebarSource, /mode-graphical/);
  assert.match(authoringSidebarSource, /viewType === 'scapNg.assessment'/);
  assert.match(authoringSidebarSource, /data-tab=\"diagnostics\"|id=\"diagnostics\"/);
  assert.match(authoringSidebarSource, /Assessment execution/);
  assert.match(authoringSidebarSource, /Verified offline pack loaded/);
  assert.match(authoringSidebarSource, /saveSchemaPackPath/);
  assert.match(authoringSidebarSource, /id=\"openGuided\"/);
  assert.match(authoringSidebarSource, /type:'openGuided'/);
  assert.match(authoringSidebarSource, /id=\"assessmentEditor\"/);
  assert.match(authoringSidebarSource, /type:'saveOptions'/);
  assert.match(authoringSidebarSource, /revealPath/);
  assert.match(authoringSidebarSource, /Reveal in YAML/);
  const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
  assert.match(extensionSource, /Authoring workflow/);
  assert.match(extensionSource, /assistedDraft/);
  assert.match(extensionSource, /createAssistedAssessment/);
  assert.match(extensionSource, /id=\"workflow\"/);
  assert.match(extensionSource, /id=\"assistedTitle\"/);
  assert.match(extensionSource, /id=\"assistedCheckText\"/);
  assert.match(extensionSource, /Generate annotated draft/);
  assert.doesNotMatch(authoringSidebarSource, /openSettings|workbench\.action\.openSettings/);
});

test('Assessment Authoring is an explicit isolated source-backed prototype', () => {
  const inspectorSource = readFileSync(new URL('../src/assessment-inspector.ts', import.meta.url), 'utf8');
  assert.match(inspectorSource, /full-feature graphical authoring prototype/);
  assert.match(inspectorSource, /Assessment Authoring/);
  assert.match(inspectorSource, /WorkspaceEdit|applyEdit|editScalar/);
  assert.doesNotMatch(inspectorSource, /openSettings|toggleMaximizedAuxiliaryBar/);
});

test('Issue #44 desktop graphical surface is a real host webview contract', async () => {
  const { graphicalHtml } = await import('../dist/graphical.js');
  const html = graphicalHtml();
  assert.match(html, /grid-template-columns:minmax\(225px,280px\) minmax\(420px,1fr\)/);
  assert.match(html, /Assessment tree/);
  assert.match(html, /Contextual help/);
  assert.match(html, /data-left-tab="assessment"/);
  assert.match(html, /data-left-tab="help"/);
  assert.match(html, /<main id="center" class="center"/);
  assert.match(html, /function showLeftTab\(name\)/);
  assert.match(html, /id="openGuided"/);
  assert.match(html, /type:'openGuided'/);
  assert.match(html, /selected node/);
  assert.match(html, /Shift\+F10/);
  assert.match(html, /type:'structural'/);
  assert.match(html, /meaningful nodes only/);
  assert.match(html, /Object · inspected items/);
  assert.match(html, /Require · pass conditions/);
  assert.match(html, /function editorFields/);
  assert.match(html, /draw\(tree\.root,root\)/, 'the DOM tree must render the constructed Assessment tree model');
  assert.match(html, /field-entry/, 'desktop forms must group label/control pairs into compact columns');
  assert.match(html, /repeat\(2,minmax\(0,1fr\)\)/, 'desktop inspectors use a readable two-column layout');
  assert.match(html, /Array\.isArray\(node\.path\)/, 'partial/stale models must not strand the webview on the loading screen');
  assert.doesNotMatch(html, /Reveal this property in YAML/);
  assert.doesNotMatch(html, /Properties on this node/);
  assert.match(readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8'), /panel\.webview\.html = graphicalHtml\(\)/);
});
