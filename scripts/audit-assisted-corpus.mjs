import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { MetadataPack } from '../dist/metadata.js';
import { createAssistedAssessment } from '../dist/assisted-draft.js';

const inputPath = process.env.SCAP_NG_ASSISTED_INPUT;
const outputPath = process.env.SCAP_NG_ASSISTED_REPORT;
const packPath = process.env.SCAP_NG_METADATA_PACK ?? '.external/editor-pack';
if (!inputPath || !outputPath) throw new Error('Set SCAP_NG_ASSISTED_INPUT and SCAP_NG_ASSISTED_REPORT.');
const profile = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(resolve(packPath), profile);
const records = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
const counts = { total: records.length, withCheckText: 0, automated: 0, nativeAutomated: 0, shellCommandCollection: 0, manual: 0, errors: 0 };
const confidence = {};
const capabilities = {};
const benchmarks = {};
const fallbackReasons = {};
const residualSignals = {};
const familyExamples = {};
const results = [];
const started = Date.now();

function increment(map, key) { map[key] = (map[key] ?? 0) + 1; }
function reason(result) {
  if (result.generatedMode === 'automated') return 'automated';
  const first = result.unresolved?.[0] ?? '';
  if (first.startsWith('The best automated guess failed pinned schema validation:')) return 'schema-validation-fallback';
  if (first.startsWith('No supported automated selector pattern')) return 'unrecognized-pattern';
  if (first.includes('does not satisfy a complete schema-required selector branch')) return 'incomplete-selector';
  return 'manual-fallback';
}
for (const input of records) {
  const benchmark = input.benchmark ?? 'unknown';
  const bench = benchmarks[benchmark] ??= { total: 0, withCheckText: 0, automated: 0, nativeAutomated: 0, shellCommandCollection: 0, manual: 0, errors: 0, capabilities: {}, fallbackReasons: {} };
  bench.total++;
  if (input.check_text) { counts.withCheckText++; bench.withCheckText++; }
  let result;
  try {
    if (!input.title || !input.check_text) throw new Error('Missing Rule title or human-readable check text.');
    result = createAssistedAssessment(pack, { title: input.title, checkText: input.check_text });
    counts[result.generatedMode]++;
    bench[result.generatedMode]++;
    if (result.generatedMode === 'automated') {
      const generatedCapabilities = [...new Set(Object.values(result.document?.assessment?.tests ?? {}).map(test => test?.capability).filter(Boolean))];
      if (generatedCapabilities.includes('independent.shellcommand')) { counts.shellCommandCollection++; bench.shellCommandCollection++; }
      else { counts.nativeAutomated++; bench.nativeAutomated++; }
    }
    increment(confidence, result.confidence);
    const tests = result.document?.assessment?.tests ?? {};
    const caps = [...new Set(Object.values(tests).map(test => test?.capability).filter(Boolean))];
    if (caps.length === 0) {
      increment(fallbackReasons, reason(result));
      increment(bench.fallbackReasons, reason(result));
    }
    if (result.generatedMode === 'manual') {
      const signals = {
        governance: /\b(?:interview|documentation|documented|organizational|organization|site representative|management approval|policy|authorization)\b/i,
        active_directory: /\b(?:Active Directory|domain controller|domain admins?|enterprise admins?|AD trust|forest)\b/i,
        macos: /\b(?:macOS|Mac OS|Darwin|Apple)\b/i,
        solaris: /\b(?:Solaris|SunOS|zonename|SMF|zoneadm|auditconfig)\b/i,
        web_server: /\b(?:IIS|Apache|httpd|NGINX|Tomcat)\b/i,
        audit_or_logging: /\b(?:auditd|auditctl|audit record|SIEM|logging)\b/i,
        configuration: /\b(?:configuration|configured|config file|settings?)\b/i,
        multi_step: /\b(?:1\.|2\.|first|then|and finally|multiple)\b/i
      };
      for (const [signal, pattern] of Object.entries(signals)) if (pattern.test(input.check_text)) increment(residualSignals, signal);
    }
    for (const capability of caps) {
      increment(capabilities, capability);
      increment(bench.capabilities, capability);
      familyExamples[capability] ??= { benchmark, sourceRule: input.source_rule, title: input.title };
    }
    results.push({ ...input, generatedMode: result.generatedMode, confidence: result.confidence, capabilities: caps, diagnostics: result.diagnostics, assumptions: result.assumptions, unresolved: result.unresolved });
  } catch (error) {
    counts.errors++; bench.errors++; increment(fallbackReasons, `audit-error: ${error.message}`); increment(bench.fallbackReasons, `audit-error: ${error.message}`);
    results.push({ ...input, generatedMode: 'error', error: String(error?.stack ?? error) });
  }
}
const report = {
  format: 'scap-ng-vscode/assisted-corpus-audit/1',
  qualification: 'offline heuristic coverage audit; not scanner proof or runtime equivalence',
  input: resolve(inputPath), metadataPack: resolve(packPath), schemaProfileSourceCommit: profile.sourceCommit,
  elapsedMs: Date.now() - started, counts, confidence, capabilities, fallbackReasons, residualSignals, familyExamples, benchmarks, results
};
mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ format: report.format, elapsedMs: report.elapsedMs, counts, confidence, capabilities, fallbackReasons, output: resolve(outputPath) }, null, 2));
