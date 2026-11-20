import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataPack } from '../dist/metadata.js';
import { createAssistedAssessment } from '../dist/assisted-draft.js';
import { buildScapNgKnowledge, createAiAssessmentDraft } from '../dist/ai-assessment.js';

const pack = new MetadataPack('.external/editor-pack', JSON.parse(readFileSync('schema-profile.json', 'utf8')));
const validYaml = createAssistedAssessment(pack, {
  title: 'Check the passwd file',
  checkText: 'Verify that the file /etc/passwd is present on the system.'
}).yaml;

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
  assert.match(knowledge.editor_documents['SCAP-NG-PRIMER.md'], /Assessment.*Rule|Rule.*Assessment/i);
  assert.match(knowledge.current_authoring_examples.shellcommand_existence, /field_requirement/);
  // Keep the outbound prompt bounded enough for an enterprise gateway while
  // retaining schema/mapping/history context.
  assert.ok(JSON.stringify(knowledge).length < 250_000);
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
      procedure_steps: [{ summary: 'Check /etc/passwd presence', represented: true, tests: ['check-file-test'] }],
      path_patterns: []
    }
  });
  const { result, requests } = await withFetch(() => response(payload), () => createAiAssessmentDraft(pack, process.cwd(), 'https://api.example.test/v1', 'secret-not-logged', 'model-a', {
    ruleId: 'check-file-rule', title: 'Check the passwd file', checkText: 'Verify that the file /etc/passwd is present.', platform: 'rhel', ruleYaml: 'rule: {}'
  }));
  assert.equal(requests.length, 1);
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.document.assessment.mode, 'automated');
  assert.equal(result.method, 'configured-ai');
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
  assert.match(malformed.result.diagnostics[0], /valid JSON/i);

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
      procedure_steps: [{ summary: 'Check configuration', represented: true, tests: ['check-file-test'] }],
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
