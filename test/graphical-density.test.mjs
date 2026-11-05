import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphicalHtml } from '../dist/graphical.js';

test('graphical webview contains syntactically valid JavaScript and source-safe controls', () => {
  const html = graphicalHtml();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Webview script must exist');
  assert.doesNotThrow(() => new Function(script), 'Webview JS must parse');
  assert.match(html, /vscode\.postMessage\(\{type:'edit'/);
  assert.match(html, /revision:current\.revision,version:current\.version/);
});

test('defaults are explained locally rather than by an opaque global toolbar count', () => {
  const html = graphicalHtml();
  assert.doesNotMatch(html, /id="toggleDefaults"/);
  assert.match(html, /function hiddenFor\(path\)/);
  assert.match(html, /function defaultsSummary\(path\)/);
  assert.match(html, /What is hidden\?/);
  assert.match(html, /Show all fields/);
  assert.match(html, /Simplified/);
  assert.match(html, /All fields/);
  assert.match(html, /No schema defaults are hidden in this section/);
});

test('center inspector is construct-focused and default help is on field focus', () => {
  const html = graphicalHtml();
  assert.match(html, /if\(path\.length===1\)return sectionFields\(path\)/, 'Assessment metadata does not show nested Test values');
  assert.match(html, /function groupedForm\(path\)/);
  assert.match(html, /input\.onfocus=\(\)=>renderHelp\(f\)/);
  assert.doesNotMatch(html, /wrap\.append\(help\)/, 'Long descriptions should not fill each property row');
  assert.match(html, /Technical YAML path/);
  assert.match(html, /function friendlyLabel\(f\)/);
});

test('help panel collapses and contextual actions preserve their node path', () => {
  const html = graphicalHtml();
  assert.match(html, /workspace\.help-collapsed/);
  assert.match(html, /classList\.toggle\('help-collapsed',!helpOpen\)/);
  assert.match(html, /const target=menuPath\?\.slice\(\);hideMenu\(\)/);
  assert.match(html, /action:item\.action,path:target/);
});

test('simplified/all-fields only rerenders the inspector, never rebuilds the tree', () => {
  const html = graphicalHtml();
  assert.match(html, /function setDefaultsView\(next\)/);
  const block = html.slice(html.indexOf('function setDefaultsView(next)'), html.indexOf('function defaultsSummary(path)'));
  assert.match(block, /renderCenter\(\);renderHelp\(\)/);
  assert.doesNotMatch(block, /renderTree\(\)|render\(current\)|revealPath\(/);
  assert.match(html, /button\.onclick=\(\)=>setDefaultsView\(item\.value\)/);
  assert.match(html, /action\.onclick=\(\)=>setDefaultsView\(!showDefaults\)/);
  assert.match(html, /const objectFields=allFieldsUnder\(object\)/);
  assert.match(html, /\|\|allFieldsUnder\(node\.path\)\.length>0/);
});

test('Test overview preserves Object-vs-Require semantics', () => {
  const html = graphicalHtml();
  assert.match(html, /Object — what to inspect/);
  assert.match(html, /Require — what must be true/);
  assert.match(html, /function semanticCard\(testPath,which\)/);
  assert.match(html, /function testOverview\(path\)/);
  assert.match(html, /if\(isCollection\(selectedPath\)\)root\.append\(collectionOverview\(selectedPath\)\)/);
});
