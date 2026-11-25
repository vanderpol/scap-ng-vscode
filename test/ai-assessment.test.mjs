import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument, stringify } from 'yaml';
import { MetadataPack } from '../dist/metadata.js';
import { createAssistedAssessment } from '../dist/assisted-draft.js';
import { AI_REQUEST_TOTAL_TIMEOUT_MS, buildScapNgKnowledge, createAiAssessmentDraft, modelUsesPinnedTools } from '../dist/ai-assessment.js';

const pack = new MetadataPack('.external/editor-pack', JSON.parse(readFileSync('schema-profile.json', 'utf8')));
const validYaml = createAssistedAssessment(pack, {
  title: 'Check the passwd file',
  checkText: 'Verify that the file /etc/passwd is present on the system.'
}).yaml;


test('bounded AI authoring leaves time for a provider correction pass', () => {
  assert.equal(AI_REQUEST_TOTAL_TIMEOUT_MS, 240_000);
});

test('withtools model token detection is explicit and does not match similarly named models', () => {
  assert.equal(modelUsesPinnedTools('gemini-3.8-flash-withtools'), true);
  assert.equal(modelUsesPinnedTools('gemini-3.8-flash-withtools-v2'), true);
  assert.equal(modelUsesPinnedTools('gemini-3.8-flash-withtools_beta'), true);
  assert.equal(modelUsesPinnedTools('gemini-3.8-flash'), false);
  assert.equal(modelUsesPinnedTools('gemini-3.8-flash-withouttools'), false);
});

function response(content) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
}

async function withFetch(handler, action) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return handler({ url: String(url), options });
  };
  try { return { result: await action(), requests }; }
  finally { globalThis.fetch = original; }
}

test('AI knowledge pack carries canonical 0.4.1 provenance, examples, and relevant capability guidance', () => {
  const knowledge = JSON.parse(buildScapNgKnowledge(pack, process.cwd(), { platform: 'rhel', checkText: 'systemctl status firewalld' }));
  assert.equal(knowledge.contract.schema_version, '0.4.1');
  assert.equal(knowledge.contract.canonical_source_commit, JSON.parse(readFileSync('schema-profile.json', 'utf8')).sourceCommit);
  assert.equal(knowledge.contract.editor_pack_manifest_sha256, JSON.parse(readFileSync('schema-profile.json', 'utf8')).manifestSha256);
  assert.equal(knowledge.contract.schema_is_authoritative, true);
  assert.equal(knowledge.contract.runtime_execution_proof, false);
  assert.ok(knowledge.capability_catalog.some(entry => entry.capability === 'linux.systemdunitproperty'));
  assert.ok(knowledge.relevant_capability_mappings.some(entry => entry.capability === 'linux.systemdunitproperty'));
  const organizational = JSON.parse(buildScapNgKnowledge(pack, process.cwd(), {
    platform: 'amazon-linux-2023',
    checkText: 'Verify the /etc/example.conf configuration file contains an organization-approved endpoint value.'
  }));
  assert.ok(organizational.relevant_capability_mappings.some(entry => entry.capability === 'independent.textfilecontent'));
  assert.deepEqual(organizational.schemas['capability-common.schema.json'].defs.input_reference.required, ['input']);
  const inputContract = organizational.schemas['assessment.schema.json'].properties.assessment.properties.inputs;
  assert.deepEqual(inputContract.additionalProperties.required, ['datatype', 'cardinality', 'required']);
  assert.deepEqual(inputContract.additionalProperties.properties.cardinality.enum, ['exactly_one', 'zero_or_one', 'one_or_more', 'zero_or_more']);
  const populationKnowledge = JSON.parse(buildScapNgKnowledge(pack, process.cwd(), { platform: 'ubuntu', checkText: 'For each local interactive user home directory, verify file permissions and ownership from /etc/passwd.' }));
  assert.ok(populationKnowledge.relevant_capability_mappings.some(entry => entry.capability === 'unix.password'));
  assert.ok(populationKnowledge.relevant_capability_mappings.some(entry => entry.capability === 'unix.file'));
  assert.ok(knowledge.schemas['capability-common.schema.json'].defs.set_expression);
  assert.ok(knowledge.schemas['capability-common.schema.json'].defs.file_traversal);
  assert.ok(knowledge.schemas['variable-expression.schema.json'].defs.expression);
  assert.ok(knowledge.authoring_invariants.some(item => /approved deviation.*after evaluation/i.test(item)));
  assert.ok(knowledge.authoring_invariants.some(item => /organization-defined value or policy parameter.*input reference/i.test(item)));
  assert.ok(knowledge.current_authoring_examples.organizational_input.includes('organization-approved-value-input'));
  assert.doesNotMatch(JSON.stringify(knowledge.authoring_invariants), /\b(?:USNO|DoW|chrony|device_t|unlabeled_t|vmci)\b/i);
  assert.ok(knowledge.authoring_invariants.some(item => /missing_organizational_input/i.test(item)));
  assert.ok(knowledge.authoring_invariants.some(item => /never repeat item_requirement inside a logical child/i.test(item)));
  assert.ok(knowledge.authoring_invariants.some(item => /not_applicable is a leaf outcome/i.test(item)));
  assert.ok(knowledge.authoring_invariants.some(item => /(?:Do not|never) emit OVAL spellings such as at_least_one/i.test(item)));
  assert.ok(knowledge.authoring_invariants.some(item => /pattern_match is not a SCAP-NG operator/i.test(item)));
  assert.ok(knowledge.authoring_invariants.some(item => /Never copy collected result\/state fields into an Object selector/i.test(item)));
  assert.match(knowledge.current_authoring_examples.applicability_gate_with_failure, /not_applicable/);
  assert.match(knowledge.editor_documents['SCAP-NG-PRIMER.md'], /Assessment.*Rule|Rule.*Assessment/i);
  assert.match(knowledge.editor_documents['AI-AUTHORING-PLAYBOOK.md'], /population gate|technical Test/i);
  assert.match(knowledge.editor_documents['AI-AUTHORING-PLAYBOOK.md'], /HKEY_CURRENT_USER[\s\S]*windows\.ntuser|windows\.ntuser[\s\S]*NTUSER/i);
  assert.match(knowledge.current_authoring_examples.shellcommand_existence, /field_requirement/);
  assert.match(knowledge.current_authoring_examples.shellcommand_filtered_absence, /always creates an Item/);
  // Keep the outbound prompt bounded enough for an enterprise gateway while
  // retaining schema/mapping/history context.
  assert.ok(JSON.stringify(knowledge).length < 250_000);
  const compactKnowledge = JSON.parse(buildScapNgKnowledge(pack, process.cwd(), { platform: 'amazon-linux-2023', checkText: 'chrony server maxpoll', maxDocumentChars: 3600, compact: true }));
  assert.ok(JSON.stringify(compactKnowledge).length < JSON.stringify(knowledge).length);
  assert.equal(compactKnowledge.vocabulary, undefined);
  assert.ok(compactKnowledge.editor_documents['AI-AUTHORING-PLAYBOOK.md']);
  assert.ok(compactKnowledge.schemas['assessment.schema.json']);
});

test('AI response parser accepts prose-wrapped JSON without accepting prose as content', async () => {
  const payload = JSON.stringify({
    generated_mode: 'manual-only', confidence: 'low', assessment_yaml: '',
    assumptions: ['Wrapped response'], unresolved_questions: [], citations: []
  });
  const wrapped = `Here is the requested contract:
\`\`\`json
${payload}
\`\`\`
`;
  const { result } = await withFetch(() => response(wrapped), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'wrapped-rule', title: 'Wrapped', checkText: 'Review manually.'
  }));
  assert.equal(result.generatedMode, 'manual-only');
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.assumptions.includes('Wrapped response'));
});

test('AI response can recover an omitted generated_mode from an explicit automated Assessment', async () => {
  const payload = JSON.stringify({
    confidence: 'high', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'The provider omitted the protocol mode field.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check /etc/passwd presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-a', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(requests.length, 1);
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.assumptions.some(message => /omitted generated_mode.*assessment\.mode: automated/i.test(message)));
});

test('AI parser normalizes one-item reported_elements enum arrays generically', async () => {
  const value = parseDocument(validYaml).toJS();
  value.assessment.tests['check-the-passwd-file-test'].reported_elements = ['all'];
  const payload = {
    generated_mode: 'automated', confidence: 'high', assessment_yaml: stringify(value),
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Complete.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check /etc/passwd presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  };
  const { result } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-reported-elements', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(result.generatedMode, 'automated');
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.document.assessment.tests['check-the-passwd-file-test'].reported_elements, 'all');
  assert.ok(result.assumptions.some(message => /reported_elements enum/i.test(message)));
});

test('AI parser removes manual-only metadata copied into an automated candidate', async () => {
  const value = parseDocument(validYaml).toJS();
  value.assessment.procedure = 'Manual source procedure copied by the provider.';
  value.assessment.response = { type: 'ocil-manual' };
  value.assessment.references = [{ source_check_ref: 'ocil:test' }];
  value.assessment.evidence_guidance = 'Manual evidence guidance.';
  const payload = {
    generated_mode: 'automated', confidence: 'high', assessment_yaml: stringify(value),
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Complete.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check /etc/passwd presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  };
  const { result, requests } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-metadata', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(requests.length, 1);
  assert.equal(result.generatedMode, 'automated');
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.yaml, /ocil-manual|Manual source procedure|Manual evidence guidance/);
  assert.ok(result.assumptions.some(message => /Removed manual-only Assessment metadata/i.test(message)));
});

test('AI parser rejects windows.registry for an explicit HKEY_CURRENT_USER source', async () => {
  const source = createAssistedAssessment(pack, {
    title: 'Per-user setting',
    checkText: 'Registry Hive: HKEY_CURRENT_USER\nRegistry Path: \\Software\\Policies\\Example\nValue Name: Setting\nValue: 1'
  });
  const value = parseDocument(source.yaml).toJS();
  const candidate = Object.values(value.assessment.tests)[0];
  candidate.capability = 'windows.registry';
  candidate.object = { hive: { equals: 'current_user' }, key: { equals: 'Software\\Policies\\Example' }, name: { equals: 'Setting' } };
  const payload = {
    generated_mode: 'automated', confidence: 'high', assessment_yaml: stringify(value),
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Candidate.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check per-user setting', represented: true, tests: [Object.keys(value.assessment.tests)[0]] }], path_patterns: [] }
  };
  const { result } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-hkcu', {
    ruleId: 'per-user-rule', title: 'Per-user setting', checkText: 'Registry Hive: HKEY_CURRENT_USER\nRegistry Path: \\Software\\Policies\\Example\nValue Name: Setting\nValue: 1'
  }));
  assert.ok(result.diagnostics.some(message => /HKEY_CURRENT_USER.*windows\.registry.*windows\.ntuser/i.test(message)));
});

test('AI response is parsed, pinned-schema validated, and remains review-only', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated',
    confidence: 'medium',
    assessment_yaml: validYaml,
    assumptions: ['The file presence wording is unambiguous.'],
    unresolved_questions: ['Confirm target filesystem visibility.'],
    citations: ['schemas/assessment.schema.json', 'relevant_capability_mappings: unix.file'],
    rationale: 'A native file existence check is available.',
    coverage: {
      applicability: 'not-needed',
      procedure_steps: [{ summary: 'Check /etc/passwd presence', represented: true, tests: ['check-the-passwd-file-test'] }],
      path_patterns: []
    }
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'secret-not-logged', 'model-a', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.', platform: 'rhel', ruleYaml: 'rule: {}'
  }, { reasoningEffort: 'high' }));
  assert.equal(requests.length, 1);
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.automationClass, 'fully-automated');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.document.assessment.mode, 'automated');
  assert.equal(result.method, 'configured-ai');
  assert.equal(result.provider, 'api.example.test');
  assert.equal(result.model, 'model-a');
  assert.match(result.yaml, /generation_method: configured-ai/);
  assert.match(result.yaml, /model: model-a/);
  assert.match(result.yaml, /editor_version: 0\.0\.1/);
  assert.match(result.yaml, /editor_build: [a-f0-9]{7,40}/);
  assert.match(result.yaml, /tool_mode: not-requested/);
  assert.match(result.yaml, /reasoning_effort: high/);
  assert.equal(result.toolMode, 'not-requested');
  assert.equal(typeof result.durationMs, 'number');
  assert.match(result.yaml, /duration_ms:/);
  assert.match(result.yaml, /assessment:/);
  assert.ok(result.assumptions.includes('The file presence wording is unambiguous.'));
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.model, 'model-a');
  assert.match(body.messages[0].content, /canonical_source_commit/);
  assert.match(body.messages[0].content, /0\.4\.1/);
  assert.doesNotMatch(body.messages[0].content, /secret-not-logged/);
});

test('malformed AI JSON and schema-invalid YAML are rejected without a usable draft', async () => {
  const malformed = await withFetch(() => response('not json'), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'bad-rule', title: 'Bad', checkText: 'Review manually.'
  }));
  assert.equal(malformed.result.generatedMode, 'manual-only');
  assert.ok(malformed.result.diagnostics.some(message => /valid JSON|correction pass/i.test(message)));

  const invalid = await withFetch(() => response(JSON.stringify({ generated_mode: 'automated', confidence: 'high', assessment_yaml: 'assessment:\n  mode: automated\n', assumptions: [], unresolved_questions: [], citations: [] })), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'invalid-rule', title: 'Invalid', checkText: 'Review.'
  }));
  assert.equal(invalid.result.generatedMode, 'automated');
  assert.ok(invalid.result.diagnostics.length > 0);
  assert.equal(invalid.result.document, undefined);
});

test('manual-only AI response is preserved as a non-linkable review result', async () => {
  const { result } = await withFetch(() => response(JSON.stringify({
    generated_mode: 'manual-only', confidence: 'low', assessment_yaml: '',
    assumptions: ['The procedure requires an ISSO decision.'],
    unresolved_questions: ['Human approval branch cannot be represented safely.'],
    citations: ['ASSISTED-ASSESSMENT-DRAFTS.md']
  })), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'manual-rule', title: 'Manual', checkText: 'Ask the ISSO.'
  }));
  assert.equal(result.generatedMode, 'manual-only');
  assert.equal(result.yaml, '');
  assert.equal(result.document, undefined);
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.unresolved.length > 0);
});

test('AI authoring cancellation stops before sending a provider request', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const result = await createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'cancel-rule', title: 'Canceled', checkText: 'Verify /etc/passwd is present.'
  }, { signal: controller.signal, request: async () => { called = true; return ''; } });
  assert.equal(called, false);
  assert.equal(result.generatedMode, 'manual-only');
  assert.match(result.diagnostics[0], /canceled/i);
});

test('AI generation fails closed before network use when no key or model is configured', async () => {
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { called = true; throw new Error('network must not be used'); };
  try {
    const result = await createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', '', '', {
      ruleId: 'none-rule', title: 'No provider', checkText: 'Review.'
    });
    assert.equal(result.generatedMode, 'manual-only');
    assert.equal(called, false);
    assert.match(result.diagnostics[0], /API key/i);
  } finally { globalThis.fetch = original; }
});

test('AI drafts with partial applicability or path coverage are visibly rejected', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: validYaml,
    assumptions: [],
    unresolved_questions: ['The applicability branch is not implemented.', 'Additional conf.d/*.conf files require a complex set evaluation.'],
    citations: [], rationale: 'Partial draft',
    coverage: {
      applicability: 'not-representable',
      procedure_steps: [{ summary: 'Check configuration', represented: true, tests: ['check-the-passwd-file-test'] }],
      path_patterns: [{ pattern: '/etc/sssd/conf.d/*.conf', represented: false }]
    }
  });
  const { result } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'LDAP protection', checkText: 'If LDAP is not being utilized, this is Not Applicable. Check /etc/sssd/sssd.conf and /etc/sssd/conf.d/*.conf.'
  }));
  assert.equal(result.confidence, 'low');
  assert.ok(result.diagnostics.some(item => /Not Applicable|conditional branch/i.test(item)));
  assert.ok(result.diagnostics.some(item => /path set|wildcard|complete population/i.test(item)));
});

test('AI coverage does not require an unexecutable OCIL/manual alternative', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Technical check is represented.',
    coverage: {
      applicability: 'not-needed',
      procedure_steps: [
        { summary: 'Check the file presence', represented: true, tests: ['check-the-passwd-file-test'] },
        { summary: 'Complete the source OCIL manual questionnaire', represented: false, tests: [] }
      ],
      path_patterns: []
    }
  });
  const { result } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.coverage.example/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.deepEqual(result.diagnostics, []);
});

test('AI coverage cannot reference a Test that the Assessment does not author', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Unknown coverage reference',
    coverage: {
      applicability: 'not-needed',
      procedure_steps: [{ summary: 'Check the file', represented: true, tests: ['missing-procedure-test'] }],
      path_patterns: []
    }
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(requests.length, 2);
  assert.ok(result.diagnostics.some(item => /Test IDs not present.*missing-procedure-test/i.test(item)));
});

test('AI candidates cannot silently narrow explicit notification alternatives to email only', async () => {
  const payload = {
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [],
    coverage: {
      applicability: 'not-needed',
      procedure_steps: [{ summary: 'Verify integrity checking and notification', represented: true, tests: ['check-the-passwd-file-test'] }],
      path_patterns: []
    }
  };
  const responses = [response(JSON.stringify(payload)), response(JSON.stringify({
    generated_mode: 'manual-only', confidence: 'medium', assessment_yaml: '',
    assumptions: ['The source permits notification channels that require an organizational policy choice.'],
    unresolved_questions: ['Select and qualify the authorized notification mechanism.'], citations: []
  }))];
  let index = 0;
  const { result, requests } = await withFetch(() => responses[index++], () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'aide-notification-rule', title: 'AIDE must notify personnel',
    checkText: 'Verify AIDE notifies personnel by email and/or monitoring system trap. Notifications may also be sent to local consoles or hardware indications.'
  }));
  assert.equal(requests.length, 2);
  assert.equal(result.generatedMode, 'manual-only');
  assert.equal(result.automationClass, 'manual');
});

test('technical not_evaluated branches remain valid when an ISSO exception also exists', async () => {
  const value = parseDocument(validYaml).toJS();
  const testId = Object.keys(value.assessment.tests)[0];
  value.assessment.evaluate = {
    if: { test: testId },
    then: { test: testId },
    else: { not_evaluated: { reason: 'The command returned an unexpected state or unavailable evidence.' } }
  };
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: stringify(value),
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Technical evidence branch',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: [testId] }], path_patterns: [] }
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'isso-branch-rule', title: 'Check the file',
    checkText: 'Verify the file is present. If the result is not documented with the ISSO, this is a finding.', platform: 'rhel'
  }));
  assert.equal(requests.length, 1);
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
});

test('AI generation performs one bounded correction pass after local rejection', async () => {
  let calls = 0;
  const phases = [];
  const repaired = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Corrected draft',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { result, requests } = await withFetch(() => {
    calls++;
    return response(calls === 1 ? JSON.stringify({ generated_mode: 'automated', confidence: 'high', assessment_yaml: validYaml, assumptions: [], unresolved_questions: [], citations: [] }) : repaired);
  }, () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.', progress: phase => phases.push(phase)
  }));
  assert.equal(requests.length, 2);
  assert.deepEqual(phases, ['sending-request', 'waiting-provider', 'received-response', 'validating-response', 'sending-correction', 'waiting-correction', 'received-correction', 'validating-correction']);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.rationale, 'Corrected draft');
});

test('AI authoring reports first-response and correction lifecycle phases', async () => {
  const phases = [];
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Lifecycle test',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const result = await createAiAssessmentDraft(pack, process.cwd(), 'codex-local', '', 'gpt-5.6-luna', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.', progress: phase => phases.push(phase)
  }, { request: async () => payload });
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(phases, ['sending-request', 'waiting-provider', 'received-response', 'validating-response']);
});

test('AI manual-only output remains provider-authored review state without offline content injection', async () => {
  const wireless = `Verify that there are no wireless interfaces configured on the system.\n\nThis is N/A for systems that do not have wireless network adapters.\n\nCheck for the presence of active wireless interfaces with the following command:\n\n# nmcli device\nDEVICE TYPE STATE\neth0 ethernet connected\nwlp3s0 wifi disconnected\nlo loopback unmanaged\n\nIf a wireless interface is configured and its use on the system is not documented with the Information System Security Officer (ISSO), this is a finding.`;
  const payload = JSON.stringify({
    generated_mode: 'manual-only', confidence: 'low', assessment_yaml: '',
    assumptions: ['The provider could not represent the wireless branch.'],
    unresolved_questions: ['ISSO review is required.'], citations: []
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'wireless-rule', title: 'Wireless interfaces must be disabled', checkText: wireless, platform: 'rhel'
  }));
  assert.equal(requests.length, 1);
  assert.equal(result.generatedMode, 'manual-only');
  assert.equal(result.method, 'configured-ai');
  assert.equal(result.yaml, '');
  assert.equal(result.document, undefined);
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.unresolved.includes('ISSO review is required.'));
});

test('withtools models fall back once when the gateway rejects tools', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Fallback draft',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  let calls = 0;
  let persisted = false;
  const { result, requests } = await withFetch(() => {
    calls++;
    if (calls <= 3) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { type: 'invalid_request_error', code: 'tools_unsupported', param: 'tools', message: 'Tools are not supported for this model.' } }) };
    return response(payload);
  }, () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'gemini-3.8-flash-withtools', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.', platform: 'rhel'
  }, { onToolsRejected: async () => { await new Promise(resolve => setTimeout(resolve, 1)); persisted = true; } }));
  assert.equal(requests.length, 4);
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(persisted, true);
  assert.equal(result.toolMode, 'fallback-no-tools');
  assert.match(result.toolWarning, /tools_unsupported|retried once without tools/i);
  assert.match(result.yaml, /tool_mode: fallback-no-tools/);
  assert.equal(JSON.parse(requests[0].options.body).tools.length, 3);
  assert.equal(JSON.parse(requests[3].options.body).tools, undefined);
});

test('withtools models receive pinned local tools and resume after a tool result', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Tool-assisted draft',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  let calls = 0;
  const { result, requests } = await withFetch(() => {
    calls++;
    if (calls === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'scap_ng_search_capabilities', arguments: JSON.stringify({ query: 'file presence', platform: 'rhel' }) } }] } }] }) };
    return response(payload);
  }, () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.tools.example.test/v1', 'key', 'gemini-3.8-flash-withtools', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.', platform: 'rhel', ruleYaml: 'rule: {}'
  }));
  assert.equal(requests.length, 2);
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.toolMode, 'local-pinned-pack');
  assert.equal(typeof result.durationMs, 'number');
  assert.match(result.yaml, /tool_mode: local-pinned-pack/);
  const first = JSON.parse(requests[0].options.body);
  const second = JSON.parse(requests[1].options.body);
  assert.ok(first.tools.some(tool => tool.function.name === 'scap_ng_search_capabilities'));
  assert.equal(second.messages.at(-1).role, 'tool');
  assert.match(second.messages.at(-1).content, /unix\.file|capability/);
});

test('persisted tool rejection skips the failed tools negotiation on later requests', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Cached capability',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.cached.example/v1', 'key', 'gemini-3.8-flash-withtools', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }, { skipTools: true }));
  assert.equal(result.diagnostics.length, 0);
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].options.body).tools, undefined);
  assert.equal(result.toolMode, 'fallback-no-tools');
});

test('provider Assessment specification is normalized from a generic root-envelope mistake', async () => {
  const nestedSpecification = '  specification:\n    id: scap-ng.pre-alpha.assessment\n    version: 0.4.1\n';
  const rootSpecification = 'specification:\n  id: scap-ng.pre-alpha.assessment\n  version: 0.4.1\n';
  const rootSpecificationYaml = validYaml.replace(nestedSpecification, '').replace('assessment:\n', rootSpecification + 'assessment:\n');
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: rootSpecificationYaml,
    assumptions: [], unresolved_questions: [], citations: [],
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { result } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.envelope.example/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.document.assessment.specification.id, 'scap-ng.pre-alpha.assessment');
  assert.ok(result.assumptions.some(item => /normalized it into assessment\.specification/i.test(item)));

  const malformedEnvelope = rootSpecificationYaml.replace('specification:\n', 'unexpected_root_member:\n');
  const malformedPayload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: malformedEnvelope,
    assumptions: [], unresolved_questions: [], citations: [],
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const malformed = await withFetch(() => response(malformedPayload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.envelope.example/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.ok(malformed.result.diagnostics.some(item => /unsupported property.*unexpected_root_member/i.test(item)));
  assert.ok(malformed.result.diagnostics.some(item => /missing required property.*specification/i.test(item)));

  const scalarSpecificationYaml = validYaml.replace(nestedSpecification, '').replace('assessment:\n', 'specification: scap-ng.pre-alpha.assessment/0.4.1\nassessment:\n');
  const scalarPayload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: scalarSpecificationYaml,
    assumptions: [], unresolved_questions: [], citations: [],
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const scalar = await withFetch(() => response(scalarPayload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.envelope.example/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(scalar.result.diagnostics.length, 0);
  assert.deepEqual(scalar.result.document.assessment.specification, { id: 'scap-ng.pre-alpha.assessment', version: '0.4.1' });
  assert.ok(scalar.result.assumptions.some(item => /id\/version.*canonical object form/i.test(item)));
});

test('provider Assessment IDs are normalized generically before correction when they exceed schema limits', async () => {
  const longId = 'ubuntu-operating-system-inactivity-client-alive-interval-configuration-assessment-generated-by-provider';
  const longYaml = validYaml.replace(/id: [^\n]+/, `id: ${longId}`);
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: longYaml,
    assumptions: [], unresolved_questions: [], citations: [],
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.id.example/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(requests.length, 1);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.document.assessment.id, 'check-file-assessment');
  assert.ok(result.assumptions.some(item => /normalized.*identity limit/i.test(item)));
});

test('provider Test IDs and coverage references are normalized generically before schema validation', async () => {
  const value = parseDocument(validYaml).toJS();
  const originalId = Object.keys(value.assessment.tests)[0];
  const longId = 'windows-server-security-policy-check-with-an-intentionally-overlong-provider-generated-name-test';
  value.assessment.tests[longId] = value.assessment.tests[originalId];
  delete value.assessment.tests[originalId];
  value.assessment.evaluate = { test: longId };
  const payload = {
    generated_mode: 'automated', confidence: 'high', assessment_yaml: stringify(value),
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Complete.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check file presence', represented: true, tests: [longId] }], path_patterns: [] }
  };
  const { result, requests } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.test-id.example/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.'
  }));
  assert.equal(requests.length, 1);
  assert.equal(result.diagnostics.length, 0);
  const [normalizedId] = Object.keys(result.document.assessment.tests);
  assert.match(normalizedId, /^[a-z0-9]+(?:-[a-z0-9]+)*-test$/);
  assert.ok(normalizedId.length <= 64);
  assert.deepEqual(result.document.assessment.evaluate, { test: normalizedId });
  assert.match(result.assumptions.find(item => /Normalized provider Test ID/i.test(item)), /→/);
});

test('provider Assessment Input names are normalized generically before schema validation', async () => {
  const inputYaml = validYaml
    .replace('  evaluate:', `  inputs:
    organization-approved-value:
      datatype: string
      cardinality: one_or_more
      required: true
  evaluate:`)
    .replace('          items_found: one_or_more', `          items_found: one_or_more
          items_satisfying: every
        field_requirement:
          values_found: one_or_more
          values_matching: every
        fields:
          full_path:
            equals: {input: organization-approved-value}
            value_match: one_or_more`);
  const payload = { generated_mode: 'automated', confidence: 'high', assessment_yaml: inputYaml, assumptions: [], unresolved_questions: [], citations: [], coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check input-backed path', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] } };
  const { result } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Approved endpoint', checkText: 'Verify the system uses <organization-approved endpoint> as the authorized endpoint value.'
  }));
  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.document.assessment.inputs['organization-approved-value-input']);
  assert.equal(result.document.assessment.tests['check-the-passwd-file-test'].require.fields.full_path.equals.input, 'organization-approved-value-input');
  assert.ok(result.assumptions.some(item => /Input name.*normalized/i.test(item)));
});

test('AI candidates cannot be reported fully automated when source contains an unresolved organizational value', async () => {
  const payload = {
    generated_mode: 'automated', confidence: 'high', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'A provider omitted the source value binding.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check authorized source', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  };
  const { result } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Approved endpoint', checkText: 'Verify the system uses <organization-approved endpoint> as the authorized endpoint value.', ruleYaml: 'rule:\n  default_assessment_choice: manual'
  }));
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.automationClass, 'fully-automated');
  assert.ok(result.diagnostics.some(message => /Assessment Input|not be treated as fully automated/i.test(message)));
});

test('AI candidates with a required organizational input are classified separately from fully automated', async () => {
  const inputYaml = validYaml
    .replace('  evaluate:', `  inputs:
    organization-approved-value-input:
      datatype: string
      cardinality: one_or_more
      required: true
  evaluate:`)
    .replace('          items_found: one_or_more', `          items_found: one_or_more
          items_satisfying: every
        field_requirement:
          values_found: one_or_more
          values_matching: every
        fields:
          full_path:
            equals: {input: organization-approved-value-input}
            value_match: one_or_more`);
  const payload = {
    generated_mode: 'automated', confidence: 'high', assessment_yaml: inputYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'The source value is bound by policy.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check authorized source', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  };
  const { result } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model', {
    ruleId: 'check-file-rule', title: 'Approved endpoint', checkText: 'Verify the system uses <organization-approved endpoint> as the authorized endpoint value.', ruleYaml: 'rule:\n  default_assessment_choice: manual'
  }));
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.automationClass, 'organizational-input');
  assert.equal(result.diagnostics.length, 0);
});

test('AI knowledge does not mistake converted XML discussion tags for organizational placeholders', () => {
  const knowledge = JSON.parse(buildScapNgKnowledge(pack, process.cwd(), {
    platform: 'windows_server_2012_member_server',
    checkText: '<VulnDiscussion>A fixed registry Value: 1 must be enabled.</VulnDiscussion>'
  }));
  assert.ok(knowledge);
});

test('AI rejects an unnecessary organizational Input when the source supplies a fixed registry literal', async () => {
  const source = createAssistedAssessment(pack, {
    title: 'Fixed registry setting',
    checkText: 'Registry Hive: HKEY_LOCAL_MACHINE\nRegistry Path: \\Software\\Policies\\Example\nValue Name: Setting\nType: REG_DWORD\nValue: 1'
  });
  const value = parseDocument(source.yaml).toJS();
  const testId = Object.keys(value.assessment.tests)[0];
  const test = value.assessment.tests[testId];
  value.assessment.inputs = { 'fixed-setting-input': { datatype: 'integer', cardinality: 'exactly_one', required: true } };
  test.require.field_requirement = { values_found: 'one_or_more', values_matching: 'every' };
  test.require.fields = { value: { equals: { input: 'fixed-setting-input' }, value_match: 'one_or_more' } };
  const payload = {
    generated_mode: 'automated', confidence: 'high', assessment_yaml: stringify(value),
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Candidate.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check fixed registry value', represented: true, tests: [testId] }], path_patterns: [] }
  };
  const { result } = await withFetch(() => response(JSON.stringify(payload)), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-fixed-input', {
    ruleId: 'fixed-registry-rule', title: 'Fixed registry setting', checkText: 'Registry Hive: HKEY_LOCAL_MACHINE\nRegistry Path: \\Software\\Policies\\Example\nValue Name: Setting\nType: REG_DWORD\nValue: 1'
  }));
  assert.ok(result.diagnostics.some(message => /concrete registry Value literal.*Input/i.test(message)));
});

test('AI does not treat a command wildcard as a filesystem path set', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Command population.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Inspect command results', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { result } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-command-wildcard', {
    ruleId: 'command-wildcard-rule', title: 'Inspect accounts',
    checkText: 'Run Get-ADUser -Filter * and if any returned records are a finding, report it.'
  }));
  assert.doesNotMatch(result.diagnostics.join('\n'), /path set|wildcard.*complete population/i);
});

test('AI rejects a generic finding-state query inversion', async () => {
  const value = parseDocument(validYaml).toJS();
  const testId = Object.keys(value.assessment.tests)[0];
  const candidate = value.assessment.tests[testId];
  candidate.capability = 'windows.wmi.query';
  candidate.object = { namespace: 'root\\cimv2', query: 'SELECT Name, PasswordRequired FROM Win32_UserAccount WHERE PasswordRequired = False' };
  candidate.require = {
    item_requirement: { items_found: 'one_or_more', items_satisfying: 'every' },
    field_requirement: { values_found: 'one_or_more', values_matching: 'every' },
    fields: { PasswordRequired: { equals: true } }
  };
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: stringify(value),
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Candidate.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Returned noncompliant records are findings', represented: true, tests: [testId] }], path_patterns: [] }
  });
  const { result } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-query-inversion', {
    ruleId: 'query-inversion-rule', title: 'Accounts require passwords',
    checkText: 'If any account records are returned with PasswordRequired False, this is a finding.'
  }));
  assert.ok(result.diagnostics.some(message => /filters query results.*False.*requires.*True|inverts a finding-state query/i.test(message)));
});

test('AI gets a correction opportunity when it over-applies a human exception to a concrete registry check', async () => {
  const repaired = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: ['Review the human exception after technical evaluation.'], citations: [], rationale: 'Objective test retained.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check the fixed registry predicate', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  let calls = 0;
  const { result, requests } = await withFetch(() => response(calls++ === 0 ? JSON.stringify({
    generated_mode: 'manual-only', confidence: 'low', assessment_yaml: '', assumptions: ['ISSO review is required.'], unresolved_questions: ['Exception review.'], citations: [], rationale: 'Manual.'
  }) : repaired), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-manual-exception', {
    ruleId: 'fixed-registry-exception-rule', title: 'Fixed registry setting',
    checkText: 'Registry Hive: HKEY_LOCAL_MACHINE\nRegistry Path: \\Software\\Policies\\Example\nValue Name: Setting\nType: REG_DWORD\nValue: 1\nIf an ISSO exception exists, document it.'
  }));
  assert.equal(requests.length, 2);
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
});

test('AI correction treats an exhaustive command as authoritative over an alternate GUI sample procedure', async () => {
  let calls = 0;
  const repaired = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: ['The command enumerates the target directory population in its default scope.'],
    unresolved_questions: ['Confirm the command scope covers the intended directory.'], citations: [], rationale: 'Objective command retained.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Query the directory for violating accounts', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { requests } = await withFetch(() => response(calls++ === 0 ? JSON.stringify({
    generated_mode: 'manual-only', confidence: 'low', assessment_yaml: '', assumptions: [], unresolved_questions: ['The GUI procedure mentions organization-defined OUs.'], citations: [], rationale: 'Manual.'
  }) : repaired), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-command-scope', {
    ruleId: 'directory-user-token-rule', title: 'Directory users require hardware authentication',
    checkText: 'Run Get-ADUser -Filter {(Enabled -eq $True) -and (SmartcardLogonRequired -eq $False)}. If any accounts are returned, this is a finding. Alternatively, sample accounts in organization-defined OUs through the GUI.'
  }));
  assert.equal(requests.length, 2);
  const firstMessages = JSON.parse(requests[0].options.body).messages;
  const secondMessages = JSON.parse(requests[1].options.body).messages;
  assert.match(firstMessages.find(message => message.role === 'user').content, /alternate procedure as corroborating review text/i);
  assert.match(secondMessages.find(message => message.role === 'user').content, /authoritative command itself has no explicit scope restriction/i);
});

test('AI prompt preserves exact patch prerequisites as conditional automation candidates', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Candidate.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Check the registry setting and version-specific patch', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-patch-branch', {
    ruleId: 'script-block-logging-rule', title: 'PowerShell script block logging',
    checkText: 'Registry Hive: HKEY_LOCAL_MACHINE\nRegistry Path: \SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging\nValue Name: EnableScriptBlockLogging\nValue: 1\nPowerShell 4.0 requires KB3000850 on Windows 2012 R2 or KB3119938 on Windows 2012; PowerShell 5.x requires no patch.'
  }));
  const requestBody = JSON.parse(requests[0].options.body);
  const system = requestBody.messages.find(message => message.role === 'system').content;
  assert.match(system, /windows\.wuaupdatesearcher/);
  assert.match(system, /named prerequisite patch.*not inherently manual/i);
  assert.match(system, /conditional Evaluate logic/i);
});

test('AI does not treat AuditPol category wildcards as filesystem populations', async () => {
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'high', assessment_yaml: validYaml,
    assumptions: [], unresolved_questions: [], citations: [], rationale: 'Audit command.',
    coverage: { applicability: 'not-needed', procedure_steps: [{ summary: 'Inspect AuditPol output', represented: true, tests: ['check-the-passwd-file-test'] }], path_patterns: [] }
  });
  const { result } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-auditpol-wildcard', {
    ruleId: 'auditpol-wildcard-rule', title: 'Audit removable storage',
    checkText: 'Enter "AuditPol /get /category:*". If the system does not audit the setting, this is a finding.'
  }));
  assert.doesNotMatch(result.diagnostics.join('\n'), /path set|wildcard.*complete population/i);
});

test('AI coverage treats an alternate Domain Controller branch as out of scope for an explicit member-server target', async () => {
  const testId = 'check-the-passwd-file-test';
  const payload = JSON.stringify({
    generated_mode: 'automated', confidence: 'medium', assessment_yaml: validYaml,
    assumptions: ['The explicit Member Server Benchmark context selects the local-account branch.'], unresolved_questions: [], citations: [], rationale: 'Role-specific branch selected.',
    coverage: { applicability: 'not-needed', procedure_steps: [
      { summary: 'Domain Controllers: use Get-ADUser for domain accounts.', represented: false, tests: [] },
      { summary: 'Member servers: inspect enabled local accounts.', represented: true, tests: [testId] }
    ], path_patterns: [] }
  });
  const { result } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'key', 'model-role-coverage', {
    ruleId: 'member-role-coverage-rule', title: 'Accounts require passwords', platform: 'windows_server_2012_member_server',
    checkText: 'Domain Controllers: use Get-ADUser. Member servers and standalone systems: inspect local accounts.'
  }));
  assert.doesNotMatch(result.diagnostics.join('\n'), /partial automation|procedure steps.*not represented/i);
});
