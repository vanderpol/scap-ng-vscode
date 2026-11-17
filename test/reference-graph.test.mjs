import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAssessmentReferences, referencePathLabel, SourceBuffer, sha256 } from '../dist/index.js';

function assessment() {
  return {
    id: 'reference-demo',
    version: 1,
    assessment_title: 'Reference demo',
    mode: 'automated',
    class: 'compliance',
    variables: {
      'command-variable': { datatype: 'string', expression: { variable: 'source-variable' } },
      'source-variable': { datatype: 'string', expression: { literal: 'shared-object-name' } }
    },
    inputs: {
      'supplied-input': { datatype: 'string', cardinality: 'exactly_one', required: false }
    },
    shared_objects: {
      'reusable-object': { object_title: 'Reusable', capability: 'independent.shellcommand', command: { variable: 'command-variable' } }
    },
    tests: {
      'first-test': {
        test_title: 'First', capability: 'independent.shellcommand', object: 'reusable-object',
        variable: 'command-variable',
        require: { fields: { stdout: { equals: { input: 'supplied-input' } }, stderr: { equals: { variable: 'command-variable' } } } }
      },
      'second-test': {
        test_title: 'Second', capability: 'independent.shellcommand',
        object: { command: { equals: { variable: 'command-variable' } } },
        require: { item_requirement: { items_found: 'one_or_more' } }
      }
    },
    evaluate: { and: [{ test: 'first-test' }, { if: { input_provided: 'supplied-input' }, then: { test: 'second-test' }, else: { test: 'first-test' } }] }
  };
}

test('typed Assessment reference analysis distinguishes local references from equal literals', () => {
  const analysis = analyzeAssessmentReferences(assessment());
  const refs = analysis.references;
  assert.deepEqual([...new Set(refs.map(ref => ref.kind))].sort(), ['input', 'shared-object', 'test', 'variable']);
  assert.equal(analysis.referencesTo('test', 'first-test').length, 2);
  assert.equal(analysis.referencesTo('test', 'second-test').length, 1);
  assert.equal(analysis.referencesTo('variable', 'command-variable').length, 4);
  assert.equal(analysis.referencesTo('input', 'supplied-input').length, 2);
  assert.equal(analysis.referencesTo('shared-object', 'reusable-object').length, 1);
  assert.equal(analysis.referencesTo('variable', 'shared-object-name').length, 0, 'literal text is not a Variable reference');
  assert.equal(analysis.unresolved.length, 0);
  assert.ok(refs.every(ref => referencePathLabel(ref).startsWith('assessment.')));
});

test('typed analysis reports unresolved references without inventing a target', () => {
  const broken = assessment();
  broken.evaluate = { test: 'missing-test' };
  broken.tests['first-test'].require.fields.stdout.equals = { input: 'missing-input' };
  const analysis = analyzeAssessmentReferences(broken);
  assert.deepEqual(analysis.unresolved.map(ref => [ref.kind, ref.targetId]), [['test', 'missing-test'], ['input', 'missing-input']]);
});

test('reference-safe rename rewrites only typed paths and preserves source style atomically', () => {
  const raw = `# keep this comment\r\nassessment:\r\n  variables:\r\n    'source-variable': {datatype: string, expression: {literal: "value"}}\r\n  inputs:\r\n    'supplied-input': {datatype: string, cardinality: exactly_one, required: false}\r\n  tests:\r\n    'first-test': {test_title: 'First', capability: independent.shellcommand, object: reusable-object, require: {fields: {value: {equals: {input: 'supplied-input'}}}}}\r\n  shared_objects:\r\n    'reusable-object': {object_title: Reusable, capability: independent.shellcommand}\r\n  evaluate: {test: first-test}\r\n  references: {note: first-test}\r\n`;
  const source = new SourceBuffer(raw);
  const graph = analyzeAssessmentReferences(source.json().assessment);
  const testRefs = graph.referencesTo('test', 'first-test');
  const renamed = source.renameDefinitionAndReferences(['assessment', 'tests', 'first-test'], testRefs.map(ref => ref.path), 'first-test', 'renamed-test', sha256(raw));
  assert.match(renamed.document.text, /renamed-test/);
  assert.match(renamed.document.text, /note: first-test/, 'untyped literal remains unchanged');
  assert.equal(renamed.document.json().assessment.tests['renamed-test'].test_title, 'First');
  assert.deepEqual(renamed.document.json().assessment.evaluate, { test: 'renamed-test' });
  assert.equal(renamed.undo().text, raw);
});

test('reference-safe rename fails closed on stale, unsafe, duplicate, or anchored references', () => {
  const raw = `assessment:\n  variables:\n    'source-variable': {expression: {literal: old}}\n  tests:\n    'first-test': {test_title: First, capability: independent.shellcommand, require: {item_requirement: {items_found: one_or_more}}}
    'other-test': {test_title: Other, capability: independent.shellcommand, require: {item_requirement: {items_found: one_or_more}}}
  evaluate: {test: first-test}\n`;
  const source = new SourceBuffer(raw);
  const refs = analyzeAssessmentReferences(source.json().assessment).referencesTo('test', 'first-test');
  assert.throws(() => source.renameDefinitionAndReferences(['assessment', 'tests', 'first-test'], refs.map(ref => ref.path), 'first-test', 'renamed-test', 'stale'), /Stale/);
  assert.throws(() => source.renameDefinitionAndReferences(['assessment', 'tests', 'first-test'], refs.map(ref => ref.path), 'first-test', 'bad id', sha256(raw)), /Unsafe/);
  assert.throws(() => source.renameDefinitionAndReferences(['assessment', 'tests', 'first-test'], refs.map(ref => ref.path), 'first-test', 'other-test', sha256(raw)), /already exists/);
  const anchored = `assessment:\n  tests:\n    'first-test': {test_title: First, capability: independent.shellcommand, require: {item_requirement: {items_found: one_or_more}}}
    'other-test': {test_title: Other, capability: independent.shellcommand, require: {item_requirement: {items_found: one_or_more}}}
  evaluate: {test: &ref first-test}\n`;
  const anchoredSource = new SourceBuffer(anchored);
  const anchoredRefs = analyzeAssessmentReferences(anchoredSource.json().assessment).referencesTo('test', 'first-test');
  assert.throws(() => anchoredSource.renameDefinitionAndReferences(['assessment', 'tests', 'first-test'], anchoredRefs.map(ref => ref.path), 'first-test', 'renamed-test', sha256(anchored)), /safe authored scalar|Source mode/);
});

test('reference-safe rename covers Variable, Input, and Shared Object contract paths', () => {
  const raw = `assessment:
  variables:
    old-variable: {expression: {literal: value}}
  inputs:
    old-input: {datatype: string, cardinality: exactly_one, required: false}
  shared_objects:
    old-object: {object_title: Object, capability: independent.shellcommand}
  tests:
    consumer-test:
      test_title: Consumer
      capability: independent.shellcommand
      variable: old-variable
      object: old-object
      require: {fields: {value: {equals: {input: old-input}}}}
  evaluate: {if: {input_provided: old-input}, then: {test: consumer-test}, else: {test: consumer-test}}
`;
  const cases = [
    ['variable', ['assessment', 'variables', 'old-variable'], 'old-variable', 'new-variable'],
    ['input', ['assessment', 'inputs', 'old-input'], 'old-input', 'new-input'],
    ['shared-object', ['assessment', 'shared_objects', 'old-object'], 'old-object', 'new-object']
  ];
  for (const [kind, definitionPath, oldId, newId] of cases) {
    const source = new SourceBuffer(raw);
    const graph = analyzeAssessmentReferences(source.json().assessment);
    const refs = graph.referencesTo(kind, oldId);
    assert.ok(refs.length, `${kind} must have typed references`);
    const edit = source.renameDefinitionAndReferences(definitionPath, refs.map(ref => ref.path), oldId, newId, sha256(raw));
    const renamed = edit.document.json().assessment;
    assert.ok(Object.hasOwn(renamed[definitionPath[1]], newId));
    assert.equal(edit.undo().text, raw);
  }
});

test('deleting a referenced definition remains fail-closed at the host decision boundary', () => {
  const analysis = analyzeAssessmentReferences(assessment());
  assert.ok(analysis.referencesTo('test', 'first-test').length);
  assert.equal(analysis.referencesTo('test', 'unused-test').length, 0);
});
