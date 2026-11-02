import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceIndex } from '../dist/indexer.js';

const assessment = (id, version = 1) => `assessment:\n  id: ${id}\n  version: ${version}\n  assessment_title: ${id} title\n  mode: automated\n  tests:\n    check:\n      capability: windows.registry\n`;
const rule = (id, target, expected = undefined) => `rule:\n  id: ${id}\n  title: ${id} title\n  assessment_choices:\n    default-choice:\n      assessment: ${target}\n${expected === undefined ? '' : `      expected_version: ${expected}\n`}`;

test('indexes logical documents and reverse Assessment usage without path identity', () => {
  const index = new WorkspaceIndex();
  index.update('file:///workspace/a.assessment.yaml', assessment('assessment-a'), '/workspace/a.assessment.yaml');
  index.update('file:///workspace/r.rule.yaml', rule('rule-r', 'assessment-a'), '/workspace/r.rule.yaml');
  assert.equal(index.find('assessment-a').length, 1);
  assert.equal(index.usedBy('assessment-a')[0].id, 'rule-r');
  assert.equal(index.search('WINDOWS.REGISTRY')[0].id, 'assessment-a');
  assert.equal(index.diagnostics().length, 0);
});

test('reports duplicate, unresolved, wrong-kind and incompatible-version references deterministically', () => {
  const index = new WorkspaceIndex();
  index.update('C:\\content\\a.assessment.yaml', assessment('same', 1));
  index.update('file:///linux/b.assessment.yaml', assessment('same', 2));
  index.update('file:///linux/r.rule.yaml', rule('r', 'missing'));
  index.update('file:///linux/r2.rule.yaml', rule('r2', 'same', 9));
  index.update('file:///linux/r3.rule.yaml', rule('r3', 'r'));
  index.update('file:///linux/r4.rule.yaml', rule('r4', 'same'));
  const codes = index.diagnostics().map(d => d.code).sort();
  assert.deepEqual(codes, ['ambiguous-assessment', 'duplicate-id', 'duplicate-id', 'incompatible-version', 'unresolved-assessment', 'wrong-reference-kind']);
  assert.equal(index.find('same').length, 2);
});

test('updates and removals re-evaluate references rather than first-file wins', () => {
  const index = new WorkspaceIndex();
  index.update('rule.yaml', rule('rule', 'assessment'));
  assert.equal(index.diagnostics()[0].code, 'unresolved-assessment');
  index.update('assessment.yaml', assessment('assessment'));
  assert.equal(index.diagnostics().length, 0);
  index.remove('assessment.yaml');
  assert.equal(index.diagnostics()[0].code, 'unresolved-assessment');
});
test('batch indexing remains bounded for a 10,000-document workspace', () => {
  const index = new WorkspaceIndex();
  index.updateMany(Array.from({length: 10_000}, (_, i) => ({uri: `file:///workspace/assessment-${i}.yaml`, text: `assessment:\n  id: assessment-${i}\n  version: 1\n  assessment_title: Assessment ${i}\n`})));
  assert.equal(index.byKind('assessment').length, 10_000);
  assert.equal(index.search('Assessment 9999')[0].id, 'assessment-9999');
});
