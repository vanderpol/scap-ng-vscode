import { readFileSync } from 'node:fs';
import { MetadataPack } from '../dist/metadata.js';
import { createAssistedAssessment } from '../dist/assisted-draft.js';
import { createAiAssessmentDraft } from '../dist/ai-assessment.js';

const baseCases = JSON.parse(readFileSync(new URL('../test/fixtures/ai-authoring-cases.json', import.meta.url), 'utf8'));
const expandedCases = JSON.parse(readFileSync(new URL('../test/fixtures/ai-authoring-expanded.json', import.meta.url), 'utf8'));
const cases = [...baseCases, ...expandedCases];
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const live = args.has('--live');
const runs = Math.max(1, Number(rawArgs.find(arg => arg.startsWith('--runs='))?.slice('--runs='.length) || 1) || 1);
const pack = new MetadataPack('.external/editor-pack', JSON.parse(readFileSync('schema-profile.json', 'utf8')));
const endpoint = process.env.SCAP_NG_AI_ENDPOINT;
const apiKey = process.env.SCAP_NG_AI_API_KEY;
const model = process.env.SCAP_NG_AI_MODEL;
if (live && (!endpoint || !apiKey || !model)) throw new Error('Live mode requires SCAP_NG_AI_ENDPOINT, SCAP_NG_AI_API_KEY, and SCAP_NG_AI_MODEL.');

function text(result) { return result?.yaml ?? ''; }
function capabilities(result) { return [...new Set(Object.values(result?.document?.assessment?.tests ?? {}).map(test => test?.capability).filter(Boolean))]; }
function evaluate(item, result) {
  const expected = item.expected ?? {};
  const actualCapabilities = capabilities(result);
  const body = text(result);
  const failures = [];
  if (expected.mode && result.generatedMode !== expected.mode && !(expected.mode === 'manual-only' && result.generatedMode === 'manual')) failures.push(`mode expected ${expected.mode}, got ${result.generatedMode}`);
  for (const capability of expected.capabilities ?? []) if (!actualCapabilities.includes(capability)) failures.push(`missing capability ${capability}`);
  for (const value of expected.required ?? []) if (!body.includes(value) && !JSON.stringify(result.document ?? {}).includes(value)) failures.push(`missing required token ${value}`);
  for (const value of expected.forbidden ?? []) if (body.includes(value)) failures.push(`forbidden token ${value}`);
  const count = Object.keys(result?.document?.assessment?.tests ?? {}).length;
  if (expected.minTests !== undefined && count < expected.minTests) failures.push(`expected at least ${expected.minTests} Tests, got ${count}`);
  if (expected.maxTests !== undefined && count > expected.maxTests) failures.push(`expected at most ${expected.maxTests} Tests, got ${count}`);
  if (result.generatedMode === 'automated' && result.diagnostics?.length) failures.push(`diagnostics: ${result.diagnostics.slice(0, 2).join(' | ')}`);
  return { ok: failures.length === 0, failures, actualCapabilities, testCount: count };
}

const results = [];
for (let run = 1; run <= runs; run++) for (const item of cases) {
  const started = Date.now();
  let result;
  if (live) result = await createAiAssessmentDraft(pack, process.cwd(), endpoint, apiKey, model, { ruleId: `${item.id}-rule`, title: item.title, checkText: item.checkText, platform: item.platform, ruleYaml: 'rule: {}' });
  else result = createAssistedAssessment(pack, { title: item.title, checkText: item.checkText, platform: item.platform });
  const evaluation = evaluate(item, result);
  results.push({ run, id: item.id, method: live ? 'configured-ai' : 'offline-heuristic', elapsed_ms: Date.now() - started, mode: result.generatedMode, confidence: result.confidence, diagnostics: result.diagnostics?.slice(0, 4) ?? [], ...evaluation });
  console.log(`${evaluation.ok ? 'PASS' : 'FAIL'} run-${run} ${item.id} · ${result.generatedMode}/${result.confidence} · ${Date.now() - started}ms${evaluation.failures.length ? ` · ${evaluation.failures.join('; ')}` : ''}`);
}
const passed = results.filter(result => result.ok).length;
console.log(`\n${passed}/${results.length} runs passed (${live ? 'live AI' : 'offline'}; ${runs} run${runs === 1 ? '' : 's'} per fixture).`);
if (!live && args.has('--strict') && passed !== results.length) process.exitCode = 1;
if (args.has('--json')) console.log(JSON.stringify({ method: live ? 'configured-ai' : 'offline-heuristic', model: live ? model : undefined, pack: pack.pin, results }, null, 2));
