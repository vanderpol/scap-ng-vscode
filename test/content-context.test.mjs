import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceIndex } from '../dist/indexer.js';
import { applicabilityForBenchmark, benchmarkApplicabilityAssessments, benchmarkApplicabilityUsage, benchmarkContextLabels, benchmarkContextPlatform, benchmarkContexts, benchmarkRuleAssessments } from '../dist/content-context.js';

const root = '/workspace/content/documents/01-product/authoring/direct-slice';

test('benchmark contexts group related documents by package path and preserve array metadata', () => {
  const index = new WorkspaceIndex();
  index.update(`${root}/benchmark.yaml`, `benchmark:\n  id: direct-slice\n  version:\n    value: 001.002.003\n  title:\n    - text: Product Benchmark\n      language: en\n  profiles:\n    - id: product-profile\n      title: Product profile\n      disabled_rules: [product-rule]\n  rules: [product-rule]\n`);
  index.update(`${root}/applicability.yaml`, `applicability:\n  id: fixture-applicability\n  conditions:\n    product-condition:\n      assessment: product-applicability-assessment\n`);
  index.update(`${root}/rules/product-rule-rule.yaml`, `rule:\n  id: product-rule\n  title: Product rule\n  applicability: [product-condition]\n  assessment_choices:\n    automated:\n      assessment: product-assessment\n`);
  index.update(`${root}/assessments/product-assessment-assessment.yaml`, `assessment:\n  id: product-assessment\n  version: 1\n  assessment_title: Product assessment\n  mode: automated\n`);
  index.update(`${root}/assessments/product-applicability-assessment-assessment.yaml`, `assessment:\n  id: product-applicability-assessment\n  version: 1\n  assessment_title: Product applicability\n  mode: automated\n`);
  index.update('/workspace/content/documents/02-other/authoring/direct-slice/assessments/duplicate-assessment.yaml', `assessment:\n  id: product-applicability-assessment\n  version: 1\n  assessment_title: Other applicability\n  mode: automated\n`);
  index.update(`${root}/assessments/manual-assessment.yaml`, `assessment:\n  id: manual-assessment\n  version: 1\n  assessment_title: Manual assessment\n  mode: manual\n`);

  const contexts = benchmarkContexts(index);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].benchmark.title, 'Product Benchmark');
  assert.equal(contexts[0].benchmark.version, '001.002.003');
  assert.deepEqual(contexts[0].profiles, [{ id: 'product-profile', title: 'Product profile', disabledRuleCount: 1 }]);
  assert.equal(contexts[0].ruleCount, 1);
  assert.equal(contexts[0].rules[0].automationStatus, 'automated');
  assert.equal(contexts[0].automation.automated, 1);
  assert.equal(contexts[0].automation.needsAutomation, 0);
  assert.equal(contexts[0].assessmentCount, 1);
  assert.deepEqual(benchmarkApplicabilityAssessments(contexts[0]).map(item => item.id), ['product-applicability-assessment']);
  assert.deepEqual(benchmarkRuleAssessments(contexts[0]).map(item => item.id), ['product-assessment']);
  assert.deepEqual(benchmarkApplicabilityUsage(contexts[0], 'product-applicability-assessment').rules.map(item => item.id), ['product-rule']);
  assert.equal(contexts[0].assessments.find(item => item.id === 'manual-assessment')?.mode, 'manual');
  assert.equal(benchmarkContextLabels(contexts).get(contexts[0].key), 'Product Benchmark — direct-slice · v001.002.003');
  assert.equal(contexts[0].conditionCount, 1);
  assert.deepEqual(contexts[0].conditions, [{
    name: 'product-condition',
    targetId: 'product-applicability-assessment',
    path: '/applicability/conditions/product-condition/assessment',
    sourceUri: `${root}/applicability.yaml`,
    sourcePath: `${root}/applicability.yaml`
  }]);
  assert.equal(applicabilityForBenchmark(index.applicabilityOptions(), contexts[0]).length, 1);
  assert.deepEqual(applicabilityForBenchmark(index.applicabilityOptions(), undefined), []);
  assert.equal(index.applicabilityOptions().find(option => option.assessmentId === 'product-applicability-assessment')?.available, false);
  assert.equal(index.applicabilityOptions(contexts[0].packagePath).find(option => option.assessmentId === 'product-applicability-assessment')?.available, true);
});


test('benchmark context platform inference covers application benchmarks', () => {
  const base = { packagePath: '/workspace', profiles: [], catalogUris: [], ruleCount: 0, assessmentCount: 0, applicabilityCount: 0, conditionCount: 0, rules: [], assessments: [], applicability: [] };
  const context = (title, id = '') => ({ ...base, key: title, benchmark: { uri: '', path: '', title, id } });
  assert.equal(benchmarkContextPlatform(context('Microsoft Office 365 ProPlus')), 'office365');
  assert.equal(benchmarkContextPlatform(context('Google Chrome')), 'chrome');
  assert.equal(benchmarkContextPlatform(context('Mozilla Firefox Windows')), 'firefox-windows');
  assert.equal(benchmarkContextPlatform(context('Mozilla Firefox Linux')), 'firefox-linux');
});

test('benchmark contexts can group a user-selected folder outside the direct-slice layout', () => {
  const index = new WorkspaceIndex();
  const root = '/tmp/imported-stig';
  index.update(`${root}/benchmark.yaml`, `benchmark:\n  id: imported-benchmark\n  title: Imported Benchmark\n`);
  index.update(`${root}/rules/rule-1.rule.yaml`, `rule:\n  id: imported-rule\n  title: Imported Rule\n`);
  index.update(`${root}/assessments/assessment-1.assessment.yaml`, `assessment:\n  id: imported-assessment\n  version: 1\n  assessment_title: Imported Assessment\n  mode: automated\n`);
  assert.equal(benchmarkContexts(index).length, 0);
  const contexts = benchmarkContexts(index, [root]);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].packagePath, root);
  assert.equal(contexts[0].ruleCount, 1);
  assert.equal(contexts[0].assessmentCount, 0);
});

test('multiple Benchmark documents in one root have distinct selectable context keys', () => {
  const index = new WorkspaceIndex();
  const root = '/workspace/content/multi/authoring/direct-slice';
  index.update(`${root}/one-benchmark.yaml`, `benchmark:\n  id: one-benchmark\n  title: One Benchmark\n`);
  index.update(`${root}/two-benchmark.yaml`, `benchmark:\n  id: two-benchmark\n  title: Two Benchmark\n`);
  const contexts = benchmarkContexts(index);
  assert.equal(contexts.length, 2);
  assert.notEqual(contexts[0].key, contexts[1].key);
  assert.equal(new Set(contexts.map(context => context.packagePath)).size, 1);
});

test('manual Assessment links stay in the automation queue until explicitly flagged', () => {
  const index = new WorkspaceIndex();
  const root = '/workspace/manual-queue/authoring/direct-slice';
  index.update(`${root}/benchmark.yaml`, 'benchmark:\n  id: queue-benchmark\n  title: Queue Benchmark\n');
  index.update(`${root}/rules/manual-rule-rule.yaml`, `rule:\n  id: manual-rule\n  title: Manual Rule\n  assessment_choices:\n    manual:\n      assessment: manual-assessment\n`);
  index.update(`${root}/assessments/manual-assessment-assessment.yaml`, `assessment:\n  id: manual-assessment\n  version: 1\n  assessment_title: Manual Assessment\n  mode: manual\n`);
  let context = benchmarkContexts(index)[0];
  assert.equal(context.rules[0].automationStatus, 'needs-automation');
  assert.equal(context.automation.needsAutomation, 1);
  index.setAutomationDisposition(`${root}/rules/manual-rule-rule.yaml`, 'manual-only');
  context = benchmarkContexts(index)[0];
  assert.equal(context.rules[0].automationStatus, 'manual-only');
  assert.equal(context.automation.manualOnly, 1);
  assert.equal(context.automation.needsAutomation, 0);
});
