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
  assert.deepEqual(index.get('file:///workspace/r.rule.yaml').assessmentChoices, [{ choice: 'default-choice', targetId: 'assessment-a', path: '/rule/assessment_choices/default-choice/assessment' }]);
  assert.equal(index.usedBy('assessment-a')[0].id, 'rule-r');
  assert.equal(index.search('WINDOWS.REGISTRY')[0].id, 'assessment-a');
  assert.equal(index.search('a.assessment.yaml')[0].id, 'assessment-a');
  assert.equal(index.diagnostics().length, 0);
});

test('normalizes Assessment authoring modes for exact graphical choice filtering', () => {
  const index = new WorkspaceIndex();
  index.update('auto.assessment.yaml', `assessment:
  id: auto
  version: 1
  assessment_title: Automated
  mode: ' AUTOMATED '
`);
  index.update('manual.assessment.yaml', `assessment:
  id: manual
  version: 1
  assessment_title: Manual
  mode: MANUAL
`);
  assert.equal(index.get('auto.assessment.yaml').mode, 'automated');
  assert.equal(index.get('manual.assessment.yaml').mode, 'manual');
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

test('indexes applicability catalogs and exposes only uniquely resolved Assessment options', () => {
  const index = new WorkspaceIndex();
  index.update('catalog.yaml', `applicability:\n  id: windows-conditions\n  conditions:\n    domain-joined:\n      assessment: windows-domain-joined-applicability-assessment\n`);
  index.update('domain.assessment.yaml', `assessment:\n  id: windows-domain-joined-applicability-assessment\n  version: 1\n  assessment_title: Windows domain member\n  mode: automated\n`);
  const options = index.applicabilityOptions();
  assert.equal(options.length, 1);
  assert.equal(options[0].condition, 'domain-joined');
  assert.equal(options[0].available, true);
  assert.equal(options[0].expectedVersion, 1);
  assert.equal(index.diagnostics().length, 0);
});

test('tracks applicability Assessment dependencies and reports missing targets', () => {
  const index = new WorkspaceIndex();
  index.update('main.assessment.yaml', `assessment:\n  id: main\n  version: 1\n  assessment_title: Main\n  mode: automated\n  dependencies:\n    domain-joined:\n      assessment: missing-applicability\n      expected_version: 1\n      purpose: applicability\n  applicability:\n    assessment: domain-joined\n`);
  assert.equal(index.applicabilityOptions()[0].available, false);
  assert.equal(index.diagnostics()[0].code, 'unresolved-assessment');
  assert.equal(index.diagnostics()[0].path, '/assessment/dependencies/domain-joined/assessment');
});

test('indexes typed local Assessment references and reports unresolved targets without matching literals', () => {
  const index = new WorkspaceIndex();
  index.update('local.assessment.yaml', `assessment:
  id: local
  version: 1
  assessment_title: Local
  mode: automated
  tests:
    check-test:
      test_title: Check
      capability: independent.shellcommand
      object: {command: {equals: first-test}}
      require: {item_requirement: {items_found: one_or_more}}
  evaluate: {test: missing-test}
`);
  const record = index.get('local.assessment.yaml');
  assert.equal(record.localReferenceAnalysis.referencesTo('test', 'missing-test').length, 1);
  assert.equal(record.localReferenceAnalysis.referencesTo('test', 'first-test').length, 0, 'literal selector text is not a Test reference');
  assert.deepEqual(record.diagnostics.map(diagnostic => diagnostic.code), ['unresolved-local-reference']);
});

test('indexes external Assessment dependencies in Evaluate and resolves exact targets', () => {
  const index = new WorkspaceIndex();
  index.update('parent.assessment.yaml', `assessment:
  id: parent
  version: 1
  assessment_title: Parent
  mode: automated
  tests: {}
  evaluate:
    not:
      assessment: child
      expected_version: 2
`);
  index.update('child.assessment.yaml', assessment('child', 2).replace('child title', 'Child title'));
  const parent = index.get('parent.assessment.yaml');
  assert.deepEqual(parent.references, [{
    targetId: 'child', expectedVersion: 2,
    path: '/assessment/evaluate/not/assessment', purpose: 'assessment'
  }]);
  assert.equal(index.diagnostics().length, 0);
});

test('clearing the index removes the prior corpus before an exclusive root is loaded', () => {
  const index = new WorkspaceIndex();
  index.update('/workspace/legacy/benchmark.yaml', 'benchmark:\n  id: legacy-040\n  title: Legacy 0.4.0\n');
  assert.equal(index.byKind('benchmark').length, 1);
  index.clear();
  assert.equal(index.all().length, 0);
  assert.equal(index.diagnostics().length, 0);
  index.update('/imports/q4/benchmark.yaml', 'benchmark:\n  id: q4-041\n  title: Q4 2026 0.4.1\n');
  assert.deepEqual(index.byKind('benchmark').map(item => item.id), ['q4-041']);
});
