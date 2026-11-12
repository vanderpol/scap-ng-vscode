import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessmentEditorModes, usesGraphicalEditor, usesNativeYamlEditor } from '../dist/editor-preferences.js';

const extensionSource = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../src/authoring-sidebar.ts', import.meta.url), 'utf8');

test('mode switching keeps YAML and Split on the native TextDocument path', () => {
  assert.deepEqual(assessmentEditorModes, ['yaml', 'graphical', 'split']);
  assert.equal(usesGraphicalEditor('yaml'), false);
  assert.equal(usesGraphicalEditor('graphical'), true);
  assert.equal(usesGraphicalEditor('split'), true);
  assert.equal(usesNativeYamlEditor('yaml'), true);
  assert.equal(usesNativeYamlEditor('graphical'), false);
  assert.equal(usesNativeYamlEditor('split'), true);
});

test('Split resolves the existing custom editor beside the same native YAML document', () => {
  assert.match(extensionSource, /configuredAssessmentEditor\(api, document\) === 'split'/);
  assert.match(extensionSource, /openNativeYamlBeside\(api, document\)/);
  assert.match(extensionSource, /input\?\.viewType === assessmentCustomEditorId/);
  assert.match(extensionSource, /openTextDocument\(custom\.input\.uri\)/);
  assert.match(sidebarSource, /value="split">Graphical \+ native YAML \(Split\)/);
});

test('Split keeps native edits and Graphical edits on the same source document', () => {
  assert.match(extensionSource, /onDidChangeTextDocument\(.*document\.uri\.toString\(\).*send\(\)/s);
  assert.match(extensionSource, /new api\.WorkspaceEdit\(\)/);
  assert.match(extensionSource, /workspace\.applyEdit\(workspaceEdit\)/);
  assert.match(extensionSource, /document\.uri/);
  assert.match(extensionSource, /supportsMultipleEditorsPerDocument: true/);
});
