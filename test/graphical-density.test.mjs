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
  assert.match(html, /else if\(isCollection\(editPath\)\)root\.append\(collectionOverview\(editPath\)\)/);
});

function evaluationHarness(assessment) {
  const html = graphicalHtml();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'webview script missing');
  const start = script.indexOf('function evalChild(');
  const end = script.indexOf('function hasVisible(', start);
  assert.ok(start >= 0 && end > start, 'evaluation outline functions missing');
  const logic = script.slice(start, end);
  const factory = new Function('current', [
    'let evaluationNodes = new Map();',
    "const key = path => path.map(String).join('/');",
    'const same = (a,b) => Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);',
    'const hasPrefix = (path,prefix) => path.length>prefix.length&&prefix.every((v,i)=>v===path[i]);',
    'const allFieldsUnder = path => (current.fields||[]).filter(f=>hasPrefix(f.path,path));',
    logic,
    'return {treeModel,evaluationSelection,testPathForSelection};'
  ].join('\n'));
  return factory({ fields: [], assessment });
}

test('Evaluate tree follows actual nested expression and resolves Test IDs without duplication', () => {
  const ctx = evaluationHarness({
    mode: 'automated',
    tests: [
      {id:'mount-nosuid-test',title:'Full mount test'},
      {id:'config-option-test',title:'Full config check'},
      {id:'registry-policy-test',title:'Full Windows test'}
    ],
    evaluate: {and:[
      {test:'mount-nosuid-test'},
      {or:[{test:'config-option-test'},{test:'registry-policy-test'}]}
    ]}
  });
  const tree = ctx.treeModel().root;
  const evalRoot = tree.children.find(n=>n.path[1]==='evaluate');
  assert.equal(evalRoot.label, 'Evaluate — AND');
  assert.equal(evalRoot.children[0].label, 'mount-nosuid-test');
  assert.equal(evalRoot.children[1].label, 'OR');
  assert.deepEqual(evalRoot.children[1].children.map(n=>n.label), ['config-option-test','registry-policy-test']);
  assert.deepEqual(ctx.testPathForSelection(evalRoot.children[1].children[1].path),
    ['assessment','tests','registry-policy-test']);
  assert.ok(tree.children.find(n=>n.path[1]==='tests'), 'Definitions remain separate');
});

test('Single Test, conditional evaluation and manual Assessment retain their true shapes', () => {
  const single = evaluationHarness({
    mode: 'automated',
    tests: [{id:'single-test'}],
    evaluate: {test:'single-test'}
  });
  const singleTree = single.treeModel().root.children.find(n=>n.path[1]==='evaluate');
  assert.equal(singleTree.label, 'Evaluate — Test');
  assert.equal(singleTree.children[0].label, 'single-test');

  const conditional = evaluationHarness({
    mode: 'automated',
    tests: [{id:'single-test'}],
    evaluate: {if:{input_provided:'optional-input'}, then:{test:'single-test'},
      else:{not_applicable:{reason:'missing optional input'}}}
  });
  const conditionalTree = conditional.treeModel().root.children.find(n=>n.path[1]==='evaluate');
  assert.equal(conditionalTree.label, 'Evaluate — IF');
  assert.deepEqual(conditionalTree.children.map(n=>n.label),
    ['IF: Input provided: optional-input','THEN: single-test','ELSE: Not applicable']);

  const manual = evaluationHarness({mode:'manual',tests:[]});
  assert.ok(!manual.treeModel().root.children.some(n=>n.path[1]==='evaluate'));
});

test('Evaluate group UI is explicitly read-only, source-backed and does not imply implicit AND', () => {
  const html = graphicalHtml();
  assert.match(html, /function renderEvalOverview\(node\)/);
  assert.match(html, /To change the logic, use Reveal in YAML/);
  assert.match(html, /fillEvalTree\(evalRoot,current\?\.assessment\?\.evaluate/);
  assert.doesNotMatch(html, /last==='evaluate'\)items\.push\(\{label:'Add child'/);
});
