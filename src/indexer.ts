import { parseDocument } from 'yaml';
import { sha256, type Json } from './metadata.js';
import { analyzeAssessmentReferences, type AssessmentReferenceAnalysis } from './reference-graph.js';
import type { AutomationDisposition } from './automation-metadata.js';

export type DocumentKind = 'assessment' | 'rule' | 'benchmark' | 'applicability' | 'unknown';
export type IndexDiagnosticCode = 'parse-error' | 'duplicate-id' | 'unresolved-assessment' | 'ambiguous-assessment' | 'wrong-reference-kind' | 'incompatible-version' | 'unresolved-local-reference';
export interface IndexDiagnostic { code: IndexDiagnosticCode; message: string; uri: string; path?: string; severity: 'error' | 'warning' }
export interface AssessmentReference { targetId: string; expectedVersion?: string | number; path: string; purpose?: 'assessment' | 'applicability'; }
export interface AssessmentChoiceReference { choice: string; targetId: string; expectedVersion?: string | number; path: string; }
export interface ApplicabilityCondition {
  name: string;
  /** Assessment is optional for provenance-only/unresolved source conditions. */
  targetId?: string;
  path: string;
  catalogUri: string;
  source?: { kind?: string; id?: string; idref?: string; sha256?: string };
}
export interface BenchmarkPlatformIdentity {
  value: string;
  binding?: string;
  source?: { kind?: string; id?: string; idref?: string; sha256?: string };
}
export interface ApplicabilityCoverageLevel {
  kind: string;
  sourceId?: string;
  conditions: readonly string[];
}
export interface ApplicabilityCoverageRule {
  artifactPaths: readonly string[];
  levels: readonly ApplicabilityCoverageLevel[];
}
export interface ApplicabilityCoverage {
  rules: readonly ApplicabilityCoverageRule[];
}
export interface ApplicabilityOption { key: string; value: string; label: string; description?: string; condition: string; assessmentId: string; expectedVersion: string | number; catalogUri: string; targetUri?: string; available: boolean; }
export interface BenchmarkProfile { id?: string; title?: string; disabledRuleCount: number; }
export interface IndexedDocument {
  uri: string; path: string; kind: DocumentKind; id?: string; version?: string | number; title?: string;
  mode?: string; automationDisposition?: AutomationDisposition; ruleApplicability: readonly string[]; benchmarkApplicability: readonly string[]; benchmarkPlatformIdentities: readonly BenchmarkPlatformIdentity[]; capabilities: readonly string[]; references: readonly AssessmentReference[]; assessmentChoices: readonly AssessmentChoiceReference[]; applicabilityConditions: readonly ApplicabilityCondition[]; profiles: readonly BenchmarkProfile[]; localReferenceAnalysis?: AssessmentReferenceAnalysis; sourceHash: string;
  diagnostics: readonly IndexDiagnostic[];
}

type MutableDocument = Omit<IndexedDocument, 'diagnostics'>;
const roots: DocumentKind[] = ['assessment', 'rule', 'benchmark', 'applicability'];
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function pointerPart(value: string) { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }
function pointer(...parts: (string | number)[]) { return '/' + parts.map(part => pointerPart(String(part))).join('/'); }
function version(value: any): string | number | undefined {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (object(value)) return version(value.value);
  return undefined;
}
function title(value: any): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const entry = value.find(candidate => object(candidate) && typeof candidate.text === 'string');
    return entry?.text;
  }
  return undefined;
}
/** Normalize the two authoring modes used by Assessment choices. Unknown
 * values remain visible for diagnostics/search, but casing and surrounding
 * whitespace must not make a valid mode appear in the wrong picker group. */
function assessmentMode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  return normalized || undefined;
}
/** Extract catalog condition names from a canonical 0.4.1 applicability
 * expression. Benchmark platform applicability is an expression (condition,
 * all_of/any_of, or not), not a flat `conditions` list. The legacy operator +
 * conditions shape is accepted for preserved pre-release fixtures. */
function applicabilityConditionReferences(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(item => applicabilityConditionReferences(item));
  if (!object(value)) return [];
  const direct = typeof value.condition === 'string' ? [value.condition] : [];
  const expressionChildren = ['all_of', 'any_of', 'not', 'conditions']
    .flatMap(key => Object.hasOwn(value, key) ? applicabilityConditionReferences(value[key]) : []);
  return [...new Set([...direct, ...expressionChildren])];
}

function collectAssessmentExpressionReferences(value: any, path: string[], references: AssessmentReference[]) {
  if (!object(value)) return;
  if (typeof value.assessment === 'string') {
    references.push({ targetId: value.assessment, expectedVersion: version(value.expected_version), path: pointer(...path, 'assessment'), purpose: 'assessment' });
    return;
  }
  for (const [key, child] of Object.entries(value)) collectAssessmentExpressionReferences(child, [...path, key], references);
}

function benchmarkProfiles(value: any): BenchmarkProfile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(object).map(profile => ({
    id: typeof profile.id === 'string' ? profile.id : undefined,
    title: title(profile.title),
    disabledRuleCount: Array.isArray(profile.disabled_rules) ? profile.disabled_rules.length : 0
  }));
}
function benchmarkPlatformIdentities(value: unknown): BenchmarkPlatformIdentity[] {
  if (!Array.isArray(value)) return [];
  return value.filter(object).flatMap(identity => {
    if (typeof identity.value !== 'string' || !identity.value) return [];
    const source = object(identity.source) ? {
      ...(typeof identity.source.kind === 'string' ? { kind: identity.source.kind } : {}),
      ...(typeof identity.source.id === 'string' ? { id: identity.source.id } : {}),
      ...(typeof identity.source.idref === 'string' ? { idref: identity.source.idref } : {}),
      ...(typeof identity.source.sha256 === 'string' ? { sha256: identity.source.sha256 } : {})
    } : undefined;
    return [{ value: identity.value, ...(typeof identity.binding === 'string' ? { binding: identity.binding } : {}), ...(source && Object.keys(source).length ? { source } : {}) }];
  });
}

function packageRootForPath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/');
  const marker = '/authoring/direct-slice/';
  const index = normalized.lastIndexOf(marker);
  return index >= 0 ? normalized.slice(0, index) : undefined;
}

function coveragePackagePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalized.replace(/\/coverage\.json$/i, '');
}
function coverageCondition(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (object(value) && typeof value.condition === 'string') return value.condition;
  return undefined;
}

export class WorkspaceIndex {
  private readonly documents = new Map<string, MutableDocument>();
  private readonly byId = new Map<string, IndexedDocument[]>();
  private readonly coverageByPackage = new Map<string, ApplicabilityCoverage>();

  update(uri: string, text: string, path = uri, rebuild = true): IndexedDocument {
    let record: MutableDocument;
    const parsed = parseDocument(text, { uniqueKeys: true });
    if (parsed.errors.length) {
      record = { uri, path, kind: 'unknown', ruleApplicability: [], benchmarkApplicability: [], benchmarkPlatformIdentities: [], capabilities: [], references: [], assessmentChoices: [], applicabilityConditions: [], profiles: [], sourceHash: sha256(text) };
    } else {
      const value = parsed.toJS({ maxAliasCount: 50 }) as Record<string, any>;
      const present = roots.filter(root => object(value) && Object.hasOwn(value, root));
      const kind = present.length === 1 ? present[0] : 'unknown';
      const body = kind !== 'unknown' && object(value[kind]) ? value[kind] : {};
      const ruleApplicability = kind === 'rule'
        ? applicabilityConditionReferences(body.applicability)
        : [];
      const benchmarkApplicability = kind === 'benchmark' && object(body.platform)
        ? applicabilityConditionReferences(body.platform.applicability)
        : [];
      const platformIdentities = kind === 'benchmark' && object(body.platform)
        ? benchmarkPlatformIdentities(body.platform.expected_cpe_identities)
        : [];
      const references: AssessmentReference[] = [];
      const assessmentChoices: AssessmentChoiceReference[] = [];
      const applicabilityConditions: ApplicabilityCondition[] = [];
      if (kind === 'rule' && object(body.assessment_choices)) {
        for (const [choice, candidate] of Object.entries(body.assessment_choices)) {
          if (object(candidate) && typeof candidate.assessment === 'string') {
            const pathToAssessment = pointer(kind, 'assessment_choices', choice, 'assessment');
            const expectedVersion = version(candidate.expected_version);
            assessmentChoices.push({ choice, targetId: candidate.assessment, ...(expectedVersion === undefined ? {} : { expectedVersion }), path: pathToAssessment });
            references.push({ targetId: candidate.assessment, expectedVersion, path: pathToAssessment, purpose: 'assessment' });
          }
        }
      }
      if (kind === 'assessment' && object(body.dependencies)) {
        for (const [alias, candidate] of Object.entries(body.dependencies)) {
          if (object(candidate) && typeof candidate.assessment === 'string') references.push({ targetId: candidate.assessment, expectedVersion: version(candidate.expected_version), path: pointer(kind, 'dependencies', alias, 'assessment'), purpose: candidate.purpose === 'applicability' ? 'applicability' : 'assessment' });
        }
      }
      if (kind === 'assessment' && object(body.evaluate)) collectAssessmentExpressionReferences(body.evaluate, [kind, 'evaluate'], references);
      if (kind === 'applicability' && object(body.conditions)) {
        for (const [name, candidate] of Object.entries(body.conditions)) {
          if (!object(candidate)) continue;
          const targetId = typeof candidate.assessment === 'string' ? candidate.assessment : undefined;
          const source = object(candidate.source) ? {
            ...(typeof candidate.source.kind === 'string' ? { kind: candidate.source.kind } : {}),
            ...(typeof candidate.source.id === 'string' ? { id: candidate.source.id } : {}),
            ...(typeof candidate.source.idref === 'string' ? { idref: candidate.source.idref } : {}),
            ...(typeof candidate.source.sha256 === 'string' ? { sha256: candidate.source.sha256 } : {})
          } : undefined;
          // Keep provenance-only conditions in the index even when no
          // executable Assessment exists. They are valid 0.4.1 catalog
          // entries and must not disappear from the editor's applicability
          // view merely because the converter recorded an explicit hold.
          if (!targetId && !source) continue;
          const conditionPath = targetId ? pointer(kind, 'conditions', name, 'assessment') : pointer(kind, 'conditions', name);
          applicabilityConditions.push({ name, ...(targetId ? { targetId } : {}), path: conditionPath, catalogUri: uri, ...(source ? { source } : {}) });
          if (targetId) references.push({ targetId, path: conditionPath, purpose: 'applicability' });
        }
      }
      const capabilities = kind === 'assessment' && object(body.tests) ? Object.values(body.tests).flatMap(test => object(test) && typeof test.capability === 'string' ? [test.capability] : []) : [];
      const localReferenceAnalysis = kind === 'assessment' ? analyzeAssessmentReferences(body) : undefined;
      record = { uri, path, kind, id: typeof body.id === 'string' ? body.id : undefined, version: version(body.version), title: title(body.title ?? body.assessment_title ?? body.benchmark_title), mode: assessmentMode(body.mode), ruleApplicability, benchmarkApplicability, benchmarkPlatformIdentities: platformIdentities, capabilities: [...new Set(capabilities)], references, assessmentChoices, applicabilityConditions, profiles: kind === 'benchmark' ? benchmarkProfiles(body.profiles) : [], localReferenceAnalysis, sourceHash: sha256(text) };
    }
    this.documents.set(uri, record); if (rebuild) this.rebuildDiagnostics(); return this.get(uri)!;
  }

  updateMany(entries: readonly { uri: string; text: string; path?: string }[]) {
    for (const entry of entries) this.update(entry.uri, entry.text, entry.path ?? entry.uri, false);
    this.rebuildDiagnostics();
    return this.all();
  }

  /** Index large converted corpora without monopolizing the extension host event loop. */
  async updateManyAsync(entries: readonly { uri: string; text: string; path?: string }[], batchSize = 250) {
    const size = Math.max(1, Math.floor(batchSize));
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      this.update(entry.uri, entry.text, entry.path ?? entry.uri, false);
      if ((index + 1) % size === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    this.rebuildDiagnostics();
    return this.all();
  }

  setAutomationDisposition(uri: string, disposition: AutomationDisposition | undefined) {
    this.setAutomationDispositions(new Map([[uri, disposition]]));
  }
  setAutomationDispositions(values: ReadonlyMap<string, AutomationDisposition | undefined>) {
    for (const [uri, disposition] of values) {
      const document = this.documents.get(uri);
      if (!document || document.kind !== 'rule') continue;
      document.automationDisposition = disposition;
    }
    this.rebuildDiagnostics();
  }
  remove(uri: string) { this.documents.delete(uri); this.rebuildDiagnostics(); }
  /** Remove all indexed documents before switching to an exclusive content root. */
  clear() { this.documents.clear(); this.coverageByPackage.clear(); this.rebuildDiagnostics(); }
  updateCoverage(path: string, text: string) {
    try {
      const value = JSON.parse(text) as Record<string, any>;
      const rules = Array.isArray(value.rules) ? value.rules.flatMap((candidate: any) => {
        if (!object(candidate)) return [];
        const levels = candidate.applicability?.levels ?? candidate.unconverted_policy_context?.applicability?.levels;
        if (!Array.isArray(levels)) return [];
        const normalizedLevels = levels.flatMap((level: any) => {
          if (!object(level) || typeof level.kind !== 'string') return [];
          const conditions = Array.isArray(level.conditions) ? level.conditions.map(coverageCondition).filter(Boolean) as string[] : [];
          return conditions.length ? [{ kind: level.kind, ...(typeof level.id === 'string' ? { sourceId: level.id } : {}), conditions }] : [];
        });
        if (!normalizedLevels.length) return [];
        return [{ artifactPaths: Array.isArray(candidate.artifacts) ? candidate.artifacts.filter((item: unknown): item is string => typeof item === 'string') : [], levels: normalizedLevels }];
      }) : [];
      this.coverageByPackage.set(coveragePackagePath(path), { rules });
    } catch {
      // Coverage is diagnostic/provenance metadata. A malformed sidecar must
      // never invalidate or replace the authoritative YAML index.
      this.coverageByPackage.delete(coveragePackagePath(path));
    }
  }
  removeCoverage(path: string) { this.coverageByPackage.delete(coveragePackagePath(path)); }
  coverageForPackage(packagePath: string): ApplicabilityCoverage | undefined { return this.coverageByPackage.get(packagePath.replaceAll('\\', '/').replace(/\/+$/, '')); }
  get(uri: string): IndexedDocument | undefined { const document = this.documents.get(uri); return document ? this.withDiagnostics(document) : undefined; }
  all(): IndexedDocument[] { return [...this.documents.values()].sort((a, b) => a.uri.localeCompare(b.uri)).map(document => this.withDiagnostics(document)); }
  private withDiagnostics(document: MutableDocument): IndexedDocument { return { ...document, diagnostics: this.diagnosticsFor(document.uri) }; }
  byKind(kind: DocumentKind): IndexedDocument[] { return this.all().filter(document => document.kind === kind); }
  find(id: string): IndexedDocument[] { return this.byId.get(id) ?? []; }
  usedBy(id: string): IndexedDocument[] { return this.all().filter(document => document.references.some(reference => reference.targetId === id)); }
  applicabilityOptions(packagePath?: string): ApplicabilityOption[] {
    const options: ApplicabilityOption[] = [];
    const inPackage = (document: IndexedDocument) => {
      if (!packagePath) return true;
      const canonical = packageRootForPath(document.path);
      if (canonical) return canonical === packagePath;
      const path = document.path.replaceAll('\\', '/').replace(/\/+$/, '');
      const root = packagePath.replaceAll('\\', '/').replace(/\/+$/, '');
      return path === root || path.startsWith(root + '/');
    };
    for (const catalog of this.byKind('applicability').filter(inPackage)) for (const condition of catalog.applicabilityConditions) {
      if (!condition.targetId) continue;
      const targets = this.find(condition.targetId).filter(document => document.kind === 'assessment' && inPackage(document));
      const target = targets.length === 1 ? targets[0] : undefined;
      options.push({ key: `${catalog.uri}#${condition.name}`, value: condition.name, label: target?.title ? `${condition.name} — ${target.title}` : condition.name, description: target ? `${condition.targetId} · version ${target.version ?? 'unknown'}` : `${condition.targetId} · unresolved`, condition: condition.name, assessmentId: condition.targetId, expectedVersion: target?.version ?? 1, catalogUri: condition.catalogUri, targetUri: target?.uri, available: targets.length === 1 });
    }
    // A catalog is authoritative, but a dependency explicitly marked for
    // applicability is still useful while a catalog is being assembled.
    for (const source of this.byKind('assessment').filter(inPackage)) for (const reference of source.references.filter(reference => reference.purpose === 'applicability')) {
      if (options.some(option => option.assessmentId === reference.targetId)) continue;
      const targets = this.find(reference.targetId).filter(document => document.kind === 'assessment' && inPackage(document));
      const target = targets.length === 1 ? targets[0] : undefined;
      options.push({ key: `assessment:${reference.targetId}`, value: reference.targetId, label: target?.title ? `${target.title} (${reference.targetId})` : reference.targetId, description: target ? `Referenced applicability Assessment · version ${target.version ?? 'unknown'}` : 'Referenced applicability Assessment is unresolved', condition: reference.targetId, assessmentId: reference.targetId, expectedVersion: target?.version ?? reference.expectedVersion ?? 1, catalogUri: '', targetUri: target?.uri, available: targets.length === 1 });
    }
    return options.filter((option, index, all) => all.findIndex(candidate => candidate.value === option.value && candidate.assessmentId === option.assessmentId) === index).sort((a, b) => a.label.localeCompare(b.label));
  }
  search(query: string, kind?: DocumentKind): IndexedDocument[] {
    const needle = query.trim().toLocaleLowerCase(); if (!needle) return kind ? this.byKind(kind) : this.all();
    return this.all().filter(document => (!kind || document.kind === kind) && [document.id, document.title, document.mode, document.path, ...document.capabilities].filter(Boolean).some(value => String(value).toLocaleLowerCase().includes(needle)));
  }
  diagnostics(): IndexDiagnostic[] { return this.all().flatMap(document => document.diagnostics); }

  private diagnosticsByUri = new Map<string, IndexDiagnostic[]>();
  private diagnosticsFor(uri: string) { return this.diagnosticsByUri.get(uri) ?? []; }
  private rebuildDiagnostics() {
    this.byId.clear(); this.diagnosticsByUri.clear();
    for (const document of this.documents.values()) if (document.id) this.byId.set(document.id, [...(this.byId.get(document.id) ?? []), document as IndexedDocument]);
    for (const document of this.documents.values()) {
      const diagnostics: IndexDiagnostic[] = [];
      const parsed = document.kind === 'unknown' && !document.id ? 'parse-error' : undefined;
      if (parsed) diagnostics.push({ code: 'parse-error', message: 'Document is not a parseable SCAP-NG Assessment, Rule, Benchmark or Applicability Catalog mapping', uri: document.uri, severity: 'error' });
      if (document.id && (this.byId.get(document.id)?.length ?? 0) > 1) diagnostics.push({ code: 'duplicate-id', message: `Duplicate logical ID: ${document.id}`, uri: document.uri, path: '/'+document.kind+'/id', severity: 'error' });
      for (const reference of document.localReferenceAnalysis?.unresolved ?? []) {
        diagnostics.push({ code: 'unresolved-local-reference', message: `Assessment ${reference.kind} reference not found: ${reference.targetId}`, uri: document.uri, path: '/' + reference.path.slice(1).map(String).join('/'), severity: 'error' });
      }
      for (const reference of document.references) {
        const candidates = this.find(reference.targetId);
        if (!candidates.length) { diagnostics.push({ code: 'unresolved-assessment', message: `Assessment reference not found: ${reference.targetId}`, uri: document.uri, path: reference.path, severity: 'error' }); continue; }
        const assessments = candidates.filter(candidate => candidate.kind === 'assessment');
        if (!assessments.length) { diagnostics.push({ code: 'wrong-reference-kind', message: `Reference is not an Assessment: ${reference.targetId}`, uri: document.uri, path: reference.path, severity: 'error' }); continue; }
        const matching = reference.expectedVersion === undefined ? assessments : assessments.filter(candidate => String(candidate.version) === String(reference.expectedVersion));
        if (reference.expectedVersion !== undefined && !matching.length) diagnostics.push({ code: 'incompatible-version', message: `Assessment ${reference.targetId} does not provide required version ${reference.expectedVersion}`, uri: document.uri, path: reference.path, severity: 'error' });
        else if (matching.length > 1) diagnostics.push({ code: 'ambiguous-assessment', message: `Assessment reference resolves to multiple documents: ${reference.targetId}`, uri: document.uri, path: reference.path, severity: 'error' });
      }
      this.diagnosticsByUri.set(document.uri, diagnostics);
    }
  }
}
