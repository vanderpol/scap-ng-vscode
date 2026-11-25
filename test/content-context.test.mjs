import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceIndex } from '../dist/indexer.js';
import { applicabilityForBenchmark, benchmarkApplicabilityAssessments, benchmarkApplicabilitySummary, benchmarkApplicabilityUsage, benchmarkContextLabels, benchmarkContextPlatform, benchmarkContexts, benchmarkRuleAssessments } from '../dist/content-context.js';

const root = '/workspace/content/documents/01-product/authoring/direct-slice';

test('benchmark contexts group related documents by package path and preserve array metadata', () => {
  const index = new WorkspaceIndex();
  index.update(`${root}/benchmark.yaml`, `benchmark:\n  id: direct-slice\n  version:\n    value: 001.002.003\n  title:\n    - text: Product Benchmark\n      language: en\n  platform:\n    id: product-platform\n    applicability:\n      operator: AND\n      conditions: [product-condition]\n  profiles:\n    - id: product-profile\n      title: Product profile\n      disabled_rules: [product-rule]\n  rules: [product-rule]\n`);
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
  assert.equal(contexts[0].automation.fullyAutomated, 1);
  assert.equal(contexts[0].automation.organizationalInputAutomated, 0);
  assert.equal(contexts[0].automation.needsAutomation, 0);
  assert.equal(contexts[0].assessmentCount, 1);
  assert.deepEqual(benchmarkApplicabilityAssessments(contexts[0]).map(item => item.id), ['product-applicability-assessment']);
  assert.deepEqual(benchmarkRuleAssessments(contexts[0]).map(item => item.id), ['product-assessment']);
  assert.deepEqual(benchmarkApplicabilityUsage(contexts[0], 'product-applicability-assessment').benchmarkConditions.map(item => item.name), ['product-condition']);
  assert.deepEqual(benchmarkApplicabilityUsage(contexts[0], 'product-applicability-assessment').ruleConditions.map(item => item.name), ['product-condition']);
  assert.deepEqual(benchmarkApplicabilityUsage(contexts[0], 'product-applicability-assessment').rules.map(item => item.id), ['product-rule']);
  // Negative guard: a Rule-linked Assessment must not leak into applicability usage or counters.
  assert.deepEqual(benchmarkApplicabilityUsage(contexts[0], 'product-assessment'), { benchmarkConditions: [], ruleConditions: [], rules: [] });
  assert.deepEqual(benchmarkApplicabilitySummary(contexts[0]), {
    assessmentCount: 1,
    benchmarkConditionCount: 1,
    ruleConditionCount: 1,
    referencedRuleCount: 1,
    catalogCount: 1
  });
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

test('automation statistics distinguish fully automated and organizational-input Assessments', () => {
  const index = new WorkspaceIndex();
  const root = '/workspace/automation-classes/authoring/direct-slice';
  index.update(`${root}/benchmark.yaml`, 'benchmark:\n  id: classes-benchmark\n  title: Classes Benchmark\n');
  index.update(`${root}/rules/full-rule-rule.yaml`, `rule:
  id: full-rule
  title: Fully automated rule
  assessment_choices:
    automated:
      assessment: full-assessment
`);
  index.update(`${root}/rules/input-rule-rule.yaml`, `rule:
  id: input-rule
  title: Organizational input rule
  assessment_choices:
    automated:
      assessment: input-assessment
`);
  index.update(`${root}/assessments/full-assessment.yaml`, `assessment:
  id: full-assessment
  version: 1
  assessment_title: Full
  mode: automated
`);
  index.update(`${root}/assessments/input-assessment.yaml`, `assessment:
  id: input-assessment
  version: 1
  assessment_title: Input
  mode: automated
  inputs:
    approved-value-input:
      datatype: string
      cardinality: exactly_one
      required: true
`);
  const context = benchmarkContexts(index)[0];
  assert.equal(context.automation.fullyAutomated, 1);
  assert.equal(context.automation.organizationalInputAutomated, 1);
  assert.equal(context.automation.manual, 0);
  assert.equal(context.rules.find(rule => rule.id === 'input-rule')?.automationClass, 'organizational-input');
  assert.equal(context.rules.find(rule => rule.id === 'full-rule')?.automationClass, 'fully-automated');
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

test('Benchmark applicability is limited to the platform OS/application gate, not Rule conditions', () => {
  const index = new WorkspaceIndex();
  const root = '/workspace/content/benchmark-scope/authoring/direct-slice';
  index.update(`${root}/benchmark.yaml`, `benchmark:
  id: scoped-benchmark
  title: Scoped Benchmark
  platform:
    id: ubuntu-platform
    title: Ubuntu
    applicability:
      any_of:
        - condition: os-ubuntu
  rules: [rule-only]
`);
  index.update(`${root}/applicability.yaml`, `applicability:
  id: scoped-catalog
  conditions:
    os-ubuntu:
      assessment: os-ubuntu-assessment
    server-role:
      assessment: server-role-assessment
`);
  index.update(`${root}/rules/rule-only-rule.yaml`, `rule:
  id: rule-only
  title: Rule-only applicability
  applicability:
    condition: server-role
  assessment_choices:
    automated:
      assessment: rule-assessment
`);
  for (const [id, title] of [['os-ubuntu-assessment', 'Ubuntu OS'], ['server-role-assessment', 'Server role'], ['rule-assessment', 'Rule compliance']]) {
    index.update(`${root}/assessments/${id}-assessment.yaml`, `assessment:
  id: ${id}
  version: 1
  assessment_title: ${title}
  mode: automated
`);
  }
  const context = benchmarkContexts(index)[0];
  assert.deepEqual(context.benchmark.benchmarkApplicability, ['os-ubuntu']);
  assert.deepEqual(benchmarkApplicabilityAssessments(context).map(item => item.id), ['os-ubuntu-assessment']);
  assert.equal(context.applicabilityCount, 1);
  assert.deepEqual(benchmarkRuleAssessments(context).map(item => item.id), ['rule-assessment']);
  assert.deepEqual(benchmarkApplicabilityUsage(context, 'server-role-assessment'), {
    benchmarkConditions: [],
    ruleConditions: [{
      name: 'server-role',
      targetId: 'server-role-assessment',
      path: '/applicability/conditions/server-role/assessment',
      sourceUri: `${root}/applicability.yaml`,
      sourcePath: `${root}/applicability.yaml`
    }],
    rules: [context.rules[0]]
  });
});

test('Benchmark context exposes direct CPE metadata and source-only applicability without inventing Assessments', () => {
  const index = new WorkspaceIndex();
  const root = '/workspace/direct/authoring/direct-slice';
  index.update(`${root}/benchmark.yaml`, `benchmark:
  id: direct-slice
  title: Direct platform benchmark
  platform:
    id: fixture-platform
    title: Fixture platform
    expected_cpe_identities:
      - value: cpe:/o:fixture:os:1
        binding: cpe_uri_2_2
        source:
          kind: cpe_platform
          id: cpe:/o:fixture:os:1
          sha256: ${'a'.repeat(64)}
  applicability_catalog: direct-slice-applicability
`);
  index.update(`${root}/applicability.yaml`, `applicability:
  id: direct-slice-applicability
  conditions:
    cpe-platform:
      source:
        kind: cpe_platform
        id: cpe:/o:fixture:os:1
        sha256: ${'b'.repeat(64)}
`);
  index.update(`${root}/rules/rule.yaml`, `rule:
  id: rule
  title: Rule
  applicability:
    condition: cpe-platform
`);
  const context = benchmarkContexts(index)[0];
  assert.equal(context.applicabilityCount, 1);
  assert.equal(context.conditionCount, 1);
  assert.equal(context.rules[0].applicability[0], 'cpe-platform');
  assert.deepEqual(benchmarkApplicabilitySummary(context), {
    assessmentCount: 0,
    benchmarkConditionCount: 0,
    ruleConditionCount: 1,
    referencedRuleCount: 1,
    catalogCount: 1
  });
  assert.deepEqual(benchmarkApplicabilityAssessments(context), []);
});

test('Benchmark context reports inherited applicability from the converter coverage sidecar', () => {
  const index = new WorkspaceIndex();
  const root = '/workspace/inherited/documents/pkg/authoring/direct-slice';
  index.update(`${root}/benchmark.yaml`, `benchmark:
  id: direct-slice
  title: Inherited benchmark
  platform:
    id: fixture
    title: Fixture
    expected_cpe_identities:
      - value: cpe:/o:fixture:os:1
        binding: cpe_uri_2_2
        source:
          kind: cpe_platform
          id: cpe:/o:fixture:os:1
          sha256: ${'a'.repeat(64)}
  applicability_catalog: catalog
`);
  index.update(`${root}/applicability.yaml`, `applicability:
  id: catalog
  conditions:
    platform-condition:
      source:
        kind: cpe_platform
        id: cpe:/o:fixture:os:1
        sha256: ${'b'.repeat(64)}
`);
  index.update(`${root}/rules/rule.yaml`, `rule:
  id: rule
  title: Rule
`);
  index.updateCoverage('/workspace/inherited/documents/pkg/coverage.json', JSON.stringify({
    rules: [{ artifacts: ['authoring/direct-slice/rules/rule.json'], applicability: { levels: [{ kind: 'benchmark', id: 'source-benchmark', conditions: [{ condition: 'platform-condition' }] }] } }]
  }));
  const context = benchmarkContexts(index)[0];
  assert.equal(context.rules[0].inheritedApplicability[0].kind, 'benchmark');
  assert.equal(context.applicabilityCount, 1);
  assert.deepEqual(benchmarkApplicabilitySummary(context), {
    assessmentCount: 0,
    benchmarkConditionCount: 1,
    ruleConditionCount: 1,
    referencedRuleCount: 1,
    catalogCount: 1
  });
});

test('benchmark context preserves explicit Windows member-server role for AI branch selection', () => {
  const base = { packagePath: '/workspace', profiles: [], catalogUris: [], ruleCount: 0, assessmentCount: 0, applicabilityCount: 0, conditionCount: 0, rules: [], assessments: [], applicability: [] };
  const context = { ...base, key: 'windows-member-server', benchmark: { uri: '', path: '', title: 'Microsoft Windows Server 2012/2012 R2 Member Server STIG SCAP Benchmark' } };
  assert.equal(benchmarkContextPlatform(context), 'windows_server_2012_member_server');
});
