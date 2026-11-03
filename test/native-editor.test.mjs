import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

test('native YAML architecture keeps Source out of the webview textarea', () => {
  assert.doesNotMatch(source, /<textarea id="source"/);
  assert.match(source, /showTextDocument\(document/);
  assert.match(source, /onDidChangeTextEditorSelection/);
  assert.match(source, /Open native YAML editor beside workbench/);
  assert.match(source, /registerCompletionItemProvider\(\{ language: 'yaml', scheme: 'file' \}/);
});
