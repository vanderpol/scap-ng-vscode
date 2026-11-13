import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inferredVariableDatatype } from '../dist/expression-contract.js';

test('Variable result type is inferred from native operation, never declaration datatype', () => {
  const assessment = { variables: {
    'one-variable': {kind:'constant', expression:{literal:'001'}},
    'typed-version-variable': {kind:'constant', expression:{literal:{datatype:'version', value:'1.02'}}},
    'count-variable': {kind:'local', expression:{count:{literal:['one','one','two']}}},
    'split-variable': {kind:'local', expression:{split:{delimiter:',',value:{literal:'a,b'}}}},
    'numeric-variable': {kind:'constant',expression:{literal:12}},
    'unique-variable': {kind:'local',expression:{unique:{literal:[1,1,2]}}},
    'alias-variable': {kind:'local',expression:{variable:'count-variable'}},
    'arithmetic-variable': {kind:'local',expression:{arithmetic:{
      arithmetic_operation:'add',values:[{literal:1},{literal:1.5}]}}},
    'cycle-a-variable': {kind:'local',expression:{variable:'cycle-b-variable'}},
    'cycle-b-variable': {kind:'local',expression:{variable:'cycle-a-variable'}},
    'untyped-empty-variable': {kind:'constant',expression:{literal:[]}},
    'collected-variable': {kind:'local',expression:{values:{
      object:{object_ref:'shared-object'},field:'owner_uid'}}}
  }};
  const infer = id => inferredVariableDatatype(assessment,id);
  assert.equal(infer('one-variable'),'string');
  assert.equal(infer('typed-version-variable'),'version');
  assert.equal(infer('count-variable'),'integer');
  assert.equal(infer('split-variable'),'string');
  assert.equal(infer('numeric-variable'),'integer');
  assert.equal(infer('unique-variable'),'integer');
  assert.equal(infer('alias-variable'),'integer');
  assert.equal(infer('arithmetic-variable'),'float');
  assert.equal(infer('cycle-a-variable'),undefined);
  assert.equal(infer('untyped-empty-variable'),undefined);
  assert.equal(infer('collected-variable'),undefined,
    'The graphical editor must not invent collected-field types without a qualified schema mapping.');
});

test('Variable GUI never silently deletes legacy YAML datatype and new Variables omit it', () => {
  const extension = readFileSync(new URL('../src/extension.ts', import.meta.url),'utf8');
  const graphical = readFileSync(new URL('../src/graphical.ts', import.meta.url),'utf8');
  assert.match(extension,/const skeleton = \{ kind: 'constant', expression: \{ literal: '' \} \}/);
  assert.doesNotMatch(extension,/const skeleton = \{ kind: 'constant', datatype:/);
  assert.match(graphical,/\['kind','title'\]\.includes/);
  assert.match(graphical,/Explicit migration is required; this editor will not silently delete it/);
  assert.match(graphical,/inference\?\.inferredDatatype/);
});
