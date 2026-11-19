import type { ApplicabilityOption, BenchmarkProfile, IndexedDocument, WorkspaceIndex } from './indexer.js';

export type RuleAutomationStatus = 'automated' | 'manual-only' | 'needs-automation' | 'unresolved';
export interface RuleAutomationSummary {
  automated: number;
  manualOnly: number;
  needsAutomation: number;
  unresolved: number;
}

export interface BenchmarkContextDocument {
  uri: string;
  path: string;
  id?: string;
  title?: string;
  version?: string | number;
  mode?: string;
  automationStatus?: RuleAutomationStatus;
  automationAssessmentId?: string;
  manualAssessmentId?: string;
}

export interface BenchmarkProfileSummary extends BenchmarkProfile {}

/** A named applicability condition and the catalog file that authors it. */
export interface BenchmarkContextCondition {
  name: string;
  targetId: string;
  path: string;
  sourceUri: string;
  sourcePath: string;
}

export interface BenchmarkContextSummary {
  key: string;
  packagePath: string;
  benchmark: BenchmarkContextDocument;
  profiles: readonly BenchmarkProfileSummary[];
  catalogUris: readonly string[];
  ruleCount: number;
  assessmentCount: number;
  applicabilityCount: number;
  conditionCount: number;
  rules: readonly BenchmarkContextDocument[];
  assessments: readonly BenchmarkContextDocument[];
  applicability: readonly BenchmarkContextDocument[];
  conditions: readonly BenchmarkContextCondition[];
  automation: RuleAutomationSummary;
}

/** Return the package root for the canonical direct-slice layout. */
export function packageRootForPath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/');
  const marker = '/authoring/direct-slice/';
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(0, index) : undefined;
}

function documentSummary(document: IndexedDocument, ruleAutomation?: Pick<BenchmarkContextDocument, 'automationStatus' | 'automationAssessmentId' | 'manualAssessmentId'>): BenchmarkContextDocument {
  return { uri: document.uri, path: document.path, id: document.id, title: document.title, version: document.version, mode: document.mode, ...ruleAutomation };
}

function ruleAutomation(document: IndexedDocument, assessmentsById: Map<string, IndexedDocument[]>): Pick<BenchmarkContextDocument, 'automationStatus' | 'automationAssessmentId' | 'manualAssessmentId'> {
  const automated = document.assessmentChoices.find(choice => choice.choice === 'automated');
  const manual = document.assessmentChoices.find(choice => choice.choice === 'manual');
  if (document.automationDisposition === 'manual-only') return { automationStatus: 'manual-only', automationAssessmentId: automated?.targetId, manualAssessmentId: manual?.targetId };
  const resolve = (choice: { targetId: string } | undefined) => {
    if (!choice) return undefined;
    const targets = assessmentsById.get(choice.targetId)?.filter(candidate => candidate.kind === 'assessment') ?? [];
    return targets.length === 1 ? targets[0] : undefined;
  };
  const automatedTarget = resolve(automated);
  if (automated && (!automatedTarget || automatedTarget.mode !== 'automated')) {
    return { automationStatus: 'unresolved', automationAssessmentId: automated?.targetId, manualAssessmentId: manual?.targetId };
  }
  if (automatedTarget) {
    return { automationStatus: 'automated', automationAssessmentId: automated?.targetId, manualAssessmentId: manual?.targetId };
  }
  const manualTarget = resolve(manual);
  if (manual && !manualTarget) return { automationStatus: 'unresolved', manualAssessmentId: manual.targetId };
  // A linked manual Assessment is not proof that a Rule is intentionally
  // manual-only. Until the author flags it in editor metadata, keep it in
  // the automation work queue.
  if (manualTarget || manual) return { automationStatus: 'needs-automation', manualAssessmentId: manual?.targetId };
  return { automationStatus: 'needs-automation' };
}

function byTitle(left: BenchmarkContextDocument, right: BenchmarkContextDocument): number {
  return (left.title ?? left.id ?? left.path).localeCompare(right.title ?? right.id ?? right.path);
}

function pathWithin(path: string, root: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/, '');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/');
}

function packageForRecord(path: string, importedRoots: readonly string[]): string | undefined {
  const canonical = packageRootForPath(path);
  if (canonical) return canonical;
  return importedRoots
    .filter(root => pathWithin(path, root))
    .sort((left, right) => right.length - left.length)[0];
}

/**
 * Build user-facing benchmark contexts without making filesystem names
 * authoritative. `importedRoots` lets the Browse action index a user-selected
 * folder that does not use the canonical direct-slice directory layout.
 */
export function benchmarkContexts(index: WorkspaceIndex, importedRoots: readonly string[] = []): BenchmarkContextSummary[] {
  const records = index.all();
  const byPackage = new Map<string, IndexedDocument[]>();
  for (const record of records) {
    const packagePath = packageForRecord(record.path, importedRoots);
    if (!packagePath) continue;
    const packageRecords = byPackage.get(packagePath) ?? [];
    packageRecords.push(record);
    byPackage.set(packagePath, packageRecords);
  }
  return records.filter(record => record.kind === 'benchmark').flatMap(benchmark => {
    const packagePath = packageForRecord(benchmark.path, importedRoots);
    if (!packagePath) return [];
    const packageRecords = byPackage.get(packagePath) ?? [];
    const assessmentsById = new Map<string, IndexedDocument[]>();
    for (const record of packageRecords.filter(candidate => candidate.kind === 'assessment')) if (record.id) assessmentsById.set(record.id, [...(assessmentsById.get(record.id) ?? []), record]);
    const rules = packageRecords.filter(record => record.kind === 'rule').map(record => documentSummary(record, ruleAutomation(record, assessmentsById))).sort(byTitle);
    const assessments = packageRecords.filter(record => record.kind === 'assessment').map(record => documentSummary(record)).sort(byTitle);
    const automation: RuleAutomationSummary = {
      automated: rules.filter(rule => rule.automationStatus === 'automated').length,
      manualOnly: rules.filter(rule => rule.automationStatus === 'manual-only').length,
      needsAutomation: rules.filter(rule => rule.automationStatus === 'needs-automation').length,
      unresolved: rules.filter(rule => rule.automationStatus === 'unresolved').length
    };
    const applicabilityRecords = packageRecords.filter(record => record.kind === 'applicability');
    const applicability = applicabilityRecords.map(record => documentSummary(record)).sort(byTitle);
    const conditions = applicabilityRecords.flatMap(record => record.applicabilityConditions.map(condition => ({
      name: condition.name,
      targetId: condition.targetId,
      path: condition.path,
      sourceUri: record.uri,
      sourcePath: record.path
    }))).sort((left, right) => left.name.localeCompare(right.name) || left.sourcePath.localeCompare(right.sourcePath));
    const catalogUris = applicability.map(document => document.uri);
    const conditionCount = conditions.length;
    return [{
      // A content root may contain multiple Benchmark documents. Keep the
      // root path for grouping, but use a stable per-Benchmark key for the
      // user's selected editing context.
      key: `${packagePath}::${benchmark.uri}`,
      packagePath,
      benchmark: documentSummary(benchmark),
      profiles: benchmark.profiles.map(profile => ({ ...profile })),
      catalogUris,
      ruleCount: rules.length,
      assessmentCount: assessments.length,
      applicabilityCount: applicability.length,
      conditionCount,
      rules,
      assessments,
      applicability,
      conditions,
      automation
    }];
  }).sort((left, right) => (left.benchmark.title ?? left.packagePath).localeCompare(right.benchmark.title ?? right.packagePath));
}
function compactBenchmarkName(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const compact = title
    .replace(/^\[[^\]]+\]\s*/i, '')
    .replace(/\s+STIG SCAP Benchmark.*$/i, '')
    .replace(/\s+-\s+NIWC.*$/i, '')
    .trim();
  return compact ? (compact.length > 56 ? `${compact.slice(0, 53)}…` : compact) : undefined;
}

/** Labels use a short human name plus the stable logical ID and version. */
export function benchmarkContextLabels(contexts: readonly BenchmarkContextSummary[]): Map<string, string> {
  return new Map(contexts.map(context => {
    const identity = [context.benchmark.id, context.benchmark.version !== undefined ? `v${context.benchmark.version}` : undefined].filter(Boolean).join(' · ');
    const name = compactBenchmarkName(context.benchmark.title);
    return [context.key, [name, identity].filter(Boolean).join(' — ') || context.packagePath];
  }));
}

export function benchmarkContextForKey(contexts: readonly BenchmarkContextSummary[], key: string | undefined): BenchmarkContextSummary | undefined {
  return key ? contexts.find(context => context.key === key) : undefined;
}
export function benchmarkContextPlatform(context: BenchmarkContextSummary | undefined): string | undefined {
  if (!context) return undefined;
  const identity = `${context.benchmark.title ?? ''} ${context.benchmark.id ?? ''} ${context.packagePath}`.toLowerCase();
  if (/office(?:[_\s-]*365)|ms[_\s-]*office/.test(identity)) return 'office365';
  if (/google[_\s-]*chrome|\bchrome\b/.test(identity)) return 'chrome';
  if (/firefox.*windows|mozilla[_\s-]*firefox.*windows/.test(identity)) return 'firefox-windows';
  if (/firefox.*linux|mozilla[_\s-]*firefox.*linux/.test(identity)) return 'firefox-linux';
  if (/sles|suse.*linux/.test(identity) && /(?:12|v3r5)/.test(identity)) return 'sles12';
  if (/sles|suse.*linux/.test(identity) && /(?:15|v2r9)/.test(identity)) return 'sles15';
  if (/amazon.*linux/.test(identity)) return 'amazon';
  if (/oracle[_\s-]*linux|\bol[0-9]+\b/.test(identity)) return 'oracle_linux';
  if (/\btoss\b/.test(identity)) return 'toss';
  if (/ubuntu/.test(identity)) return 'ubuntu';
  if (/apple.*macos|macos/.test(identity)) return 'macos';
  if (/cisco.*ios[-_ ]?xe/.test(identity)) return 'cisco_ios-xe';
  if (/cisco.*ios/.test(identity)) return 'cisco_ios';
  if (/apache.*server/.test(identity)) return `apache_server_${/windows/.test(identity) ? 'windows' : 'unix'}_${/site/.test(identity) ? 'site' : 'host'}`;
  if (/active[_\s-]*directory/.test(identity)) return 'active_directory';
  if (/windows.*server.*dns|server.*dns/.test(identity)) return 'windows_server_dns';
  if (/iis/.test(identity)) {
    const version = /8[._\s-]*5/.test(identity) ? '8-5' : '10';
    return `iis_${version}_${/site/.test(identity) ? 'site' : 'server'}`;
  }
  if (/adobe.*acrobat|acrobat.*reader/.test(identity)) return 'adobe_acrobat';
  if (/ie11|internet explorer/.test(identity)) return 'ms_ie11';
  if (/onedrive/.test(identity)) return 'ms_onedrive';
  if (/exchange/.test(identity)) return 'ms_exchange';
  if (/f5.*nginx|nginx/.test(identity)) return 'f5_nginx';
  if (/kubernetes/.test(identity)) return 'kubernetes';
  if (/dot.?net|framework.*4/.test(identity)) return 'dotnet_framework';
  if (/solaris|sunos|(?:^|[_-])sol[_\s-]*11(?:$|[_-])/.test(identity)) return 'solaris';
  if (/rhel|red\s+hat/.test(identity)) return 'rhel';
  if (/(?:^|[_\s-])windows[_\s-]*11(?:$|[_\s-])/.test(identity)) return 'windows_11';
  if (/(?:^|[_\s-])windows[_\s-]*10(?:$|[_\s-])/.test(identity)) return 'windows_10';
  if (/windows.*server.*2016/.test(identity)) return 'windows_server_2016';
  if (/windows.*server.*2019/.test(identity)) return 'windows_server_2019';
  if (/windows.*server.*2022/.test(identity)) return 'windows_server_2022';
  if (/windows.*server.*2025/.test(identity)) return 'windows_server_2025';
  if (/windows/.test(identity)) return 'windows';
  return undefined;
}


/** Restrict applicability choices to the selected package before showing them in a wizard. */
export function applicabilityForBenchmark(options: readonly ApplicabilityOption[], context: BenchmarkContextSummary | undefined): ApplicabilityOption[] {
  // Applicability choices are package-scoped. Without an explicitly selected
  // Benchmark context, do not expose a cross-package/global dropdown.
  if (!context) return [];
  return options.filter(option => {
    if (option.catalogUri && context.catalogUris.includes(option.catalogUri)) return true;
    const targetRoot = option.targetUri ? packageRootForPath(option.targetUri) : undefined;
    return Boolean(targetRoot && targetRoot === context.packagePath);
  });
}
