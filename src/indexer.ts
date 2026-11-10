import { parseDocument } from 'yaml';
import { sha256, type Json } from './metadata.js';

export type DocumentKind = 'assessment' | 'rule' | 'benchmark' | 'applicability' | 'unknown';
export type IndexDiagnosticCode = 'parse-error' | 'duplicate-id' | 'unresolved-assessment' | 'ambiguous-assessment' | 'wrong-reference-kind' | 'incompatible-version';
export interface IndexDiagnostic { code: IndexDiagnosticCode; message: string; uri: string; path?: string; severity: 'error' | 'warning' }
export interface AssessmentReference { targetId: string; expectedVersion?: string | number; path: string; purpose?: 'assessment' | 'applicability'; }
export interface ApplicabilityCondition { name: string; targetId: string; path: string; catalogUri: string; }
export interface ApplicabilityOption { key: string; value: string; label: string; description?: string; condition: string; assessmentId: string; expectedVersion: string | number; catalogUri: string; targetUri?: string; available: boolean; }
export interface IndexedDocument {
  uri: string; path: string; kind: DocumentKind; id?: string; version?: string | number; title?: string;
  mode?: string; capabilities: readonly string[]; references: readonly AssessmentReference[]; applicabilityConditions: readonly ApplicabilityCondition[]; sourceHash: string;
  diagnostics: readonly IndexDiagnostic[];
}

type MutableDocument = Omit<IndexedDocument, 'diagnostics'>;
const roots: DocumentKind[] = ['assessment', 'rule', 'benchmark', 'applicability'];
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function pointerPart(value: string) { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }
function pointer(...parts: (string | number)[]) { return '/' + parts.map(part => pointerPart(String(part))).join('/'); }
function version(value: any): string | number | undefined { return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined; }

export class WorkspaceIndex {
  private readonly documents = new Map<string, MutableDocument>();
  private readonly byId = new Map<string, IndexedDocument[]>();

  update(uri: string, text: string, path = uri, rebuild = true): IndexedDocument {
    let record: MutableDocument;
    const parsed = parseDocument(text, { uniqueKeys: true });
    if (parsed.errors.length) {
      record = { uri, path, kind: 'unknown', capabilities: [], references: [], applicabilityConditions: [], sourceHash: sha256(text) };
    } else {
      const value = parsed.toJS({ maxAliasCount: 50 }) as Record<string, any>;
      const present = roots.filter(root => object(value) && Object.hasOwn(value, root));
      const kind = present.length === 1 ? present[0] : 'unknown';
      const body = kind !== 'unknown' && object(value[kind]) ? value[kind] : {};
      const references: AssessmentReference[] = [];
      const applicabilityConditions: ApplicabilityCondition[] = [];
      if (kind === 'rule' && object(body.assessment_choices)) {
        for (const [choice, candidate] of Object.entries(body.assessment_choices)) {
          if (object(candidate) && typeof candidate.assessment === 'string') references.push({ targetId: candidate.assessment, expectedVersion: version(candidate.expected_version), path: pointer(kind, 'assessment_choices', choice, 'assessment'), purpose: 'assessment' });
        }
      }
      if (kind === 'assessment' && object(body.dependencies)) {
        for (const [alias, candidate] of Object.entries(body.dependencies)) {
          if (object(candidate) && typeof candidate.assessment === 'string') references.push({ targetId: candidate.assessment, expectedVersion: version(candidate.expected_version), path: pointer(kind, 'dependencies', alias, 'assessment'), purpose: candidate.purpose === 'applicability' ? 'applicability' : 'assessment' });
        }
      }
      if (kind === 'applicability' && object(body.conditions)) {
        for (const [name, candidate] of Object.entries(body.conditions)) {
          if (object(candidate) && typeof candidate.assessment === 'string') {
            const pathToAssessment = pointer(kind, 'conditions', name, 'assessment');
            applicabilityConditions.push({ name, targetId: candidate.assessment, path: pathToAssessment, catalogUri: uri });
            references.push({ targetId: candidate.assessment, path: pathToAssessment, purpose: 'applicability' });
          }
        }
      }
      const capabilities = kind === 'assessment' && object(body.tests) ? Object.values(body.tests).flatMap(test => object(test) && typeof test.capability === 'string' ? [test.capability] : []) : [];
      record = { uri, path, kind, id: typeof body.id === 'string' ? body.id : undefined, version: version(body.version), title: typeof (body.title ?? body.assessment_title ?? body.benchmark_title) === 'string' ? (body.title ?? body.assessment_title ?? body.benchmark_title) : undefined, mode: typeof body.mode === 'string' ? body.mode : undefined, capabilities: [...new Set(capabilities)], references, applicabilityConditions, sourceHash: sha256(text) };
    }
    this.documents.set(uri, record); if (rebuild) this.rebuildDiagnostics(); return this.get(uri)!;
  }

  updateMany(entries: readonly { uri: string; text: string; path?: string }[]) {
    for (const entry of entries) this.update(entry.uri, entry.text, entry.path ?? entry.uri, false);
    this.rebuildDiagnostics();
    return this.all();
  }

  remove(uri: string) { this.documents.delete(uri); this.rebuildDiagnostics(); }
  get(uri: string): IndexedDocument | undefined { const document = this.documents.get(uri); return document ? this.withDiagnostics(document) : undefined; }
  all(): IndexedDocument[] { return [...this.documents.values()].sort((a, b) => a.uri.localeCompare(b.uri)).map(document => this.withDiagnostics(document)); }
  private withDiagnostics(document: MutableDocument): IndexedDocument { return { ...document, diagnostics: this.diagnosticsFor(document.uri) }; }
  byKind(kind: DocumentKind): IndexedDocument[] { return this.all().filter(document => document.kind === kind); }
  find(id: string): IndexedDocument[] { return this.byId.get(id) ?? []; }
  usedBy(id: string): IndexedDocument[] { return this.all().filter(document => document.references.some(reference => reference.targetId === id)); }
  applicabilityOptions(): ApplicabilityOption[] {
    const options: ApplicabilityOption[] = [];
    for (const catalog of this.byKind('applicability')) for (const condition of catalog.applicabilityConditions) {
      const targets = this.find(condition.targetId).filter(document => document.kind === 'assessment');
      const target = targets.length === 1 ? targets[0] : undefined;
      options.push({ key: `${catalog.uri}#${condition.name}`, value: condition.name, label: target?.title ? `${condition.name} — ${target.title}` : condition.name, description: target ? `${condition.targetId} · version ${target.version ?? 'unknown'}` : `${condition.targetId} · unresolved`, condition: condition.name, assessmentId: condition.targetId, expectedVersion: target?.version ?? 1, catalogUri: condition.catalogUri, targetUri: target?.uri, available: targets.length === 1 });
    }
    // A catalog is authoritative, but a dependency explicitly marked for
    // applicability is still useful while a catalog is being assembled.
    for (const source of this.byKind('assessment')) for (const reference of source.references.filter(reference => reference.purpose === 'applicability')) {
      if (options.some(option => option.assessmentId === reference.targetId)) continue;
      const targets = this.find(reference.targetId).filter(document => document.kind === 'assessment');
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
