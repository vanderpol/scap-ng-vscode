import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');

test('native YAML architecture keeps Source out of the webview textarea', () => {
  assert.doesNotMatch(source, /<textarea id="source"/);
  assert.match(source, /showTextDocument\(document/);
  assert.match(source, /onDidChangeTextEditorSelection/);
  assert.match(source, /Mode buttons keep the Graphical webview and native YAML editor/);
  assert.match(source, /registerCompletionItemProvider\(\{ language: 'yaml', scheme: 'file' \}/);
  assert.match(source, /registerCodeActionsProvider\(\{ language: 'yaml', scheme: 'file' \}/);
  assert.match(source, /invalid `fields: mount_options:` YAML/);
  assert.match(source, /blankParent/);
  assert.match(source, /Insert missing required Object properties/);
  assert.match(source, /normalizeYamlCompletionIndent/);
  const help = readFileSync(new URL('../src/yaml-help.ts', import.meta.url), 'utf8');
  assert.match(help, /registerDefinitionProvider\(\{ language: 'yaml', scheme: 'file' \}/);
  assert.match(help, /registerHoverProvider\(\{ language: 'yaml', scheme: 'file' \}/);
  assert.match(help, /schemaTargetForPath/);
  const completion = readFileSync(new URL('../src/completion.ts', import.meta.url), 'utf8');
  assert.match(completion, /schema-resolver/);
  assert.match(completion, /variables/);
  assert.match(completion, /oneOf/);
});
