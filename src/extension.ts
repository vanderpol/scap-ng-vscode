import * as vscode from 'vscode';
import { parseDocument, stringify } from 'yaml';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { MetadataPack, sha256, type Pin } from './metadata.js';
import { SourceBuffer, sourceRevisionMatches } from './source.js';
import { previewRegexSafe, regexSafetyError } from './playground.js';
import { findFirstRegexContext, findRegexContext, replaceRegexScalars } from './regex-tester.js';
import { evaluateObjectSamples, findObjectContext, objectTesterGuidance, starterSampleItems } from './sample-object.js';
import { WorkspaceIndex, type IndexedDocument, type ApplicabilityOption } from './indexer.js';
import { GuidedCatalog, createGuidedAssessment, generatedTestTitle } from './guided.js';
import { completionChoices, inlineMappingPath, propertyChoicesForPath } from './completion.js';
import { registerYamlDefinitionProvider, registerYamlHoverProvider } from './yaml-help.js';
import { workspaceIndexPatterns } from './workspace-index-files.js';
import { applicabilityForBenchmark, benchmarkContextForKey, benchmarkContextLabels, benchmarkContextPlatform, benchmarkContexts, packageRootForPath, type BenchmarkContextSummary } from './content-context.js';
import { schemaDynamicPropertyLocations, schemaCapabilityObjectProperties, schemaItemLocations, schemaNodes, schemaPropertyEntries } from './schema-resolver.js';
import { AuthoringSidebarProvider } from './authoring-sidebar.js';
import { AssessmentAuthoringPrototypePanel } from './assessment-inspector.js';
import { graphicalHtml } from './graphical.js';
import { assessmentCustomEditorId, isAssessmentEditorMode, isAssessmentFilePath, sameEditorAssociations, withAssessmentEditorAssociation } from './editor-preferences.js';
import { cleanProcedureForAutomation, createAssistedAssessment, isLikelyAutomatableDraft } from './assisted-draft.js';
import { automationMetadataPath, readAutomationDispositions, writeAutomationDispositions, type AutomationDisposition } from './automation-metadata.js';
import { normalizeYamlObjectStyle, type YamlObjectStyle } from './yaml-style.js';
import { analyzeAssessmentReferences, referencePathLabel, type ReferenceKind } from './reference-graph.js';
import { assessmentSectionBeforeKey } from './assessment-order.js';
import { WelcomePanel, type WelcomeContextInfo } from './welcome.js';
import { assessmentFileName } from './assessment-filename.js';
import { AiConfigurationPanel } from './ai-configuration-panel.js';
import { aiEndpointError, normalizeAiAssistanceMode, type AiAuthoringConfiguration } from './ai-configuration.js';
import { testOpenAiCompatibleGateway } from './ai-remote.js';
import { createAiAssessmentDraft, type AiAssessmentInput } from './ai-assessment.js';
import { resolveStudioSearch } from './studio-search.js';

import { SCHEMA_BASE, SCHEMA_VERSION } from './schema-contract.js';
import { validateNativeSemantics } from './native-semantic.js';
const schemaBase = SCHEMA_BASE;
const profilePath = (root: string) => join(root, 'schema-profile.json');

class StudioNode extends vscode.TreeItem {
  readonly nodeLabel: string;
  readonly children: StudioNode[] = [];
  readonly childMap = new Map<string, StudioNode>();
  constructor(label: string, state = vscode.TreeItemCollapsibleState.None, contextValue?: string, children: StudioNode[] = []) {
    super(label, state); this.nodeLabel = label; this.contextValue = contextValue; this.children.push(...children);
  }
}
class StudioTree implements vscode.TreeDataProvider<StudioNode> {
  private readonly changed = new vscode.EventEmitter<StudioNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private query = '';
  constructor(private readonly index: WorkspaceIndex) {}
  refresh() { this.changed.fire(undefined); }
  setQuery(query: string) { this.query = query; this.refresh(); }
  getTreeItem(node: StudioNode) { return node; }
  getChildren(node?: StudioNode) {
    // Let the native viewsWelcome surface own the empty state.  Returning
    // category nodes here would prevent VS Code from showing the discoverable
    // first-run actions contributed in package.json.
    if (!node && this.index.all().length === 0) return [];
    if (node) return node.children;
    return [
      new StudioNode('STIG Library', vscode.TreeItemCollapsibleState.Collapsed, 'stig-library', this.contentTree('benchmark')),
      new StudioNode('Assessment Library', vscode.TreeItemCollapsibleState.Collapsed, 'assessment-library', this.contentTree('assessment')),
      new StudioNode('Rule Library', vscode.TreeItemCollapsibleState.Collapsed, 'rule-library', this.contentTree('rule')),
      new StudioNode('Diagnostics', vscode.TreeItemCollapsibleState.Collapsed, 'index-diagnostics', this.index.diagnostics().map(diagnostic => new StudioNode(`${diagnostic.code}: ${diagnostic.message}`, vscode.TreeItemCollapsibleState.None, 'index-diagnostic')))
    ];
  }
  private contentTree(kind: 'assessment' | 'rule' | 'benchmark') {
    const records = (this.query ? this.index.search(this.query) : this.index.all()).filter(record => record.kind === kind);
    const root = new Map<string, StudioNode>();
    for (const record of records) {
      const relativePath = workspaceRelativePath(record.path);
      const parts = relativePath.split('/').filter(Boolean);
      const file = parts.pop() ?? record.path;
      let current = root;
      for (const part of parts) {
        let folder = current.get(part);
        if (!folder) {
          folder = new StudioNode(part, vscode.TreeItemCollapsibleState.Collapsed, 'indexed-folder');
          current.set(part, folder);
        }
        current = folder.childMap;
      }
      const leaf = recordNode(record, file);
      current.set(file, leaf);
    }
    const materialize = (map: Map<string, StudioNode>) => {
      for (const node of map.values()) if (node.contextValue === 'indexed-folder') {
        node.children.splice(0, node.children.length, ...materialize(node.childMap));
      }
      return [...map.values()].sort((a, b) => {
        const aFolder = a.contextValue === 'indexed-folder' ? 0 : 1;
        const bFolder = b.contextValue === 'indexed-folder' ? 0 : 1;
        return aFolder - bFolder || a.nodeLabel.localeCompare(b.nodeLabel);
      });
    };
    return materialize(root);
  }
}
function workspaceRelativePath(filePath: string) {
  const folders = (vscode.workspace as any).workspaceFolders ?? [];
  const root = folders.map((folder: any) => folder.uri?.fsPath).filter((value: any): value is string => typeof value === 'string' && filePath.startsWith(value)).sort((a: string, b: string) => b.length - a.length)[0];
  return (root ? relative(root, filePath) : filePath).replaceAll('\\', '/');
}
function recordNode(record: IndexedDocument, fileName = record.path) {
  // File names are stable, recognizable navigation targets. Keep authored
  // titles/IDs as secondary metadata so long internal text cannot hide which
  // source file will be opened (and paths already disambiguate duplicates).
  const node = new StudioNode(fileName, vscode.TreeItemCollapsibleState.None, 'indexed-document');
  const metadata = [record.title, record.id ? `id: ${record.id}` : undefined].filter(Boolean).join(' · ');
  node.description = [metadata, record.diagnostics.length ? `${record.diagnostics.length} diagnostic(s)` : undefined].filter(Boolean).join(' · ');
  (node as any).tooltip = `${workspaceRelativePath(record.path)}${metadata ? `\n${metadata}` : ''}`;
  (node as any).resourceUri = vscode.Uri.file(record.path);
  (node as any).command = { command: 'vscode.open', title: `Open ${fileName}`, arguments: [vscode.Uri.file(record.path)] };
  return node;
}
class PinView implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}
  resolveWebviewView(view: vscode.WebviewView) {
    const profile = readProfile(this.context.extensionPath);
    const build = readBuildInfo(this.context.extensionPath);
    view.webview.html = `<!doctype html><html><body><h2>SCAP-NG Assessment Studio</h2><p>Schema ${escapeHtml(profile.schemaVersion)}</p><p>Source commit <code>${escapeHtml(profile.sourceCommit)}</code></p><p>Build <code>${escapeHtml(buildLabel(build))}</code></p><p>Offline validation is enabled only when a verified local metadata pack is configured.</p></body></html>`;
  }
}
function readProfile(root: string): Pin {
  const raw = readFileSync(profilePath(root), 'utf8');
  return JSON.parse(raw) as Pin;
}
type BuildInfo = { buildId: string; sourceCommit: string; builtAt: string };
function readBuildInfo(root: string): BuildInfo {
  try { return JSON.parse(readFileSync(join(root, 'dist', 'build-info.json'), 'utf8')) as BuildInfo; }
  catch { return { buildId: 'development', sourceCommit: 'unbuilt', builtAt: 'unbuilt' }; }
}
function buildLabel(info: BuildInfo) { return `${info.buildId} · ${info.builtAt}`; }
function yamlServiceLabel(api: any) { const extension = api.extensions?.getExtension?.('redhat.vscode-yaml'); return extension ? `Red Hat YAML ${extension.packageJSON?.version ?? 'installed'}` : 'Red Hat YAML not detected'; }
function configuredAssessmentEditor(api: any, document?: any) {
  const configured = api.workspace.getConfiguration('scapNg', document?.uri).get('assessmentEditor', 'yaml');
  return isAssessmentEditorMode(configured) ? configured : 'yaml';
}
async function openNativeYamlBeside(api: any, document: any) {
  return api.window.showTextDocument(document, { viewColumn: api.ViewColumn?.Beside ?? 2, preserveFocus: true, preview: false });
}
async function openConfiguredSplitSource(api: any) {
  if (configuredAssessmentEditor(api) !== 'split') return;
  const tabs = (api.window.tabGroups?.all ?? []).flatMap((group: any) => group.tabs ?? []);
  const custom = tabs.find((tab: any) => tab.input?.viewType === assessmentCustomEditorId && tab.input?.uri);
  if (!custom?.input?.uri || !api.workspace.openTextDocument) return;
  const document = await api.workspace.openTextDocument(custom.input.uri);
  await openNativeYamlBeside(api, document);
}

/** Explicit chooser actions override the global Assessment editor preference. */
async function openAssessmentInMode(api: any, uri: any, mode: 'yaml' | 'graphical') {
  if (mode === 'yaml') {
    const document = await api.workspace.openTextDocument(uri);
    return api.window.showTextDocument(document, { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
  }
  return api.commands.executeCommand('vscode.openWith', uri, assessmentCustomEditorId, { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
}

/** Open generated Assessments using the user's configured editor preference. */
async function openGeneratedAssessment(api: any, document: any) {
  const mode = configuredAssessmentEditor(api, document);
  if (mode === 'graphical' || mode === 'split') {
    try {
      await api.commands.executeCommand('vscode.openWith', document.uri, assessmentCustomEditorId, { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
      return;
    } catch { /* Fall back to native YAML if this host cannot custom-open an untitled document. */ }
  }
  await api.window.showTextDocument(document, { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
}

async function searchStudioIndex(api: any, index: WorkspaceIndex) {
  return resolveStudioSearch(api, index, workspaceRelativePath, async (record, mode) => {
    if (!api.Uri?.file) throw new Error('VS Code URI support is unavailable; cannot open the indexed document.');
    return openAssessmentInMode(api, api.Uri.file(record.path), mode);
  });
}
function pathWithinRoot(root: string, candidate: string): boolean {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase();
  const normalizedRoot = normalize(root); const normalizedCandidate = normalize(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + '/');
}
/** Save a new Assessment inside the selected Benchmark's authoring slice. */
async function saveGeneratedAssessmentForBenchmark(api: any, document: any, context: BenchmarkContextSummary, suggestedStem: unknown): Promise<any | undefined> {
  if (typeof api.window.showSaveDialog !== 'function' || !api.Uri?.file || !api.workspace.fs?.writeFile) {
    await api.window.showWarningMessage('Saving a Benchmark Assessment requires a VS Code workspace file system.');
    return undefined;
  }
  const existingAssessment = context.assessments.find(assessment => /[\/]assessments[\/]/i.test(assessment.path));
  const existingMarker = existingAssessment ? existingAssessment.path.replaceAll('\\', '/').toLocaleLowerCase().lastIndexOf('/assessments/') : -1;
  const directory = existingAssessment && existingMarker >= 0
    ? existingAssessment.path.slice(0, existingMarker + '/assessments'.length)
    : join(dirname(context.benchmark.path), 'assessments');
  const defaultUri = api.Uri.file(join(directory, assessmentFileName(suggestedStem)));
  const picked = await api.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Save Benchmark Assessment',
    title: 'Save Assessment in the selected Benchmark',
    filters: { 'Assessment YAML': ['yaml'] }
  });
  if (!picked) return undefined;
  if (!pathWithinRoot(directory, picked.fsPath ?? '')) {
    await api.window.showWarningMessage('Save the new Assessment in the selected Benchmark content folder.');
    return undefined;
  }
  try { await api.workspace.fs.createDirectory?.(api.Uri.file(directory)); } catch { /* The directory normally exists in a converted Benchmark; write reports any real failure. */ }
  await api.workspace.fs.writeFile(picked, new TextEncoder().encode(document.getText()));
  const saved = await api.workspace.openTextDocument(picked);
  await openGeneratedAssessment(api, saved);
  return saved;
}

interface RuleAutomationSeed {
  ruleId: string;
  ruleTitle: string;
  checkText: string;
  sourceLabel: string;
  revision: string;
  existingAutomatedAssessmentId?: string;
}

type AiAssessmentGenerator = (input: AiAssessmentInput) => Promise<any>;

function cleanRuleDiscussion(value: unknown): string {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

interface BenchmarkAutomationAnalysis {
  state: 'not-run' | 'complete';
  likelyAutomatable: number;
  likelyRuleUris: string[];
  scanned: number;
  total: number;
  analyzedAt?: string;
}

/**
 * Run the expensive assisted heuristic only for the selected Benchmark's
 * actual automation gaps. This is deliberately opt-in: indexing and Home
 * rendering never open source files or execute the heuristic.
 */
async function analyzeBenchmarkAutomation(api: any, index: WorkspaceIndex, state: BenchmarkContextState, pack: MetadataPack, selected: BenchmarkContextSummary, progress?: any, token?: any): Promise<BenchmarkAutomationAnalysis> {
  const gaps = selected.rules.filter(rule => rule.automationStatus === 'needs-automation');
  let likelyAutomatable = 0;
  const likelyRuleUris: string[] = [];
  let scanned = 0;
  for (const rule of gaps) {
    if (token?.isCancellationRequested) break;
    const manualId = rule.manualAssessmentId;
    const manual = manualId ? selected.assessments.find(assessment => assessment.id === manualId) : undefined;
    try {
      if (manual?.path && api.workspace?.openTextDocument && api.Uri?.file) {
        const document = await api.workspace.openTextDocument(api.Uri.file(manual.path));
        const assessment = new SourceBuffer(document.getText()).json() as any;
        const procedure = assessment?.assessment?.procedure;
        if (typeof procedure === 'string' && procedure.trim()) {
          const procedureText = cleanProcedureForAutomation(procedure);
          const result = createAssistedAssessment(pack, {
            title: rule.title ?? rule.id ?? 'Untitled Rule',
            checkText: procedureText,
            platform: benchmarkContextPlatform(selected)
          });
          if (isLikelyAutomatableDraft(result, procedureText)) { likelyAutomatable++; likelyRuleUris.push(rule.uri); }
        }
      }
    } catch { /* One malformed/missing manual source must not abort the batch. */ }
    scanned++;
    progress?.report?.({ increment: gaps.length ? 100 / gaps.length : 100, message: `${scanned}/${gaps.length} Rules analyzed` });
  }
  return { state: 'complete', likelyAutomatable, likelyRuleUris, scanned, total: gaps.length, analyzedAt: new Date().toISOString() };
}

async function ruleAutomationSeed(api: any, context: BenchmarkContextSummary | undefined, rule: any, ruleDocument: any): Promise<RuleAutomationSeed> {
  const body = new SourceBuffer(ruleDocument.getText()).json() as any;
  const ruleBody = body?.rule ?? {};
  const ruleId = String(rule?.id ?? ruleBody.id ?? '');
  const ruleTitle = String(rule?.title ?? ruleBody.title ?? ruleId);
  const manualId = rule?.manualAssessmentId ?? ruleBody.assessment_choices?.manual?.assessment;
  const manual = context?.assessments.find(item => item.id === manualId);
  if (manual?.path && api.workspace?.openTextDocument && api.Uri?.file) {
    try {
      const assessmentDocument = await api.workspace.openTextDocument(api.Uri.file(manual.path));
      const assessment = new SourceBuffer(assessmentDocument.getText()).json() as any;
      const procedure = assessment?.assessment?.procedure;
      if (typeof procedure === 'string' && procedure.trim()) {
        return { ruleId, ruleTitle, checkText: cleanProcedureForAutomation(procedure), sourceLabel: `manual Assessment procedure (${manual.id ?? manual.path})`, revision: sha256(ruleDocument.getText()), existingAutomatedAssessmentId: ruleBody.assessment_choices?.automated?.assessment };
      }
    } catch { /* Fall back to the Rule's authored discussion below. */ }
  }
  const discussion = cleanRuleDiscussion(ruleBody.discussion);
  const fallback = discussion || ruleTitle;
  return { ruleId, ruleTitle, checkText: fallback, sourceLabel: discussion ? 'Rule discussion (manual procedure unavailable)' : 'Rule title (manual procedure unavailable)', revision: sha256(ruleDocument.getText()), existingAutomatedAssessmentId: ruleBody.assessment_choices?.automated?.assessment };
}

function ruleAutomationHtml(seed: RuleAutomationSeed, aiEnabled: boolean) {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-rule-automation';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:18px;max-width:1000px}h1{font-size:20px;margin:0 0 6px}.hint,.muted{color:var(--vscode-descriptionForeground)}label{display:block;font-weight:600;margin:12px 0 5px}input,textarea{display:block;width:100%;box-sizing:border-box;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}textarea{min-height:180px;font-family:var(--vscode-editor-font-family);resize:vertical}.actions{display:flex;gap:8px;margin:14px 0}button{font:inherit;padding:7px 11px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:disabled{opacity:.5;cursor:default}.ai-assist{border:1px solid var(--vscode-panel-border);padding:10px;margin:12px 0;background:var(--vscode-textBlockQuote-background)}.ai-assist label{font-weight:400}.summary{border-left:3px solid var(--vscode-textLink-foreground);padding:9px 11px;background:var(--vscode-textBlockQuote-background);margin:12px 0}.progress{border-left:3px solid var(--vscode-textLink-foreground);padding:9px 11px;background:var(--vscode-textBlockQuote-background);margin:12px 0}.progress::before{content:'◌';display:inline-block;margin-right:7px;animation:scap-ng-spin 1.1s linear infinite}@keyframes scap-ng-spin{to{transform:rotate(360deg)}}.warning{color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}pre{white-space:pre-wrap;overflow:auto;max-height:360px;border:1px solid var(--vscode-panel-border);padding:10px;background:var(--vscode-textCodeBlock-background);font:11px var(--vscode-editor-font-family)}li{margin:5px 0}</style></head><body><h1>Create automated Assessment from Rule</h1><p class="hint">The editor uses the linked manual Assessment procedure as source text, then applies the same deterministic offline best-guess generator as Assisted Assessment authoring. Nothing is saved or linked until you review the result.</p><p><strong>Rule:</strong> ${escapeHtml(seed.ruleTitle)} <span class="muted">(${escapeHtml(seed.ruleId)})</span></p><p class="muted">Source: ${escapeHtml(seed.sourceLabel)}</p><label for="title">Assessment title</label><input id="title" value="${escapeHtml(seed.ruleTitle)}"><label for="checkText">Check/procedure text</label><textarea id="checkText">${escapeHtml(seed.checkText)}</textarea><div class="actions"><button id="generate" class="primary">Generate best-guess YAML</button><button id="create" class="primary" disabled>Create and link automated Assessment</button><button id="cancel">Cancel</button></div>${aiEnabled ? '<div class="ai-assist"><strong>Configured AI assistance</strong><p class="hint">AI will receive the Rule ID/title, the procedure text, the current Rule YAML, target platform context, and the pinned SCAP-NG 0.4.1 knowledge pack. No Assessment is saved or linked automatically.</p><label><input id="aiConsent" type="checkbox"> I approve sending this bounded authoring context to the configured AI provider for a draft.</label><div class="actions"><button id="generateAi" class="primary" disabled>Generate with configured AI</button></div></div>' : ''}<div id="summary" class="summary">Generate a draft to review confidence and assumptions.</div><div id="aiProgress" class="progress" hidden role="status" aria-live="polite"></div><h2 id="previewHeading">Assessment draft</h2><pre id="preview">No draft generated.</pre><script nonce="rule-automation">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let generated=false;let aiProgressTimer;let aiProgressStarted;const aiConsent=$('aiConsent');const aiButton=$('generateAi');function stopAiProgress(){if(aiProgressTimer)clearInterval(aiProgressTimer);aiProgressTimer=undefined;aiProgressStarted=undefined;const node=$('aiProgress');node.hidden=true;node.textContent='';}function startAiProgress(){stopAiProgress();const node=$('aiProgress');const phases=['Sending the approved bounded context…','Waiting for the configured model response…','The response will be validated locally before acceptance…','A bounded correction pass may run if the first response needs repair…'];let phase=0;aiProgressStarted=Date.now();node.hidden=false;const update=()=>{const elapsed=Math.floor((Date.now()-aiProgressStarted)/1000);node.textContent=phases[phase]+' '+elapsed+'s elapsed. No Assessment is being saved.';phase=(phase+1)%phases.length;};update();aiProgressTimer=setInterval(update,1800);}function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function render(result){stopAiProgress();generated=result;const summary=$('summary');summary.className='summary'+(result.generatedMode!=='automated'||Boolean(result.diagnostics?.length)?' warning':'');const manualSignals=(result.unresolved||[]).filter(value=>/\b(?:manual|human|site-specific|organization|organizational|approval|ISSO|ISSM|SA)\b/i.test(value));const disposition=result.generatedMode==='manual-only'&&!result.diagnostics?.length?'Manual-only by provider logic; no automated Assessment was proposed.':result.diagnostics?.length?(manualSignals.length?'Provider generation was rejected; manual/site-specific review was noted, but manual-only was not established.':'Provider generation was rejected; this is not a manual-only determination.'):'Automated candidate; any listed human or site-specific notes remain review items.';const nextStep=result.diagnostics?.length?(quotaFailure?'Next step: Wait for the provider quota reset or resolve the account limit. No content was saved or linked.':'Next step: Retry configured AI or generate the deterministic offline draft. Do not mark this Rule manual-only based on a provider failure.') :result.generatedMode==='manual-only'?'Next step: Review the manual-only rationale; no automated Assessment can be linked.':'Next step: Review the generated YAML and assumptions before creating and linking the automated Assessment.';const lines=['Method: '+(result.method||'deterministic offline heuristic'),...(result.provider?['Provider endpoint: '+result.provider]:[]),...(result.model?['Model: '+result.model]:[]),...(result.toolMode?['Local tools: '+(result.toolMode==='local-pinned-pack'?'offered from the pinned 0.4.1 pack':result.toolMode==='fallback-no-tools'?(String(result.toolWarning||'').includes('skipped the failed tools negotiation')?'previously rejected; negotiation skipped':'provider rejected tools; retried without them'):'not requested')]:[]),...(result.toolWarning?['Tool warning: '+result.toolWarning]:[]),...(result.toolMode==='fallback-no-tools'?['Warning: This request ran without the pinned local SCAP-NG tools; provider-only output may be less reliable. Prefer a model withtools when available.']:[]),...(result.generatedAt?['Generated at: '+result.generatedAt]:[]),...(typeof result.durationMs==='number'?['Duration: '+result.durationMs+' ms ('+(result.durationMs/1000).toFixed(1)+' s)']:[]),'Mode: '+result.generatedMode,'Confidence: '+result.confidence,'Disposition: '+disposition,nextStep,...(result.diagnostics?.length?[result.generatedMode==='manual-only'?'Provider did not return a usable AI response; this is not an intentional manual-only content decision.':'Automated draft rejected by local SCAP-NG 0.4.1 validation; this is a provider-format/content failure, not a manual-only classification.']:result.linkable===false?['This provider-recovery draft is preview-only; rerun the deterministic offline workflow for an independently linkable draft.']:result.generatedMode==='automated'?['Review required before use. This is not scanner/runtime proof.']:['Automation was intentionally not generated: the provider classified this procedure as manual-only. Review the listed human or site-specific questions; no automated Assessment can be linked.']),...(result.assumptions||[]).map(value=>'Assumption: '+value),...(result.unresolved||[]).map(value=>'Review needed: '+value),...(result.diagnostics||[]).map(value=>'Draft rejected: '+value),...(result.coverage?[('Coverage: applicability '+result.coverage.applicability+', '+(result.coverage.procedureSteps||[]).filter(step=>step.represented).length+'/'+(result.coverage.procedureSteps||[]).length+' procedure steps represented')]:[]),...(result.rationale?[('Rationale: '+result.rationale)]:[]),...(result.citations||[]).map(value=>'Knowledge citation: '+value)];const requestFailed=result.diagnostics?.some(value=>/gateway|quota|rate limit|insufficient[_ -]?quota|credits?|billing|request timed out|timed out|no stored|connection failed|endpoint|authoring deadline|before a response/i.test(value));const quotaFailure=Boolean(requestFailed&&/quota|rate limit|insufficient[_ -]?quota|credits?|billing/i.test(result.diagnostics?.join(' ')||''));const coverageMissing=Boolean(result.diagnostics?.some(value=>/procedure coverage manifest/i.test(value)));const candidateAvailable=Boolean(result.yaml);const headline=result.diagnostics?.length?(quotaFailure?'AI quota or rate limit reached':coverageMissing&&candidateAvailable?'Candidate generated — coverage confirmation missing':'Automation was not created'):result.generatedMode==='manual-only'?'Manual-only decision — no automation proposed':'Automated draft ready for review';const userMessage=result.diagnostics?.length?(requestFailed&&/quota|rate limit|insufficient[_ -]?quota|credits?|billing/i.test(result.diagnostics?.join(' ')||'')?'The AI provider reported a quota or rate-limit error. The account may be out of tokens/credits or temporarily throttled; check the provider account and retry later.':requestFailed?'The AI provider request did not complete. Check the endpoint, model, and API key, then retry. This is not a manual-only decision.':coverageMissing&&candidateAvailable?'The AI provider returned candidate YAML, but omitted the required procedure-coverage confirmation. The candidate is review-only and cannot be saved or linked until coverage is confirmed; this is not a token or quota failure.':'The AI provider responded, but its draft failed the pinned SCAP-NG 0.4.1 validation contract. This is not a token or quota failure; nothing was saved or linked.'):result.generatedMode==='manual-only'?'The provider determined that a complete objective automated check could not be represented. Review the rationale before recording the Rule as manual-only.':'A schema-valid automated Assessment draft is ready. Review the YAML and assumptions before linking it.';summary.replaceChildren();const headlineNode=document.createElement('strong');headlineNode.textContent=headline;summary.append(headlineNode);const messageNode=document.createElement('p');messageNode.textContent=userMessage;summary.append(messageNode);const details=document.createElement('details');const detailsLabel=document.createElement('summary');detailsLabel.textContent='Show technical/provider details';details.append(detailsLabel);for(const line of lines){const node=document.createElement('div');node.textContent=line;details.append(node)}summary.append(details);$('previewHeading').textContent=result.diagnostics?.length?(candidateAvailable?'Candidate YAML — review only':'Rejected draft — no YAML accepted'):result.generatedMode==='manual-only'?'Manual-only result — no automated YAML':'Generated YAML preview';$('preview').textContent=result.diagnostics?.length?(candidateAvailable?'Candidate YAML was returned, but it is not linkable until the provider supplies the required coverage confirmation. Review only; no source files were changed.':'No automated YAML was accepted because the provider response failed local validation. Review the diagnostics, then retry or use Generate best-guess YAML for the deterministic offline fallback.'):result.generatedMode==='manual-only'?'No automated YAML was generated. The provider classified this procedure as manual-only; review the human/site-specific questions above.':(result.yaml||'');$('create').disabled=result.generatedMode!=='automated'||Boolean(result.diagnostics?.length)||result.linkable===false;if(aiButton){aiButton.disabled=false;aiButton.textContent=result.diagnostics?.length?'Retry configured AI':'Generate with configured AI';}}$("generate").onclick=()=>{stopAiProgress();generated=false;$('create').disabled=true;$('preview').textContent='';$('summary').textContent='Generating deterministic best guess…';vscode.postMessage({type:'generate',title:$('title').value,checkText:$('checkText').value});};if(aiButton){aiConsent.onchange=()=>{aiButton.disabled=!aiConsent.checked;};aiButton.onclick=()=>{generated=false;$('create').disabled=true;$('preview').textContent='';startAiProgress();$('summary').textContent='Configured AI is working; the result will be validated locally before it can be used.';aiButton.disabled=true;vscode.postMessage({type:'generateAi',title:$('title').value,checkText:$('checkText').value});};}$('create').onclick=()=>{if(generated?.generatedMode==='automated')vscode.postMessage({type:'createAndLink'});};$('cancel').onclick=()=>vscode.postMessage({type:'cancel'});window.addEventListener('message',event=>{const message=event.data;if(message.type==='generated')render(message.result);if(message.type==='status'){stopAiProgress();$('summary').className='summary'+(message.error?' error':'');$('summary').textContent=message.message||'';if(message.error)$('create').disabled=true;}});</script></body></html>`;
}

async function openRuleAutomationPanel(extensionContext: vscode.ExtensionContext, api: any, ruleDocument: any, context: BenchmarkContextSummary, seed: RuleAutomationSeed, getPack: () => MetadataPack | undefined, objectStyle: YamlObjectStyle, onLinked?: () => void, aiGenerator?: AiAssessmentGenerator) {
  const pack = getPack();
  if (!pack) throw new Error('Configure a verified offline SCAP-NG metadata pack before generating automation.');
  const panel = api.window.createWebviewPanel('scapNg.ruleAutomation', 'Create automated Assessment', api.ViewColumn?.Active ?? 1, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = ruleAutomationHtml(seed, Boolean(aiGenerator));
  let generated: any;
  const listener = panel.webview.onDidReceiveMessage(async (message: any) => {
    if (message.type === 'cancel') { panel.dispose(); return; }
    if (message.type === 'generate') {
      try {
        const result = createAssistedAssessment(pack, { title: String(message.title ?? ''), checkText: String(message.checkText ?? ''), platform: benchmarkContextPlatform(context), objectStyle });
        generated = result;
        panel.webview.postMessage({ type: 'generated', result: { ...result, document: undefined } });
      } catch (error) { panel.webview.postMessage({ type: 'status', error: true, message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (message.type === 'generateAi') {
      try {
        if (!aiGenerator) throw new Error('Configured AI assistance is not enabled. Select a remote AI provider and save its configuration first.');
        const result = await aiGenerator({ ruleId: seed.ruleId, title: String(message.title ?? ''), checkText: String(message.checkText ?? ''), platform: benchmarkContextPlatform(context), ruleYaml: ruleDocument.getText(), availableConditions: context.conditions.map(condition => ({ name: condition.name, assessment: condition.targetId })) });
        generated = result;
        panel.webview.postMessage({ type: 'generated', result: { ...result, document: undefined } });
      } catch (error) { panel.webview.postMessage({ type: 'status', error: true, message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (message.type !== 'createAndLink') return;
    try {
      if (!generated || generated.generatedMode !== 'automated' || generated.diagnostics?.length || generated.linkable === false) throw new Error('Generate and review an independently linkable schema-valid automated draft before linking it.');
      if (sha256(ruleDocument.getText()) !== seed.revision) throw new Error('The Rule changed while the automation draft was open. Refresh the Rule and generate again.');
      const currentRule = new SourceBuffer(ruleDocument.getText()).json() as any;
      const existing = currentRule?.rule?.assessment_choices?.automated?.assessment;
      const generatedId = String(generated.document?.assessment?.id ?? '');
      if (!generatedId) throw new Error('The generated Assessment has no safe ID.');
      if (existing && existing !== generatedId) {
        const choice = await api.window.showWarningMessage(`This Rule already links automated Assessment “${existing}”. Replace it with “${generatedId}”?`, { modal: true }, 'Replace and link');
        if (choice !== 'Replace and link') return;
      }
      const assessmentDocument = await api.workspace.openTextDocument({ content: generated.yaml, language: 'yaml' });
      const saved = await saveGeneratedAssessmentForBenchmark(api, assessmentDocument, context, generatedId);
      if (!saved) { panel.webview.postMessage({ type: 'status', message: 'Assessment creation canceled before saving or linking.' }); return; }
      const source = new SourceBuffer(ruleDocument.getText());
      const before = source.json();
      const edit = source.linkAutomatedAssessment(generatedId, seed.revision);
      const beforeErrors = pack.validate(schemaBase + 'rule.schema.json', before);
      const afterErrors = pack.validate(schemaBase + 'rule.schema.json', edit.document.json());
      const introduced = afterErrors.filter((error: string) => !beforeErrors.includes(error));
      if (introduced.length) throw new Error('Pinned Rule schema rejected the Assessment link: ' + introduced.join('; '));
      await applySourceWorkspaceEdit(api, ruleDocument, edit);
      onLinked?.();
      panel.webview.postMessage({ type: 'status', message: `Saved and linked ${generatedId} as the default automated Assessment. Review generated assumptions before relying on it.` });
    } catch (error) { panel.webview.postMessage({ type: 'status', error: true, message: error instanceof Error ? error.message : String(error) }); }
  });
  panel.onDidDispose(() => listener.dispose());
  extensionContext.subscriptions.push(panel);
}

function assistedDraftWarnings(document: any): { confidence?: string; assumptions: string[]; review: string[] } | undefined {
  const lines = String(document?.getText?.() ?? '').split(/\r?\n/);
  if (!lines.some(line => /^# Assisted Assessment draft\b/.test(line))) return undefined;
  const confidence = lines.find(line => /^# Confidence:/i.test(line))?.replace(/^# Confidence:\s*/i, '').trim();
  const assumptions = lines.filter(line => /^# Assumption:/i.test(line)).map(line => line.replace(/^# Assumption:\s*/i, '').trim());
  const review = lines.filter(line => /^# Review needed:/i.test(line)).map(line => line.replace(/^# Review needed:\s*/i, '').trim());
  return { confidence, assumptions, review };
}

/** Keep the default Assessment editor in sync without touching unrelated user associations. */
async function synchronizeAssessmentEditorPreference(api: any): Promise<void> {
  const scapConfiguration = api.workspace.getConfiguration('scapNg');
  const configured = scapConfiguration?.get?.('assessmentEditor', 'yaml');
  const mode = isAssessmentEditorMode(configured) ? configured : 'yaml';
  const workbenchConfiguration = api.workspace.getConfiguration();
  const current = workbenchConfiguration?.get?.('workbench.editorAssociations', {});
  const next = withAssessmentEditorAssociation(current, mode);
  if (sameEditorAssociations(current, next) || typeof workbenchConfiguration?.update !== 'function') return;
  await workbenchConfiguration.update('workbench.editorAssociations', next, api.ConfigurationTarget?.Global ?? 1);
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }


import { modelFor, assessmentEditorModel, comparisonOperations, comparisonValueSources, comparisonVariableCompatible, variableExpressionOperations, requireLogicalOperations } from './structured-model.js';

function regexTesterHtml() {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-regex-tester';"><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;max-width:1100px}h1{margin-top:0}.hint,.muted{color:var(--vscode-descriptionForeground)}label{display:block;font-weight:600;margin:12px 0 4px}textarea,input,select{box-sizing:border-box;width:100%;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}textarea{font-family:var(--vscode-editor-font-family);min-height:85px}.row{display:grid;grid-template-columns:minmax(0,1fr) 120px 100px;gap:8px;align-items:end;margin:8px 0}.row .sample{min-height:40px}.button{padding:7px 12px;margin:12px 8px 10px 0;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.banner,.result{border:1px solid var(--vscode-panel-border);padding:12px;margin:12px 0}.banner{border-left:4px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background)}.warning{color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.pass{color:var(--vscode-testing-iconPassed)}.fail{color:var(--vscode-testing-iconFailed)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:8px}.highlight{white-space:pre-wrap;overflow-wrap:anywhere}.highlight mark{color:var(--vscode-editor-foreground);background:var(--vscode-editor-findMatchHighlightBackground)}.capture{margin:4px 0}@media(max-width:700px){.row{grid-template-columns:1fr}.row select{width:100%}}
</style></head><body><h1>SCAP-NG Regex Tester</h1><div class="banner"><p id="source">Loading selected schema regex…</p><p class="hint">Offline bounded preview only. The engine is <strong>PCRE2-safe-preview</strong>; it is not a scanner, does not execute commands, and does not prove SCAP-NG runtime dialect parity.</p></div><label>Selected regular expression(s)</label><p class="hint" id="patternHelp">A selected matches_regex list is shown as separate editable alternatives. Select multiple YAML list entries before opening this tester.</p><div id="patterns"></div><button class="button secondary" id="addPattern">Add expression</button><div class="row"><label>Flags<input id="flags" value="" aria-label="Regular expression flags" spellcheck="false"></label><span class="hint">Allowed PCRE2 flags: i, m, s, x, u, U, A, D</span><span></span></div><h2>Sample strings</h2><p class="hint">Use several representative samples. Expected positive/negative is an author test expectation; it does not create compliance evidence.</p><div id="samples"></div><button class="button secondary" id="add">Add sample</button><button class="button" id="run">Test samples</button><button class="button secondary" id="apply">Apply expression(s) to YAML</button><p id="status" role="status" aria-live="polite"></p><section id="results" aria-live="polite"></section><script nonce="regex-tester">
const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const samples=$('samples');const patterns=$('patterns');let initial=[];function addPattern(value=''){const row=document.createElement('div');row.className='pattern-row';const input=document.createElement('textarea');input.rows=2;input.value=value;input.spellcheck=false;input.setAttribute('aria-label','Regular expression alternative');const remove=document.createElement('button');remove.className='button secondary';remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(input,remove);patterns.append(row);}function readPatterns(){return [...patterns.children].map(row=>row.querySelector('textarea').value);}function renderPatterns(values){patterns.replaceChildren();(values?.length?values:['']).forEach(addPattern);}function addSample(value='',expected='positive'){const row=document.createElement('div');row.className='row';const input=document.createElement('textarea');input.className='sample';input.rows=2;input.value=value;input.setAttribute('aria-label','Sample text');const select=document.createElement('select');select.setAttribute('aria-label','Expected result');for(const x of ['positive','negative']){const o=document.createElement('option');o.value=x;o.textContent='Expected '+x;o.selected=x===expected;select.append(o);}const remove=document.createElement('button');remove.className='button secondary';remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(input,select,remove);samples.append(row);}function readSamples(){return [...samples.children].map(row=>({input:row.querySelector('textarea').value,expected:row.querySelector('select').value}));}function showText(node,text){node.replaceChildren(document.createTextNode(text??''));}function highlight(node,text,span){node.replaceChildren();if(!span||span[0]<0){node.append(document.createTextNode(text));return;}node.append(document.createTextNode(text.slice(0,span[0])));const mark=document.createElement('mark');mark.textContent=text.slice(span[0],span[1]);node.append(mark,document.createTextNode(text.slice(span[1])));}function renderResults(results){const root=$('results');root.replaceChildren();for(const r of results){const box=document.createElement('article');box.className='result';const heading=document.createElement('h3');heading.className=r.error?'error':(r.expectedMatch===r.matched?'pass':'fail');heading.textContent=r.error?'Preview error':(r.expectedMatch===r.matched?(r.matched?'Matched as expected':'Did not match as expected'):(r.matched?'Matched unexpectedly':'Did not match unexpectedly'));box.append(heading);const patternLabel=document.createElement('p');patternLabel.className='muted';patternLabel.textContent='Pattern: '+(r.pattern||'');box.append(patternLabel);const detail=document.createElement('p');detail.textContent='Expected '+(r.expectedMatch?'match':'nonmatch')+' · observed '+(r.matched?'match':'nonmatch')+(r.limited?' · input was truncated by the safety limit':'');box.append(detail);if(r.error){const err=document.createElement('p');err.className='error';err.textContent=r.error;box.append(err);}else{const label=document.createElement('strong');label.textContent='Matched text / span';box.append(label);const span=document.createElement('div');span.className='highlight';highlight(span,r.input,r.matchSpan);box.append(span);const cap=document.createElement('div');cap.className='capture';cap.textContent='Captures: '+(r.captures?.length?JSON.stringify(r.captures):'none');box.append(cap);if(r.namedCaptures&&Object.keys(r.namedCaptures).length){const named=document.createElement('div');named.className='capture';named.textContent='Named captures: '+JSON.stringify(r.namedCaptures);box.append(named);}}root.append(box);}}$('add').onclick=()=>addSample();$('addPattern').onclick=()=>addPattern();$('run').onclick=()=>{const selectedPatterns=readPatterns();const flags=$('flags').value;const rows=readSamples();$('status').textContent='Testing in an isolated, time-limited worker…';vscode.postMessage({type:'run',patterns:selectedPatterns,flags,samples:rows});};$('apply').onclick=()=>{if(confirm('Apply these expression(s) to the selected YAML scalar(s)?'))vscode.postMessage({type:'apply',patterns:readPatterns()});};window.addEventListener('message',event=>{const m=event.data;if(m.type==='init'){showText($('source'),'Source: '+m.context.kind+' · '+(m.context.capability||'capability not present')+' · '+(m.context.path?.join('.')||''));renderPatterns(m.context.patterns||[m.context.pattern]);initial=m.samples||[];samples.replaceChildren();(initial.length?initial:[{input:'',expected:'positive'}]).forEach(x=>addSample(x.input,x.expected));}if(m.type==='results')renderResults(m.results||[]);if(m.type==='status'){$('status').className=m.error?'error':'';$('status').textContent=m.message||'';}});</script></body></html>`;
}

class RegexTesterPanel {
  static open(extensionContext: vscode.ExtensionContext, document: any, pack: MetadataPack | undefined, options: { useFirst?: boolean } = {}) {
    const api: any = vscode;
    const editor = api.window.activeTextEditor;
    if (!document) return void api.window.showWarningMessage('Open an Assessment YAML document before using the Regex Tester.');
    if (!pack) return void api.window.showWarningMessage('Configure a verified offline SCAP-NG metadata pack before using the Regex Tester.');
    const sameDocument = editor?.document?.uri?.toString?.() === document.uri?.toString?.();
    const selected = sameDocument
      ? findRegexContext(document.getText(), document.offsetAt(editor.selection.start), document.offsetAt(editor.selection.end))
      : undefined;
    const context = selected ?? (options?.useFirst ? findFirstRegexContext(document.getText()) : undefined);
    if (!context) return void api.window.showWarningMessage('Place the caret inside a schema-recognized matches_regex value or regex_capture pattern.');
    const panel = api.window.createWebviewPanel('scapNg.regexTester', 'SCAP-NG Regex Tester', api.ViewColumn?.Beside ?? 2, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = regexTesterHtml();
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'run') {
        const patterns = Array.isArray(message.patterns) ? message.patterns.filter((pattern: any) => typeof pattern === 'string') : [];
        const flags = typeof message.flags === 'string' ? message.flags : '';
        const rows = Array.isArray(message.samples) ? message.samples.filter((row: any) => row && typeof row.input === 'string') : [];
        const previews = (await Promise.all(rows.map(async (row: any) => {
          const results = await previewRegexSafe(patterns, row.input, flags, 100);
          return results.map(result => ({ ...result, expectedMatch: row.expected === 'positive' }));
        }))).flat();
        panel.webview.postMessage({ type: 'results', results: previews }); return;
      }
      if (message.type === 'apply') {
        try {
          const patterns = Array.isArray(message.patterns) ? message.patterns.filter((pattern: any) => typeof pattern === 'string') : [];
          if (!patterns.length) throw new Error('Enter at least one expression before applying.');
          for (const pattern of patterns) { const safety = regexSafetyError(pattern, ''); if (safety) throw new Error(safety); }
          const current = document.getText();
          if (sha256(current) !== context.documentRevision) throw new Error('The YAML document changed; reopen the Regex Tester before applying.');
          const edit = replaceRegexScalars(current, context, patterns);
          const parsed = parseDocument(edit.nextText, { uniqueKeys: true });
          const root = assessmentSchemaUri(pack);
          if (root) {
            const problems = pack.validate(root, parsed.toJS({ maxAliasCount: 50 }));
            if (problems.length) throw new Error(`Pinned schema rejected the expression: ${problems.join('; ')}`);
          }
          const workspaceEdit = new api.WorkspaceEdit();
          for (const replacement of [...edit.replacements].sort((a, b) => b.range[0] - a.range[0])) {
            workspaceEdit.replace(document.uri, new api.Range(document.positionAt(replacement.range[0]), document.positionAt(replacement.range[1])), replacement.replacement);
          }
          if (!await api.workspace.applyEdit(workspaceEdit)) throw new Error('VS Code declined the source edit.');
          panel.webview.postMessage({ type: 'status', message: `${patterns.length} expression${patterns.length === 1 ? '' : 's'} applied with a native undoable source edit.` });
        } catch (error) { panel.webview.postMessage({ type: 'status', error: true, message: error instanceof Error ? error.message : String(error) }); }
      }
    });
    panel.webview.postMessage({ type: 'init', context, samples: [{ input: '', expected: 'positive' }] });
    extensionContext.subscriptions.push(panel);
  }
}

function sampleObjectTesterHtml() {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-object-tester';"><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;max-width:1200px}h1{margin-top:0}.layout{display:grid;grid-template-columns:minmax(260px,1fr) minmax(360px,2fr);gap:16px}.card,.result{border:1px solid var(--vscode-panel-border);padding:12px;margin:10px 0}.banner{border-left:4px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background);padding:10px}.instructions{border-left:4px solid var(--vscode-editorWarning-foreground);background:var(--vscode-textCodeBlock-background);padding:10px;margin:10px 0;line-height:1.45}.instructions p{margin:6px 0}.muted{color:var(--vscode-descriptionForeground)}textarea{box-sizing:border-box;width:100%;min-height:420px;padding:8px;font-family:var(--vscode-editor-font-family);color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}button{padding:7px 12px;margin:10px 8px 0 0;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.matched{border-left:4px solid var(--vscode-testing-iconPassed)}.mismatched{border-left:4px solid var(--vscode-testing-iconFailed)}.indeterminate,.missing,.invalid{border-left:4px solid var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.status{font-weight:600}.trace{padding:8px;margin:8px 0;background:var(--vscode-textCodeBlock-background)}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 10px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}@media(max-width:850px){.layout{display:block}}
</style></head><body><h1>SCAP-NG Sample Object Tester</h1><div class="banner"><p id="source">Loading selected Object…</p><p class="muted"><strong>Offline sample data only.</strong> This tool previews Object selector traces. It does not collect evidence, execute a scanner, evaluate <code>require</code>, or produce compliance PASS/FAIL.</p></div><div class="layout"><section><div class="card"><h2>Assessment Object (read-only)</h2><p class="muted">This is the Object authored in the Test. It is not the sample input and should not be replaced.</p><pre id="object"></pre></div><div class="card"><h2 id="sampleHeading">Collected Item sample input</h2><div id="guidance" class="instructions"><strong>What to do:</strong> Replace the generated starter below with a sanitized canonical collected Item. Do not paste the Assessment YAML or raw command output.</div><p id="sampleHelp" class="muted">Select all text in the editor below and paste one Item, an array of Items, or <code>{items: [...]}</code>. Each Item must contain <code>id</code>, <code>capability</code>, <code>status</code>, <code>fields</code>, and <code>provenance</code>. The starter is scaffolding only; it is not scanner evidence.</p><details id="sampleShape"><summary>Show the required Item shape</summary><pre>{
  "id": "collected-item-1",
  "capability": "windows.registry",
  "status": "exists",
  "fields": {
    "field_name": {"datatype": "string", "status": "exists", "value": "example"}
  },
  "provenance": {}
}</pre></details><textarea id="samples" spellcheck="false" aria-label="Collected Item sample input; replace the starter text"></textarea><button id="test">Test collected Item against Object</button><button class="secondary" id="reset">Restore generated starter</button><p id="status" class="status" role="status" aria-live="polite"></p></div></section><section><h2>Selector trace</h2><div id="results" aria-live="polite"><p class="muted">Run the tester to see each Item and selector decision.</p></div></section></div><script nonce="object-tester">
const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let starter='';function text(node,value){node.replaceChildren(document.createTextNode(value??''));}function statusClass(value){return value==='matched'?'matched':value==='mismatched'?'mismatched':value;}function renderTrace(result){const root=$('results');root.replaceChildren();if(result.inputDiagnostics?.length){const box=document.createElement('div');box.className='result invalid';const h=document.createElement('h3');h.textContent='Sample input unavailable';box.append(h);for(const x of result.inputDiagnostics){const p=document.createElement('p');p.className='error';p.textContent=x;box.append(p);}root.append(box);return;}const summary=document.createElement('div');summary.className='banner';summary.textContent='Selected Item indices: '+(result.selectedItemIndices.length?result.selectedItemIndices.join(', '):'none')+' · '+result.items.length+' Item(s) inspected';root.append(summary);for(const item of result.items){const box=document.createElement('article');box.className='result '+statusClass(item.status);const h=document.createElement('h3');h.textContent='Item '+item.index+(item.id?' ('+item.id+')':'')+' — '+item.status;box.append(h);if(item.schemaDiagnostics?.length){const p=document.createElement('p');p.className='error';p.textContent='Canonical schema diagnostics: '+item.schemaDiagnostics.join('; ');box.append(p);}for(const trace of item.selectors){const t=document.createElement('div');t.className='trace '+statusClass(trace.status);const title=document.createElement('strong');title.textContent=trace.field+' · '+trace.operator+' · '+trace.status;t.append(title);const dl=document.createElement('dl');for(const pair of [['Expected',trace.expected],['Actual',trace.actual],['Datatype',trace.datatype],['Reason',trace.reason]]){const dt=document.createElement('dt');dt.textContent=pair[0];const dd=document.createElement('dd');dd.textContent=pair[1]===undefined?'(not present)':typeof pair[1]==='string'?pair[1]:JSON.stringify(pair[1]);dl.append(dt,dd);}t.append(dl);box.append(t);}root.append(box);}for(const warning of result.warnings||[]){const p=document.createElement('p');p.className='muted';p.textContent=warning;root.append(p);}}$('test').onclick=()=>{const textValue=$('samples').value;$('status').textContent='Validating sample structure and evaluating selectors offline…';vscode.postMessage({type:'test',source:textValue});};$('reset').onclick=()=>{$('samples').value=starter;};window.addEventListener('message',event=>{const m=event.data;if(m.type==='init'){text($('source'),'Source: '+m.context.capability+(m.context.testId?' · Test '+m.context.testId:'')+' · '+m.context.path.join('.'));text($('object'),JSON.stringify(m.context.object,null,2));text($('guidance'),m.context.guidance?.message||'Replace the generated starter below with a sanitized canonical collected Item.');starter=m.starter;$('samples').value=starter;const unavailable=m.context.guidance&&!m.context.guidance.canPreview;if(unavailable){text($('sampleHeading'),'Sample input unavailable for this Test');$('sampleHelp').hidden=true;$('sampleShape').hidden=true;$('samples').hidden=true;$('test').hidden=true;$('reset').hidden=true;}}if(m.type==='result'){renderTrace(m.result);$('status').textContent='Preview complete. Assessment evaluation remains unavailable.';}if(m.type==='error'){$('status').className='status error';$('status').textContent=m.message;}});</script></body></html>`;
}

class SampleObjectTesterPanel {
  static open(context: vscode.ExtensionContext, document: any, pack: MetadataPack | undefined) {
    const api: any = vscode; const editor = api.window.activeTextEditor;
    if (!document || !editor) return void api.window.showWarningMessage('Open an Assessment YAML document and place the caret inside an Object first.');
    if (!pack) return void api.window.showWarningMessage('Configure a verified offline SCAP-NG metadata pack before using the Sample Object Tester.');
    const start = document.offsetAt(editor.selection.start); const end = document.offsetAt(editor.selection.end);
    const selected = findObjectContext(document.getText(), start, end);
    if (!selected) return void api.window.showWarningMessage('Place the caret on or inside a Test Object with a schema-resolved capability.');
    if (selected.capability === 'independent.shellcommand') return void api.window.showInformationMessage('Shellcommand sample preview is postponed while its input and evaluation design is reworked. No command was executed.');
    const panel = api.window.createWebviewPanel('scapNg.sampleObjectTester', 'SCAP-NG Sample Object Tester', api.ViewColumn?.Beside ?? 2, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = sampleObjectTesterHtml();
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type !== 'test' || typeof message.source !== 'string') return;
      try { const result = await evaluateObjectSamples(selected.object, selected.capability, message.source, pack); panel.webview.postMessage({ type: 'result', result }); }
      catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
    });
    panel.webview.postMessage({ type: 'init', context: { ...selected, guidance: objectTesterGuidance(selected.object) }, starter: starterSampleItems(selected.object, selected.capability) });
    context.subscriptions.push(panel);
  }
}

async function revealNativeSource(api: any, document: any, range?: [number, number]) {
  const editor = await api.window.showTextDocument(document, { viewColumn: api.ViewColumn?.Beside ?? 2, preserveFocus: false, preview: false });
  if (range) {
    const start = document.positionAt(range[0]); const end = document.positionAt(range[1]);
    const sourceRange = new api.Range(start.line, start.character, end.line, end.character);
    editor.selection = new api.Selection(start.line, start.character, end.line, end.character);
    editor.revealRange(sourceRange, api.TextEditorRevealType?.InCenterIfOutsideViewport);
  }
  return editor;
}

async function switchToNativeSource(api: any, document: any, panel: any) {
  const editor = await api.window.showTextDocument(document, { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
  // Show the text editor first so disposing this custom-editor panel cannot
  // leave the workbench without an active view of the authoritative document.
  panel?.dispose?.();
  return editor;
}


function pinnedSchemaUri(pack: MetadataPack, filename: string): string {
  if (pack.pin.schemaVersion !== '0.4.1') throw new Error('Unsupported schema version');
  return `${schemaBase}${filename}`;
}
function structuralEntityName(collection: string): string {
  return collection === 'tests' ? 'Test' : collection === 'variables' ? 'Variable' :
    collection === 'inputs' ? 'Organizational Input' :
    collection === 'shared_objects' ? 'Shared Object' : 'definition';
}
function valueAtPathForGraphical(value: any, path: (string | number)[]) { let current = value; for (const part of path) current = current?.[part as any]; return current; }
function genericSchemaLocations(pack: MetadataPack, path: (string | number)[], value?: any) {
  const root = value?.assessment?.mode === 'manual'
    ? pinnedSchemaUri(pack, 'manual-assessment.schema.json')
    : pinnedSchemaUri(pack, 'assessment.schema.json');
  let locations = schemaNodes(pack, root);
  for (const part of path) {
    if (typeof part === 'number') {
      locations = schemaItemLocations(pack, locations).flatMap(location => schemaNodes(pack, location.uri));
      continue;
    }
    const property = schemaPropertyEntries(pack, locations).get(part);
    if (property) locations = schemaNodes(pack, property.uri);
    else {
      const additional = schemaDynamicPropertyLocations(pack, locations, String(part));
      if (!additional.length) return [];
      locations = additional.flatMap(location => schemaNodes(pack, location.uri));
    }
  }
  return locations;
}
function genericSchemaSeed(pack: MetadataPack, locations: any[]): any {
  const node = locations.find(location => location.node?.const !== undefined)?.node ??
    locations.find(location => location.node?.default !== undefined)?.node ?? locations[0]?.node;
  if (!node) return undefined;
  if (node.const !== undefined) return structuredClone(node.const);
  if (node.default !== undefined) return structuredClone(node.default);
  if (Array.isArray(node.enum) && node.enum.length) return structuredClone(node.enum[0]);
  if (node.type === 'array' || node.items) return [];
  if (node.type === 'object' || node.properties || node.patternProperties || node.additionalProperties !== undefined) return {};
  if (node.type === 'boolean') return false;
  if (node.type === 'integer' || node.type === 'number') return 0;
  if (node.type === 'null') return null;
  return '';
}
function validateGraphicalSchemaEdit(pack: MetadataPack, before: any, edit: any, label: string) {
  const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
  const beforeErrors = pack.validate(schemaUri, before);
  const afterValue = edit.document.json();
  const afterErrors = pack.validate(schemaUri, afterValue);
  const introduced = afterErrors.filter((error: string) => !beforeErrors.includes(error));
  if (introduced.length) throw new Error(`Pinned schema rejected ${label}: ${introduced.join('; ')}`);
  const semantic = validateNativeSemantics(afterValue);
  if (semantic.length) throw new Error(`Native semantic rule rejected ${label}: ${semantic.map(error => error.message).join('; ')}`);
}
function preferred<T extends { value: string; isDefault?: boolean }>(options: T[]) { return options.find(option => option.isDefault)?.value ?? options[0]?.value; }

function variableExpressionTemplate(operation: string, assessment: any, variableId: string): any {
  const variables = assessment?.variables && typeof assessment.variables === 'object' ? assessment.variables : {};
  const otherVariable = Object.keys(variables).find(id => id !== variableId) || 'source-variable';
  const objectRef = assessment?.shared_objects && typeof assessment.shared_objects === 'object'
    ? Object.keys(assessment.shared_objects)[0] || 'source-object' : 'source-object';
  switch (operation) {
    case 'literal': return { literal: '' };
    case 'variable': return { variable: otherVariable };
    case 'values': return { values: { object: objectRef, field: 'value' } };
    case 'input': {
      const inputId = Object.keys(assessment?.inputs ?? {})[0] || 'example-input';
      return { input: inputId };
    }
    case 'to_integer': return { to_integer: { literal: '' } };
    case 'time_difference': return { time_difference: { values: [{ literal: '' }] } };
    case 'count': return { count: { literal: [] } };
    case 'split': return { split: { delimiter: ',', value: { literal: '' } } };
    case 'substring': return { substring: { substring_start: 1, substring_length: 1, value: { literal: '' } } };
    case 'arithmetic': return { arithmetic: { arithmetic_operation: 'add', values: [{ literal: 0 }, { literal: 0 }] } };
    case 'begin': return { begin: { character: '/', value: { literal: '' } } };
    case 'end': return { end: { character: '/', value: { literal: '' } } };
    case 'concat': return { concat: [{ literal: '' }, { literal: '' }] };
    case 'regex_capture': return { regex_capture: { pattern: '(.*)', value: { literal: '' } } };
    case 'unique': return { unique: { literal: [] } };
    case 'merge': return { merge: { delimiter: ', ', sort: 'document', order: 'ascending', values: { literal: '' } } };
    default: throw new Error(`Operation '${operation}' is not available in the pinned native Variable schema.`);
  }
}
function variableExpressionPath(path: any[], value: any): boolean {
  // Root and nested expression branches (concat operands, regex input,
  // unique/merge input) share the same one-operation native shape.
  return Array.isArray(path) && path.length >= 4 && path[0] === 'assessment' && path[1] === 'variables' &&
    typeof path[2] === 'string' && path[3] === 'expression' &&
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1;
}
function graphicalTestSkeleton(pack: MetadataPack, id: string, title: string, capability: string) {
  const catalog = new GuidedCatalog(pack); const object: any = {};
  const requirement = catalog.objectRequirements(capability)[0];
  for (const name of requirement?.fields ?? []) {
    const field = catalog.objectFields(capability).find(candidate => candidate.name === name);
    const operation = field?.operations[0]?.value;
    if (operation) object[name] = { [operation]: '' };
  }
  const itemFound = preferred(catalog.itemFound()); const itemsSatisfying = preferred(catalog.itemsSatisfying());
  const valuesFound = preferred(catalog.fieldValuesFound()); const valuesMatching = preferred(catalog.fieldValuesMatching());
  const item_requirement: any = {}; if (itemFound) item_requirement.items_found = itemFound; if (itemsSatisfying) item_requirement.items_satisfying = itemsSatisfying;
  const field_requirement: any = {}; if (valuesFound) field_requirement.values_found = valuesFound; if (valuesMatching) field_requirement.values_matching = valuesMatching;
  const require: any = {}; if (Object.keys(item_requirement).length) require.item_requirement = item_requirement; if (Object.keys(field_requirement).length) require.field_requirement = field_requirement;
  const reported = preferred(catalog.reportedElements());
  return { test_title: title, capability, object, require, ...(reported ? { reported_elements: reported } : {}) } as any;
}

/** Build schema-backed Shared Object selectors without authoring invalid placeholders. */
async function promptSharedSelector(api: any, catalog: GuidedCatalog,
    capability: string, already: Record<string, any>, preferredNames?: string[]) {
  const fields = catalog.objectFields(capability).filter(field => !Object.prototype.hasOwnProperty.call(already, field.name));
  if (!fields.length) throw new Error('No additional schema-declared selectors are available for this capability. Use native YAML for advanced Object shapes.');
  const field = preferredNames?.length ? fields.find(candidate => preferredNames.includes(candidate.name)) :
    (await api.window.showQuickPick(fields.map(candidate => ({ label: candidate.label || candidate.name,
      description: candidate.name, detail: candidate.description, candidate })), {
      placeHolder: 'Select a collection selector for the Shared Object'
    }))?.candidate;
  if (!field) return undefined;
  const ops = field.operations;
  if (!ops?.length) throw new Error('The pinned capability metadata has no supported selector operations for ' + field.name);
  const operation = ops.length === 1 ? ops[0] :
    (await api.window.showQuickPick(ops.map((value: any) => ({ label: value.label || value.value,
      description: value.value, value })), { placeHolder: 'Choose how to select ' + field.name }))?.value;
  if (!operation) return undefined;
  let value: string | undefined;
  if (field.enumValues.length) {
    const picked = await api.window.showQuickPick(field.enumValues.map((entry: string) => ({
      label: entry, value: entry
    })), { placeHolder: 'Select a valid ' + field.name + ' value' });
    value = picked?.value;
  } else {
    value = await api.window.showInputBox({
      prompt: 'Value for selector ' + field.name + ' (' + operation.value + ')',
      value: '',
      validateInput: (input: string) => input.trim().length ? undefined : 'Enter a selector value.'
    });
  }
  if (value === undefined || !String(value).length) return undefined;
  const candidate = { [field.name]: { [operation.value]: value } } as any;
  const schemaUri = catalog.capabilityObjectSchema(capability);
  if (!schemaUri) throw new Error('No pinned object schema for ' + capability);
  // Validate the completed Object, not a partial alternative with missing required selectors.
  // A multi-field selector branch may be incomplete until the final prompt has finished.
  return candidate;
}

async function promptRequireField(api: any, catalog: GuidedCatalog, capability: string, already: Record<string, any>, requested?: any) {
  const fields = catalog.resultFields(capability).filter(field => !Object.prototype.hasOwnProperty.call(already, field.name));
  if (!fields.length) throw new Error('No additional schema-declared Require fields are available for this capability. Use native YAML for advanced fields.');
  const requestedName = typeof requested?.fieldName === 'string' ? requested.fieldName : undefined;
  const field = requestedName
    ? fields.find(candidate => candidate.name === requestedName)
    : (await api.window.showQuickPick(fields.map(candidate => ({
      label: candidate.label || candidate.name, description: candidate.name, detail: candidate.description, field: candidate
    })), { placeHolder: 'Select a collected field to require' }))?.field;
  if (!field) {
    if (requestedName) throw new Error('The selected Require field is not available in the pinned capability schema.');
    return undefined;
  }
  if (!field.operations?.length) throw new Error('The pinned capability metadata has no supported Require operations for ' + field.name);
  const operation = typeof requested?.operation === 'string'
    ? field.operations.find((candidate: any) => candidate.value === requested.operation)
    : field.operations.length === 1 ? field.operations[0] :
      (await api.window.showQuickPick(field.operations.map((value: any) => ({
        label: value.label || value.value, description: value.value, value
      })), { placeHolder: 'Choose how to compare ' + field.name }))?.value;
  if (!operation) {
    if (requested?.operation) throw new Error('The selected Require operation is not available in the pinned capability schema.');
    return undefined;
  }
  if (requestedName) {
    if (!Object.prototype.hasOwnProperty.call(requested, 'value')) throw new Error('The Require field wizard did not provide a value.');
    const value = operation.value === 'matches_regex' && typeof requested.value === 'string' ? [requested.value] : requested.value;
    return { [field.name]: { [operation.value]: value } };
  }
  let raw: string | undefined;
  const datatypes = Array.isArray(field.datatypes) ? field.datatypes : [];
  if (datatypes.includes('boolean') && datatypes.length === 1) {
    raw = (await api.window.showQuickPick([
      { label: 'true', value: 'true' }, { label: 'false', value: 'false' }
    ], { placeHolder: 'Choose the expected Boolean value' }))?.value;
  } else {
    raw = await api.window.showInputBox({
      prompt: 'Expected value for ' + field.name + ' (' + operation.value + ')', value: '',
      validateInput: (value: string) => value.trim().length ? undefined : 'Enter an expected value.'
    });
  }
  if (raw === undefined || !raw.trim()) return undefined;
  let value: any = raw;
  if (operation.value === 'matches_regex') value = [raw];
  else if (datatypes.includes('boolean') && datatypes.length === 1) value = raw === 'true';
  else if (datatypes.includes('integer') && datatypes.length === 1 && /^[-+]?\d+$/.test(raw.trim())) value = Number(raw);
  else if (datatypes.includes('number') && datatypes.length === 1 && Number.isFinite(Number(raw))) value = Number(raw);
  return { [field.name]: { [operation.value]: value } };
}

function insertAssessmentSection(source: SourceBuffer, key: string, value: any, expectedHash: string) {
  const authored: any = (source.json() as any)?.assessment;
  const existingKeys = authored && typeof authored === 'object' && !Array.isArray(authored) ? Object.keys(authored) : [];
  const beforeKey = assessmentSectionBeforeKey(existingKeys, key, authored?.mode);
  return source.insertMapEntry(['assessment'], key, value, expectedHash, beforeKey ? { beforeKey } : {});
}
async function graphicalAdd(api: any, document: any, pack: MetadataPack | undefined, path: (string | number)[], expectedHash: string, options?: any): Promise<any> {
  if (!pack) throw new Error('A verified offline metadata pack is required for schema-driven structural additions.');
  const source = new SourceBuffer(document.getText()); const catalog = new GuidedCatalog(pack);
  const last = String(path.at(-1) ?? '');
  if (last === 'tests') {
    const id = await api.window.showInputBox({ prompt: 'New Test ID (drafts end in -test)', value: 'new-test' }); if (!id) return undefined;
    const capability = await api.window.showQuickPick(catalog.capabilities(), { placeHolder: 'Choose the Test capability from the pinned metadata' }); if (!capability) return undefined;
    const title = await api.window.showInputBox({ prompt: 'Human-readable Test summary (optional; generated when blank)', value: '' }); if (title === undefined) return undefined;
    const skeleton = graphicalTestSkeleton(pack, id, title.trim(), capability.value);
    if (!skeleton.test_title) skeleton.test_title = generatedTestTitle(pack, { capability: capability.value, object: skeleton.object, fields: {}, presenceOnly: false });
    const collection = valueAtPathForGraphical(source.json(), path); return collection === undefined ? insertAssessmentSection(source, 'tests', { [id]: skeleton } as any, expectedHash) : source.insertMapEntry(path, id, skeleton, expectedHash);
  }
  if (last === 'inputs' && path.length === 2 && path[0] === 'assessment') {
    // An Input declares a typed value supplied by the referring policy/Rule.
    // It is not an external Assessment file reference (those use dependencies).
    const assessmentSchema: any = pack.resource(pinnedSchemaUri(pack, 'assessment.schema.json'));
    const definition: any = assessmentSchema.properties?.assessment?.properties?.inputs;
    const inputSpec: any = definition?.additionalProperties;
    const nameSpec: any = definition?.propertyNames;
    const cardinalityOptions: string[] = inputSpec?.properties?.cardinality?.enum;
    const capabilitySchema: any = pack.resource(pinnedSchemaUri(pack, 'capability-common.schema.json'));
    const datatypeOptions: string[] = capabilitySchema.$defs?.native_datatype?.enum;
    if (!nameSpec?.pattern || !Array.isArray(cardinalityOptions) || !cardinalityOptions.length ||
        !Array.isArray(datatypeOptions) || !datatypeOptions.length) {
      throw new Error('Pinned Input schema metadata is incomplete. No Input was added.');
    }
    const allowedName = new RegExp(nameSpec.pattern);
    const name = await api.window.showInputBox({
      prompt: 'Input ID — named value supplied when this Assessment is invoked (not an Assessment file)',
      value: 'policy-value-input',
      validateInput: (value: string) =>
        allowedName.test(value) && value.length <= (nameSpec.maxLength ?? 64) ? undefined :
        'Use a unique lowercase hyphenated Input ID ending in -input.'
    });
    if (!name) return undefined;
    const authored = source.json();
    const inputs: any = valueAtPathForGraphical(authored, path);
    if (inputs !== undefined && (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs))) {
      throw new Error('The existing Inputs section is not a mapping. No source was changed.');
    }
    if (inputs && Object.prototype.hasOwnProperty.call(inputs, name)) {
      throw new Error('An Input with this ID already exists.');
    }
    const datatype = await api.window.showQuickPick(datatypeOptions.map(value => ({ label: value, value })), {
      placeHolder: 'Value datatype declared by this Input'
    });
    if (!datatype) return undefined;
    const cardinality = await api.window.showQuickPick(cardinalityOptions.map(value => ({ label: value.replaceAll('_', ' '), value })), {
      placeHolder: 'Number of values the caller may supply'
    });
    if (!cardinality) return undefined;
    const required = await api.window.showQuickPick([
      { label: 'Required — the caller must provide this Input', value: true },
      { label: 'Optional — caller may omit this Input', value: false }
    ], { placeHolder: 'Does this Input have to be supplied?' });
    if (!required) return undefined;
    const description = await api.window.showInputBox({
      prompt: 'Describe what value the caller supplies (optional; Esc to cancel)',
      value: ''
    });
    if (description === undefined) return undefined;
    const skeleton = {
      datatype: datatype.value,
      cardinality: cardinality.value,
      required: required.value,
      ...(description.trim() ? { description: description.trim() } : {})
    };
    const edit = inputs === undefined
      ? insertAssessmentSection(source, 'inputs', { [name]: skeleton } as any, expectedHash)
      : source.insertMapEntry(path, name, skeleton as any, expectedHash);
    const errors = pack.validate(pinnedSchemaUri(pack, 'assessment.schema.json'), edit.document.json());
    if (errors.length) throw new Error('Pinned schema rejected the new Input: ' + errors.join('; '));
    return edit;
  }
  if (last === 'variables') {
    const id = await api.window.showInputBox({ prompt: 'New Variable name', value: 'new-variable' }); if (!id) return undefined;
    const variableUri = pinnedSchemaUri(pack, 'variable-expression.schema.json');
    const declaration: any = pack.node(variableUri + '#/$defs/declaration');
    const allowsDatatype = Object.hasOwn(declaration.properties ?? {}, 'datatype');
    const required = new Set<string>(declaration.required ?? []);
    if (required.has('datatype') !== allowsDatatype)
      throw new Error('Inconsistent Variable declaration metadata in the pinned schema.');
    const skeleton = {
      kind: 'constant',
      ...(allowsDatatype ? { datatype: 'string' } : {}),
      expression: { literal: '' }
    } as any; const collection = valueAtPathForGraphical(source.json(), path); return collection === undefined ? insertAssessmentSection(source, 'variables', { [id]: skeleton } as any, expectedHash) : source.insertMapEntry(path, id, skeleton, expectedHash);
  }
  if (path.length === 4 && path[0] === 'assessment' && path[1] === 'tests' && path[3] === 'require' && options?.condition === true) {
    const doc: any = source.json(); const test: any = doc.assessment?.tests?.[String(path[2])];
    if (!test) throw new Error('The Test definition was not found.');
    const capability = String(test.capability || '');
    if (!capability) throw new Error('The Test has no valid capability.');
    const requirement: any = test.require;
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) throw new Error('The Test Require section is not a mapping. Use native YAML to repair it.');
    const logical = typeof options.logicalOperation === 'string' ? options.logicalOperation : '';
    if (!requireLogicalOperations(pack).includes(logical)) throw new Error('That Require logical operation is not available in the pinned schema.');
    const candidate = await promptRequireField(api, catalog, capability, {}, options);
    if (!candidate) return undefined;
    const condition = { fields: candidate } as any;
    const currentLogical = ['and', 'or', 'one', 'xor'].find(name => Array.isArray(requirement[name]));
    let edit: any;
    if (currentLogical === logical) {
      edit = source.insertArrayItem(path.concat(logical), condition, expectedHash);
    } else {
      const next: any = {};
      for (const name of ['item_requirement', 'field_requirement']) if (Object.prototype.hasOwnProperty.call(requirement, name)) next[name] = requirement[name];
      const branches: any[] = [];
      if (Object.prototype.hasOwnProperty.call(requirement, 'fields')) branches.push({ fields: requirement.fields });
      else if (currentLogical) branches.push({ [currentLogical]: requirement[currentLogical] });
      branches.push(condition);
      next[logical] = branches;
      edit = source.replacePathValue(path, next, expectedHash);
    }
    const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
    const before = pack.validate(schemaUri, doc);
    const errors = pack.validate(schemaUri, edit.document.json());
    const introduced = errors.filter((error: string) => !before.includes(error));
    if (introduced.length) throw new Error('Pinned schema rejected the new Require condition: ' + introduced.join('; '));
    return edit;
  }

  if (path.length === 4 && path[0] === 'assessment' && path[1] === 'tests' && path[3] === 'require') {
    const doc: any = source.json(); const test: any = doc.assessment?.tests?.[String(path[2])];
    if (!test) throw new Error('The Test definition was not found.');
    const capability = String(test.capability || '');
    if (!capability) throw new Error('The Test has no valid capability.');
    const requirement = test.require;
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement))
      throw new Error('The Test Require section is not a mapping. Use native YAML to repair it.');
    const existingFields = requirement.fields;
    if (existingFields !== undefined && (existingFields === null || typeof existingFields !== 'object' || Array.isArray(existingFields)))
      throw new Error('The Require fields section is not a mapping. Use native YAML to repair it.');
    const candidate = await promptRequireField(api, catalog, capability, existingFields ?? {}, options);
    if (!candidate) return undefined;
    const [fieldName, predicate] = Object.entries(candidate)[0] as [string, any];
    const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
    let edit: any;
    if (existingFields === undefined) {
      if (requirement.field_requirement === undefined) {
        const fieldRequirement = {
          values_found: preferred(catalog.fieldValuesFound()),
          values_matching: preferred(catalog.fieldValuesMatching())
        };
        if (!fieldRequirement.values_found || !fieldRequirement.values_matching)
          throw new Error('Pinned field-requirement defaults are unavailable; no Require field was added.');
        edit = source.insertMapEntries(path, [['field_requirement', fieldRequirement], ['fields', { [fieldName]: predicate }]], expectedHash);
      } else {
        edit = source.insertMapEntry(path, 'fields', { [fieldName]: predicate }, expectedHash);
      }
    } else {
      edit = source.insertMapEntry(path.concat('fields'), fieldName, predicate, expectedHash);
    }
    const errors = pack.validate(schemaUri, edit.document.json());
    if (errors.length) throw new Error('Pinned schema rejected the new Require field: ' + errors.join('; '));
    return edit;
  }

  if (last === 'shared_objects' && path.length === 2) {
    const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
    const spec: any = pack.resource(schemaUri).properties?.assessment?.properties?.shared_objects;
    const nameRule: any = spec?.propertyNames;
    if (!nameRule?.pattern) throw new Error('Pinned Shared Object naming metadata is unavailable.');
    const namePattern = new RegExp(nameRule.pattern);
    const id = await api.window.showInputBox({
      prompt: 'Shared Object ID (must end in -object)', value: 'new-object',
      validateInput: (name: string) =>
        namePattern.test(name) && name.length <= (nameRule.maxLength ?? 64) ? undefined :
        'Use a lowercase hyphenated ID ending in -object.'
    });
    if (!id) return undefined;
    const existing = valueAtPathForGraphical(source.json(), path);
    if (existing && Object.prototype.hasOwnProperty.call(existing, id))
      throw new Error('This Shared Object ID already exists.');
    const title = await api.window.showInputBox({
      prompt: 'Descriptive Object title (required by 0.4 schema)',
      value: id.replace(/-object$/, '').replaceAll('-', ' '),
      validateInput: (value: string) => value.trim() ? undefined : 'A Shared Object title is required.'
    });
    if (!title) return undefined;
    const capability = await api.window.showQuickPick(catalog.capabilities(), {
      placeHolder: 'Choose the capability this Object collects with'
    });
    if (!capability) return undefined;
    const available = catalog.objectFields(capability.value);
    if (!available.length)
      throw new Error('This capability has no supported selector form in the pinned authoring pack; no incomplete Object was added.');
    const requirements = catalog.objectRequirements(capability.value);
    const candidates = requirements.filter(item => item.fields.every(name =>
      available.some(field => field.name === name)));
    let chosen = candidates[0];
    if (candidates.length > 1) {
      const picked = await api.window.showQuickPick(candidates.map((item, index) => ({
        label: 'Selector alternative ' + (index + 1) + ': ' + item.fields.join(', '),
        description: item.description, item
      })), { placeHolder: 'Select a capability-supported Object selector alternative' });
      chosen = picked?.item;
      if (!chosen) return undefined;
    }
    const skeleton: any = { object_title: title.trim(), capability: capability.value };
    const requiredFields: string[] = chosen?.fields?.length ? chosen.fields : [];
    if (requiredFields.length) {
      for (const fieldName of requiredFields) {
        const next = await promptSharedSelector(api, catalog, capability.value,
          Object.fromEntries(Object.entries(skeleton).filter(([key]) => key !== 'object_title' && key !== 'capability')),
          [fieldName]);
        if (!next) return undefined;
        Object.assign(skeleton, next);
      }
    } else {
      const next = await promptSharedSelector(api, catalog, capability.value, {});
      if (!next) return undefined;
      Object.assign(skeleton, next);
    }
    const capabilitySchema = catalog.capabilityObjectSchema(capability.value);
    const selectors = Object.fromEntries(Object.entries(skeleton).filter(([key]) =>
      key !== 'object_title' && key !== 'capability'));
    const capabilityErrors = pack.validate(capabilitySchema + '#/$defs/object', selectors as any);
    if (capabilityErrors.length) throw new Error('Object selectors are incomplete: ' + capabilityErrors.join('; '));
    const edit = existing === undefined
      ? source.insertMapEntry(['assessment'], 'shared_objects', { [id]: skeleton } as any, expectedHash)
      : source.insertMapEntry(path, id, skeleton, expectedHash);
    const errors = pack.validate(schemaUri, edit.document.json());
    if (errors.length) throw new Error('Pinned schema rejected Shared Object: ' + errors.join('; '));
    return edit;
  }
  if (path.length === 3 && path[0] === 'assessment' && path[1] === 'shared_objects') {
    const selected: any = valueAtPathForGraphical(source.json(), path);
    if (!selected || typeof selected !== 'object' || Array.isArray(selected) || !selected.capability)
      throw new Error('Shared Object has no capability. Set a valid capability first.');
    const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
    const spec: any = pack.resource(schemaUri).properties?.assessment?.properties?.shared_objects;
    const validId = new RegExp(spec?.propertyNames?.pattern ?? '^$');
    if (!validId.test(String(path[2])))
      throw new Error('Shared Object ID must end in -object. Rename the key before adding selectors.');
    if (!Object.prototype.hasOwnProperty.call(selected, 'object_title')) {
      const title = await api.window.showInputBox({
        prompt: 'Required Shared Object title',
        value: String(path[2]).replace(/-object$/, '').replaceAll('-', ' '),
        validateInput: (value: string) => value.trim() ? undefined : 'Enter a title.'
      });
      if (!title) return undefined;
      const edit = source.insertMapEntry(path, 'object_title', title.trim() as any, expectedHash);
      return edit; // A legacy partial Object may need additional selectors before full schema admission.
    }
    const newSelector = await promptSharedSelector(api, catalog, selected.capability,
      Object.fromEntries(Object.entries(selected).filter(([key]) =>
        key !== 'object_title' && key !== 'capability')));
    if (!newSelector) return undefined;
    const [fieldName, value] = Object.entries(newSelector)[0] as [string, any];
    const edit = source.insertMapEntry(path, fieldName, value as any, expectedHash);
    const errors = pack.validate(schemaUri, edit.document.json());
    if (errors.length) throw new Error('Pinned schema rejected added selector: ' + errors.join('; '));
    return edit;
  }
  if (path.length === 4 && path[0] === 'assessment' && path[1] === 'tests' && path[3] === 'object') {
    const doc: any = source.json(); const test: any = doc.assessment?.tests?.[String(path[2])];
    if (!test) throw new Error('The Test definition was not found.');
    const object = test.object;
    if (typeof object === 'string')
      throw new Error('This Test references a Shared Object. Edit that Shared Object to change its selectors.');
    if (!object || typeof object !== 'object' || Array.isArray(object))
      throw new Error('The Test Object is not an inline mapping. Use native YAML to repair it.');
    if ('set' in object)
      throw new Error('This Test uses an Object Set. Add operands under its Set node; do not add unrelated selectors beside the Set.');
    const capability = String(test.capability||'');
    if (!capability) throw new Error('The Test has no valid capability.');
    const extra = await promptSharedSelector(api, catalog, capability, object);
    if (!extra) return undefined;
    const [fieldName, value] = Object.entries(extra)[0] as [string, any];
    const edit = source.insertMapEntry(path, fieldName, value as any, expectedHash);
    const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
    const errors = pack.validate(schemaUri, edit.document.json());
    if (errors.length) throw new Error('Pinned schema rejected the added Object selector: ' + errors.join('; '));
    return edit;
  }
  const before = source.json();
  const existing = valueAtPathForGraphical(before, path);
  const locations = genericSchemaLocations(pack, path, before);
  if (Array.isArray(existing)) {
    const itemLocations = schemaItemLocations(pack, locations);
    if (!itemLocations.length) throw new Error(`The pinned schema does not authorize sequence items at ${path.join('.')}.`);
    const seed = genericSchemaSeed(pack, itemLocations.flatMap(location => schemaNodes(pack, location.uri)));
    const edit = source.insertArrayItem(path, seed as any, expectedHash);
    validateGraphicalSchemaEdit(pack, before, edit, 'the new sequence item');
    return edit;
  }
  if (existing && typeof existing === 'object') {
    const entries = schemaPropertyEntries(pack, locations);
    const authored = new Set(Object.keys(existing));
    const choices = [...entries.entries()].filter(([key]) => !authored.has(key));
    let key: string | undefined;
    if (choices.length) {
      key = (await api.window.showQuickPick(choices.map(([name, location]) => ({
        label: name, description: String(location.node?.title ?? ''), detail: String(location.node?.description ?? ''), name
      })), { placeHolder: `Add a schema property under ${last}` }))?.name;
    } else if (schemaDynamicPropertyLocations(pack, locations).length) {
      key = await api.window.showInputBox({
        prompt: `Add a schema-authorized member under ${last}`,
        value: 'new-member',
        validateInput: (candidate: string) => schemaDynamicPropertyLocations(pack, locations, candidate).length
          ? undefined : 'The member name does not satisfy the pinned schema dynamic-key contract.'
      });
    }
    if (!key) throw new Error(`No unused schema-declared property is available under ${path.join('.')}.`);
    const selected = entries.get(key);
    const seedLocations = selected ? schemaNodes(pack, selected.uri) : schemaDynamicPropertyLocations(pack, locations, key);
    const seed = genericSchemaSeed(pack, seedLocations);
    const edit = path.length === 1 && path[0] === 'assessment'
      ? insertAssessmentSection(source, key, seed as any, expectedHash)
      : source.insertMapEntry(path, key, seed as any, expectedHash);
    validateGraphicalSchemaEdit(pack, before, edit, `the new ${key} member`);
    return edit;
  }
  throw new Error(`Cannot add a child to ${path.join('.')}; the selected YAML node is not a schema-authorized collection.`);
}
async function applySourceWorkspaceEdit(api: any, document: any, edit: any) {
  const workspaceEdit = new api.WorkspaceEdit();
  const replacements = Array.isArray(edit.replacements) ? edit.replacements : [{ start: edit.range[0], end: edit.range[1], replacement: edit.replacement }];
  for (const item of replacements) workspaceEdit.replace(document.uri, new api.Range(document.positionAt(item.start), document.positionAt(item.end)), item.replacement);
  if (!await api.workspace.applyEdit(workspaceEdit)) throw new Error('VS Code declined the source edit.');
}
type AssessmentEditorScope = { mode: 'benchmark' | 'standalone'; benchmarkLabel?: string };
type AssessmentExternalReference = {
  targetId: string;
  expectedVersion?: string | number;
  purpose: string;
  path: string;
  status: 'resolved' | 'missing' | 'wrong-kind' | 'version-mismatch' | 'ambiguous';
  targetUri?: string;
  targetTitle?: string;
  targetVersion?: string | number;
  detail: string;
  negated: boolean;
};

function assessmentExternalReferenceData(index: WorkspaceIndex, uri: string): AssessmentExternalReference[] {
  const source = index.get(uri);
  if (!source || source.kind !== 'assessment') return [];
  return source.references.map(reference => {
    const candidates = index.find(reference.targetId);
    const assessments = candidates.filter(candidate => candidate.kind === 'assessment');
    const matching = reference.expectedVersion === undefined
      ? assessments
      : assessments.filter(candidate => String(candidate.version) === String(reference.expectedVersion));
    let status: AssessmentExternalReference['status'] = 'resolved';
    let detail = 'Resolved by logical Assessment ID and version.';
    if (!candidates.length) { status = 'missing'; detail = 'No indexed Assessment has this logical ID. Import or refresh the containing content folder.'; }
    else if (!assessments.length) { status = 'wrong-kind'; detail = 'The logical ID resolves, but the target is not an Assessment.'; }
    else if (!matching.length) { status = 'version-mismatch'; detail = `No target provides expected version ${reference.expectedVersion}.`; }
    else if (matching.length !== 1) { status = 'ambiguous'; detail = 'Multiple Assessment documents match this logical ID/version; no target was selected.'; }
    const target = matching.length === 1 ? matching[0] : undefined;
    return {
      targetId: reference.targetId,
      ...(reference.expectedVersion === undefined ? {} : { expectedVersion: reference.expectedVersion }),
      purpose: reference.purpose ?? 'assessment',
      path: reference.path,
      status,
      ...(target ? { targetUri: target.uri, targetTitle: target.title, targetVersion: target.version } : {}),
      detail,
      negated: /\/not\//.test(reference.path)
    };
  });
}


class AssessmentEditorProvider {
  constructor(
    private readonly getPack: () => MetadataPack | undefined,
    private readonly getScope: (document: any) => AssessmentEditorScope = () => ({ mode: 'standalone' }),
    private readonly getExternalReferences: (uri: string) => AssessmentExternalReference[] = () => []
  ) {}
  async resolveCustomTextEditor(document: any, panel: any, _token: any) {
    const api: any = vscode; panel.webview.options = { enableScripts: true }; panel.webview.html = graphicalHtml();
    let editorMode = configuredAssessmentEditor(api, document);
    // Split mode keeps the graphical inspector and the actual VS Code YAML
    // editor visible together. Both views still bind to this one TextDocument.
    if (editorMode === 'split') void openNativeYamlBeside(api, document);
    const send = () => {
      try {
        const model = assessmentEditorModel(document, this.getPack());
        void panel.webview.postMessage({ type: 'model', model: { ...model, sourceName: document.uri?.fsPath ?? document.fileName ?? 'active document', editorMode, scope: this.getScope(document), externalReferences: this.getExternalReferences(document.uri?.toString?.() ?? ''), authoringWarnings: assistedDraftWarnings(document) } });
      } catch (error) {
        // A malformed/exotic YAML document must never strand the custom editor
        // on its loading placeholder. Keep the native YAML editor available
        // and expose the exact model-building failure in the webview/status bar.
        const message = error instanceof Error ? error.message : String(error);
        void panel.webview.postMessage({ type: 'model', model: { ok: false, error: message, fields: [], sourceName: document.uri?.fsPath ?? document.fileName ?? 'active document', scope: this.getScope(document) } });
        void panel.webview.postMessage({ type: 'error', message: `Unable to load the graphical model: ${message}` });
      }
    };
    let editQueue = Promise.resolve();
    const applyMessage = async (message: any) => {
      if (message.type === 'ready') return send();
      if (message.type === 'webviewError') {
        const detail = typeof message.message === 'string' ? message.message : 'Unknown webview error';
        void api.window.showErrorMessage(`SCAP-NG graphical editor failed to load: ${detail}`);
        return;
      }
      // Mode buttons keep the Graphical webview and native YAML editor bound to
      // this one TextDocument. YAML uses the active column; Split keeps both views.
      if (message.type === 'editorMode') {
        const mode = message.mode === 'yaml' || message.mode === 'split' || message.mode === 'graphical' ? message.mode : undefined;
        if (!mode) return;
        editorMode = mode;
        if (mode === 'yaml') {
          await api.window.showTextDocument(document, { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
        } else if (mode === 'split') {
          await openNativeYamlBeside(api, document);
          panel.reveal?.(api.ViewColumn?.Active ?? 1, false);
        } else {
          panel.reveal?.(api.ViewColumn?.Active ?? 1, false);
        }
        panel.webview.postMessage({ type: 'editorMode', mode });
        return;
      }
      // Compatibility for older webviews: the document remains authoritative.
      if (message.type === 'openSource') { await revealNativeSource(api, document); return; }
      if (message.type === 'switchToSource') { await switchToNativeSource(api, document, panel); return; }
      if (message.type === 'openRegex') { await api.commands.executeCommand('scapNg.testRegex', { document, useFirst: true }); return; }
      if (message.type === 'openGuided') { await api.commands.executeCommand('scapNg.createGuidedAssessment'); return; }
      if (message.type === 'openExternalAssessment' && typeof message.uri === 'string' && (message.mode === 'graphical' || message.mode === 'yaml')) {
        const target = this.getExternalReferences(document.uri?.toString?.() ?? '').find(reference => reference.status === 'resolved' && reference.targetUri === message.uri);
        if (!target || !api.Uri?.parse) {
          panel.webview.postMessage({ type: 'error', message: 'That referenced Assessment is no longer resolved in the indexed workspace. Refresh content and retry.' });
          return;
        }
        await openAssessmentInMode(api, api.Uri.parse(message.uri), message.mode);
        return;
      }
      if (message.type === 'selectPath' && Array.isArray(message.path)) {
        try { const range = new SourceBuffer(document.getText()).scalarRange(message.path); await revealNativeSource(api, document, range); } catch { await revealNativeSource(api, document); }
        return;
      }
      if (message.type === 'regexPreview' && Array.isArray(message.patterns) && typeof message.input === 'string') {
        const previews = await previewRegexSafe(message.patterns.filter((pattern: any) => typeof pattern === 'string'), message.input, typeof message.flags === 'string' ? message.flags : '', 100);
        panel.webview.postMessage({ type: 'regexPreviewResult', previews }); return;
      }
      if (message.type === 'regexList') {
        try {
          const revision = sha256(document.getText());
          if (message.revision !== revision ||
              (message.version !== undefined && message.version !== document.version))
            throw new Error('Document changed before regex edit; refresh and retry.');
          const path = message.path;
          if (!Array.isArray(path) || path[0] !== 'assessment' || path[1] !== 'tests' ||
              path.at(-1) !== 'matches_regex' || !path.includes('require') || !path.includes('fields'))
            throw new Error('Invalid Require regex-list path.');
          const pack = this.getPack();
          if (!pack) throw new Error('A verified pinned schema pack is required.');
          const source = new SourceBuffer(document.getText());
          const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
          const before = pack.validate(schemaUri, source.json());
          const edit = source.editRegexList(path, message.action, revision, message.value, message.index);
          const after = pack.validate(schemaUri, edit.document.json());
          const introduced = after.filter((error: string) => !before.includes(error));
          if (introduced.length) throw new Error('Regex edit violates the pinned schema: ' + introduced.join('; '));
          await applySourceWorkspaceEdit(api, document, edit);
        } catch (error) {
          panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
          send();
        }
        return;
      }
      if (message.type === 'comparisonChange') {
        try {
          const revision=sha256(document.getText());
          if(message.revision!==revision || (message.version!==undefined&&message.version!==document.version))
            throw new Error('Document changed before comparison edit; reload and retry.');
          const path=message.path, op=message.operation;
          if(!Array.isArray(path)||path[0]!=='assessment'||typeof op!=='string'||
             !Array.isArray(message.allowedOperations)||!message.allowedOperations.includes(op)||
             !((path[1]==='tests'&&path.includes('object'))||
               (path[1]==='tests'&&path.includes('require')&&path.includes('fields'))||
               path[1]==='shared_objects'||(path[1]==='variables'&&path.includes('object'))))
            throw new Error('Comparison path/operator was not authorized by the editor.');
          const source=new SourceBuffer(document.getText());
          const before: any=source.json();
          const pack=this.getPack();
          if(!pack)throw new Error('Pinned offline schema pack is required.');
          const prior=valueAtPathForGraphical(before,path);
          const existing=prior && typeof prior==='object'&&!Array.isArray(prior) ? Object.keys(prior) : [];
          const operationPath=existing.length===1?[...path,existing[0]]:[];
          const legal=operationPath.length ? comparisonOperations(pack,before?.assessment,operationPath,true) : [];
          if(!legal.includes(op))throw new Error('The pinned schema does not permit this operator in the selected field.');
          const valueSource=typeof message.source==='string'?message.source:'fixed';
          const allowedSources=operationPath.length?comparisonValueSources(pack,before?.assessment,operationPath):[];
          if(!allowedSources.includes(valueSource))throw new Error('The pinned schema does not permit this value source in the selected field.');
          if((valueSource==='variable'||valueSource==='input') && typeof message.value!=='string')throw new Error('Select a named value source.');
          if(valueSource==='variable'){
            if(!Object.hasOwn(before?.assessment?.variables||{},message.value))throw new Error('Select an existing Assessment Variable.');
            if(!comparisonVariableCompatible(pack,before?.assessment,operationPath,message.value))throw new Error('The selected Variable datatype is incompatible with this field.');
          }
          if(valueSource==='input' && !Object.hasOwn(before?.assessment?.inputs||{},message.value))throw new Error('Select an existing Organizational Input.');
          const replacementValue=valueSource==='variable'||valueSource==='input'?{[valueSource]:message.value}:message.value;
          const schemaUri=pinnedSchemaUri(pack, 'assessment.schema.json');
          const earlier=pack.validate(schemaUri,before);
          const edit=source.replaceComparison(path,op,replacementValue,revision);
          const later=pack.validate(schemaUri,edit.document.json());
          const introduced=later.filter((error:string)=>!earlier.includes(error));
          if(introduced.length)throw new Error('Pinned schema rejects this comparison: '+introduced.join('; '));
          await applySourceWorkspaceEdit(api,document,edit);
        }catch(error){
          panel.webview.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});
          send();
        }
        return;
      }
      if (message.type === 'selectorSource') {
        try {
          const revision = sha256(document.getText());
          if (message.revision !== revision ||
              (message.version !== undefined && message.version !== document.version))
            throw new Error('Document changed before selector replacement; refresh and retry.');
          const path = message.path;
          const variant = message.variant;
          if (!Array.isArray(path) || path[0] !== 'assessment' ||
              !(path[1] === 'tests' && path[3] === 'object' ||
                path[1] === 'shared_objects' && path.length >= 4 ||
                path[1] === 'variables' && path.lastIndexOf('object') >= 3) ||
              !['equals', 'variable'].includes(variant) ||
              typeof message.value !== 'string' || !message.value.length)
            throw new Error('Invalid Object selector source request');
          const source = new SourceBuffer(document.getText());
          const authored: any = source.json();
          if (variant === 'variable' && !Object.prototype.hasOwnProperty.call(authored?.assessment?.variables || {}, message.value))
            throw new Error('Choose an existing Assessment Variable; the requested Variable ID was not found.');
          const original: any = valueAtPathForGraphical(authored,path);
          if (!original || typeof original !== 'object' || Array.isArray(original) ||
              Object.keys(original).length !== 1 ||
              !['equals','variable'].includes(Object.keys(original)[0]))
            throw new Error('This Object selector cannot be switched safely; use native YAML.');
          const pack = this.getPack();
          if (!pack) throw new Error('A pinned offline schema pack is required.');
          const originalOperation = String(Object.keys(original)[0]);
          if (variant === 'variable' && !comparisonVariableCompatible(pack, authored?.assessment, [...path, originalOperation], message.value))
            throw new Error('The selected Variable datatype is incompatible with this Object selector.');
          const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
          const before = pack.validate(schemaUri, source.json());
          const edit = source.replaceSelectorSource(path, variant, message.value, revision);
          const after = pack.validate(schemaUri, edit.document.json());
          const introduced = after.filter((error: string) => !before.includes(error));
          if (introduced.length) throw new Error('The pinned schema rejected this selector: ' + introduced.join('; '));
          await applySourceWorkspaceEdit(api, document, edit);
          panel.webview.postMessage({ type: 'status', message: 'Object selector source updated; native Undo/Redo remains available.' });
        } catch (error) {
          panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
          send();
        }
        return;
      }
      if (message.type === 'structural') {
        try {
          const currentRevision = sha256(document.getText());
          if (message.revision !== currentRevision || (message.version !== undefined && message.version !== document.version)) throw new Error('Document changed before this structural edit; refresh and try again.');
          const path = Array.isArray(message.path) ? message.path : [];
          if (message.action === 'reveal') { try { await revealNativeSource(api, document, new SourceBuffer(document.getText()).scalarRange(path)); } catch { await revealNativeSource(api, document); } return; }
          if (message.action === 'addEvaluateTest') {
            if (path.length !== 2 || path[0] !== 'assessment' || path[1] !== 'evaluate')
              throw new Error('Evaluate editing is available only from the Assessment Evaluate node.');
            if (typeof message.testId !== 'string' || !message.testId.length || typeof message.operation !== 'string')
              throw new Error('Choose a Test and a logical Evaluate operation.');
            const pack = this.getPack();
            if (!pack) throw new Error('The verified offline schema pack is required for Evaluate edits.');
            const allowed = new GuidedCatalog(pack).logicalOperators().map(option => option.value);
            if (!allowed.includes(message.operation)) throw new Error('That logical operation is not available in the pinned Evaluate schema.');
            const source = new SourceBuffer(document.getText()), original: any = source.json();
            const assessment = original?.assessment;
            if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) throw new Error('The Assessment root is not an editable mapping.');
            if (!assessment.tests || typeof assessment.tests !== 'object' || Array.isArray(assessment.tests) ||
                !Object.prototype.hasOwnProperty.call(assessment.tests, message.testId))
              throw new Error('Choose an authored Test from this Assessment.');
            const evaluate = assessment.evaluate;
            if (evaluate && typeof evaluate === 'object' && !Array.isArray(evaluate) && Object.prototype.hasOwnProperty.call(evaluate, 'if'))
              throw new Error('This Assessment uses a conditional Evaluate tree. Edit its if/then/else branches in YAML; the Add Test wizard does not change conditional roots.');
            const testExpression = { test: message.testId } as any;
            let edit: any;
            if (evaluate === undefined) {
              edit = insertAssessmentSection(source, 'evaluate', { [message.operation]: [testExpression] } as any, currentRevision);
            } else if (evaluate && typeof evaluate === 'object' && !Array.isArray(evaluate) &&
                       Object.keys(evaluate).length === 1 && evaluate[message.operation] && Array.isArray(evaluate[message.operation])) {
              edit = source.insertArrayItem(['assessment', 'evaluate', message.operation], testExpression, currentRevision);
            } else {
              // Preserve an existing direct Test, conditional, or differently
              // grouped expression by making it one branch of the selected
              // schema-defined logical operator.
              edit = source.replacePathValue(['assessment', 'evaluate'], { [message.operation]: [evaluate, testExpression] } as any, currentRevision);
            }
            const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
            const before = pack.validate(schemaUri, original);
            const afterDocument = edit.document.json();
            const after = pack.validate(schemaUri, afterDocument);
            const introduced = after.filter((error: string) => !before.includes(error));
            if (introduced.length) throw new Error('The pinned schema rejected this Evaluate edit: ' + introduced.join('; '));
            await applySourceWorkspaceEdit(api, document, edit);
            panel.webview.postMessage({ type: 'status', message: 'Added Test "' + message.testId + '" to Evaluate using ' + message.operation + '. Native Undo/Redo remains available.' });
            return;
          }
          if (message.action === 'removeField') {
            const fieldKind = message.fieldKind === 'require' ? 'require' : message.fieldKind === 'object' ? 'object' : message.fieldKind === 'filter' ? 'filter' : undefined;
            if (!fieldKind) throw new Error('Unknown field editing context.');
            const source = new SourceBuffer(document.getText()), original = source.json();
            const rootPath = Array.isArray(message.path) ? message.path : [];
            const fieldPath = Array.isArray(message.fieldPath) ? message.fieldPath : [];
            if (fieldPath.some((part: unknown) =>
              (typeof part !== 'string' && !(typeof part === 'number' && Number.isInteger(part)))))
              throw new Error('Invalid field path.');
            const startsWith = (candidate: (string | number)[], prefix: (string | number)[]) =>
              candidate.length >= prefix.length && prefix.every((part, index) => candidate[index] === part);
            let label: string;
            if (fieldKind === 'require') {
              if (rootPath.length !== 4 || rootPath[0] !== 'assessment' || rootPath[1] !== 'tests' ||
                  typeof rootPath[2] !== 'string' || rootPath[3] !== 'require')
                throw new Error('Require field removal is available only from a Test Require form.');
              if (!startsWith(fieldPath, rootPath) || fieldPath.length < rootPath.length + 2)
                throw new Error('The requested Require field is outside this Test Require form.');
              const relative = fieldPath.slice(rootPath.length);
              const fieldsIndex = relative.lastIndexOf('fields');
              // A predicate may be nested below and/or/one/xor branches, but the
              // field being removed must be the direct member of that predicate's
              // fields mapping—not a requirement or metadata member.
              if (fieldsIndex < 0 || fieldsIndex !== relative.length - 2 ||
                  typeof relative.at(-1) !== 'string' ||
                  relative.slice(0, fieldsIndex).some((part: string | number, index: number) =>
                    index % 2 === 0
                      ? !['and', 'or', 'one', 'xor'].includes(String(part))
                      : !(typeof part === 'number' && Number.isInteger(part) && part >= 0)))
                throw new Error('Choose an authored field from a Require predicate.');
              const fieldsPath = fieldPath.slice(0, -1);
              const fields = valueAtPathForGraphical(original, fieldsPath);
              const fieldName = String(fieldPath.at(-1));
              if (!fields || typeof fields !== 'object' || Array.isArray(fields) ||
                  !Object.prototype.hasOwnProperty.call(fields, fieldName))
                throw new Error('The requested Require field is not an authored fields member.');
              label = 'Require field';
            } else if (fieldKind === 'filter') {
              const isSharedFilterInclude = rootPath.length === 6 && rootPath[0] === 'assessment' &&
                rootPath[1] === 'shared_objects' && typeof rootPath[2] === 'string' &&
                rootPath[3] === 'filters' && typeof rootPath[4] === 'number' &&
                rootPath[5] === 'include';
              if (!isSharedFilterInclude || !startsWith(fieldPath, rootPath) ||
                  fieldPath.length !== rootPath.length + 1 || typeof fieldPath.at(-1) !== 'string')
                throw new Error('Filter field removal is available only for direct Shared Object Filter include members.');
              const fieldName = String(fieldPath.at(-1));
              const include = valueAtPathForGraphical(original, rootPath);
              if (!include || typeof include !== 'object' || Array.isArray(include) ||
                  !Object.prototype.hasOwnProperty.call(include, fieldName))
                throw new Error('The requested Filter include member is not authored.');
              label = 'Filter include field';
            } else {
              const isInlineTestObject = rootPath.length === 4 && rootPath[0] === 'assessment' &&
                rootPath[1] === 'tests' && typeof rootPath[2] === 'string' && rootPath[3] === 'object';
              const isSharedObject = rootPath.length === 3 && rootPath[0] === 'assessment' &&
                rootPath[1] === 'shared_objects' && typeof rootPath[2] === 'string';
              if (!isInlineTestObject && !isSharedObject)
                throw new Error('Object field removal is available only from an inline Test Object or Shared Object form.');
              if (!startsWith(fieldPath, rootPath) || fieldPath.length !== rootPath.length + 1 ||
                  typeof fieldPath.at(-1) !== 'string')
                throw new Error('Choose a direct field from this Object form.');
              const fieldName = String(fieldPath.at(-1));
              const metadata = new Set(['capability', 'object_title', 'filters', 'set', 'for_each', 'traversal']);
              if (metadata.has(fieldName)) throw new Error('Object metadata is not removable from the field editor.');
              const object = valueAtPathForGraphical(original, rootPath);
              if (!object || typeof object !== 'object' || Array.isArray(object) ||
                  !Object.prototype.hasOwnProperty.call(object, fieldName))
                throw new Error('The requested Object field is not an authored direct member.');
              label = 'Object field';
            }
            const fieldName = String(fieldPath.at(-1));
            const confirmation = await api.window.showWarningMessage(
              'Remove ' + label + ' "' + fieldName + '" from the YAML document?',
              { modal: true }, 'Remove field');
            if (confirmation !== 'Remove field') return;
            const pack = this.getPack();
            if (!pack) throw new Error('The verified offline schema pack is required for field edits.');
            const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
            const before = pack.validate(schemaUri, original);
            const edit = source.removePath(fieldPath, currentRevision);
            const errors = pack.validate(schemaUri, edit.document.json());
            const introduced = errors.filter((error: string) => !before.includes(error));
            if (introduced.length)
              throw new Error('Removing this field would invalidate the Assessment: ' + introduced.join('; '));
            await applySourceWorkspaceEdit(api, document, edit);
            return;
          }
          if (message.action === 'renameMember') {
            const mappingPath = Array.isArray(message.mappingPath) ? message.mappingPath : [];
            const oldKey = typeof message.oldKey === 'string' ? message.oldKey : '';
            const isRequireFields = mappingPath.length >= 2 && mappingPath[0] === 'assessment' &&
              mappingPath.at(-1) === 'fields' && mappingPath.includes('require');
            const isSharedFilterInclude = mappingPath.length === 6 && mappingPath[0] === 'assessment' &&
              mappingPath[1] === 'shared_objects' && typeof mappingPath[2] === 'string' &&
              mappingPath[3] === 'filters' && typeof mappingPath[4] === 'number' && mappingPath[5] === 'include';
            if ((!isRequireFields && !isSharedFilterInclude) || !oldKey)
              throw new Error('Only authored Require fields and Shared Object Filter include members can be renamed graphically.');
            const source = new SourceBuffer(document.getText());
            const original = source.json();
            const mapping = valueAtPathForGraphical(original, mappingPath);
            if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
                !Object.prototype.hasOwnProperty.call(mapping, oldKey))
              throw new Error('The selected Require field no longer exists.');
            const pack = this.getPack();
            if (!pack) throw new Error('The verified offline schema pack is required for field edits.');
            const locations = genericSchemaLocations(pack, mappingPath, original);
            const staticKeys = new Set(schemaPropertyEntries(pack, locations).keys());
            if (staticKeys.has(oldKey) || !schemaDynamicPropertyLocations(pack, locations, oldKey).length)
              throw new Error('The selected member is not a schema-authorized dynamic field.');
            const newKey = await api.window.showInputBox({
              prompt: (isSharedFilterInclude ? 'Rename Filter include field "' : 'Rename Require field "') + oldKey + '"', value: oldKey,
              validateInput: (candidate: string) => candidate !== oldKey &&
                !Object.prototype.hasOwnProperty.call(mapping, candidate) &&
                schemaDynamicPropertyLocations(pack, locations, candidate).length
                  ? undefined : 'Use a new member name accepted by the pinned schema.'
            });
            if (!newKey) return;
            const before = pack.validate(pinnedSchemaUri(pack, 'assessment.schema.json'), original);
            const edit = source.editMappingKey(mappingPath, oldKey, newKey, currentRevision);
            const errors = pack.validate(pinnedSchemaUri(pack, 'assessment.schema.json'), edit.document.json());
            const introduced = errors.filter((error: string) => !before.includes(error));
            if (introduced.length) throw new Error('Renaming this dynamic field would invalidate the Assessment: ' + introduced.join('; '));
            await applySourceWorkspaceEdit(api, document, edit);
            return;
          }
          if (message.action === 'removeMember') {
            if (!path.length || path[0] !== 'assessment') throw new Error('Only authored Assessment members can be removed graphically.');
            const source = new SourceBuffer(document.getText());
            const original = source.json();
            const selected = valueAtPathForGraphical(original, path);
            if (selected === undefined) throw new Error('The selected schema member no longer exists.');
            const parent = valueAtPathForGraphical(original, path.slice(0, -1));
            if (!parent || typeof parent !== 'object') throw new Error('The selected member has no editable parent mapping or sequence.');
            const pack = this.getPack();
            if (!pack) throw new Error('The verified offline schema pack is required for structural edits.');
            const label = String(path.at(-1));
            const confirmation = await api.window.showWarningMessage(
              `Remove schema member "${label}" from the YAML document?`, { modal: true }, 'Remove member');
            if (confirmation !== 'Remove member') return;
            const edit = source.removePath(path, currentRevision);
            validateGraphicalSchemaEdit(pack, original, edit, `removing ${label}`);
            await applySourceWorkspaceEdit(api, document, edit);
            return;
          }
          if (message.action === 'rename' || message.action === 'remove') {
            const collections = new Set(['tests', 'variables', 'inputs', 'shared_objects']);
            if (path.length !== 3 || path[0] !== 'assessment' ||
                !collections.has(String(path[1])) || typeof path[2] !== 'string')
              throw new Error('This action is available only for named Tests, Variables, Organizational Inputs and Shared Objects.');
            const collection = String(path[1]), oldId = String(path[2]);
            const entity = structuralEntityName(collection);
            const source = new SourceBuffer(document.getText()), original = source.json();
            const pack = this.getPack();
            if (!pack) throw new Error('The verified offline schema pack is required for structural edits.');
            const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
            const schema: any = pack.resource(schemaUri).properties?.assessment?.properties?.[collection];
            const rule: any = schema?.propertyNames;
            if (!rule?.pattern) throw new Error('The pinned schema does not define the naming rules for ' + entity + '.');
            const referenceKind: ReferenceKind = collection === 'tests' ? 'test' :
              collection === 'variables' ? 'variable' : collection === 'inputs' ? 'input' : 'shared-object';
            const analysis = analyzeAssessmentReferences((original as any)?.assessment);
            const references = analysis.referencesTo(referenceKind, oldId);
            const referenceLabels = references.map(referencePathLabel);
            const before = pack.validate(schemaUri, original);
            if (message.action === 'rename') {
              const namePattern = new RegExp(rule.pattern), max = rule.maxLength ?? 64;
              const newId = await api.window.showInputBox({
                prompt: 'Rename ' + entity + ' ID "' + oldId + '"',
                value: oldId,
                validateInput: (value: string) => namePattern.test(value) && value.length <= max
                  ? undefined : 'The ' + entity + ' ID must match its schema naming rule (maximum ' + max + ' characters).'
              });
              if (!newId || newId === oldId) return;
              // References are rewritten only at schema-authorized typed paths;
              // literals equal to an ID remain untouched. SourceBuffer verifies
              // all ranges first and applies the key plus references atomically.
              const edit = source.renameDefinitionAndReferences(path, references.map(reference => reference.path), oldId, newId, currentRevision);
              const errors = pack.validate(schemaUri, edit.document.json());
              if (errors.length > before.length)
                throw new Error('Renaming the ' + entity + ' would introduce validation errors: ' + errors.join('; '));
              await applySourceWorkspaceEdit(api, document, edit);
              if (references.length) void panel.webview.postMessage({ type: 'status',
                message: 'Renamed ' + entity + ' and updated ' + references.length + ' typed reference' + (references.length === 1 ? '' : 's') + '.' });
              else if (errors.length) void panel.webview.postMessage({ type: 'status',
                message: 'Renamed ' + entity + ' ID; pre-existing schema diagnostics remain.' });
              return;
            }
            // Deletion is deliberately fail-closed. Unlike rename, there is no
            // safe local replacement for a dangling reference and no implicit
            // Evaluate/Variable/Input rewrite is allowed.
            if (references.length) throw new Error('Cannot remove ' + entity + ' "' + oldId +
              '" because it is referenced at ' + referenceLabels.slice(0, 3).join(', ') +
              (referenceLabels.length > 3 ? ', …' : '') + '. Remove or update those references explicitly in YAML first.');
            const confirmation = await api.window.showWarningMessage(
              'Remove ' + entity + ' "' + oldId + '"? This deletes its entire definition from YAML.',
              { modal: true }, 'Remove ' + entity);
            if (confirmation !== 'Remove ' + entity) return;
            const edit = source.removePath(path, currentRevision);
            const errors = pack.validate(schemaUri, edit.document.json());
            if (errors.length > before.length)
              throw new Error('Removing ' + entity + ' would invalidate the Assessment: ' + errors.join('; '));
            await applySourceWorkspaceEdit(api, document, edit);
            return;
          }
          if (message.action === 'duplicate') {
            const collections = new Set(['tests', 'variables', 'inputs', 'shared_objects']);
            if (path.length !== 3 || path[0] !== 'assessment' || !collections.has(String(path[1])) || typeof path[2] !== 'string')
              throw new Error('Duplicate applies only to named Tests, Variables, Organizational Inputs and Shared Objects. A Test has one Object. For multiple Object populations, use an Object Set or separate Tests.');
            const pack = this.getPack();
            if (!pack) throw new Error('A verified offline metadata pack is needed for safe duplication.');
            const collection = String(path[1]), oldKey = String(path[2]);
            const source = new SourceBuffer(document.getText()); const doc = source.json();
            const value = valueAtPathForGraphical(doc, path);
            if (value === undefined) throw new Error('The selected named definition does not exist.');
            const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
            const spec: any = pack.resource(schemaUri).properties?.assessment?.properties?.[collection];
            const rule: any = spec?.propertyNames;
            if (!rule?.pattern) throw new Error('The pinned schema has no naming rule for this collection.');
            const allowed = new RegExp(rule.pattern);
            const suffix = collection === 'tests' ? 'test' : collection === 'variables' ? 'variable' : collection === 'inputs' ? 'input' : 'object';
            const stem = oldKey.endsWith('-' + suffix) ? oldKey.slice(0, -suffix.length - 1) : oldKey;
            const max = rule.maxLength ?? 64, postfix = '-copy-' + suffix;
            const suggested = stem.slice(0, Math.max(1,max-postfix.length)).replace(/-+$/, '') + postfix;
            const newKey = await api.window.showInputBox({
              prompt: 'Duplicate ' + collection.replaceAll('_',' ') + ' "' + oldKey + '" as a new named definition',
              value: suggested,
              validateInput: (name: string) => allowed.test(name) && name.length <= max
                ? undefined : 'Name must follow the pinned schema and end in -' + suffix + '.'
            });
            if (!newKey) return;
            const duplicate = source.insertMapEntry(path.slice(0,-1), newKey, value, currentRevision);
            const errors = pack.validate(schemaUri, duplicate.document.json());
            if (errors.length) throw new Error('Pinned schema rejected the duplicated definition: ' + errors.join('; '));
            await applySourceWorkspaceEdit(api, document, duplicate);
            void panel.webview.postMessage({ type: 'status', message:
              'Duplicated ' + oldKey + ' as ' + newKey + (collection === 'tests' ? '. This Test is not automatically included in Evaluate.' : '.') });
            return;
          }
          if (message.action === 'add') {
            const beforeDocument = new SourceBuffer(document.getText()).json();
            const edit = await graphicalAdd(api, document, this.getPack(), path, currentRevision, message);
            if (edit) {
              // A field addition is a local Test Require/Object edit. Refuse
              // any accidental change to the authored Evaluate tree rather
              // than silently turning a referenced Test into an orphan.
              const afterDocument = edit.document.json();
              if (JSON.stringify(valueAtPathForGraphical(beforeDocument, ['assessment', 'evaluate'])) !==
                  JSON.stringify(valueAtPathForGraphical(afterDocument, ['assessment', 'evaluate'])))
                throw new Error('The field edit changed Assessment Evaluate references; no source was applied. Use native YAML to review the document.');
              await applySourceWorkspaceEdit(api, document, edit);
            }
            return;
          }
        } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type === 'editKey') {
        const currentRevision = sha256(document.getText());
        if (message.revision !== currentRevision || (message.version !== undefined && message.version !== document.version)) { panel.webview.postMessage({ type: 'error', message: 'Document changed before this edit was applied; refreshed the editor.' }); return send(); }
        try { const source = new SourceBuffer(document.getText()); const edit = source.editMappingKey(message.mappingPath, message.oldKey, message.newKey, currentRevision, message.allowedOperations); const pack = this.getPack(); if (pack) { const root = pack.manifest.resources.find((resource: any) => resource.kind === 'schema' && /\/assessment\.schema\.json$/.test(resource.uri))?.uri; const problems = root ? pack.validate(root, edit.document.json()) : []; if (problems.length) throw new Error(`Pinned schema rejected operation change: ${problems.join('; ')}`); } const workspaceEdit = new api.WorkspaceEdit(); workspaceEdit.replace(document.uri, new api.Range(document.positionAt(edit.range[0]), document.positionAt(edit.range[1])), edit.replacement); if (!await api.workspace.applyEdit(workspaceEdit)) throw new Error('VS Code declined the source edit'); } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); send(); } return;
      }
      if (message.type === 'variableExpressionChange') {
        try {
          const currentRevision = sha256(document.getText());
          if (message.revision !== currentRevision || (message.version !== undefined && message.version !== document.version))
            throw new Error('Document changed before this Variable edit; refresh and try again.');
          const path = Array.isArray(message.path) ? message.path : [];
          const source = new SourceBuffer(document.getText());
          const authored: any = source.json();
          const currentExpression = valueAtPathForGraphical(authored, path);
          if (!variableExpressionPath(path, currentExpression)) throw new Error('Select a native Variable expression to change.');
          const pack = this.getPack();
          if (!pack) throw new Error('The verified offline schema pack is required for Variable expression edits.');
          const allowed = variableExpressionOperations(pack).map(option => option.value);
          if (typeof message.operation !== 'string' || !allowed.includes(message.operation))
            throw new Error('That operation is not present in the pinned native Variable schema.');
          const variableId = String(path[2]);
          const expression = variableExpressionTemplate(message.operation, authored.assessment, variableId);
          const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
          const before = pack.validate(schemaUri, authored);
          const edit = source.replaceExpression(path, expression, currentRevision, path.slice(0, 3));
          const after = pack.validate(schemaUri, edit.document.json());
          const introduced = after.filter((error: string) => !before.includes(error));
          if (introduced.length) throw new Error('Pinned schema rejected the new Variable expression: ' + introduced.join('; '));
          await applySourceWorkspaceEdit(api, document, edit);
          panel.webview.postMessage({ type: 'status', message: 'Variable expression changed. Native Undo/Redo remains available; review any unresolved placeholder references.' });
        } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); send(); }
        return;
      }
      if (message.type === 'variableConcatAdd' || message.type === 'variableConcatRemove') {
        try {
          const currentRevision = sha256(document.getText());
          if (message.revision !== currentRevision || (message.version !== undefined && message.version !== document.version))
            throw new Error('Document changed before this Variable edit; refresh and try again.');
          const path = Array.isArray(message.path) ? message.path : [];
          const source = new SourceBuffer(document.getText());
          const authored: any = source.json();
          const expression = valueAtPathForGraphical(authored, path);
          const operands = expression?.concat;
          if (!Array.isArray(operands)) throw new Error('Select a native concat expression.');
          let edit: any;
          if (message.type === 'variableConcatAdd') {
            edit = source.insertArrayItem(path.concat('concat'), { literal: '' } as any, currentRevision);
          } else {
            const index = Number(message.index);
            if (!Number.isInteger(index) || index < 0 || index >= operands.length) throw new Error('That concat component no longer exists.');
            if (operands.length <= 2) throw new Error('A native concat requires at least two components.');
            edit = source.removePath(path.concat('concat', index), currentRevision);
          }
          const pack = this.getPack();
          if (!pack) throw new Error('The verified offline schema pack is required for Variable expression edits.');
          const schemaUri = pinnedSchemaUri(pack, 'assessment.schema.json');
          const before = pack.validate(schemaUri, authored);
          const after = pack.validate(schemaUri, edit.document.json());
          const introduced = after.filter((error: string) => !before.includes(error));
          if (introduced.length) throw new Error('Pinned schema rejected this concat edit: ' + introduced.join('; '));
          await applySourceWorkspaceEdit(api, document, edit);
        } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); send(); }
        return;
      }
      if (message.type !== 'edit' || !Array.isArray(message.path)) return;
      try {
        const currentRevision = sha256(document.getText());
        if (message.revision !== currentRevision || (message.version !== undefined && message.version !== document.version)) {
          panel.webview.postMessage({ type: 'error', message: 'Document changed before this edit was applied; refreshed the Structured view.' });
          return send();
        }
        const source = new SourceBuffer(document.getText());
        const edit = source.editScalar(message.path, message.value, currentRevision);
        const pack = this.getPack();
        if (!pack) throw new Error('The verified offline schema pack is required for graphical scalar edits.');
        validateGraphicalSchemaEdit(pack, source.json(), edit, 'the scalar edit');
        const workspaceEdit = new api.WorkspaceEdit();
        workspaceEdit.replace(document.uri, new api.Range(document.positionAt(edit.range[0]), document.positionAt(edit.range[1])), edit.replacement);
        if (!await api.workspace.applyEdit(workspaceEdit)) throw new Error('VS Code declined the source edit');
      } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); send(); }
    };
    const onMessage = panel.webview.onDidReceiveMessage((message: any) => {
      // Serialize all webview edits. A second event must not apply against the first event's stale model.
      editQueue = editQueue.then(() => applyMessage(message), () => applyMessage(message));
    });
    const onChange = api.workspace.onDidChangeTextDocument((event: any) => { if (event.document.uri.toString() === document.uri.toString()) send(); });
    const onSelection = api.window.onDidChangeTextEditorSelection?.((event: any) => {
      if (event.textEditor?.document?.uri?.toString() !== document.uri.toString()) return;
      const active = event.selections?.[0]?.active; if (!active) return;
      const offset = document.offsetAt(active); const model = assessmentEditorModel(document, this.getPack());
      const match = model.fields?.find((field: any) => { try { const range = new SourceBuffer(document.getText()).scalarRange(field.path); return offset >= range[0] && offset <= range[1]; } catch { return false; } });
      if (match) panel.webview.postMessage({ type: 'selectGraphical', path: match.path, testId: match.path[0] === 'assessment' && match.path[1] === 'tests' ? match.path[2] : undefined });
    });
    panel.onDidDispose(() => { onMessage.dispose(); onChange.dispose(); onSelection?.dispose?.(); });
    send();
  }
}

const INDEX_WORKERS = 8;

function pathWithinIndexedRoot(path: string, root: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/, '');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/+$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/');
}

/** Index SCAP-NG YAML files from either the open workspace or a user-selected folder. */
async function indexContentLocation(index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, folderUri?: any, onBenchmarkIndexed?: () => void, state?: BenchmarkContextState) {
  if (!api.workspace.findFiles || !api.workspace.openTextDocument) return 0;
  const patterns = workspaceIndexPatterns;
  const relativePattern = folderUri && api.RelativePattern
    ? (pattern: string) => new api.RelativePattern(folderUri, pattern)
    : (pattern: string) => folderUri ? `${folderUri.fsPath ?? folderUri}/${pattern}` : pattern;
  const findFiles = async (patternsToFind: readonly string[]) =>
    (await Promise.all(patternsToFind.map(pattern => api.workspace.findFiles(relativePattern(pattern), '**/{node_modules,.git}/**')))).flat();
  const benchmarkPatterns = patterns.filter(pattern => /benchmark\.ya?ml$/i.test(pattern));
  const remainingPatterns = patterns.filter(pattern => !benchmarkPatterns.includes(pattern));
  const decoder = new TextDecoder();
  const readFiles = async (batch: readonly any[]) => {
    const entries: { uri: string; text: string; path: string }[] = []; let cursor = 0;
    const worker = async () => {
      while (cursor < batch.length) {
        const uri = batch[cursor++];
        try {
          // Read large corpora through the filesystem API rather than opening
          // every YAML file as a VS Code TextDocument.
          const bytes = await api.workspace.fs?.readFile?.(uri);
          const text = bytes ? decoder.decode(bytes) : (await api.workspace.openTextDocument(uri)).getText();
          entries.push({ uri: uri.toString(), text, path: uri.fsPath });
        } catch { /* unreadable files remain outside the index */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(INDEX_WORKERS, batch.length) }, worker));
    return entries;
  };
  // Benchmarks are the only information needed to populate the context
  // wizard. Find and index their small set of globs before even starting the
  // potentially expensive Rules/Assessments globs, so the wizard can become
  // useful while a large content root continues loading in the background.
  const benchmarkFound = await findFiles(benchmarkPatterns);
  const benchmarkFiles = [...new Map(benchmarkFound.map((uri: any) => [uri.toString(), uri])).values()];
  const benchmarkEntries = await readFiles(benchmarkFiles);
  await index.updateManyAsync(benchmarkEntries);
  publishIndexDiagnostics(index, indexDiagnostics, api);
  tree.refresh();
  onBenchmarkIndexed?.();
  const remainingFound = await findFiles(remainingPatterns);
  const files = [...new Map([...benchmarkFiles, ...remainingFound].map((uri: any) => [uri.toString(), uri])).values()];
  const remainingFiles = files.filter((uri: any) => !benchmarkFiles.some((benchmark: any) => benchmark.toString() === uri.toString()));
  // A restored Benchmark selection identifies the only package needed by the
  // Home/source choosers. Do not parse every Benchmark in a large content
  // root (often tens of thousands of YAML files) before showing that package.
  // If no Benchmark is selected yet, leave the remaining corpus unopened;
  // the selection page shows identity only and hydration starts on selection.
  const selectedPackagePath = state?.activeKey
    ? benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey)?.packagePath
    : undefined;
  const scopedRemainingFiles = selectedPackagePath
    ? remainingFiles.filter((uri: any) => pathWithinIndexedRoot(uri.fsPath ?? uri.path ?? uri.toString(), selectedPackagePath))
    : [];
  const remainingEntries = await readFiles(scopedRemainingFiles);
  await index.updateManyAsync(remainingEntries);
  publishIndexDiagnostics(index, indexDiagnostics, api);
  tree.refresh();
  return files.length;
}

async function indexWorkspace(index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, onBenchmarkIndexed?: () => void, state?: BenchmarkContextState) {
  return indexContentLocation(index, tree, api, indexDiagnostics, undefined, onBenchmarkIndexed, state);
}

async function indexSelectedContentFolder(index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, folderUri: any, onBenchmarkIndexed?: () => void, state?: BenchmarkContextState) {
  return indexContentLocation(index, tree, api, indexDiagnostics, folderUri, onBenchmarkIndexed, state);
}

async function indexWorkspaceAndImportedRoots(index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, state: BenchmarkContextState) {
  let count = await indexWorkspace(index, tree, api, indexDiagnostics, () => state.onChange?.(), state);
  for (const root of state.importedRoots) {
    if (!api.Uri?.file) continue;
    count += await indexSelectedContentFolder(index, tree, api, indexDiagnostics, api.Uri.file(root), () => state.onChange?.(), state);
  }
  return count;
}

/** Re-read workspace/imported content so Home statistics reflect disk changes. */
async function refreshContentIndex(index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, state: BenchmarkContextState) {
  const previous = state.ready;
  if (previous) { try { await previous; } catch { /* a fresh refresh can recover from a failed prior scan */ } }
  state.indexing = true;
  const run = (async () => {
    return indexWorkspaceAndImportedRoots(index, tree, api, indexDiagnostics, state);
  })();
  state.ready = run.then(() => { loadAutomationMetadata(index, state.importedRoots); state.indexing = false; state.onChange?.(); }, error => { state.indexing = false; state.onChange?.(); throw error; });
  return run;
}

function publishIndexDiagnostics(index: WorkspaceIndex, diagnostics: vscode.DiagnosticCollection, api: any) {
  const grouped = new Map<string, vscode.Diagnostic[]>();
  for (const diagnostic of index.diagnostics()) {
    const severity = diagnostic.severity === 'error' ? api.DiagnosticSeverity.Error : api.DiagnosticSeverity.Warning;
    const existing = grouped.get(diagnostic.uri) ?? [];
    existing.push(new api.Diagnostic(new api.Range(0, 0, 0, 1), diagnostic.message, severity)); grouped.set(diagnostic.uri, existing);
  }
  diagnostics.clear();
  for (const [uri, values] of grouped) diagnostics.set(api.Uri.parse(uri), values);
}
function isAutomationMetadataPath(value: string): boolean { return /[\\/]\.scap-ng[\\/]automation-dispositions\.ya?ml$/i.test(value); }

function loadAutomationMetadata(index: WorkspaceIndex, importedRoots: readonly string[]) {
  const values = new Map<string, AutomationDisposition | undefined>();
  for (const rule of index.byKind('rule')) values.set(rule.uri, undefined);
  for (const context of benchmarkContexts(index, importedRoots)) {
    const dispositions = readAutomationDispositions(context.packagePath);
    for (const rule of context.rules) {
      const entry = rule.id ? dispositions.get(rule.id) : undefined;
      if (entry && index.get(rule.uri)?.sourceHash === entry.source_hash) values.set(rule.uri, entry.disposition);
    }
  }
  index.setAutomationDispositions(values);
}

async function updateRuleAutomationDisposition(index: WorkspaceIndex, state: BenchmarkContextState, uri: string, disposition: AutomationDisposition | undefined, sourceHash: string) {
  const rule = index.get(uri);
  if (!rule || rule.kind !== 'rule' || !rule.id) throw new Error('The selected Rule is not indexed; refresh Benchmark data and try again.');
  const contexts = benchmarkContexts(index, state.importedRoots);
  // Prefer the selected Benchmark package that actually contains this Rule.
  // This remains reliable for imported roots whose layout is not the normal
  // direct-slice path and avoids writing metadata beside the wrong package.
  const context = contexts.find(candidate => candidate.rules.some(item => item.uri === uri))
    ?? benchmarkContextForKey(contexts, state.activeKey);
  const packagePath = context?.packagePath ?? packageRootForPath(rule.path);
  if (!packagePath) throw new Error('The selected Rule is not associated with a Benchmark package.');
  const entries = readAutomationDispositions(packagePath);
  if (disposition) entries.set(rule.id, { disposition, source_hash: sourceHash, reviewed_at: new Date().toISOString() });
  else entries.delete(rule.id);
  writeAutomationDispositions(packagePath, entries);
  // Fail loudly if the sidecar could not be read back. The Rule YAML remains
  // authoritative; this metadata is intentionally editor-only and must never
  // appear to save successfully when persistence failed.
  const persisted = readAutomationDispositions(packagePath).get(rule.id);
  if (disposition && (!persisted || persisted.disposition !== disposition || persisted.source_hash !== sourceHash)) throw new Error(`Could not persist Rule metadata at ${automationMetadataPath(packagePath)}.`);
  index.setAutomationDisposition(uri, disposition);
  state.onChange?.();
  for (const listener of state.refreshListeners) listener();
  return automationMetadataPath(packagePath);
}

async function updateIndexedUri(index: WorkspaceIndex, uri: any, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, state?: BenchmarkContextState) {
  try { const document = await api.workspace.openTextDocument(uri); if (!isAutomationMetadataPath(uri.fsPath ?? '')) index.update(uri.toString(), document.getText(), uri.fsPath); if (state) loadAutomationMetadata(index, state.importedRoots); publishIndexDiagnostics(index, indexDiagnostics, api); tree.refresh(); state?.onChange?.(); } catch { /* file may have been removed between watcher events */ }
}

function optionHtml(options: readonly { value: string; label: string; description?: string }[]) { return options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join(''); }
function guidedHtml(catalog: GuidedCatalog, applicabilityOptions: readonly ApplicabilityOption[] = [], activeContextLabel = '') {
  const applicabilityOptionHtml = applicabilityOptions.filter(option => option.available).map(option => `<option value="${escapeHtml(option.key)}">${escapeHtml(option.label)}</option>`).join('');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-guided';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;max-width:900px}fieldset{border:1px solid var(--vscode-panel-border);margin:12px 0;padding:12px}legend{font-weight:600}label{display:block;margin:9px 0}input,select,textarea{display:block;width:100%;box-sizing:border-box;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:6px}input[type=checkbox]{display:inline;width:auto}textarea{min-height:64px;font-family:var(--vscode-editor-font-family)}.row{display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:8px;margin:8px 0;align-items:end}.row label{margin:0}.hint{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.explanation{border-left:3px solid var(--vscode-textLink-foreground);padding:8px}.summary{border-left:3px solid var(--vscode-textLink-foreground);padding:8px;margin:10px 0}.advanced{border-top:1px solid var(--vscode-panel-border);margin-top:12px;padding-top:8px}button{padding:7px 12px}.unsupported{color:var(--vscode-descriptionForeground);font-style:italic}</style></head><body><h1>Guided Assessment authoring</h1><p class="hint">Answer the policy question first. Exact YAML keywords remain available in the Graphical editor and native YAML editor. Platform is an authoring context only; it does not assert CPE applicability.</p><p id="status" role="status"></p><fieldset><legend>Authoring workflow</legend><label for="workflow">How would you like to start?<select id="workflow"><option value="guided">Build from structured questions</option><option value="assisted">Paste check text (offline best guess)</option></select></label><p class="hint">The assisted path is deterministic and offline. It never calls AI or claims scanner results.</p></fieldset><fieldset id="guidedPurpose"><legend>1. Assessment purpose</legend><label for="platform">Target platform<select id="platform">${optionHtml(catalog.platforms())}</select></label><label for="mode">Assessment mode<select id="mode">${optionHtml(catalog.modes())}</select></label><label for="className">Assessment class<select id="className">${optionHtml(catalog.classes())}</select></label><label for="id">Assessment ID<input id="id" value="guided-assessment"></label><label for="title">Security requirement<input id="title" placeholder="What security requirement should be checked?"></label><label for="procedure">Manual procedure<textarea id="procedure">Review the target according to the documented procedure.</textarea></label><div id="manualResponse"><p class="hint">Manual responses are author-defined choices, not scanner results.</p><label for="responseType">Response contract name<input id="responseType" value="manual-review"></label><div class="row"><label>Value<input id="choice1Value" value="yes"></label><label>Label<input id="choice1Label" value="Yes"></label><label>Outcome<select id="choice1Outcome"><option>true</option><option>false</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><div class="row"><label>Value<input id="choice2Value" value="no"></label><label>Label<input id="choice2Label" value="No"></label><label>Outcome<select id="choice2Outcome"><option>false</option><option>true</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><label><input id="allowComment" type="checkbox" checked> Allow reviewer comment</label><label><input id="allowEvidence" type="checkbox" checked> Allow evidence attachment</label></div></fieldset><fieldset id="guidedEvidence"><legend>2. What evidence should be collected?</legend><label for="capability">Evidence collection capability<select id="capability">${optionHtml(catalog.capabilities())}</select></label><p id="capabilityHelp" class="hint"></p><div id="objectRequirements" class="hint" aria-live="polite"></div><div id="objectFields"></div><details class="advanced"><summary>Advanced source fields</summary><p class="unsupported">This slice exposes the schema-declared primary selector fields. Advanced Objects, Variables and dependent sources remain available through the native YAML editor without being discarded.</p></details><legend>3. What counts as sufficient evidence?</legend><label for="testId">Test ID<input id="testId" value="guided-test"></label><label for="testTitle">Human-readable Test summary<input id="testTitle" placeholder="Generated summary; editable before save"></label><label for="itemsFound">Collected Items found<select id="itemsFound">${optionHtml(catalog.itemFound())}</select></label><label id="itemsSatisfyingLabel" for="itemsSatisfying">Selected Items satisfying condition<select id="itemsSatisfying">${optionHtml(catalog.itemsSatisfying())}</select></label><label id="valuesFoundLabel" for="valuesFound">Field values found<select id="valuesFound">${optionHtml(catalog.fieldValuesFound())}</select></label><label id="valuesMatchingLabel" for="valuesMatching">Field values matching<select id="valuesMatching">${optionHtml(catalog.fieldValuesMatching())}</select></label><label><input id="presenceOnly" type="checkbox"> Presence-only check (no field comparison)</label><div id="comparisonFields"></div><button id="addField" type="button">Add comparison field</button><div id="summary" class="summary" aria-live="polite"></div><p class="hint">This Guided slice creates one Test. Add additional authored Tests to Evaluate from the Graphical editor with its schema-driven Test/logic wizard.</p></fieldset><fieldset id="applicabilitySection"><legend>Applicability (optional; can be added later)</legend><p class="hint">Leave this blank while designing the requirement. Add an existing shared applicability Assessment only when you know the requirement is target-specific; it can also be added later in the Graphical editor.</p><p id="benchmarkContextStatus" class="hint" aria-live="polite">${activeContextLabel ? `Benchmark context selected from the Welcome screen: ${escapeHtml(activeContextLabel)}.` : 'No Benchmark root is selected. Existing applicability choices are unavailable; select a Benchmark root from Home before linking one, or continue as a standalone Assessment.'}</p><label for="applicability">Existing applicability condition<select id="applicability"><option value="">No applicability condition selected</option>${applicabilityOptionHtml}</select></label><p class="hint">If the needed condition is not listed, continue without it and add the companion applicability Assessment later.</p></fieldset><button id="guidedCreate">Create Assessment</button><fieldset id="assistedInputs" hidden><legend>Assisted Assessment draft</legend><p class="explanation">Paste the human-readable check/procedure text. A Rule title is optional; when omitted, the editor infers a title from the check text. The copied check text drives best-guess inference; applicability is handled after the draft is generated. If the text contains branches, the draft identifies the applicability Assessments that still need to be linked.</p><label for="assistedCheckText">Check text<textarea id="assistedCheckText" placeholder="Paste the STIG check/procedure text here."></textarea></label><label for="assistedTitle">Rule title (optional)<input id="assistedTitle" placeholder="Leave blank to infer from check text"></label><button id="generateAssisted" type="button">Generate from check text</button></fieldset><script nonce="guided">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const status=$('status');let objectDefinitions=[];let objectRequirements=[];let resultDefinitions=[];function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function opts(items,selected){return items.map(x=>'<option value=\"'+esc(x.value)+'\" '+(x.value===selected?'selected':'')+'>'+esc(x.label||x.value)+'</option>').join('');}function renderObjectFields(fields,requirements){objectDefinitions=fields;objectRequirements=requirements||[];const requirementRoot=$('objectRequirements');requirementRoot.replaceChildren();if(objectRequirements.length>1){const text=document.createElement('p');text.textContent='Choose one complete item identity: '+objectRequirements.map(requirement=>requirement.fields.join(' + ')).join(' OR ')+'.';requirementRoot.append(text);}else if(objectRequirements.length===1){const text=document.createElement('p');text.textContent='Required item selectors: '+objectRequirements[0].fields.join(', ')+'.';requirementRoot.append(text);}const root=$('objectFields');root.replaceChildren();if(!fields.length){root.innerHTML='<p class="unsupported">No primary selector controls are available for this capability yet. Continue in Structured or the native YAML editor.</p>';return;}for(const f of fields){const row=document.createElement('div');row.className='row object-row';row.dataset.name=f.name;const label=document.createElement('label');label.textContent=f.label;label.title=f.description||'';const operation=document.createElement('select');operation.className='object-operation';const preferredOperation=f.operations.find(value=>value.value==='equals')?.value||f.operations[0]?.value;operation.innerHTML=opts(f.operations,preferredOperation);const value=document.createElement(f.enumValues?.length?'select':'input');value.className='object-value';if(f.enumValues?.length)value.innerHTML='<option value="">Choose '+esc(f.label.toLowerCase())+'</option>'+opts(f.enumValues.map(v=>({value:v,label:v})));else {value.placeholder='Enter '+f.label.toLowerCase();if(f.datatype==='integer'||f.datatype==='number')value.type='number';if(f.datatype==='boolean')value.type='checkbox';}row.append(label,operation,value);root.append(row);}}function renderComparisonFields(fields){resultDefinitions=fields;const root=$('comparisonFields');root.replaceChildren();addComparisonRow(fields[0]?.name||'');}function addComparisonRow(selected){const root=$('comparisonFields');const row=document.createElement('div');row.className='row field-row';const name=document.createElement('select');name.className='field-name';name.innerHTML=opts(resultDefinitions.map(f=>({value:f.name,label:f.label})),selected);const operation=document.createElement('select');operation.className='field-operation';operation.innerHTML=opts(resultDefinitions[0]?.operations||[],'equals');const datatype=document.createElement('select');datatype.className='field-datatype';datatype.innerHTML=opts((resultDefinitions.find(f=>f.name===selected)?.datatypes||['string']).map(v=>({value:v,label:v})),'string');const value=document.createElement('input');value.className='field-value';value.placeholder='Expected value';name.onchange=()=>{const definition=resultDefinitions.find(f=>f.name===name.value);operation.innerHTML=opts(definition?.operations||[],'equals');datatype.innerHTML=opts((definition?.datatypes||['string']).map(v=>({value:v,label:v})),definition?.datatype||'string');};const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(name,operation,datatype,value,remove);root.append(row);}function collectObject(){const object={};document.querySelectorAll('.object-row').forEach(row=>{const input=row.querySelector('.object-value');const value=input.type==='checkbox'?input.checked:input.value;if(value) object[row.dataset.name]={[row.querySelector('.object-operation').value]:value};});return object;}function objectRequirementError(object){if(!objectRequirements.length)return '';if(objectRequirements.some(requirement=>requirement.fields.every(name=>Object.hasOwn(object,name))))return '';if(objectRequirements.length===1)return 'Complete the required item selectors: '+objectRequirements[0].fields.join(', ')+'.';return 'Complete one item identity: '+objectRequirements.map(requirement=>requirement.fields.join(' + ')).join(' OR ')+'.';}function collectFields(){const fields={};document.querySelectorAll('.field-row').forEach(row=>{let value=row.querySelector('.field-value').value;if(value){const datatype=row.querySelector('.field-datatype').value;if(datatype==='integer')value=Number(value);else if(datatype==='boolean')value=value==='true';fields[row.querySelector('.field-name').value]={[row.querySelector('.field-operation').value]:value};}});return fields;}function updateSummary(){const cap=$('capability').selectedOptions[0]?.textContent||$('capability').value;const item=$('itemsFound').selectedOptions[0]?.textContent;const match=$('presenceOnly').checked?'presence only':($('itemsSatisfying').selectedOptions[0]?.textContent+' of selected Items');const field=$('presenceOnly').checked?'No field comparison':($('valuesMatching').selectedOptions[0]?.textContent+' of found values');$('summary').textContent=cap+': at least '+item+' Item(s) must exist; '+match+' must satisfy the condition; '+field+' must match.';}function refresh(){const automated=$('mode').value==='automated';$('guidedEvidence').hidden=!automated;$('manualResponse').hidden=automated;updateSummary();}$('mode').onchange=refresh;$('capability').onchange=()=>vscode.postMessage({type:'capability',value:$('capability').value});$('presenceOnly').onchange=()=>{const hidden=$('presenceOnly').checked;for(const id of ['itemsSatisfyingLabel','valuesFoundLabel','valuesMatchingLabel','comparisonFields','addField'])$(id).hidden=hidden;updateSummary();};$('itemsFound').onchange=updateSummary;$('itemsSatisfying').onchange=updateSummary;$('valuesMatching').onchange=updateSummary;$('addField').onclick=()=>addComparisonRow('');function refreshWorkflow(){const assisted=$('workflow').value==='assisted';$('guidedPurpose').hidden=assisted;$('guidedEvidence').hidden=assisted;$('applicabilitySection').hidden=assisted;$('guidedCreate').hidden=assisted;$('assistedInputs').hidden=!assisted;}$('workflow').onchange=refreshWorkflow;function renderApplicabilityOptions(options){const select=$('applicability');const selected=select.value;select.innerHTML='<option value="">No applicability condition selected</option>'+(options||[]).filter(option=>option.available).map(option=>'<option value="'+esc(option.key)+'">'+esc(option.label)+'</option>').join('');if([...select.options].some(option=>option.value===selected))select.value=selected;}function updateBenchmarkContextStatus(label){$('benchmarkContextStatus').textContent=label?'Benchmark context selected from the Welcome screen: '+label+'.':'No benchmark context selected; standalone authoring is fine.';}$('generateAssisted').onclick=()=>{vscode.postMessage({type:'assistedDraft',title:$('assistedTitle').value,checkText:$('assistedCheckText').value});};$('guidedCreate').onclick=()=>{try{const automated=$('mode').value==='automated';const message={type:'create',platform:$('platform').value,id:$('id').value,title:$('title').value,mode:$('mode').value,className:$('className').value,procedure:$('procedure').value,applicability:$('applicability').value||undefined};if(automated){const object=collectObject();const objectError=objectRequirementError(object);if(objectError){status.className='error';status.textContent=objectError;return;}message.tests=[{id:$('testId').value,title:$('testTitle').value,capability:$('capability').value,object,fields:collectFields(),presenceOnly:$('presenceOnly').checked}];}else{message.response={type:$('responseType').value,choices:[{value:$('choice1Value').value,label:$('choice1Label').value,outcome:$('choice1Outcome').value},{value:$('choice2Value').value,label:$('choice2Label').value,outcome:$('choice2Outcome').value}],allow_comment:$('allowComment').checked,allow_evidence:$('allowEvidence').checked};}vscode.postMessage(message);}catch(error){status.className='error';status.textContent=error.message;}};window.addEventListener('message',event=>{if(event.data.type==='objectFields')renderObjectFields(event.data.fields,event.data.requirements);if(event.data.type==='resultFields')renderComparisonFields(event.data.fields);if(event.data.type==='benchmarkContext'){renderApplicabilityOptions(event.data.applicability||[]);updateBenchmarkContextStatus(event.data.label);}if(event.data.ok!==undefined)status.className=event.data.ok?'':'error';if(event.data.message)status.textContent=event.data.message;});refresh();refreshWorkflow();vscode.postMessage({type:'capability',value:$('capability').value});</script></body></html>`;
}
interface BenchmarkContextState {
  activeKey?: string;
  authoringMode: 'benchmark' | 'standalone';
  importedRoots: string[];
  listeners: Set<(key: string | undefined) => void>;
  refreshListeners: Set<() => void>;
  indexing?: boolean;
  ready?: Promise<void>;
  persist?: () => void;
  onChange?: () => void;
}
function contextState(extensionContext?: vscode.ExtensionContext): BenchmarkContextState {
  const workspaceState: any = (extensionContext as any)?.workspaceState;
  const activeKey = typeof workspaceState?.get === 'function' ? workspaceState.get('scapNg.benchmarkContextKey') : undefined;
  const importedRoots = typeof workspaceState?.get === 'function' ? workspaceState.get('scapNg.importedContentRoots') : undefined;
  const savedMode = typeof workspaceState?.get === 'function' ? workspaceState.get('scapNg.authoringMode') : undefined;
  const authoringMode = savedMode === 'standalone' || savedMode === 'benchmark' ? savedMode : activeKey ? 'benchmark' : 'standalone';
  const state: BenchmarkContextState = {
    activeKey,
    authoringMode,
    importedRoots: Array.isArray(importedRoots) ? importedRoots.filter(root => typeof root === 'string') : [],
    listeners: new Set(),
    refreshListeners: new Set()
  };
  state.persist = extensionContext ? () => {
    void (extensionContext as any).workspaceState.update('scapNg.benchmarkContextKey', state.activeKey);
    void (extensionContext as any).workspaceState.update('scapNg.importedContentRoots', state.importedRoots);
    void (extensionContext as any).workspaceState.update('scapNg.authoringMode', state.authoringMode);
  } : undefined;
  return state;
}
function persistBenchmarkContext(state: BenchmarkContextState) { state.persist?.(); }
function selectBenchmarkContext(state: BenchmarkContextState, key: string | undefined) {
  state.activeKey = key;
  state.authoringMode = key ? 'benchmark' : 'standalone';
  persistBenchmarkContext(state);
  state.onChange?.();
  for (const listener of state.listeners) listener(key);
  for (const listener of state.refreshListeners) listener();
}
function setStandaloneMode(state: BenchmarkContextState) {
  state.authoringMode = 'standalone';
  persistBenchmarkContext(state);
  state.onChange?.();
  for (const listener of state.listeners) listener(undefined);
  for (const listener of state.refreshListeners) listener();
}
async function clearBenchmarkContext(api: any, state: BenchmarkContextState) {
  const choice = await api.window.showWarningMessage('Clear the saved Benchmark root and selected Benchmark? You can still create standalone Assessments.', { modal: true }, 'Clear Benchmark context');
  if (choice !== 'Clear Benchmark context') return;
  state.activeKey = undefined;
  state.authoringMode = 'standalone';
  state.importedRoots.splice(0, state.importedRoots.length);
  persistBenchmarkContext(state);
  state.onChange?.();
  for (const listener of state.listeners) listener(undefined);
  for (const listener of state.refreshListeners) listener();
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
function setImportedBenchmarkRoot(state: BenchmarkContextState, root: string) {
  state.importedRoots.splice(0, state.importedRoots.length, root);
  state.activeKey = undefined;
  state.authoringMode = 'standalone';
  persistBenchmarkContext(state);
}
async function promptForContentFolder(index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, state: BenchmarkContextState): Promise<string | undefined> {
  if (typeof api.window.showOpenDialog !== 'function') {
    await api.window.showWarningMessage('No Benchmark documents are indexed. Open a folder containing SCAP-NG Benchmarks or Assessments, then try Browse Benchmarks again.');
    return undefined;
  }
  const picked = await api.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Index Benchmarks',
    title: 'Select a folder containing SCAP-NG Benchmarks or Assessments'
  });
  const folder = picked?.[0];
  const root = folder?.fsPath;
  if (!root) return undefined;
  setImportedBenchmarkRoot(state, root);
  const indexFolder = () => indexSelectedContentFolder(index, tree, api, indexDiagnostics, folder, () => {
    state.onChange?.();
    for (const listener of state.refreshListeners) listener();
  });
  const count = api.window.withProgress
    ? await api.window.withProgress({ location: api.ProgressLocation?.Window ?? 10, title: 'Indexing selected SCAP-NG content…' }, indexFolder)
    : await indexFolder();
  state.onChange?.();
  for (const listener of state.refreshListeners) listener();
  if (!count) {
    await api.window.showWarningMessage(`No recognized Benchmark or Assessment YAML files were found in "${root}".`);
  }
  return root;
}
function benchmarkContextViewData(contexts: readonly BenchmarkContextSummary[]) {
  const contextLabels = benchmarkContextLabels(contexts);
  return contexts.map(context => ({
    key: context.key,
    label: contextLabels.get(context.key) ?? context.packagePath,
    packagePath: context.packagePath,
    benchmark: context.benchmark,
    profiles: context.profiles,
    ruleCount: context.ruleCount,
    assessmentCount: context.assessmentCount,
    applicabilityCount: context.applicabilityCount,
    conditionCount: context.conditionCount,
    rules: context.rules,
    assessments: context.assessments,
    applicability: context.applicability,
    conditions: context.conditions,
    automation: context.automation
  }));
}
function benchmarkContextHtml(contexts: readonly BenchmarkContextSummary[], activeKey?: string, focusSection?: string) {
  const contextLabels = benchmarkContextLabels(contexts);
  const data = benchmarkContextViewData(contexts);
  const options = contexts.map(context => `<option value="${escapeHtml(context.key)}"${context.key === activeKey ? ' selected' : ''}>${escapeHtml(contextLabels.get(context.key) ?? context.packagePath)}</option>`).join('');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-benchmark-context';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:18px;max-width:1100px}h1{margin-top:0;font-size:18px}.hint,.muted{color:var(--vscode-descriptionForeground)}select{width:100%;box-sizing:border-box;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}button{padding:6px 10px;margin:6px 6px 6px 0;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.banner,.card{border:1px solid var(--vscode-panel-border);padding:12px;margin:12px 0}.banner{border-left:4px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background)}.stats{display:grid;grid-template-columns:repeat(5,minmax(100px,1fr));gap:8px}.stat{border:1px solid var(--vscode-panel-border);padding:9px;text-align:left;font:inherit;color:var(--vscode-foreground);background:var(--vscode-editor-background);cursor:pointer}.stat:hover{border-color:var(--vscode-textLink-foreground)}.stat strong{display:block;font-size:18px}.stat span{font-size:11px;color:var(--vscode-descriptionForeground)}details{border-top:1px solid var(--vscode-panel-border);padding:8px 0}summary{cursor:pointer;font-weight:600}.items{max-height:360px;overflow:auto;margin-top:8px}.item{display:flex;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--vscode-panel-border)}.item button{margin:0;padding:3px 6px;white-space:nowrap}.item span{overflow-wrap:anywhere}.source-link{color:var(--vscode-textLink-foreground);text-decoration:underline;cursor:pointer}.path{font:11px var(--vscode-editor-font-family);color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}@media(max-width:700px){.stats{grid-template-columns:repeat(2,minmax(120px,1fr))}}</style></head><body><h1>SCAP-NG Benchmark context</h1><p class="hint">Switching context changes navigation and authoring suggestions only. It never rewrites YAML or turns platform metadata into an applicability claim.</p><label for="benchmark">Current benchmark</label><select id="benchmark"><option value="">No benchmark context</option>${options}</select><p id="status" class="muted" role="status"></p><section id="details" aria-live="polite"></section><script nonce="benchmark-context">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let contexts=${scriptJson(data)};const initialFocus=${scriptJson(focusSection)};function text(value){return String(value??'');}function add(parent,tag,value,className){const node=document.createElement(tag);if(className)node.className=className;node.textContent=text(value);parent.append(node);return node;}function sourceLink(uri,label){const link=document.createElement('a');link.className='source-link';link.href='#';link.textContent=label;link.title='Open source file for editing';link.onclick=event=>{event.preventDefault();vscode.postMessage({type:'open',uri});};return link;}function list(parent,title,items,assessment=false,section=''){const details=document.createElement('details');if(section)details.dataset.section=section;const summary=document.createElement('summary');summary.textContent=title+' ('+items.length+')';details.append(summary);const wrap=document.createElement('div');wrap.className='items';for(const item of items){const row=document.createElement('div');row.className='item';const sourceUri=item.sourceUri||item.uri;const label=item.name||item.title||item.id||'Source file';const body=document.createElement('span');if(sourceUri)body.append(sourceLink(sourceUri,label));else body.textContent=label;const metadata=[item.id&&('id: '+item.id),item.targetId&&('assessment: '+item.targetId),item.version!==undefined&&('version: '+item.version),item.disabledRuleCount!==undefined&&(item.disabledRuleCount+' disabled Rules')].filter(Boolean).join(' · ');if(metadata){const meta=document.createElement('span');meta.className='muted';meta.textContent=' · '+metadata;body.append(meta);}row.append(body);if(item.uri&&assessment){for(const mode of ['yaml','graphical']){const button=document.createElement('button');button.className='secondary';button.type='button';button.textContent=mode==='yaml'?'YAML':'Graphical';button.title='Open Assessment in '+(mode==='yaml'?'native YAML':'graphical')+' editor';button.onclick=()=>vscode.postMessage({type:'open',uri:item.uri,mode});row.append(button);}}wrap.append(row);}details.append(wrap);parent.append(details);}function render(value){const root=$('details');root.replaceChildren();if(!value){add(root,'p','No benchmark selected. Choose a package above.','muted');return;}const banner=document.createElement('div');banner.className='banner';add(banner,'h2',value.label||value.benchmark.title||value.benchmark.id||'Benchmark');root.append(banner);const stats=document.createElement('div');stats.className='stats';for(const pair of [['Profiles',value.profiles.length,'profiles'],['Rules',value.ruleCount,'rules'],['Assessments',value.assessmentCount,'assessments'],['Applicability catalogs',value.applicabilityCount,'applicability'],['Conditions',value.conditionCount,'conditions']]){const card=document.createElement('button');card.type='button';card.className='stat stat-link';card.title='Open searchable '+pair[0]+' editor';add(card,'strong',pair[1]);add(card,'span',pair[0]);card.onclick=()=>vscode.postMessage({type:'section',section:pair[2]});stats.append(card);}root.append(stats);list(root,'Profiles',value.profiles,false,'profiles');list(root,'Rules',value.rules,false,'rules');const automated=value.assessments.filter(item=>item.mode==='automated');const manual=value.assessments.filter(item=>item.mode==='manual');const other=value.assessments.filter(item=>item.mode!=='automated'&&item.mode!=='manual');list(root,'Automated Assessments',automated,true,'assessments');list(root,'Manual Assessments',manual,true,'assessments');if(other.length)list(root,'Other Assessments',other,true,'assessments');list(root,'Applicability',value.applicability,false,'applicability');list(root,'Conditions',value.conditions||[],false,'conditions');}function focusSection(section){if(!section)return;const targets=[...document.querySelectorAll('[data-section=\"'+section+'\"]')];for(const target of targets)target.open=true;if(targets[0])targets[0].scrollIntoView({block:'start'});}function choose(key){const value=contexts.find(context=>context.key===key);render(value);$('status').textContent=value?'Context selected: '+(value.label||value.benchmark.title||value.benchmark.id||value.packagePath):'No benchmark context selected.';vscode.postMessage({type:'select',key:key||undefined});}$('benchmark').onchange=()=>choose($('benchmark').value);for(const button of document.querySelectorAll('button'))button.addEventListener('keydown',event=>{if(event.key==='Enter')button.click();});window.addEventListener('message',event=>{if(event.data.type==='contexts'){contexts=Array.isArray(event.data.contexts)?event.data.contexts:[];$('benchmark').value=event.data.activeKey||'';render(contexts.find(context=>context.key===event.data.activeKey));}if(event.data.type==='selected'){$('benchmark').value=event.data.key||'';render(contexts.find(context=>context.key===event.data.key));}});render(contexts.find(context=>context.key===${scriptJson(activeKey)}));focusSection(initialFocus);</script></body></html>`;
}
async function selectBenchmarkRoot(extensionContext: vscode.ExtensionContext, index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, state: BenchmarkContextState) {
  // Do not await the workspace scan here. The setup surface is deliberately
  // opened first so a large content root feels like a guided loading step,
  // not a frozen command-palette action. Benchmark documents are indexed
  // ahead of the rest of the corpus and will populate this wizard first.
  const contexts = benchmarkContexts(index, state.importedRoots);
  await openBenchmarkSetupPanel(extensionContext, index, tree, api, indexDiagnostics, contexts, state);
}

async function chooseBenchmarkRootAndBenchmark(extensionContext: vscode.ExtensionContext, index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, state: BenchmarkContextState) {
  const root = await promptForContentFolder(index, tree, api, indexDiagnostics, state);
  if (!root) return;
  // Choosing a filesystem root is only the first step when a root contains
  // one or more converted Benchmarks. Keep the user in the selection flow so
  // the root cannot silently leave Home in standalone mode.
  await openBenchmarkSetupPanel(extensionContext, index, tree, api, indexDiagnostics, benchmarkContexts(index, state.importedRoots), state);
}

function benchmarkSetupData(contexts: readonly BenchmarkContextSummary[]) {
  const labels = benchmarkContextLabels(contexts);
  return contexts.map(context => ({
    key: context.key,
    label: labels.get(context.key) ?? context.packagePath,
    // Keep this payload limited to selectable identity. Detailed content is
    // loaded only after the user selects a Benchmark.
  }));
}

function benchmarkSetupHtml(contexts: readonly BenchmarkContextSummary[], activeKey?: string) {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-benchmark-setup';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:22px;max-width:900px}h1{font-size:21px;margin:0 0 7px}.hint,.muted{color:var(--vscode-descriptionForeground)}.search{width:100%;box-sizing:border-box;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit;margin-top:8px}.choices{display:grid;gap:6px;margin:12px 0}.choice{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;text-align:left;width:100%;padding:8px 10px;border:1px solid var(--vscode-panel-border);border-left:3px solid transparent;background:var(--vscode-editor-background);color:var(--vscode-foreground);cursor:pointer}.choice:hover,.choice.selected{background:var(--vscode-list-hoverBackground);border-left-color:var(--vscode-textLink-foreground)}.choice strong{display:block;font-size:13px;overflow-wrap:anywhere}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}button{font:inherit;padding:7px 11px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button:disabled{opacity:.5;cursor:default}.status{min-height:1.4em;color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.empty{border:1px dashed var(--vscode-panel-border);padding:16px;margin:18px 0}</style></head><body><h1>Choose the Benchmark to edit</h1><p class="hint">This guided step selects the Benchmark you want to edit. The selected Benchmark filters applicability choices and guides new Assessments; it does not rewrite existing YAML or open the full Benchmark details page.</p><label class="muted" for="benchmarkSearch">Find a Benchmark</label><input id="benchmarkSearch" class="search" type="search" placeholder="Search by Benchmark name"><div id="choices" class="choices"></div><div id="empty" class="empty" hidden><strong>No Benchmark is available yet.</strong><p class="muted">The workspace scan may still be running. You can wait for it, or choose a content folder to index here.</p></div><p id="status" class="status" role="status" aria-live="polite">Scanning for Benchmark files…</p><div class="actions"><button id="browse">Choose content folder</button><button id="cancel">Cancel</button><button id="use" class="primary" disabled>Use selected Benchmark</button></div><script nonce="benchmark-setup">const vscode=acquireVsCodeApi();const initial=${scriptJson(benchmarkSetupData(contexts))};let data=initial;let selected=${scriptJson(activeKey)};let query='';const choices=document.getElementById('choices');const empty=document.getElementById('empty');const use=document.getElementById('use');const status=document.getElementById('status');function render(next,active){data=Array.isArray(next)?next:[];if(active&&data.some(item=>item.key===active))selected=active;else if(!data.some(item=>item.key===selected))selected=undefined;const visible=data.filter(item=>!query||item.label.toLocaleLowerCase().includes(query));choices.replaceChildren();for(const item of visible){const button=document.createElement('button');button.type='button';button.className='choice'+(item.key===selected?' selected':'');button.onclick=()=>{selected=item.key;render(data,selected);};button.ondblclick=()=>{selected=item.key;vscode.postMessage({type:'select',key:selected});};const title=document.createElement('strong');title.textContent=item.label;button.append(title);choices.append(button);}empty.hidden=data.length>0;use.disabled=!selected;if(data.length){if(status.textContent==='Scanning for Benchmark files…'||status.textContent==='No Benchmark is available yet.')status.textContent=visible.length+' Benchmark'+(visible.length===1?'':'s')+' shown. Double-click one or use the button below.';if(!visible.length)status.textContent='No Benchmarks match your search.';}else{if(status.textContent!=='Choose a content folder to continue.')status.textContent='Scanning for Benchmark files…';}}document.getElementById('benchmarkSearch').oninput=event=>{query=event.target.value.trim().toLocaleLowerCase();render(data,selected);};document.getElementById('browse').onclick=()=>{status.textContent='Choose a folder to index; this wizard will stay open while it loads…';vscode.postMessage({type:'browse'});};document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'cancel'});use.onclick=()=>{if(selected)vscode.postMessage({type:'select',key:selected});};window.addEventListener('message',event=>{if(event.data.type==='contexts')render(event.data.contexts,event.data.activeKey);if(event.data.type==='status'){status.className='status'+(event.data.error?' error':'');status.textContent=event.data.message||'';}});vscode.postMessage({type:'ready'});render(data,selected);</script></body></html>`;
}
async function openBenchmarkSetupPanel(extensionContext: vscode.ExtensionContext, index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection, contexts: readonly BenchmarkContextSummary[], state: BenchmarkContextState) {
  const panel = api.window.createWebviewPanel('scapNg.benchmarkSetup', 'Choose Benchmark to edit', api.ViewColumn?.Active ?? 1, { enableScripts: true, retainContextWhenHidden: false });
  panel.webview.html = benchmarkSetupHtml(contexts, state.activeKey);
  let browsing = false;
  const refresh = () => {
    const current = benchmarkContexts(index, state.importedRoots);
    void panel.webview.postMessage({ type: 'contexts', contexts: benchmarkSetupData(current), activeKey: state.activeKey });
  };
  state.refreshListeners.add(refresh);
  const onMessage = panel.webview.onDidReceiveMessage(async (message: any) => {
    if (message.type === 'ready') { refresh(); return; }
    if (message.type === 'cancel') { panel.dispose(); return; }
    if (message.type === 'browse') {
      if (browsing) return;
      browsing = true;
      try {
        const root = await promptForContentFolder(index, tree, api, indexDiagnostics, state);
        refresh();
        if (!root) panel.webview.postMessage({ type: 'status', message: 'Choose a content folder to continue.' });
      } catch (error) {
        panel.webview.postMessage({ type: 'status', error: true, message: error instanceof Error ? error.message : String(error) });
      } finally { browsing = false; }
      return;
    }
    if (message.type === 'select' && typeof message.key === 'string') {
      const current = benchmarkContexts(index, state.importedRoots);
      const selected = current.find(context => context.key === message.key);
      if (!selected) { panel.webview.postMessage({ type: 'status', error: true, message: 'That Benchmark is no longer available. Wait for indexing to finish, then choose it again.' }); return; }
      selectBenchmarkContext(state, selected.key);
      // The startup fast path indexes only the restored Benchmark package.
      // Selecting a different Benchmark must explicitly hydrate its package;
      // otherwise the intentionally lazy index would leave its counters at 0.
      void refreshContentIndex(index, tree, api, indexDiagnostics, state).catch(error => {
        void api.window.showErrorMessage(`Could not load the selected Benchmark content: ${error instanceof Error ? error.message : String(error)}`);
      });
      panel.dispose();
      await api.window.showInformationMessage(`Benchmark context selected: ${selected.benchmark.title ?? selected.benchmark.id ?? selected.packagePath}`);
    }
  });
  const cleanup = () => { state.refreshListeners.delete(refresh); onMessage.dispose(); };
  panel.onDidDispose(cleanup);
  extensionContext.subscriptions.push(panel);
  // The scan is intentionally observed, not awaited. The wizard remains
  // responsive and receives Benchmark cards as soon as the fast first pass
  // completes, followed by current stats after the rest of the corpus loads.
  if (state.ready) void state.ready.then(refresh, error => panel.webview.postMessage({ type: 'status', error: true, message: `Content scan failed: ${error instanceof Error ? error.message : String(error)}` }));
  refresh();
}

function benchmarkAssessmentChooserData(context: BenchmarkContextSummary | undefined) {
  if (!context) return undefined;
  const label = benchmarkContextLabels([context]).get(context.key) ?? context.benchmark.title ?? context.benchmark.id ?? 'Benchmark';
  return {
    label,
    assessments: context.assessments.map(assessment => ({
      uri: assessment.uri,
      title: assessment.title ?? assessment.id ?? 'Untitled Assessment',
      id: assessment.id,
      mode: assessment.mode,
      version: assessment.version
    }))
  };
}

function benchmarkAssessmentChooserHtml(context: BenchmarkContextSummary | undefined) {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-assessment-chooser';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:18px;max-width:900px}h1{font-size:20px;margin:0 0 7px}.hint,.muted{color:var(--vscode-descriptionForeground)}.context{font-weight:600;margin:15px 0 8px}.search{width:100%;box-sizing:border-box;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}.group{margin:17px 0}.group h2{font-size:14px;margin:0 0 7px}.list{display:grid;gap:6px}.item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--vscode-panel-border)}.name{font-weight:600;overflow-wrap:anywhere}.meta{display:block;color:var(--vscode-descriptionForeground);font-size:11px;margin-top:3px}.badge{display:inline-block;margin-left:7px;padding:2px 5px;border:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);font-size:10px;font-weight:400;vertical-align:middle}.item-actions{display:flex;gap:6px}.item button,button{font:inherit;padding:6px 9px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}.empty{border:1px dashed var(--vscode-panel-border);padding:15px;margin:16px 0}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.error{color:var(--vscode-errorForeground)}@media(max-width:650px){.item{grid-template-columns:1fr}.item-actions{justify-content:flex-start}}</style></head><body><h1>Open an Assessment</h1><p class="hint">Assessments are separated by authoring mode before you open one. YAML always opens the native YAML editor; Graphical always opens the graphical editor, regardless of the global editor preference.</p><p id="context" class="context"></p><input id="search" class="search" type="search" placeholder="Search Assessments"><div id="groups"></div><div id="empty" class="empty" hidden><strong>No associated Assessments are indexed yet.</strong><p class="muted">Refresh Benchmark data after adding files, or create a new Assessment from Home.</p></div><p id="status" class="muted" role="status" aria-live="polite">Loading associated Assessments…</p><div class="actions"><button id="switch">Change Benchmark</button><button id="cancel">Cancel</button></div><script nonce="assessment-chooser">const vscode=acquireVsCodeApi();const initial=${scriptJson(benchmarkAssessmentChooserData(context))};let data=initial;let query='';const contextNode=document.getElementById('context');const groups=document.getElementById('groups');const empty=document.getElementById('empty');const status=document.getElementById('status');function modeOf(item){return item.mode==='manual'?'Manual':item.mode==='automated'?'Automated':'Other';}function render(next){data=next||undefined;contextNode.textContent=data?'Current Benchmark: '+data.label:'';groups.replaceChildren();const items=(data?.assessments||[]).filter(item=>!query||[item.title,item.id,item.mode].filter(Boolean).some(value=>String(value).toLocaleLowerCase().includes(query)));const names=['Automated','Manual','Other'];for(const groupName of names){const groupItems=items.filter(item=>modeOf(item)===groupName);if(!groupItems.length)continue;const section=document.createElement('section');section.className='group';const heading=document.createElement('h2');heading.textContent=groupName+' Assessments ('+groupItems.length+')';section.append(heading);const list=document.createElement('div');list.className='list';for(const item of groupItems){const row=document.createElement('div');row.className='item';const body=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=item.title;const badge=document.createElement('span');badge.className='badge';badge.textContent=groupName;name.append(badge);body.append(name);const meta=document.createElement('span');meta.className='meta';meta.textContent=[item.id,item.version!==undefined?'version '+item.version:undefined].filter(Boolean).join(' · ');body.append(meta);const actions=document.createElement('div');actions.className='item-actions';for(const mode of ['yaml','graphical']){const button=document.createElement('button');button.textContent=mode==='yaml'?'YAML':'Graphical';button.onclick=()=>vscode.postMessage({type:'open',uri:item.uri,mode});actions.append(button);}row.append(body,actions);list.append(row);}section.append(list);groups.append(section);}empty.hidden=Boolean(data?.assessments?.length);if(!data)status.textContent='Loading associated Assessments…';else if(!data.assessments.length)status.textContent='No associated Assessments are indexed yet.';else status.textContent=items.length+' matching Assessment'+(items.length===1?'':'s')+'; choose YAML or Graphical.';}document.getElementById('search').oninput=event=>{query=event.target.value.trim().toLocaleLowerCase();render(data);};document.getElementById('switch').onclick=()=>vscode.postMessage({type:'switch'});document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'cancel'});window.addEventListener('message',event=>{if(event.data.type==='context')render(event.data.context);if(event.data.type==='status'){status.className=event.data.error?'error':'muted';status.textContent=event.data.message||'';}});vscode.postMessage({type:'ready'});render(data);</script></body></html>`;
}

type BenchmarkSourceSection = 'rules' | 'applicability' | 'conditions';

type BenchmarkEntityKind = 'rule' | 'applicability' | 'condition';

function benchmarkEntityReferenceData(context: BenchmarkContextSummary | undefined, automationDisposition?: AutomationDisposition) {
  const assessments = context?.assessments ?? [];
  const byId = new Map(assessments.filter(item => item.id).map(item => [item.id!, item]));
  return {
    availableAssessments: assessments.map(item => ({ id: item.id, title: item.title, mode: item.mode, version: item.version, path: item.path })),
    // Keep the condition key as the serialized Rule value. The target
    // Assessment metadata is display/search context, not a replacement for
    // the applicability catalog's condition reference.
    availableConditions: (context?.conditions ?? []).map(item => {
      const target = byId.get(item.targetId);
      return {
        id: item.name,
        title: item.name,
        assessment: item.targetId,
        assessmentTitle: target?.title,
        assessmentVersion: target?.version,
        sourcePath: item.sourcePath
      };
    })
  };
}
function benchmarkEntityModel(text: string, kind: BenchmarkEntityKind, conditionName?: string, references: any = {}) {
  const value: any = new SourceBuffer(text).json();
  if (kind === 'rule') {
    const body = value.rule ?? {};
    return { kind, id: body.id, revision: sha256(text), title: body.title, version: body.version, severity: body.severity, role: body.role, weight: body.weight, discussion: body.discussion, requires: body.requires ?? [], conflicts: body.conflicts ?? [], applicability: body.applicability ?? [], assessmentChoices: body.assessment_choices ?? {}, defaultAssessmentChoice: body.default_assessment_choice, automationDisposition: references.automationDisposition, availableAssessments: references.availableAssessments ?? [], availableConditions: references.availableConditions ?? [] };
  }
  const body = value.applicability ?? {};
  if (kind === 'applicability') return { kind, id: body.id, revision: sha256(text), conditions: Object.entries(body.conditions ?? {}).map(([name, condition]: [string, any]) => ({ name, assessment: condition?.assessment, path: ['applicability', 'conditions', name, 'assessment'] })) };
  const condition = body.conditions?.[conditionName ?? ''];
  return { kind, id: conditionName, revision: sha256(text), assessment: condition?.assessment, path: ['applicability', 'conditions', conditionName, 'assessment'] };
}

function benchmarkEntityGraphicalHtml(kind: BenchmarkEntityKind, initialModel?: any) {
  // This surface intentionally mirrors the Assessment editor's contract: a
  // navigation rail, focused inspector sections, explicit YAML escape hatch,
  // and extension-host-owned localized edits. It is not a read-only summary.
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-scap-ng-entity-editor';"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.4 var(--vscode-font-family)}button,input,select,textarea{font:inherit}button{cursor:pointer}.shell{height:100vh;display:grid;grid-template-rows:auto 1fr 24px}.topbar{display:flex;align-items:center;gap:9px;padding:0 10px;min-height:38px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.topbar strong{font-size:13px}.topbar .file{min-width:0;flex:1;color:var(--vscode-descriptionForeground);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.topbar button,.action{border:1px solid var(--vscode-panel-border);border-radius:3px;padding:5px 9px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.topbar button.primary,.action.primary{border-color:var(--vscode-button-background);background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.workspace{min-height:0;display:grid;grid-template-columns:235px minmax(0,1fr)}.rail{min-width:0;overflow:auto;padding:12px 9px;background:var(--vscode-sideBar-background);border-right:1px solid var(--vscode-panel-border)}.rail h2{font-size:12px;margin:0 4px 4px}.rail p{font-size:11px;color:var(--vscode-descriptionForeground);margin:0 4px 13px}.nav{display:grid;gap:2px}.nav button{border:0;border-radius:3px;text-align:left;padding:7px 8px;background:transparent;color:var(--vscode-foreground)}.nav button:hover{background:var(--vscode-list-hoverBackground)}.nav button.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.nav small{display:block;color:var(--vscode-descriptionForeground);margin-top:2px}.inspector{min-width:0;overflow:auto;padding:17px 22px 30px}.crumb{color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:5px}.inspector h1{font-size:18px;margin:0}.sub{color:var(--vscode-descriptionForeground);font-size:12px;margin:3px 0 12px}.banner{border-left:3px solid var(--vscode-textLink-foreground);padding:9px 11px;margin:10px 0 15px;background:var(--vscode-textBlockQuote-background);font-size:12px}.section{border-top:1px solid var(--vscode-panel-border);padding:14px 0 3px;max-width:920px}.section h2{font-size:13px;margin:0 0 9px}.section p{color:var(--vscode-descriptionForeground);font-size:11px;margin:4px 0 9px}.field{display:grid;grid-template-columns:minmax(150px,190px) minmax(0,1fr);gap:12px;align-items:start;margin:9px 0;max-width:920px}.field label{padding-top:7px;font-weight:600;font-size:12px;overflow-wrap:anywhere}.field input,.field textarea,.field select,.condition input{width:100%;min-height:30px;padding:5px 7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:2px}.field textarea{min-height:90px;resize:vertical;font-family:var(--vscode-editor-font-family)}.field input:focus,.field textarea:focus,.field select:focus,.condition input:focus{outline:1px solid var(--vscode-focusBorder)}.readonly{opacity:.65}.list-help{display:block;color:var(--vscode-descriptionForeground);font-size:10px;margin-top:3px}.condition{display:grid;grid-template-columns:minmax(210px,1fr) minmax(260px,2fr);gap:12px;align-items:center;border-top:1px solid var(--vscode-panel-border);padding:9px 0;max-width:920px}.condition:first-of-type{border-top:0}.condition strong{font:11px var(--vscode-editor-font-family);overflow-wrap:anywhere}.choice{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;align-items:center;border-top:1px solid var(--vscode-panel-border);padding:9px 0;max-width:920px}.choice strong{font-size:12px}.statusbar{display:flex;align-items:center;padding:0 10px;border-top:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);font-size:11px}.error{color:var(--vscode-errorForeground)!important}.muted{color:var(--vscode-descriptionForeground)}.source-note{font:11px var(--vscode-editor-font-family);overflow-wrap:anywhere;color:var(--vscode-descriptionForeground)}.picker{position:relative;min-width:0}.picker input{width:100%;min-height:30px;padding:5px 7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:2px}.picker-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}.picker-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border:1px solid var(--vscode-panel-border);border-radius:3px;background:var(--vscode-textBlockQuote-background);font:11px var(--vscode-editor-font-family);overflow-wrap:anywhere}.picker-chip button{border:0;background:transparent;color:inherit;padding:0 2px}.picker-results{position:absolute;z-index:20;left:0;right:0;top:100%;max-height:260px;overflow:auto;margin-top:2px;border:1px solid var(--vscode-focusBorder);background:var(--vscode-menu-background);box-shadow:0 4px 12px #0006}.picker-item{display:block;width:100%;padding:7px 9px;text-align:left;border:0;border-bottom:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-menu-foreground);overflow-wrap:anywhere}.picker-item:hover{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground)}.picker-empty{padding:8px;color:var(--vscode-descriptionForeground);font-size:11px}.automation-checkbox{width:auto!important;min-height:0!important;margin:7px 7px 0 0;vertical-align:middle}.picker-help{display:block;margin-top:3px;color:var(--vscode-descriptionForeground);font-size:10px}@media(max-width:700px){.workspace{grid-template-columns:170px minmax(0,1fr)}.inspector{padding:14px}.field{grid-template-columns:1fr;gap:3px}.condition,.choice{grid-template-columns:1fr;gap:4px}.topbar .file{display:none}}
</style></head><body><div class="shell"><header class="topbar"><strong id="topTitle">SCAP-NG</strong><span id="file" class="file"></span><button id="yaml" type="button">YAML</button><button id="close" type="button">Close</button></header><div class="workspace"><aside class="rail"><h2 id="railTitle">Source inspector</h2><p>Graphical editing writes localized changes to the authoritative YAML. Native Undo/Redo remains available.</p><nav id="nav" class="nav"></nav></aside><main class="inspector"><div class="crumb">Selected Benchmark source <span aria-hidden="true">›</span> Graphical editor</div><h1 id="heading">Loading graphical editor…</h1><p id="sub" class="sub">Loading the authored model…</p><div id="banner" class="banner"></div><div id="editor"></div></main></div><footer id="status" class="statusbar" role="status" aria-live="polite">Loading…</footer></div><script nonce="scap-ng-entity-editor">const vscode=acquireVsCodeApi();const kind=${scriptJson(kind)};const initialModel=${scriptJson(initialModel)};let model=initialModel;const editor=document.getElementById('editor');const nav=document.getElementById('nav');const status=document.getElementById('status');const text=value=>value===undefined||value===null?'':String(value);function setStatus(message,error=false){status.textContent=message||'';status.className='statusbar'+(error?' error':'')}function send(path,value,replace=false){if(!model)return;setStatus('Saving localized source edit…');vscode.postMessage({type:'edit',path,value,replace,revision:model.revision,version:model.version})}function section(title,id){const node=document.createElement('section');node.className='section';node.id=id;const h=document.createElement('h2');h.textContent=title;node.append(h);editor.append(node);return node}function field(parent,label,path,value,opts={}){const row=document.createElement('div');row.className='field';const name=document.createElement('label');name.textContent=label;const control=opts.multiline?document.createElement('textarea'):opts.select?document.createElement('select'):document.createElement('input');if(opts.multiline)control.value=text(value);else if(opts.select){let values=[...(opts.select||[])];if(value!==undefined&&value!==null&&!values.includes(value))values.push(value);for(const option of values){const item=document.createElement('option');item.value=option;item.textContent=option;item.selected=option===value;control.append(item)}}else{control.value=text(value);control.type=opts.number?'number':'text'}if(opts.readonly){control.disabled=true;control.className='readonly'}else control.onchange=()=>send(path,opts.number?(control.value===''?null:Number(control.value)):control.value,opts.replace===true);row.append(name,control);parent.append(row);return row}function listField(parent,label,path,value){const row=document.createElement('div');row.className='field';const name=document.createElement('label');name.textContent=label;const control=document.createElement('textarea');control.value=Array.isArray(value)?value.join('\\n'):'';control.rows=3;control.onchange=()=>send(path,control.value.split(/\\r?\\n/).map(item=>item.trim()).filter(Boolean),true);const help=document.createElement('span');help.className='list-help';help.textContent='One referenced ID per line.';const box=document.createElement('div');box.append(control,help);row.append(name,box);parent.append(row);return row}function itemValue(item){return typeof item==='string'?item:String(item?.id||'')}function itemLabel(item){if(typeof item==='string')return item;return [item?.title,item?.id,item?.mode,item?.assessmentTitle,item?.assessment,item?.sourcePath].filter(Boolean).join(' · ')||String(item?.id||'')}function referencePicker(parent,label,path,value,items,options={}){const multi=options.multi===true;const expectedMode=options.mode;const row=label?document.createElement('div'):parent;if(label){row.className='field';const name=document.createElement('label');name.textContent=label;row.append(name)}const box=document.createElement('div');box.className='picker';const selected=multi?(Array.isArray(value)?value.map(String):[]):[value===undefined||value===null?'':String(value)];const chips=document.createElement('div');chips.className='picker-chips';const input=document.createElement('input');input.type='search';input.placeholder=multi?'Search applicability conditions or Assessment IDs':'Search existing Assessments by title or ID';if(!multi)input.value=selected[0]||'';input.setAttribute('aria-label',label||'Choose existing reference');const results=document.createElement('div');results.className='picker-results';results.hidden=true;const help=document.createElement('small');help.className='picker-help';help.textContent=multi?'Search and add existing conditions from the selected Benchmark applicability catalog; target Assessment IDs and titles are searchable.':'Only '+(expectedMode||'matching')+' Assessments are shown for this choice.';box.append(chips,input,help,results);if(label)row.append(box);else parent.append(box);function commit(){send(path,multi?selected.slice():selected[0]||'',multi)}function renderChips(){chips.replaceChildren();if(!multi)return;for(const id of selected){const chip=document.createElement('span');chip.className='picker-chip';chip.textContent=id;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Remove '+id;remove.onclick=()=>{const index=selected.indexOf(id);if(index>=0){selected.splice(index,1);renderChips();commit()}};chip.append(remove);chips.append(chip)}}function draw(){const query=input.value.trim().toLocaleLowerCase();results.replaceChildren();const matches=(Array.isArray(items)?items:[]).filter(item=>{if(expectedMode&&item?.mode!==expectedMode)return false;const haystack=itemLabel(item).toLocaleLowerCase();return !query||haystack.includes(query)}).slice(0,80);if(!matches.length){const empty=document.createElement('div');empty.className='picker-empty';empty.textContent=items?.length?'No matching existing reference.':'No indexed references are available.';results.append(empty)}for(const item of matches){const id=itemValue(item);if(multi&&selected.includes(id))continue;const button=document.createElement('button');button.type='button';button.className='picker-item';button.textContent=itemLabel(item);button.title=id;button.onclick=()=>{if(multi){if(!selected.includes(id))selected.push(id);input.value='';renderChips()}else{selected[0]=id;input.value=id;results.hidden=true}commit();if(multi)draw()};results.append(button)}results.hidden=false}input.onfocus=()=>{if(!multi&&input.value)input.select();draw()};input.oninput=draw;input.onkeydown=event=>{if(event.key==='Escape')results.hidden=true};document.addEventListener('click',event=>{if(!box.contains(event.target))results.hidden=true});renderChips();return row}function navItem(label,id,detail){const button=document.createElement('button');button.type='button';button.dataset.target=id;button.innerHTML='';const strong=document.createElement('span');strong.textContent=label;button.append(strong);if(detail){const small=document.createElement('small');small.textContent=detail;button.append(small)}button.onclick=()=>{document.getElementById(id)?.scrollIntoView({block:'start',behavior:'smooth'});for(const item of nav.children)item.classList.toggle('active',item===button)};nav.append(button);return button}function render(next){model=next;if(!model){setStatus('The source model could not be loaded.',true);return}editor.replaceChildren();nav.replaceChildren();const label=kind==='rule'?'Rule':kind==='applicability'?'Applicability catalog':'Applicability condition';document.getElementById('topTitle').textContent='SCAP-NG '+label+' editor';document.getElementById('file').textContent=model.sourceName||'';document.getElementById('heading').textContent=label+' graphical editor';document.getElementById('sub').textContent='Edit authored values with the same source-preserving workflow as Assessment graphical editing.';document.getElementById('banner').textContent=kind==='rule'?'Rule: '+text(model.title||model.id):kind==='applicability'?'Catalog: '+text(model.id):'Condition: '+text(model.id);if(kind==='rule'){const identity=section('Rule identity','identity');navItem('Rule identity','identity',text(model.id));field(identity,'Rule ID',['rule','id'],model.id,{readonly:true});field(identity,'Title',['rule','title'],model.title);field(identity,'Version',['rule','version'],model.version);field(identity,'Severity',['rule','severity'],model.severity,{select:['low','medium','high','critical']});field(identity,'Role',['rule','role'],model.role);field(identity,'Weight',['rule','weight'],model.weight,{number:true});const automation=section('Automation metadata','automation');navItem('Automation metadata','automation','editor-only review flag');const automationRow=document.createElement('div');automationRow.className='field';const automationLabel=document.createElement('label');automationLabel.textContent='Manual-only flag';const automationBox=document.createElement('div');const automationInput=document.createElement('input');automationInput.type='checkbox';automationInput.checked=model.automationDisposition==='manual-only';automationInput.className='automation-checkbox';automationInput.setAttribute('aria-label','Flag this Rule as manual-only');automationInput.onchange=()=>{setStatus('Saving Rule metadata…');vscode.postMessage({type:'automationDisposition',disposition:automationInput.checked?'manual-only':undefined,revision:model.revision,version:model.version});};const automationHelp=document.createElement('small');automationHelp.className='picker-help';automationHelp.textContent='Use this lightweight editor flag for clearly manual questions; it is not part of the SCAP-NG 0.4.1 Rule schema.';automationBox.append(automationInput,automationHelp);automationRow.append(automationLabel,automationBox);automation.append(automationRow);const policy=section('Policy and relationships','policy');navItem('Policy and relationships','policy','discussion, references, applicability picker');field(policy,'Discussion',['rule','discussion'],model.discussion,{multiline:true,replace:true});listField(policy,'Requires',['rule','requires'],model.requires);listField(policy,'Conflicts',['rule','conflicts'],model.conflicts);const applicability=section('Applicability','applicability');navItem('Applicability','applicability',(model.availableConditions||[]).length+' existing conditions · searchable');referencePicker(applicability,'Applicable conditions',['rule','applicability'],model.applicability,model.availableConditions,{multi:true});const choices=section('Assessment choices','choices');navItem('Assessment choices','choices',Object.keys(model.assessmentChoices||{}).length+' choices · searchable references');const authored=Object.entries(model.assessmentChoices||{});const canCreateAutomation=model.automationDisposition!=='manual-only'&&!authored.some(([name,value])=>name==='automated'&&typeof value?.assessment==='string'&&value.assessment.trim());if(!authored.length){const empty=document.createElement('p');empty.textContent='No assessment choices are authored in this Rule.';choices.append(empty)}for(const [name,value] of authored){const row=document.createElement('div');row.className='choice';const heading=document.createElement('strong');heading.textContent=name==='automated'?'Automated assessment':'Manual assessment';row.append(heading);referencePicker(row,'',['rule','assessment_choices',name,'assessment'],value?.assessment,model.availableAssessments,{multi:false,mode:name==='automated'||name==='manual'?name:undefined});if(name==='automated'&&canCreateAutomation){const action=document.createElement('button');action.type='button';action.className='action primary';action.textContent='Create automated Assessment from this Rule';action.title='Use the linked manual procedure to generate and review a best-guess automated Assessment';action.onclick=()=>vscode.postMessage({type:'createAutomationFromRule'});row.append(action)}choices.append(row)}if(canCreateAutomation){const action=document.createElement('button');action.type='button';action.className='action primary';action.textContent='Create automated Assessment from this Rule';action.onclick=()=>vscode.postMessage({type:'createAutomationFromRule'});choices.append(action)}field(choices,'Default assessment choice',['rule','default_assessment_choice'],model.defaultAssessmentChoice,{select:authored.map(([name])=>name)});}else if(kind==='applicability'){const identity=section('Applicability catalog','identity');navItem('Catalog identity','identity',text(model.id));field(identity,'Catalog ID',['applicability','id'],model.id,{readonly:true});const conditions=section('Condition mappings','conditions');navItem('Condition mappings','conditions',(model.conditions||[]).length+' conditions');if(!model.conditions?.length){const empty=document.createElement('p');empty.textContent='No conditions are authored in this catalog.';conditions.append(empty)}for(const condition of model.conditions||[]){const row=document.createElement('div');row.className='condition';const name=document.createElement('strong');name.textContent=condition.name;const input=document.createElement('input');input.value=text(condition.assessment);input.setAttribute('aria-label','Assessment for '+condition.name);input.onchange=()=>send(condition.path,input.value);row.append(name,input);conditions.append(row)}}else{const identity=section('Condition mapping','identity');navItem('Condition mapping','identity',text(model.id));field(identity,'Condition name',['applicability','conditions',model.id],model.id,{readonly:true});field(identity,'Assessment ID',model.path,model.assessment);const note=document.createElement('p');note.textContent='Condition names are reference keys. Rename them in YAML only after updating every Rule and dependency that refers to this condition.';identity.append(note)}const first=nav.firstElementChild;if(first)first.classList.add('active');setStatus('Ready. Changes are saved to YAML as you leave each field.')}document.getElementById('yaml').onclick=()=>vscode.postMessage({type:'openSource'});document.getElementById('close').onclick=()=>vscode.postMessage({type:'close'});window.addEventListener('message',event=>{const message=event.data;if(message.type==='model')render(message.model);if(message.type==='status')setStatus(message.message||'');if(message.type==='error')setStatus(message.message||'Edit failed',true)});window.addEventListener('error',event=>{try{vscode.postMessage({type:'webviewError',message:event.message||'Unknown graphical editor error'})}catch{}});render(initialModel);vscode.postMessage({type:'ready'});</script></body></html>`;
}
async function openBenchmarkGraphicalEditor(extensionContext: vscode.ExtensionContext, api: any, uri: any, kind: BenchmarkEntityKind, conditionName: string | undefined, getPack: () => MetadataPack | undefined, getReferences: () => any = () => ({}), onAutomationDisposition?: (disposition: AutomationDisposition | undefined, sourceHash: string) => Promise<void | string>, onCreateAutomation?: () => Promise<void>) {
  const document = await api.workspace.openTextDocument(uri);
  const panel = api.window.createWebviewPanel(`scapNg.${kind}Graphical`, kind === 'rule' ? 'Graphical Rule' : kind === 'applicability' ? 'Graphical Applicability' : 'Graphical Condition', api.ViewColumn?.Active ?? 1, { enableScripts: true, retainContextWhenHidden: true });
  const initialModel = { ...benchmarkEntityModel(document.getText(), kind, conditionName, getReferences()), version: document.version, sourceName: document.uri?.fsPath ?? document.fileName };
  panel.webview.options = { enableScripts: true };
  panel.webview.html = benchmarkEntityGraphicalHtml(kind, initialModel);
  const send = () => { try { void panel.webview.postMessage({ type: 'model', model: { ...benchmarkEntityModel(document.getText(), kind, conditionName, getReferences()), version: document.version, sourceName: document.uri?.fsPath ?? document.fileName } }); } catch (error) { void panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); } };
  const listener = panel.webview.onDidReceiveMessage(async (message: any) => {
    if (message.type === 'ready') { send(); return; }
    if (message.type === 'close') { panel.dispose(); return; }
    if (message.type === 'openSource') { await api.window.showTextDocument(document, { viewColumn: api.ViewColumn?.Beside ?? 2, preserveFocus: false, preview: false }); return; }
    if (message.type === 'webviewError') {
      const detail = typeof message.message === 'string' ? message.message : 'Unknown webview error';
      void api.window.showErrorMessage(`SCAP-NG graphical editor failed to load: ${detail}`);
      return;
    }
    if (message.type === 'createAutomationFromRule') {
      try {
        if (kind !== 'rule' || !onCreateAutomation) throw new Error('Create automation is available only for indexed Rules.');
        await onCreateAutomation();
      } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (message.type === 'automationDisposition') {
      try {
        if (kind !== 'rule' || !onAutomationDisposition) throw new Error('Automation metadata is available only for indexed Rules.');
        if (message.revision !== sha256(document.getText()) || (message.version !== undefined && message.version !== document.version)) throw new Error('Rule changed before the metadata edit; refresh and try again.');
        const metadataPath = await onAutomationDisposition(message.disposition === 'manual-only' ? 'manual-only' : undefined, sha256(document.getText()));
        panel.webview.postMessage({ type: 'status', message: `Saved editor-only automation metadata${metadataPath ? ` in ${metadataPath}` : ''}.` });
        send();
      } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); send(); }
      return;
    }
    if (message.type !== 'edit' || !Array.isArray(message.path)) return;
    try {
      const revision = sha256(document.getText());
      if (message.revision !== revision || (message.version !== undefined && message.version !== document.version)) throw new Error('Document changed before this edit; refresh and try again.');
      const source = new SourceBuffer(document.getText());
      const before = source.json();
      const edit = message.replace ? source.replacePathValue(message.path, message.value, revision) : source.editScalar(message.path, message.value, revision);
      const pack = getPack();
      const schemaUri = kind === 'rule' ? schemaBase + 'rule.schema.json' : schemaBase + 'applicability.schema.json';
      if (pack) {
        const beforeErrors = pack.validate(schemaUri, before);
        const afterErrors = pack.validate(schemaUri, edit.document.json());
        const introduced = afterErrors.filter((error: string) => !beforeErrors.includes(error));
        if (introduced.length) throw new Error('Pinned schema rejected this edit: ' + introduced.join('; '));
      }
      await applySourceWorkspaceEdit(api, document, edit);
      panel.webview.postMessage({ type: 'status', message: 'Saved localized YAML edit; native Undo/Redo remains available.' });
    } catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); send(); }
  });
  const onChange = api.workspace.onDidChangeTextDocument?.((event: any) => { if (event.document.uri.toString() === document.uri.toString()) send(); });
  panel.onDidDispose(() => { listener.dispose(); onChange?.dispose?.(); });
  extensionContext.subscriptions.push(panel);
  send();
}

function benchmarkSourceChooserData(context: BenchmarkContextSummary | undefined, section: BenchmarkSourceSection, filter = '', automationAnalysis?: BenchmarkAutomationAnalysis) {
  if (!context) return undefined;
  const label = benchmarkContextLabels([context]).get(context.key) ?? context.benchmark.title ?? context.benchmark.id ?? 'Benchmark';
  const entries = section === 'rules'
    ? context.rules.map(rule => ({ uri: rule.uri, title: rule.title ?? rule.id ?? 'Untitled Rule', id: rule.id, automationStatus: rule.automationStatus, conditionName: undefined }))
    : section === 'applicability'
      ? context.applicability.map(catalog => ({ uri: catalog.uri, title: catalog.title ?? catalog.id ?? 'Applicability catalog', id: catalog.id, conditionName: undefined }))
      : context.conditions.map(condition => ({ uri: condition.sourceUri, title: condition.name, id: condition.targetId, path: condition.path, conditionName: condition.name }));
  const filteredEntries = section === 'rules' && filter === 'needs-automation'
    ? entries.filter(entry => 'automationStatus' in entry && entry.automationStatus === 'needs-automation')
    : section === 'rules' && filter === 'likely-automatable'
      ? entries.filter(entry => automationAnalysis?.state === 'complete' && automationAnalysis.likelyRuleUris.includes(entry.uri))
      : entries;
  const titles: Record<BenchmarkSourceSection, string> = { rules: 'Rules', applicability: 'Applicability', conditions: 'Conditions' };
  return { label, section, title: titles[section], entries: filteredEntries, filter };
}

function benchmarkSourceChooserHtml(context: BenchmarkContextSummary | undefined, section: BenchmarkSourceSection, initialFilter = '', automationAnalysis?: BenchmarkAutomationAnalysis) {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-benchmark-source-chooser';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:18px;max-width:900px}h1{font-size:20px;margin:0 0 7px}.hint,.muted{color:var(--vscode-descriptionForeground)}.context{font-weight:600;margin:15px 0 8px}.search{width:100%;box-sizing:border-box;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}.list{display:grid;gap:6px;margin-top:17px}.item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--vscode-panel-border)}.name{font-weight:600;overflow-wrap:anywhere}.meta{display:block;color:var(--vscode-descriptionForeground);font-size:11px;margin-top:3px}.item-actions{display:flex;gap:6px}.item button,button{font:inherit;padding:6px 9px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}.empty{border:1px dashed var(--vscode-panel-border);padding:15px;margin:16px 0}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.error{color:var(--vscode-errorForeground)}@media(max-width:650px){.item{grid-template-columns:1fr}.item-actions{justify-content:flex-start}}</style></head><body><h1>Open Benchmark ${escapeHtml(section === 'rules' ? 'Rule' : section === 'applicability' ? 'Applicability' : 'Condition')}</h1><p class="hint">Search the selected Benchmark's ${escapeHtml(section)} and open the authored YAML source for editing.</p><p id="context" class="context"></p><input id="search" class="search" type="search" placeholder="Search ${escapeHtml(section)}"><div id="list" class="list"></div><div id="empty" class="empty" hidden><strong>No ${escapeHtml(section)} are indexed yet.</strong><p class="muted">Refresh Benchmark data after adding files.</p></div><p id="status" class="muted" role="status" aria-live="polite">Loading ${escapeHtml(section)}…</p><div class="actions"><button id="switch">Change Benchmark</button><button id="cancel">Cancel</button></div><script nonce="benchmark-source-chooser">const vscode=acquireVsCodeApi();const initial=${scriptJson(benchmarkSourceChooserData(context,section,initialFilter,automationAnalysis))};const singular=${scriptJson(section === 'applicability' ? 'applicability' : section.slice(0,-1))};let data=initial;let query='';const contextNode=document.getElementById('context');const listNode=document.getElementById('list');const empty=document.getElementById('empty');const status=document.getElementById('status');function render(next){data=next||undefined;contextNode.textContent=data?'Current Benchmark: '+data.label:'';const items=(data?.entries||[]).filter(item=>!query||[item.title,item.id,item.path,item.automationStatus].filter(Boolean).some(value=>String(value).toLocaleLowerCase().includes(query)));listNode.replaceChildren();for(const item of items){const row=document.createElement('div');row.className='item';const body=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=item.title;body.append(name);const meta=document.createElement('span');meta.className='meta';meta.textContent=[item.id,item.path,item.automationStatus&&('automation: '+item.automationStatus)].filter(Boolean).join(' · ');body.append(meta);const actions=document.createElement('div');actions.className='item-actions';const button=document.createElement('button');button.textContent='YAML';button.title='Open source YAML for editing';button.onclick=()=>vscode.postMessage({type:'open',uri:item.uri});actions.append(button);const graphical=document.createElement('button');graphical.textContent='Graphical';graphical.title='Open graphical editor';graphical.onclick=()=>vscode.postMessage({type:'graphical',uri:item.uri,conditionName:item.conditionName});actions.append(graphical);if(${scriptJson(section)}==='rules'&&item.automationStatus==='needs-automation'){const automate=document.createElement('button');automate.textContent='Automate';automate.title='Generate and review an automated Assessment from this Rule';automate.onclick=()=>vscode.postMessage({type:'createAutomation',uri:item.uri});actions.append(automate)}row.append(body,actions);listNode.append(row);}empty.hidden=items.length>0;if(!data)status.textContent='Loading '+${scriptJson(section)}+'…';else if(!data.entries.length)status.textContent=data.filter==='needs-automation'?'No Rules needing automation were found.':data.filter==='likely-automatable'?'No likely automatable Rules were found.':'No '+${scriptJson(section)}+' are indexed yet.';else status.textContent=items.length+' matching '+singular+(items.length===1?'':'s')+'.';}document.getElementById('search').oninput=event=>{query=event.target.value.trim().toLocaleLowerCase();render(data);};document.getElementById('switch').onclick=()=>vscode.postMessage({type:'switch'});document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'cancel'});window.addEventListener('message',event=>{if(event.data.type==='context')render(event.data.context);if(event.data.type==='status'){status.className=event.data.error?'error':'muted';status.textContent=event.data.message||'';}});vscode.postMessage({type:'ready'});render(data);</script></body></html>`;
}

async function openBenchmarkSourceChooserPanel(extensionContext: vscode.ExtensionContext, index: WorkspaceIndex, api: any, state: BenchmarkContextState, section: BenchmarkSourceSection, getPack: () => MetadataPack | undefined, filter = '', getAutomationAnalysis: (key: string) => BenchmarkAutomationAnalysis | undefined = () => undefined, getAiGenerator: () => AiAssessmentGenerator | undefined = () => undefined) {
  const selected = benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey);
  if (!selected) return false;
  const title = section === 'rules' ? 'Open Benchmark Rules' : section === 'applicability' ? 'Open Benchmark Applicability' : 'Open Benchmark Conditions';
  const panel = api.window.createWebviewPanel(`scapNg.${section}Chooser`, title, api.ViewColumn?.Active ?? 1, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = benchmarkSourceChooserHtml(selected, section, filter, getAutomationAnalysis(selected.key));
  const refresh = () => {
    const current = benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey);
    void panel.webview.postMessage({ type: 'context', context: benchmarkSourceChooserData(current, section, filter, current ? getAutomationAnalysis(current.key) : undefined) });
  };
  state.refreshListeners.add(refresh);
  const listener = panel.webview.onDidReceiveMessage(async (message: any) => {
    if (message.type === 'ready') { refresh(); return; }
    if (message.type === 'cancel') { panel.dispose(); return; }
    if (message.type === 'switch') { panel.dispose(); await api.commands.executeCommand('scapNg.selectBenchmarkRoot'); return; }
    if (!['open', 'graphical', 'createAutomation'].includes(message.type) || typeof message.uri !== 'string') return;
    const current = benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey);
    const data = benchmarkSourceChooserData(current, section, filter, current ? getAutomationAnalysis(current.key) : undefined);
    const entry = data?.entries.find(candidate => candidate.uri === message.uri && (section !== 'conditions' || candidate.conditionName === message.conditionName));
    if (!entry) { panel.webview.postMessage({ type: 'status', error: true, message: `That ${data?.title ?? 'source'} is not associated with the current Benchmark.` }); return; }
    try {
      const uri = api.Uri.parse(message.uri);
      if (message.type === 'createAutomation') {
        if (section !== 'rules') throw new Error('Automation creation is available only for Rules.');
        const rule = current?.rules.find(item => item.uri === message.uri);
        if (!current || !rule) throw new Error('That Rule is not associated with the current Benchmark.');
        if (rule.automationStatus !== 'needs-automation') throw new Error('This Rule already has automation or is marked manual-only; review the existing Assessment instead.');
        const ruleDocument = await api.workspace.openTextDocument(uri);
        const seed = await ruleAutomationSeed(api, current, rule, ruleDocument);
        await openRuleAutomationPanel(extensionContext, api, ruleDocument, current, seed, getPack, normalizeYamlObjectStyle(api.workspace.getConfiguration('scapNg').get('objectStyle')), () => {
          state.onChange?.();
          for (const listener of state.refreshListeners) listener();
        }, getAiGenerator());
        return;
      }
      if (message.type === 'graphical') {
        const createAutomation = section === 'rules' ? async () => {
          const selectedContext = benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey);
          const rule = selectedContext?.rules.find(item => item.uri === uri.toString());
          if (!selectedContext || !rule) throw new Error('The selected Rule is no longer associated with the active Benchmark.');
          if (rule.automationStatus !== 'needs-automation') throw new Error('This Rule already has automation or is marked manual-only; review the existing Assessment instead.');
          const ruleDocument = await api.workspace.openTextDocument(uri);
          const seed = await ruleAutomationSeed(api, selectedContext, rule, ruleDocument);
          await openRuleAutomationPanel(extensionContext, api, ruleDocument, selectedContext, seed, getPack, normalizeYamlObjectStyle(api.workspace.getConfiguration('scapNg').get('objectStyle')), () => {
            state.onChange?.();
            for (const listener of state.refreshListeners) listener();
          }, getAiGenerator());
        } : undefined;
        await openBenchmarkGraphicalEditor(extensionContext, api, uri, section === 'rules' ? 'rule' : section === 'applicability' ? 'applicability' : 'condition', section === 'conditions' ? entry.conditionName : undefined, getPack, () => benchmarkEntityReferenceData(benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey), section === 'rules' ? index.get(uri.toString())?.automationDisposition : undefined), section === 'rules' ? (disposition, sourceHash) => updateRuleAutomationDisposition(index, state, uri.toString(), disposition, sourceHash) : undefined, createAutomation);
      }
      else await api.commands.executeCommand('vscode.open', uri);
    }
    catch (error) { panel.webview.postMessage({ type: 'status', error: true, message: error instanceof Error ? error.message : String(error) }); }
  });
  panel.onDidDispose(() => { state.refreshListeners.delete(refresh); listener.dispose(); });
  extensionContext.subscriptions.push(panel);
  if (state.ready) void state.ready.then(refresh, error => panel.webview.postMessage({ type: 'status', error: true, message: `Content scan failed: ${error instanceof Error ? error.message : String(error)}` }));
  refresh();
  return true;
}

async function openBenchmarkAssessmentPanel(extensionContext: vscode.ExtensionContext, index: WorkspaceIndex, api: any, state: BenchmarkContextState) {
  const contexts = benchmarkContexts(index, state.importedRoots);
  const selected = benchmarkContextForKey(contexts, state.activeKey);
  if (!selected) return false;
  const panel = api.window.createWebviewPanel('scapNg.assessmentChooser', 'Open Benchmark Assessment', api.ViewColumn?.Active ?? 1, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = benchmarkAssessmentChooserHtml(selected);
  const refresh = () => {
    const current = benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey);
    void panel.webview.postMessage({ type: 'context', context: benchmarkAssessmentChooserData(current) });
  };
  state.refreshListeners.add(refresh);
  const listener = panel.webview.onDidReceiveMessage(async (message: any) => {
    if (message.type === 'ready') { refresh(); return; }
    if (message.type === 'cancel') { panel.dispose(); return; }
    if (message.type === 'switch') {
      panel.dispose();
      await api.commands.executeCommand('scapNg.selectBenchmarkRoot');
      return;
    }
    if (message.type !== 'open' || typeof message.uri !== 'string') return;
    const current = benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey);
    const assessment = current?.assessments.find(item => item.uri === message.uri);
    if (!assessment) { panel.webview.postMessage({ type: 'status', error: true, message: 'That Assessment is not associated with the current Benchmark.' }); return; }
    try {
      const uri = api.Uri.parse(assessment.uri);
      if ((message.mode === 'graphical' || message.mode === 'yaml') && isAssessmentFilePath(uri.fsPath ?? '')) await openAssessmentInMode(api, uri, message.mode);
      else await api.commands.executeCommand('vscode.open', uri);
    } catch (error) { panel.webview.postMessage({ type: 'status', error: true, message: error instanceof Error ? error.message : String(error) }); }
  });
  panel.onDidDispose(() => { state.refreshListeners.delete(refresh); listener.dispose(); });
  extensionContext.subscriptions.push(panel);
  if (state.ready) void state.ready.then(refresh, error => panel.webview.postMessage({ type: 'status', error: true, message: `Content scan failed: ${error instanceof Error ? error.message : String(error)}` }));
  refresh();
  return true;
}

async function openStandaloneAssessmentFile(api: any) {
  if (typeof api.window.showOpenDialog !== 'function') {
    await api.window.showWarningMessage('File browsing is unavailable in this VS Code session.');
    return;
  }
  const picked = await api.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Open Assessment',
    title: 'Open a standalone SCAP-NG Assessment file',
    filters: { 'Assessment YAML': ['yaml', 'yml'] }
  });
  const uri = picked?.[0];
  if (!uri) return;
  if (!isAssessmentFilePath(uri.fsPath ?? '')) {
    await api.window.showWarningMessage('Select a file ending in .assessment.yaml, .assessment.yml, -assessment.yaml, or -assessment.yml.');
    return;
  }
  await api.commands.executeCommand('vscode.open', uri);
}

async function openBenchmarkContextPanel(extensionContext: vscode.ExtensionContext, index: WorkspaceIndex, tree: StudioTree, indexDiagnostics: vscode.DiagnosticCollection, state: BenchmarkContextState, focusSection?: string) {
  const api: any = vscode;
  if (state.ready) {
    try {
      if (api.window.withProgress) await api.window.withProgress({ location: api.ProgressLocation?.Window ?? 10, title: 'Indexing SCAP-NG content…' }, () => state.ready);
      else await state.ready;
    } catch { /* The empty-state message below remains actionable if indexing failed. */ }
  }
  let contexts = benchmarkContexts(index, state.importedRoots);
  if (!contexts.length) {
    const importedRoot = await promptForContentFolder(index, tree, api, indexDiagnostics, state);
    if (!importedRoot) return;
    contexts = benchmarkContexts(index, state.importedRoots);
    if (!contexts.length) {
      await api.window.showWarningMessage(`No Benchmark document was found under "${importedRoot}". Select the folder that contains the converted Benchmark YAML (Assessments and Rules may be in child folders).`);
      return;
    }
    // Root selection and Benchmark selection are separate. Do not fall
    // through to the overview while the user still needs to choose a
    // Benchmark; leave the searchable chooser in front instead.
    if (!state.activeKey) {
      await openBenchmarkSetupPanel(extensionContext, index, tree, api, indexDiagnostics, contexts, state);
      return;
    }
  }
  const selected = benchmarkContextForKey(contexts, state.activeKey);
  if (selected && state.activeKey !== selected.key) selectBenchmarkContext(state, selected.key);
  const panel = api.window.createWebviewPanel('scapNg.benchmarkContext', 'SCAP-NG Benchmark context', api.ViewColumn?.Active ?? 1, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = benchmarkContextHtml(contexts, selected?.key, focusSection);
  const listener = (key: string | undefined) => panel.webview.postMessage({ type: 'selected', key });
  const refresh = () => {
    const current = benchmarkContexts(index, state.importedRoots);
    void panel.webview.postMessage({ type: 'contexts', contexts: benchmarkContextViewData(current), activeKey: state.activeKey });
  };
  state.listeners.add(listener);
  state.refreshListeners.add(refresh);
  panel.webview.onDidReceiveMessage(async (message: any) => {
    if (message.type === 'select') {
      const key = typeof message.key === 'string' ? message.key : undefined;
      selectBenchmarkContext(state, key);
      if (key) void refreshContentIndex(index, tree, api, indexDiagnostics, state).catch(error => {
        void api.window.showErrorMessage(`Could not load the selected Benchmark content: ${error instanceof Error ? error.message : String(error)}`);
      });
      return;
    }
    if (message.type === 'section' && ['rules', 'applicability', 'conditions', 'assessments'].includes(message.section)) {
      panel.dispose();
      await api.commands.executeCommand(message.section === 'rules' ? 'scapNg.openBenchmarkRules' : message.section === 'applicability' ? 'scapNg.openBenchmarkApplicability' : message.section === 'conditions' ? 'scapNg.openBenchmarkConditions' : 'scapNg.openBenchmarkAssessments');
      return;
    }
    if (message.type === 'open' && typeof message.uri === 'string') {
      try {
        // The page only links to documents in the selected Benchmark context.
        // Validate the URI before opening it so a tampered webview message
        // cannot turn this navigation surface into an arbitrary file opener.
        const current = benchmarkContextForKey(benchmarkContexts(index, state.importedRoots), state.activeKey);
        const sourceUris = new Set([
          ...(current ? [current.benchmark.uri] : []),
          ...(current?.rules.map(item => item.uri) ?? []),
          ...(current?.assessments.map(item => item.uri) ?? []),
          ...(current?.applicability.map(item => item.uri) ?? []),
          ...(current?.conditions.map(item => item.sourceUri) ?? [])
        ]);
        if (!sourceUris.has(message.uri)) return;
        const uri = api.Uri.parse(message.uri);
        if ((message.mode === 'graphical' || message.mode === 'yaml') && isAssessmentFilePath(uri.fsPath ?? '')) await openAssessmentInMode(api, uri, message.mode);
        else await api.commands.executeCommand('vscode.open', uri);
      } catch { /* keep the context form usable if a file cannot be opened */ }
    }
  });
  panel.onDidDispose(() => { state.listeners.delete(listener); state.refreshListeners.delete(refresh); });
  extensionContext.subscriptions.push(panel);
}

class GuidedPanel {
  static open(context: vscode.ExtensionContext, pack: MetadataPack | undefined, index: WorkspaceIndex, tree: StudioTree, indexDiagnostics: vscode.DiagnosticCollection, benchmarkState: BenchmarkContextState, forceStandalone = false) {
    const api: any = vscode;
    if (!pack) return void vscode.window.showWarningMessage('Configure a verified offline SCAP-NG metadata pack before using Guided authoring.');
    const catalog = new GuidedCatalog(pack);
    const contexts = benchmarkContexts(index, benchmarkState.importedRoots);
    const active = forceStandalone || benchmarkState.authoringMode !== 'benchmark' ? undefined : benchmarkContextForKey(contexts, benchmarkState.activeKey);
    if (active && benchmarkState.activeKey !== active.key) selectBenchmarkContext(benchmarkState, active.key);
    const optionsFor = (key: string | undefined) => {
      const selectedContext = benchmarkContextForKey(contexts, key);
      return applicabilityForBenchmark(index.applicabilityOptions(selectedContext?.packagePath), selectedContext);
    };
    const objectStyle = normalizeYamlObjectStyle(api.workspace.getConfiguration('scapNg').get('objectStyle'));
    const panel = api.window.createWebviewPanel('scapNg.guided', forceStandalone ? 'SCAP-NG Standalone Assessment' : 'SCAP-NG Guided Assessment', api.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    const publishContext = (key: string | undefined) => {
      const selectedContext = forceStandalone ? undefined : benchmarkContextForKey(contexts, key);
      const selectedLabel = selectedContext ? benchmarkContextLabels(contexts).get(selectedContext.key) : undefined;
      panel.webview.postMessage({
        type: 'benchmarkContext',
        applicability: optionsFor(selectedContext?.key),
        label: selectedContext ? (selectedLabel ?? selectedContext.benchmark.title ?? selectedContext.benchmark.id ?? 'Benchmark') : undefined
      });
    };
    const activeContextLabel = active ? benchmarkContextLabels(contexts).get(active.key) ?? active.benchmark.title ?? active.benchmark.id ?? 'Benchmark' : '';
    panel.webview.html = guidedHtml(catalog, optionsFor(active?.key), activeContextLabel);
    const stateListener = (key: string | undefined) => publishContext(key);
    benchmarkState.listeners.add(stateListener);
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'capability') { panel.webview.postMessage({ type: 'objectFields', fields: catalog.objectFields(message.value), requirements: catalog.objectRequirements(message.value) }); panel.webview.postMessage({ type: 'resultFields', fields: catalog.resultFields(message.value) }); return; }
      if (message.type === 'assistedDraft') {
        try {
          const selectedContext = forceStandalone || benchmarkState.authoringMode !== 'benchmark' ? undefined : benchmarkContextForKey(contexts, typeof message.benchmarkContext === 'string' ? message.benchmarkContext : benchmarkState.activeKey);
          const applicabilityOptions = optionsFor(selectedContext?.key);
          const selected = typeof message.applicability === 'string' ? applicabilityOptions.find(option => option.key === message.applicability && option.available) : undefined;
          const result = createAssistedAssessment(pack, { title: String(message.title ?? ''), checkText: String(message.checkText ?? ''), platform: benchmarkContextPlatform(selectedContext), applicability: selected ? { alias: selected.condition, assessmentId: selected.assessmentId, expectedVersion: selected.expectedVersion } : undefined, objectStyle });
          const document = await api.workspace.openTextDocument({ content: result.yaml, language: 'yaml' });
          const opened = selectedContext
            ? await saveGeneratedAssessmentForBenchmark(api, document, selectedContext, message.title || 'assisted-assessment')
            : await openGeneratedAssessment(api, document);
          if (selectedContext && !opened) { panel.webview.postMessage({ ok: false, message: 'Assessment creation canceled before saving in the selected Benchmark.' }); return; }
          const conditionalNotice = result.unresolved.some((value: string) => /applicability Assessments/i.test(value))
            ? ' Select or create the referenced applicability Assessments before relying on the if/else-if branches.'
            : '';
          panel.webview.postMessage({ ok: true, message: `Annotated ${result.generatedMode} draft opened (${result.confidence} confidence).${conditionalNotice} Review every assumption before use; no scanner result was produced.` });
        } catch (error) { panel.webview.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type !== 'create') return;
      try {
        const selectedContext = forceStandalone || benchmarkState.authoringMode !== 'benchmark' ? undefined : benchmarkContextForKey(contexts, typeof message.benchmarkContext === 'string' ? message.benchmarkContext : benchmarkState.activeKey);
        const applicabilityOptions = optionsFor(selectedContext?.key);
        const selected = typeof message.applicability === 'string' ? applicabilityOptions.find(option => option.key === message.applicability && option.available) : undefined;
        const draft = { ...message, applicability: selected ? { alias: selected.condition, assessmentId: selected.assessmentId, expectedVersion: selected.expectedVersion } : undefined, objectStyle };
        const result = createGuidedAssessment(pack, draft);
        if (result.diagnostics.length) { panel.webview.postMessage({ ok: false, message: `Schema validation: ${result.diagnostics.join('; ')}` }); return; }
        const document = await api.workspace.openTextDocument({ content: result.yaml, language: 'yaml' });
        const opened = selectedContext
          ? await saveGeneratedAssessmentForBenchmark(api, document, selectedContext, message.id || 'new-assessment')
          : await openGeneratedAssessment(api, document);
        if (selectedContext && !opened) { panel.webview.postMessage({ ok: false, message: 'Assessment creation canceled before saving in the selected Benchmark.' }); return; }
        panel.webview.postMessage({ ok: true, message: selectedContext ? 'Assessment saved in the selected Benchmark. Review it in Source or Structured mode; no scanner result was produced.' : 'Assessment created. Review it in Source or Structured mode; no scanner result was produced.' });
      } catch (error) { panel.webview.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    });
    panel.onDidDispose(() => benchmarkState.listeners.delete(stateListener));
    context.subscriptions.push(panel);
  }
}

function pointerPath(pointer: string): string[] {
  return pointer.replace(/^\//, '').split('/').filter(Boolean).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}
function valueAtPath(root: any, path: string[]) {
  let value = root;
  for (const key of path) value = value?.[key];
  return value;
}
function yamlMapAtPath(node: any, path: string[], current: string[] = []): { map: any; pair?: any } | undefined {
  if (path.length === current.length && node?.items) return { map: node };
  if (!node?.items) return undefined;
  for (const pair of node.items) {
    const key = pair.key?.value;
    if (typeof key !== 'string' || path[current.length] !== key) continue;
    if (current.length + 1 === path.length && pair.value?.items) return { map: pair.value, pair };
    const found = yamlMapAtPath(pair.value, path, [...current, key]);
    if (found) return found;
  }
  return undefined;
}
function inlineYaml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineYaml).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${key}: ${inlineYaml(item)}`).join(', ')}}`;
  return stringify(value).trim();
}
function quickFixFragment(choice: { value: string; insertText?: string; defaultValue?: unknown }, block: boolean, style: YamlObjectStyle = 'tree'): string {
  const flow = !block || style === 'compact';
  if (choice.defaultValue !== undefined) {
    if (flow && choice.defaultValue && typeof choice.defaultValue === 'object' && !Array.isArray(choice.defaultValue)) return `${choice.value}: ${inlineYaml(choice.defaultValue)}`;
    if (!flow && choice.defaultValue && typeof choice.defaultValue === 'object' && !Array.isArray(choice.defaultValue)) return `${choice.value}:\n${String(stringify(choice.defaultValue)).trim()}`;
    return `${choice.value}: ${inlineYaml(choice.defaultValue)}`;
  }
  // A flow parent cannot safely contain expanded children. In that case the
  // requested style falls back to the parent's syntax rather than corrupting
  // YAML; `tree` follows the parent by design.
  if (choice.insertText?.endsWith('{')) return flow ? `${choice.value}: {}` : `${choice.value}:`;
  return choice.insertText ?? `${choice.value}: `;
}
function indentYamlFragment(fragment: string, indent: number): string {
  return fragment.split('\n').map((line, index) => `${' '.repeat(index ? indent + 2 : indent)}${line}`).join('\n');
}
function capabilityForPath(value: any, path: string[]): string {
  const tests = path.indexOf('tests');
  const testId = tests >= 0 ? path[tests + 1] : undefined;
  return tests >= 0 && typeof testId === 'string' ? valueAtPath(value, ['assessment', 'tests', testId, 'capability']) ?? '' : '';
}
function isRelevantRequired(parent: any, parentPath: string[], missing: string): boolean {
  if (parentPath.at(-1) === 'require' && ['and', 'or', 'one', 'xor'].includes(missing)) {
    // The canonical comparison branch uses `fields`; Boolean condition
    // alternatives are valid only when the authored branch selects them.
    return Boolean(parent?.item_requirement && parent?.field_requirement && missing === 'fields');
  }
  return true;
}
function schemaRequiredErrors(document: any, pack: MetadataPack): any[] {
  const schemaUri = assessmentSchemaUri(pack);
  if (!schemaUri) return [];
  const parsed = parseDocument(document.getText(), { uniqueKeys: true });
  if (parsed.errors.length || !parsed.contents) return [];
  let value: any;
  try { value = parsed.toJS({ maxAliasCount: 50 }); } catch { return []; }
  const errors = pack.validateDetailed(schemaUri, value).filter(error =>
    error.keyword === 'required' &&
    (!/^#\/oneOf\/\d+\/required$/.test(String(error.schemaPath)) || error.params?.missingProperty === 'fields')
  );
  const tests = value?.assessment?.tests;
  if (tests && typeof tests === 'object' && !Array.isArray(tests)) for (const [testId, test] of Object.entries(tests)) {
    const capability = (test as any)?.capability;
    const object = (test as any)?.object;
    const capabilityUri = capability && pack.manifest.capabilities[capability]?.schema_uri;
    if (!capabilityUri || !object || typeof object !== 'object' || Array.isArray(object)) continue;
    const capabilitySchema: any = pack.resource(capabilityUri);
    const objectSchema = capabilitySchema.$defs?.object;
    // A reviewed native-selector overlay may intentionally replace generated
    // capability field names (for example filepath versus legacy full_path).
    // Keep the generated schema's required-branch diagnostics, but do not
    // report a legacy required member that the active overlay cannot contain.
    const overlayFields = schemaCapabilityObjectProperties(pack, capability);
    const hasOverlay = overlayFields.size > 0;
    const branches = Array.isArray(objectSchema?.oneOf) ? objectSchema.oneOf : [];
    // AJV reports required errors from every oneOf branch. Only publish the
    // branch best matched by authored keys; otherwise deleting hive from a
    // Registry selector misleadingly reports the unrelated set branch too.
    const selectedBranches = new Set<number>();
    if (branches.length) {
      let best = -1; let bestPresent = -1;
      for (let index = 0; index < branches.length; index++) {
        const present = (branches[index].required ?? []).filter((name: string) => Object.hasOwn(object, name)).length;
        if (present > bestPresent) { bestPresent = present; best = index; }
      }
      if (best >= 0) selectedBranches.add(best);
    }
    for (const error of pack.validateDetailed(`${capabilityUri}#/$defs/object`, object)) if (error.keyword === 'required') {
      if (hasOverlay && typeof error.params?.missingProperty === 'string' && !overlayFields.has(error.params.missingProperty)) continue;
      const branch = String(error.schemaPath).match(/^#\/oneOf\/(\d+)\/required$/);
      if (branches.length && (!branch || !selectedBranches.has(Number(branch[1])))) continue;
      if (!branches.length && !/^#\/oneOf\/\d+\/required$/.test(error.schemaPath)) continue;
      errors.push({
        ...error,
        instancePath: `/assessment/tests/${String(testId).replace(/~/g, '~0').replace(/\//g, '~1')}/object${error.instancePath}`
      });
    }
  }
  return errors;
}
function publishSchemaRequiredDiagnostics(document: any, pack: MetadataPack | undefined, diagnostics: any) {
  if (!pack || !isAssessmentFilePath(document.uri?.fsPath ?? document.fileName ?? '')) { diagnostics.delete(document.uri); return; }
  const parsed = parseDocument(document.getText(), { uniqueKeys: true });
  if (parsed.errors.length) { diagnostics.delete(document.uri); return; }
  let value: any;
  try { value = parsed.toJS({ maxAliasCount: 50 }); } catch { diagnostics.delete(document.uri); return; }
  const values: any[] = [];
  const seen = new Set<string>();
  for (const error of schemaRequiredErrors(document, pack)) {
    const key = `${error.instancePath}|${error.params?.missingProperty}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const path = pointerPath(error.instancePath);
    const parent = valueAtPath(value, path);
    if (!isRelevantRequired(parent, path, error.params?.missingProperty)) continue;
    const located = yamlMapAtPath(parsed.contents, path);
    const start = located?.map?.range?.[0] ?? 0;
    const position = document.positionAt(start);
    values.push(new vscode.Diagnostic(new vscode.Range(position.line, position.character, position.line, position.character + 1), `Missing required property '${error.params?.missingProperty}'`, vscode.DiagnosticSeverity.Error));
  }
  diagnostics.set(document.uri, values);
}

function missingRequiredActions(document: any, pack: MetadataPack, api: any): any[] {
  if (!isAssessmentFilePath(document.fileName ?? document.uri?.fsPath ?? '')) return [];
  const schemaUri = assessmentSchemaUri(pack);
  if (!schemaUri) return [];
  const parsed = parseDocument(document.getText(), { uniqueKeys: true });
  if (parsed.errors.length || !parsed.contents) return [];
  let value: any;
  try { value = parsed.toJS({ maxAliasCount: 50 }); } catch { return []; }
  const actions: any[] = [];
  const grouped: Map<string, any> = new Map();
  const seen = new Set<string>();
  for (const error of schemaRequiredErrors(document, pack)) {
    if (typeof error.params?.missingProperty !== 'string') continue;
    const parentPath = pointerPath(error.instancePath);
    const parent = valueAtPath(value, parentPath);
    if (!isRelevantRequired(parent, parentPath, error.params.missingProperty)) continue;
    const key = `${parentPath.join('/')}\0${error.params.missingProperty}`;
    if (seen.has(key) || parent?.[error.params.missingProperty] !== undefined) continue;
    seen.add(key);
    const choices = propertyChoicesForPath(pack, parentPath, capabilityForPath(value, parentPath));
    const choice = choices.find(candidate => candidate.value === error.params.missingProperty);
    if (!choice) continue;
    const located = yamlMapAtPath(parsed.contents, parentPath);
    if (!located) continue;
    const map = located.map;
    const source = document.getText();
    const mapStart = map.range?.[0];
    const mapEnd = map.range?.[1];
    if (!Array.isArray(map.range) || typeof mapStart !== 'number' || typeof mapEnd !== 'number') continue;
    const flow = source[mapStart] === '{' && source[mapEnd - 1] === '}';
    const groupKey = parentPath.join('/');
    const group = grouped.get(groupKey) ?? { parentPath, map, mapStart, mapEnd, flow, source, choices: [] };
    group.choices.push(choice);
    grouped.set(groupKey, group);
    const style = normalizeYamlObjectStyle(api.workspace.getConfiguration('scapNg', document.uri).get('objectStyle'));
    const fragment = quickFixFragment(choice, !flow, style);
    let position: any;
    let text: string;
    if (flow) {
      position = document.positionAt(mapEnd - 1);
      text = `${map.items?.length ? ', ' : ''}${fragment}`;
    } else {
      // yaml's collection range consumes the newline after the last pair, so
      // the insertion point is normally already at the beginning of the next
      // line. Add a separator only for an inline/EOF range and always finish
      // the inserted pair before an existing sibling. This prevents
      // `require: {}  evaluate:`-style corruption.
      const indent = document.positionAt(mapStart).character;
      const before = source.slice(0, mapEnd);
      const after = source.slice(mapEnd);
      const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
      const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
      position = document.positionAt(mapEnd);
      text = `${prefix}${indentYamlFragment(fragment, indent)}${suffix}`;
    }
    const edit = new api.WorkspaceEdit();
    edit.insert(document.uri, position, text);
    const action = new api.CodeAction(`Insert missing '${error.params.missingProperty}'`, api.CodeActionKind?.QuickFix ?? 'quickfix');
    action.edit = edit;
    action.isPreferred = choice.defaultValue !== undefined;
    actions.push(action);
  }
  // When an Object is missing several required identity members, offer one
  // schema-derived action as well as the individual Quick Fixes. This is a
  // single minimal insertion and never invents selector values or operators.
  for (const group of grouped.values()) {
    if (group.parentPath.at(-1) !== 'object' || group.choices.length < 2) continue;
    const uniqueChoices = [...new Map(group.choices.map((choice: any) => [choice.value, choice])).values()];
    if (uniqueChoices.length < 2) continue;
    const style = normalizeYamlObjectStyle(api.workspace.getConfiguration('scapNg', document.uri).get('objectStyle'));
    const fragments = uniqueChoices.map((choice: any) => quickFixFragment(choice, !group.flow, style));
    let position: any;
    let text: string;
    if (group.flow) {
      position = document.positionAt(group.mapEnd - 1);
      text = `${group.map.items?.length ? ', ' : ''}${fragments.join(', ')}`;
    } else {
      const indent = document.positionAt(group.mapStart).character;
      const before = group.source.slice(0, group.mapEnd);
      const after = group.source.slice(group.mapEnd);
      const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
      const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
      position = document.positionAt(group.mapEnd);
      text = `${prefix}${fragments.map((fragment: string) => indentYamlFragment(fragment, indent)).join('\n')}${suffix}`;
    }
    const edit = new api.WorkspaceEdit();
    edit.insert(document.uri, position, text);
    const action = new api.CodeAction(
      `Insert missing required Object properties (${uniqueChoices.map((choice: any) => choice.value).join(', ')})`,
      api.CodeActionKind?.QuickFix ?? 'quickfix'
    );
    action.edit = edit;
    action.isPreferred = false;
    actions.push(action);
  }
  return actions;
}
function assessmentSchemaUri(pack: MetadataPack) {
  return pack.manifest.resources.find((resource: any) => resource.kind === 'schema' && resource.uri.endsWith('/assessment.schema.json'))?.uri;
}

function parseDiagnosticMessage(message: string): string {
  if (/Missing , between flow map items/.test(message)) {
    return `${message} Flow-style mappings require commas between entries; use block mapping syntax (remove the opening and matching closing braces) when entries are on separate lines.`;
  }
  return message;
}
function schemaErrorRange(document: vscode.TextDocument, instancePath: string) {
  try {
    const range = new SourceBuffer(document.getText()).scalarRange(pointerPath(instancePath));
    const start = (document as any).positionAt(range[0]);
    const end = (document as any).positionAt(Math.max(range[0] + 1, range[1]));
    return new vscode.Range(start.line, start.character, end.line, end.character);
  } catch {
    return new vscode.Range(0, 0, 0, 1);
  }
}

function validateDocument(document: vscode.TextDocument, profile: Pin, diagnostics: vscode.DiagnosticCollection, pack?: MetadataPack) {
  const parsed = parseDocument(document.getText(), { uniqueKeys: true });
  const output: vscode.Diagnostic[] = [];
  for (const error of parsed.errors) {
    const offset = error.pos?.[0] ?? 0;
    const position = (document as any).positionAt ? (document as any).positionAt(offset) : { line: 0, character: 0 };
    output.push(new vscode.Diagnostic(new vscode.Range(position.line, position.character, position.line, position.character + 1), parseDiagnosticMessage(error.message), vscode.DiagnosticSeverity.Error));
  }
  if (!output.length) {
    const value = parsed.toJS({ maxAliasCount: 50 }) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) output.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'Assessment document must be a YAML mapping', vscode.DiagnosticSeverity.Error));
    const version = value && (value.version ?? value.specification_version ?? value.schema_version);
    if (typeof version === 'string' && version !== profile.schemaVersion) output.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), `Document version ${version} does not match pinned SCAP-NG ${profile.schemaVersion}`, vscode.DiagnosticSeverity.Error));
    // Red Hat YAML remains an optional presentation/authoring aid. Keep the
    // extension's own pinned-schema diagnostics authoritative so an unresolved
    // external $ref in that optional service cannot make invalid edits appear
    // valid (or make valid canonical content unusable).
    if (!output.length && pack && isAssessmentDocument(document)) {
      const schemaUri = assessmentSchemaUri(pack);
      if (schemaUri && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const error of pack.validateDetailed(schemaUri, value as any)) {
          const path = error.instancePath || '/';
          output.push(new vscode.Diagnostic(schemaErrorRange(document, path), `${path}: ${error.message ?? 'schema validation error'}`, vscode.DiagnosticSeverity.Error));
        }
        for (const error of validateNativeSemantics(value)) {
          output.push(new vscode.Diagnostic(schemaErrorRange(document, '/' + error.path.slice(1).map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')), error.message, vscode.DiagnosticSeverity.Error));
        }
      }
    }
  }
  diagnostics.set(document.uri, output);
}
function yamlAssociationMap(pack: MetadataPack) {
  const byFile: Array<{ suffix: string; patterns: string[] }> = [
    { suffix: '/assessment.schema.json', patterns: ['**/*.assessment.yaml', '**/*.assessment.yml', '**/*-assessment.yaml', '**/*-assessment.yml'] },
    { suffix: '/rule.schema.json', patterns: ['**/*.rule.yaml', '**/*.rule.yml'] },
    { suffix: '/benchmark.schema.json', patterns: ['**/*.benchmark.yaml', '**/*.benchmark.yml'] }
  ];
  const result: Record<string, string[]> = {};
  for (const entry of byFile) {
    const resource: any = pack.manifest.resources.find((candidate: any) => candidate.kind === 'schema' && candidate.uri.endsWith(entry.suffix));
    if (resource) result[apiUriFile(resource, pack)] = entry.patterns;
  }
  return result;
}
function apiUriFile(resource: any, pack: MetadataPack) {
  return vscode.Uri.file(pack.resourcePath(resource.uri)).toString();
}
async function configureNativeYamlWorkspace(pack: MetadataPack, api: any) {
  if (!api.workspace.workspaceFolders?.length || !api.workspace.getConfiguration) return false;
  const target = api.ConfigurationTarget?.Workspace ?? 2;
  const yamlConfiguration = api.workspace.getConfiguration('yaml');
  const existing = yamlConfiguration.get('schemas', {}) ?? {};
  const associations = { ...(typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), ...yamlAssociationMap(pack) };
  await yamlConfiguration.update('schemas', associations, target);
  await yamlConfiguration.update('completion', false, target);
  const resource = api.window.activeTextEditor?.document?.uri ?? api.workspace.workspaceFolders?.[0]?.uri;
  const rootConfiguration = api.workspace.getConfiguration(undefined, resource);
  const existingYaml = rootConfiguration.get('[yaml]', {}) ?? {};
  const yamlEditorSettings = { ...(typeof existingYaml === 'object' && !Array.isArray(existingYaml) ? existingYaml : {}), 'editor.wordBasedSuggestions': 'off' };
  await rootConfiguration.update('[yaml]', yamlEditorSettings, target);
  await rootConfiguration.update('yaml.schemaStore.enable', false, target);
  return true;
}
function isAssessmentDocument(document: any): boolean {
  return Boolean(document && isAssessmentFilePath(document.uri?.fsPath ?? document.fileName ?? ''));
}
function yamlStatusDetails(pack: MetadataPack | undefined, document: any, profile: Pin, api: any, build: BuildInfo, packError?: string) {
  const redhat = api.extensions?.getExtension?.('redhat.vscode-yaml');
  const schemaUri = pack ? assessmentSchemaUri(pack) : undefined;
  const schemas = document && api.workspace.getConfiguration ? api.workspace.getConfiguration('yaml', document.uri).get('schemas', {}) ?? {} : {};
  const schemaPath = schemaUri && pack ? api.Uri.file(pack.resourcePath(schemaUri)).toString() : undefined;
  const associated = Boolean(schemaPath && Object.hasOwn(schemas, schemaPath));
  const diagnostics = document && api.languages?.getDiagnostics ? api.languages.getDiagnostics(document.uri) : [];
  const error = packError || (!pack ? 'Verified offline SCAP-NG metadata pack is unavailable.' : undefined);
  const state = error ? 'error' : associated && !diagnostics.length ? 'healthy' : 'partial';
  return {
    visible: isAssessmentDocument(document), recognized: isAssessmentDocument(document), state,
    text: state === 'healthy' ? `$(check) SCAP-NG ${profile.schemaVersion} · ${build.buildId}` : state === 'error' ? `$(error) SCAP-NG YAML · ${build.buildId}` : `$(warning) SCAP-NG ${profile.schemaVersion} · ${build.buildId}`,
    buildId: build.buildId, builtAt: build.builtAt, sourceCommit: build.sourceCommit,
    document: document?.uri?.fsPath ?? '', languageId: document?.languageId ?? '',
    schemaUri: schemaUri ?? '', schemaVersion: pack?.pin.schemaVersion ?? profile.schemaVersion,
    schemaPath: schemaPath ?? '', packPath: pack?.directory ?? '', packSha256: pack?.pin.manifestSha256 ?? '',
    redhatInstalled: Boolean(redhat), redhatVersion: redhat?.packageJSON?.version ?? '', redhatActive: Boolean(redhat?.isActive), associationPresent: associated,
    diagnostics: diagnostics.length, error: error ?? (associated ? '' : 'Pinned Assessment schema association is not present.')
  };
}
function discoverPackPath(documentPath: string | undefined) {
  if (!documentPath) return undefined;
  let directory = dirname(documentPath);
  for (;;) {
    const candidate = join(directory, '.external', 'editor-pack');
    if (existsSync(join(candidate, 'manifest.json'))) return candidate;
    const parent = dirname(directory); if (parent === directory) return undefined; directory = parent;
  }
}

function registerYamlCompletionProvider(context: vscode.ExtensionContext, getPack: () => MetadataPack | undefined, api: any) {
  if (!api.languages?.registerCompletionItemProvider) return;
  const normalizeIndentCommand = 'scapNg.normalizeYamlCompletionIndent';
  context.subscriptions.push(api.commands.registerCommand(normalizeIndentCommand, async (uri: any, line: number, indent: number) => {
    try {
      const document = await api.workspace.openTextDocument(uri);
      if (!Number.isInteger(line) || line < 0 || line >= document.lineCount) return;
      const text = document.lineAt(line).text;
      const leading = text.match(/^\s*/)?.[0] ?? '';
      if (!text.slice(leading.length).trim() || leading.length === indent) return;
      const edit = new api.WorkspaceEdit();
      edit.replace(uri, new api.Range(line, 0, line, leading.length), ' '.repeat(Math.max(0, indent)));
      await api.workspace.applyEdit(edit);
    } catch { /* Completion remains usable if a host declines the follow-up edit. */ }
  }));
  const redhatExtension = api.extensions?.getExtension?.('redhat.vscode-yaml');
  if (redhatExtension && !redhatExtension.isActive) void redhatExtension.activate().catch(() => undefined);
  const redhatOwnsSchema = (pack: MetadataPack) => {
    const yamlConfiguration = api.workspace.getConfiguration('yaml');
    const configuredSchemas = yamlConfiguration.get('schemas', {}) ?? {};
    const assessmentSchemaUri = Object.keys(yamlAssociationMap(pack)).find(uri => Object.hasOwn(configuredSchemas, uri));
    // Red Hat owns hover/validation. The schema-driven SCAP-NG adapter owns
    // completion in this workspace so a broken/stale Red Hat completion channel
    // cannot leave authors with an empty menu or duplicate entries.
    return Boolean(redhatExtension?.isActive && assessmentSchemaUri && yamlConfiguration.get('completion') !== false);
  };
  const provider = {
    provideCompletionItems(document: any, position: any) {
      // Do not inject SCAP-NG vocabulary into ordinary YAML documents. The
      // native YAML language id remains intact; this provider is resource
      // scoped to Assessment authoring files only.
      if (!isAssessmentFilePath(document.uri?.fsPath ?? document.fileName ?? '')) return [];
      const pack = getPack();
      if (!pack) return [];
      const offset = typeof document.offsetAt === 'function' ? document.offsetAt(position) : document.getText().length;
      return completionChoices(pack, document.getText(), offset, redhatOwnsSchema(pack)).map(choice => {
        const kind = choice.kind === 'property' ? api.CompletionItemKind?.Property ?? 10 : api.CompletionItemKind?.Value ?? 12;
        const item = new api.CompletionItem(choice.value, kind);
        const documentText = typeof document.getText === 'function' ? document.getText() : '';
        const nextCharacter = choice.kind === 'property' ? documentText.slice(offset, offset + 1) : '';
        const linePrefix = typeof document.lineAt === 'function'
          ? document.lineAt(position.line).text.slice(0, position.character)
          : '';
        const flowMapping = linePrefix.lastIndexOf('{') > linePrefix.lastIndexOf('}') || inlineMappingPath(documentText.slice(0, offset)).length > 0;
        const objectStyle = normalizeYamlObjectStyle(api.workspace.getConfiguration('scapNg', document.uri).get('objectStyle'));
        const useFlowMapping = flowMapping || objectStyle === 'compact';
        let propertyInsert = choice.insertText ?? `${choice.value}: `;
        const objectDefault = choice.defaultValue && typeof choice.defaultValue === 'object' && !Array.isArray(choice.defaultValue);
        // A schema object must not force authors into flow syntax. In a block
        // mapping, `require: {` followed by newline-authored children is
        // invalid YAML unless commas are added. The tree default follows the
        // surrounding mapping, while compact is explicit for new mappings.
        if (!useFlowMapping && (propertyInsert.endsWith('{') || objectDefault)) propertyInsert = `${choice.value}:`;
        else if (useFlowMapping && objectDefault && objectStyle === 'compact') propertyInsert = `${choice.value}: ${inlineYaml(choice.defaultValue)}`;
        // If the user deleted only the property name, preserve the existing
        // colon (`k: ...`) instead of producing `key: : ...`.
        let completionInsert = choice.kind === 'property'
          ? (nextCharacter === ':' ? choice.value : propertyInsert)
          : choice.value;
        // A child mapping requested immediately after `fields:`/`require:`
        // must start on the next indented block line. Inserting the key after
        // the parent's colon creates invalid `fields: mount_options:` YAML.
        // Flow mappings and already-indented sequence items stay compact.
        const blankParent = linePrefix.match(/^(\s*)(?:-\s*)?[A-Za-z_][A-Za-z0-9_-]*:\s*$/);
        let normalizeInsertedLine: { line: number; indent: number } | undefined;
        if (choice.kind === 'property' && !flowMapping && objectStyle !== 'compact' && blankParent && nextCharacter !== ':') {
          // Keep the textual edit minimal, then normalize the newly created
          // line after VS Code/Red Hat YAML has had a chance to apply its own
          // indentation. This avoids both same-level children and doubled
          // indentation across hosts/settings.
          const editor = api.workspace?.getConfiguration?.('editor', document.uri);
          const tabSize = Number(editor?.get?.('tabSize') ?? document.options?.tabSize ?? 2);
          const step = Number.isFinite(tabSize) && tabSize > 0 ? tabSize : 2;
          completionInsert = `\n${completionInsert}`;
          normalizeInsertedLine = { line: position.line + 1, indent: blankParent[1].length + step };
        }
        item.insertText = completionInsert;
        if (normalizeInsertedLine) {
          item.command = {
            command: normalizeIndentCommand,
            title: 'Normalize YAML completion indentation',
            arguments: [document.uri, normalizeInsertedLine.line, normalizeInsertedLine.indent]
          };
        }
        item.range = typeof document.getWordRangeAtPosition === 'function'
          ? (document.getWordRangeAtPosition(position, /[A-Za-z0-9_.-]+/) ?? new api.Range(position, position))
          : new api.Range(position, position);
        item.detail = choice.kind === 'property'
          ? (choice.isDefault ? 'Valid schema default' : choice.isPlaceholder ? 'Schema skeleton; complete required fields' : 'Pinned schema property')
          : `Pinned SCAP-NG metadata${choice.isDefault ? ' (schema default)' : ''}`;
        item.documentation = choice.description;
        return item;
      });
    }
  };
  // Keep the selector resource-scoped. A language-only selector is merged with
  // VS Code's word provider and produces unrelated document-word suggestions.
  context.subscriptions.push(api.languages.registerCompletionItemProvider({ language: 'yaml', scheme: 'file' }, provider, ':', '_'));
}

function registerYamlCodeActions(context: vscode.ExtensionContext, getPack: () => MetadataPack | undefined, api: any) {
  if (!api.languages?.registerCodeActionsProvider) return;
  const provider = { provideCodeActions(document: any) {
    const pack = getPack();
    return pack ? missingRequiredActions(document, pack, api) : [];
  }};
  context.subscriptions.push(api.languages.registerCodeActionsProvider({ language: 'yaml', scheme: 'file' }, provider, { providedCodeActionKinds: [api.CodeActionKind?.QuickFix ?? 'quickfix'] }));
}

export function activate(context: vscode.ExtensionContext) {
  const api: any = vscode;
  const profile = readProfile(context.extensionPath);
  let pack: MetadataPack | undefined;
  let packConfiguration: Promise<boolean> | undefined;
  let packError: string | undefined;
  let packWarningShown = false;
  const loadPack = (documentPath?: string) => {
    if (pack) return pack;
    packError = undefined;
    const configuredPack = vscode.workspace.getConfiguration('scapNg').get<string>('schemaPackPath');
    const candidate = configuredPack || discoverPackPath(documentPath);
    if (!candidate) { packError = 'No verified offline SCAP-NG metadata pack was found for this workspace.'; return undefined; }
    try {
      pack = new MetadataPack(candidate, profile);
      packConfiguration = configureNativeYamlWorkspace(pack, vscode);
    } catch (error) {
      packError = error instanceof Error ? error.message : String(error);
      if (!packWarningShown) { packWarningShown = true; void vscode.window.showWarningMessage(`SCAP-NG metadata pack rejected: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return pack;
  };
  const initialDocumentPath = (vscode.window as any).activeTextEditor?.document?.uri?.fsPath;
  const initialWorkspacePath = (vscode.workspace as any).workspaceFolders?.[0]?.uri?.fsPath;
  // A blank workspace has no active document yet. Still walk from the
  // workspace root so the verified sibling .external/editor-pack is loaded
  // before the Authoring Home is displayed.
  loadPack(initialDocumentPath || initialWorkspacePath);
  const syncEditorPreference = () => void synchronizeAssessmentEditorPreference(api).catch(() => { /* a read-only settings host may decline this optional convenience */ });
  syncEditorPreference();
  const index = new WorkspaceIndex();
  const benchmarkState = contextState(context);
  const automationAnalysis = new Map<string, BenchmarkAutomationAnalysis>();
  const welcomeContextInfo = (): WelcomeContextInfo => {
    const contexts = benchmarkContexts(index, benchmarkState.importedRoots);
    const selected = benchmarkState.authoringMode === 'benchmark' ? benchmarkContextForKey(contexts, benchmarkState.activeKey) : undefined;
    if (!selected) {
      // workspaceState is restored before the asynchronous index is ready.
      // Keep Home in a selected/restoring state so users do not mistake the
      // initial scan window for a lost Benchmark selection.
      if (benchmarkState.authoringMode === 'benchmark' && benchmarkState.activeKey && benchmarkState.indexing) return { benchmarkRootSelected: true, authoringMode: 'benchmark', benchmarkLabel: 'Restoring saved Benchmark…', benchmarkRootPath: benchmarkState.importedRoots.at(-1) };
      return { benchmarkRootSelected: false, authoringMode: benchmarkState.authoringMode, benchmarkRootPath: benchmarkState.importedRoots.at(-1) };
    }
    const labels = benchmarkContextLabels(contexts);
    return {
      benchmarkRootSelected: true,
      authoringMode: 'benchmark',
      benchmarkLabel: labels.get(selected.key),
      benchmarkRootPath: benchmarkState.importedRoots.at(-1) ?? selected.packagePath,
      profileCount: selected.profiles.length,
      ruleCount: selected.ruleCount,
      assessmentCount: selected.assessmentCount,
      applicabilityCount: selected.applicabilityCount,
      conditionCount: selected.conditionCount,
      automation: selected.automation,
      automationAnalysis: automationAnalysis.get(selected.key) ?? { state: 'not-run', likelyAutomatable: 0, likelyRuleUris: [], scanned: 0, total: selected.automation.needsAutomation }
    };
  };
  const tree = new StudioTree(index);
  const diagnostics = vscode.languages.createDiagnosticCollection('scap-ng');
  const schemaDiagnostics = vscode.languages.createDiagnosticCollection('scap-ng-schema');
  const indexDiagnostics = vscode.languages.createDiagnosticCollection('scap-ng-index');
  registerYamlCompletionProvider(context, () => pack, api);
  registerYamlDefinitionProvider(context, () => pack, api);
  registerYamlHoverProvider(context, () => pack, api);
  registerYamlCodeActions(context, () => pack, api);
  const build = readBuildInfo(context.extensionPath);
  // Test harness hook only: a real Extension Development Host can open the
  // graphical surface for screenshot/host receipts without changing the
  // default YAML-first activation path.
  if (process.env.SCAP_NG_GRAPHICAL_HOST === '1') setTimeout(async () => {
    const active = api.window.activeTextEditor?.document;
    const candidate = active && isAssessmentFilePath(active.uri?.fsPath ?? '') ? active : undefined;
    if (candidate) await api.commands.executeCommand('vscode.openWith', candidate.uri, 'scapNg.assessment', { viewColumn: api.ViewColumn?.One ?? 1, preserveFocus: false, preview: false });
  }, 3000);
  const resetPack = () => {
    pack = undefined;
    packConfiguration = undefined;
    packError = undefined;
    packWarningShown = false;
    loadPack((api.window as any).activeTextEditor?.document?.uri?.fsPath);
  };
  const authoringSidebar = new AuthoringSidebarProvider(context, () => pack, profile, build, () => { resetPack(); syncEditorPreference(); });
  const readAiConfiguration = (): AiAuthoringConfiguration => {
    const configuration = api.workspace.getConfiguration('scapNg.ai');
    const mode = normalizeAiAssistanceMode(configuration.get('mode'));
    const endpoint = configuration.get('endpoint', '') ?? '';
    const model = configuration.get('model', '') ?? '';
    return { mode, endpoint, model };
  };
  const writeAiConfiguration = async (value: AiAuthoringConfiguration): Promise<AiAuthoringConfiguration> => {
    const endpointError = aiEndpointError(value.mode, value.endpoint);
    if (endpointError) throw new Error(endpointError);
    const configuration = api.workspace.getConfiguration('scapNg.ai');
    if (typeof configuration?.update !== 'function') throw new Error('AI settings are unavailable in this VS Code session.');
    const saved = { mode: normalizeAiAssistanceMode(value.mode), endpoint: value.endpoint.trim(), model: value.model.trim() };
    await configuration.update('mode', saved.mode, api.ConfigurationTarget?.Global ?? 1);
    await configuration.update('endpoint', saved.endpoint || undefined, api.ConfigurationTarget?.Global ?? 1);
    await configuration.update('model', saved.model || undefined, api.ConfigurationTarget?.Global ?? 1);
    authoringSidebar.refreshContext();
    AiConfigurationPanel.update(saved);
    return saved;
  };
  benchmarkState.onChange = () => {
    WelcomePanel.updateContext(welcomeContextInfo(), Boolean(pack));
    authoringSidebar.refreshContext();
    for (const listener of benchmarkState.refreshListeners) listener();
  };
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('scapNg-authoringSidebar', authoringSidebar));
  if (api.workspace.onDidChangeConfiguration) context.subscriptions.push(api.workspace.onDidChangeConfiguration((event: any) => {
    if (event?.affectsConfiguration?.('scapNg.assessmentEditor')) {
      syncEditorPreference();
      void openConfiguredSplitSource(api);
    }
    if (event?.affectsConfiguration?.('scapNg.ai')) authoringSidebar.refreshContext();
  }));
  const revealAuthoring = async () => {
    // Secondary-bar containers are not consistently addressable through one
    // workbench command across VS Code releases. Try both forms; some builds
    // resolve the first command without actually moving focus to the view.
    let opened = false;
    try { await api.commands.executeCommand('workbench.action.openView', 'scapNg-authoringSidebar'); opened = true; } catch { /* try container form */ }
    try { await api.commands.executeCommand('workbench.view.extension.scapNg-authoring'); return true; } catch { return opened; }
  };
  const yamlStatus = api.window.createStatusBarItem(api.StatusBarAlignment?.Right ?? 2, 100);
  yamlStatus.command = 'scapNg.showYamlStatus';
  let currentYamlStatus: any;
  const refreshYamlStatus = async (document: any = api.window.activeTextEditor?.document) => {
    if (!isAssessmentDocument(document)) { yamlStatus.hide(); currentYamlStatus = undefined; return undefined; }
    loadPack(document.uri.fsPath);
    if (packConfiguration) { try { await packConfiguration; } catch { /* status reports association state */ } }
    currentYamlStatus = yamlStatusDetails(pack, document, profile, api, build, packError);
    yamlStatus.text = currentYamlStatus.text;
    yamlStatus.tooltip = `SCAP-NG ${profile.schemaVersion} · build ${build.buildId} · ${currentYamlStatus.state} · click for diagnostics`;
    yamlStatus.show();
    return currentYamlStatus;
  };
  context.subscriptions.push(yamlStatus);
  // Keep the suppression and schema association workspace-scoped. This avoids
  // changing ordinary YAML files in other workspaces or the user's global settings.
  context.subscriptions.push(diagnostics, schemaDiagnostics, indexDiagnostics, vscode.window.registerTreeDataProvider('scapNg-assessmentStudio', tree), vscode.window.registerWebviewViewProvider('scapNg.pinView', new PinView(context)));
  benchmarkState.indexing = true;
  const indexReady = indexWorkspaceAndImportedRoots(index, tree, api, indexDiagnostics, benchmarkState);
  benchmarkState.ready = indexReady.then(() => { benchmarkState.indexing = false; benchmarkState.onChange?.(); }, error => { benchmarkState.indexing = false; benchmarkState.onChange?.(); throw error; });
  if (api.workspace.createFileSystemWatcher) {
    for (const pattern of ['**/*.yaml', '**/*.yml']) {
      const watcher = api.workspace.createFileSystemWatcher(pattern);
      context.subscriptions.push(watcher, watcher.onDidCreate((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics, benchmarkState)), watcher.onDidChange((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics, benchmarkState)), watcher.onDidDelete((uri: any) => { if (!isAutomationMetadataPath(uri.fsPath ?? '')) index.remove(uri.toString()); loadAutomationMetadata(index, benchmarkState.importedRoots); publishIndexDiagnostics(index, indexDiagnostics, api); tree.refresh(); benchmarkState.onChange?.(); }));
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.openAssessmentAuthoringPrototype', async (argument: any) => {
    const candidate = argument?.document?.getText ? argument.document : undefined;
    const candidates = [
      argument?.resourceUri,
      argument?.uri,
      argument?.scheme ? argument : undefined,
      api.window.activeTextEditor?.document?.uri,
      api.window.tabGroups?.activeTabGroup?.activeTab?.input?.uri,
      ...(api.window.tabGroups?.all ?? []).flatMap((group: any) => (group.tabs ?? []).filter((tab: any) => tab.isActive).map((tab: any) => tab.input?.uri))
    ].filter(Boolean);
    let document = candidate ?? api.window.activeTextEditor?.document;
    for (const uri of candidates) {
      if (document) break;
      try { document = await api.workspace.openTextDocument(uri); } catch { /* Try the next active-tab/resource URI. */ }
    }
    AssessmentAuthoringPrototypePanel.open(context, document, () => pack);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.openAuthoringSidebar', async () => {
    if (await revealAuthoring()) return;
    await api.commands.executeCommand('workbench.action.openView');
    void api.window.showInformationMessage('Select the SCAP-NG Authoring view from the Open View picker.');
  }));
  const remoteApiKeySecret = 'scapNg.ai.remoteApiKey';
  const aiConfigurationActions = {
    storeRemoteApiKey: async () => {
      const secrets = (context as any).secrets;
      if (typeof secrets?.store !== 'function') throw new Error('VS Code SecretStorage is unavailable in this session.');
      const value = await api.window.showInputBox({ prompt: 'Enter the API key for the configured remote gateway', password: true, ignoreFocusOut: true, placeHolder: 'The key is stored only in VS Code SecretStorage.' });
      if (value === undefined) return 'Key entry canceled.';
      if (!String(value).trim()) return 'No key was stored.';
      await secrets.store(remoteApiKeySecret, String(value).trim());
      return 'Remote API key stored securely. The key is not displayed or written to settings.';
    },
    clearRemoteApiKey: async () => {
      const secrets = (context as any).secrets;
      if (typeof secrets?.delete !== 'function') throw new Error('VS Code SecretStorage is unavailable in this session.');
      await secrets.delete(remoteApiKeySecret);
      return 'Stored remote API key deleted.';
    },
    testRemote: async (configuration?: AiAuthoringConfiguration) => {
      const secrets = (context as any).secrets;
      const key = typeof secrets?.get === 'function' ? await secrets.get(remoteApiKeySecret) : undefined;
      const target = configuration ?? readAiConfiguration();
      if (target.mode !== 'remote') return { message: 'Select Configured remote AI before testing a gateway.' };
      const result = await testOpenAiCompatibleGateway(target.endpoint, key ?? '');
      return { message: result.message, models: result.modelIds };
    },
    testAuthoring: async (configuration?: AiAuthoringConfiguration) => {
      const target = configuration ?? readAiConfiguration();
      if (target.mode !== 'remote') return { message: 'Select Configured remote AI before running the AI authoring self-test.' };
      const secrets = (context as any).secrets;
      const key = typeof secrets?.get === 'function' ? await secrets.get(remoteApiKeySecret) : undefined;
      const activePack = pack;
      if (!activePack) return { message: 'A verified offline SCAP-NG 0.4.1 metadata pack is required for the AI authoring self-test.' };
      const draft = await createAiAssessmentDraft(activePack, context.extensionPath, target.endpoint, key ?? '', target.model, {
        ruleId: 'scap-ng-ai-self-test-rule',
        title: 'SCAP-NG AI authoring self-test',
        checkText: 'Verify that the file /etc/passwd is present on the system.',
        platform: 'linux'
      });
      if (draft.diagnostics.length) return { message: `AI request completed, but the self-test draft was rejected: ${draft.diagnostics.slice(0, 3).join(' ')}` };
      return { message: `AI authoring self-test succeeded: ${draft.generatedMode} draft, confidence ${draft.confidence}. No workspace files were changed.` };
    },
    discoverRemoteModels: async (configuration?: AiAuthoringConfiguration) => {
      const secrets = (context as any).secrets;
      const key = typeof secrets?.get === 'function' ? await secrets.get(remoteApiKeySecret) : undefined;
      const target = configuration ?? readAiConfiguration();
      if (target.mode !== 'remote') return { message: 'Select Configured remote AI before querying models.' };
      const result = await testOpenAiCompatibleGateway(target.endpoint, key ?? '');
      return { message: result.message, models: result.modelIds };
    }
  };
  const aiAssessmentGenerator: AiAssessmentGenerator = async (input: AiAssessmentInput) => {
    const target = readAiConfiguration();
    if (target.mode !== 'remote') throw new Error('Configured AI assistance is not enabled. Select Configured remote AI first.');
    const secrets = (context as any).secrets;
    const key = typeof secrets?.get === 'function' ? await secrets.get(remoteApiKeySecret) : undefined;
    const activePack = pack;
    if (!activePack) throw new Error('A verified offline SCAP-NG 0.4.1 metadata pack is required for AI authoring.');
    const toolProfile = `${target.endpoint.replace(/\/$/, '')}\u0000${target.model.trim()}`;
    const globalState = (context as any).globalState;
    const rejectedProfiles = typeof globalState?.get === 'function' ? (globalState.get('scapNg.ai.rejectedToolProfiles', []) as string[] ?? []) : [];
    return createAiAssessmentDraft(activePack, context.extensionPath, target.endpoint, key ?? '', target.model, input, {
      skipTools: rejectedProfiles.includes(toolProfile),
      onToolsRejected: () => {
        const next = [...new Set([...rejectedProfiles, toolProfile])].slice(-32);
        // Await the cache write before the fallback request completes so an
        // immediate VS Code reload does not repeat the known-bad negotiation.
        return typeof globalState?.update === 'function' ? globalState.update('scapNg.ai.rejectedToolProfiles', next) : undefined;
      }
    });
  };
  const configuredAiGenerator = () => readAiConfiguration().mode === 'remote' ? aiAssessmentGenerator : undefined;
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.openAiConfiguration', () => AiConfigurationPanel.open(context, readAiConfiguration, writeAiConfiguration, aiConfigurationActions)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.testAiAuthoring', async () => { const result = await aiConfigurationActions.testAuthoring(); const message = result.message; if (/succeeded/i.test(message)) await api.window.showInformationMessage(message); else await api.window.showWarningMessage(message); return result; }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.setAiMode', async (value: unknown) => {
    const mode = normalizeAiAssistanceMode(value);
    const configuration = api.workspace.getConfiguration('scapNg.ai');
    if (typeof configuration?.update !== 'function') throw new Error('AI settings are unavailable in this VS Code session.');
    await configuration.update('mode', mode, api.ConfigurationTarget?.Global ?? 1);
    const saved = readAiConfiguration();
    authoringSidebar.refreshContext();
    AiConfigurationPanel.update(saved);
    return saved;
  }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.openWelcome', () => WelcomePanel.open(context, () => Boolean(pack), build, welcomeContextInfo)));
  context.subscriptions.push(api.commands.registerCommand('scapNg.openAssessmentFile', async () => {
    const contexts = benchmarkContexts(index, benchmarkState.importedRoots);
    const selected = benchmarkContextForKey(contexts, benchmarkState.activeKey);
    if (benchmarkState.authoringMode === 'benchmark' && selected) {
      await openBenchmarkAssessmentPanel(context, index, api, benchmarkState);
      return;
    }
    await openStandaloneAssessmentFile(api);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.refreshContentIndex', async () => {
    automationAnalysis.clear();
    const refresh = () => refreshContentIndex(index, tree, api, indexDiagnostics, benchmarkState);
    try {
      const count = api.window.withProgress
        ? await api.window.withProgress({ location: api.ProgressLocation?.Window ?? 10, title: 'Refreshing Benchmark data…' }, refresh)
        : await refresh();
      await api.window.showInformationMessage(`Benchmark data refreshed (${count} YAML files indexed).`);
    } catch (error) {
      await api.window.showErrorMessage(`Benchmark data refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.searchIndex', async () => {
    try { return await searchStudioIndex(api, index); }
    catch (error) { await api.window.showErrorMessage(`Assessment Studio search failed: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
  }));
  context.subscriptions.push(api.commands.registerCommand('scapNg.configureYamlSchemas', async () => {
    if (!pack) { await api.window.showWarningMessage('Configure a verified offline SCAP-NG metadata pack before associating native YAML schemas.'); return; }
    const configured = await configureNativeYamlWorkspace(pack, api);
    const installed = Boolean(api.extensions?.getExtension?.('redhat.vscode-yaml'));
    await api.window.showInformationMessage(configured
      ? `Pinned SCAP-NG ${pack.pin.schemaVersion} YAML settings saved for this workspace${installed ? ' (Red Hat YAML detected).' : '. Install Red Hat YAML to activate language-service completion/hover.'}`
      : 'Open the SCAP-NG folder as a workspace before configuring native YAML settings.');
  }));
  context.subscriptions.push(api.commands.registerCommand('scapNg.openAssessmentStudio', async (argument: any) => {
    const uri = argument?.uri ?? argument ?? api.window.activeTextEditor?.document?.uri;
    // The graphical-editor command is also exposed prominently in the empty
    // Assessment Studio view. Never strand a first-time user with a file-first
    // warning: without an Assessment, Home is the actionable creation surface.
    if (!uri || !isAssessmentFilePath(uri.fsPath ?? '')) {
      WelcomePanel.open(context, () => Boolean(pack), build, welcomeContextInfo);
      return;
    }
    const selected = benchmarkContextForKey(benchmarkContexts(index, benchmarkState.importedRoots), benchmarkState.activeKey);
    if (selected && !selected.assessments.some(assessment => assessment.uri === uri.toString())) {
      await api.window.showWarningMessage('This Assessment is not associated with the selected Benchmark. Use Home to change Benchmark context or open an associated Assessment.');
      return;
    }
    await api.commands.executeCommand('vscode.openWith', uri, 'scapNg.assessment', { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
  }));
  const scopeForAssessment = (document: any): AssessmentEditorScope => {
    const contexts = benchmarkContexts(index, benchmarkState.importedRoots);
    const selected = benchmarkState.authoringMode === 'benchmark'
      ? benchmarkContextForKey(contexts, benchmarkState.activeKey)
      : undefined;
    const path = String(document?.uri?.fsPath ?? document?.fileName ?? '');
    // A Benchmark Assessment is identified by its selected content package, not
    // by a source filename. This also covers newly saved Assessments before the
    // asynchronous workspace index has observed the file.
    if (selected && pathWithinRoot(selected.packagePath, path)) {
      const label = benchmarkContextLabels(contexts).get(selected.key)
        ?? selected.benchmark.title ?? selected.benchmark.id ?? 'Selected Benchmark';
      return { mode: 'benchmark', benchmarkLabel: label };
    }
    return { mode: 'standalone' };
  };
  context.subscriptions.push(api.window.registerCustomEditorProvider('scapNg.assessment', new AssessmentEditorProvider(() => pack, scopeForAssessment, uri => assessmentExternalReferenceData(index, uri)), { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.showPin', () => vscode.window.showInformationMessage(`SCAP-NG ${profile.schemaVersion} · ${profile.sourceCommit} · Build ${buildLabel(build)} · ${yamlServiceLabel(api)}`)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.showBuildInfo', () => vscode.window.showInformationMessage(`SCAP-NG build ${buildLabel(build)} · source ${build.sourceCommit} · ${yamlServiceLabel(api)}`)));
  context.subscriptions.push(api.commands.registerCommand('scapNg.showYamlStatus', async () => {
    const details = await refreshYamlStatus(api.window.activeTextEditor?.document);
    const channel = api.window.createOutputChannel('SCAP-NG YAML Status'); channel.clear();
    if (!details) channel.appendLine('No recognized SCAP-NG Assessment document is active.');
    else for (const line of [
      `State: ${details.state}`, `Build: ${details.buildId} · ${details.builtAt}`, `Source commit: ${details.sourceCommit}`, `Document: ${details.document}`, `Language ID: ${details.languageId}`,
      `Schema: ${details.schemaUri || 'unavailable'} (${details.schemaVersion})`, `Schema path: ${details.schemaPath || 'unavailable'}`,
      `Pack: ${details.packPath || 'unavailable'}`, `Pack manifest SHA-256: ${details.packSha256 || 'unavailable'}`,
      `Red Hat YAML: ${details.redhatInstalled ? `installed ${details.redhatVersion || 'unknown'}, active=${details.redhatActive}` : 'not installed'}`,
      `Schema association: ${details.associationPresent ? 'present' : 'missing'}`, `Diagnostics: ${details.diagnostics}`,
      `Error: ${details.error || 'none'}`, 'Commands: SCAP-NG: Diagnose native YAML; SCAP-NG: Configure native YAML schemas'
    ]) channel.appendLine(line);
    channel.show(true);
    const summary = !details
      ? 'No recognized SCAP-NG Assessment document is active.'
      : `SCAP-NG ${details.schemaVersion} · build ${details.buildId} · ${details.state} · Red Hat YAML ${details.redhatInstalled ? `${details.redhatVersion || 'unknown'}${details.redhatActive ? ', active' : ', inactive'}` : 'not installed'} · schema ${details.associationPresent ? 'associated' : 'missing'}`;
    void api.window.showInformationMessage(summary);
    return details;
  }));
  context.subscriptions.push(api.commands.registerCommand('scapNg.diagnoseYaml', async () => {
    const editor = api.window.activeTextEditor; const document = editor?.document; const yaml = api.workspace.getConfiguration('yaml');
    const schemas = yaml.get('schemas', {}) ?? {}; const override = document ? api.workspace.getConfiguration('editor', document.uri).get('wordBasedSuggestions') : undefined;
    const redhat = api.extensions?.getExtension?.('redhat.vscode-yaml'); const expectedSchemas = pack ? Object.keys(yamlAssociationMap(pack)) : [];
    let cursorCompletion = 'unavailable'; let classCompletion = 'unavailable';
    if (document) {
      try {
        const cursor = await api.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, editor.selection.active);
        cursorCompletion = (cursor?.items ?? []).map((item: any) => typeof item.label === 'string' ? item.label : item.label?.label).filter(Boolean).slice(0, 20).join(', ') || 'none';
        const classLine = [...Array(document.lineCount).keys()].find((line: number) => document.lineAt(line).text.includes('class:'));
        if (classLine !== undefined) { const line = document.lineAt(classLine).text; const position = new api.Position(classLine, line.length); const result = await api.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri, position); classCompletion = (result?.items ?? []).map((item: any) => typeof item.label === 'string' ? item.label : item.label?.label).filter(Boolean).slice(0, 20).join(', ') || 'none'; }
      } catch (error) { cursorCompletion = `error: ${error instanceof Error ? error.message : String(error)}`; }
    }
    const channel = api.window.createOutputChannel('SCAP-NG Diagnostics'); channel.clear();
    for (const line of [
      `Build: ${buildLabel(build)}`,
      `Document: ${document?.uri?.fsPath ?? 'none'}`,
      `Language ID: ${document?.languageId ?? 'none'}`,
      `SCAP-NG pack: ${pack ? pack.directory : 'not loaded'}`,
      `Red Hat YAML: ${redhat ? `installed ${redhat.packageJSON?.version ?? ''}, active=${redhat.isActive}` : 'not detected'}`,
      `wordBasedSuggestions: ${override ?? 'not set in workspace'}`,
      `SCAP-NG schema association: ${expectedSchemas.some(uri => Object.hasOwn(schemas, uri)) ? 'present' : 'missing'}`,
      `Workspace folders: ${api.workspace.workspaceFolders?.length ?? 0}`,
      `Completion at cursor: ${cursorCompletion}`,
      `Completion at class value: ${classCompletion}`
    ]) channel.appendLine(line);
    channel.show(true);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.createGuidedAssessment', () => GuidedPanel.open(context, pack, index, tree, indexDiagnostics, benchmarkState)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.createStandaloneAssessment', () => GuidedPanel.open(context, pack, index, tree, indexDiagnostics, benchmarkState, true)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.enterStandaloneMode', () => setStandaloneMode(benchmarkState)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.clearBenchmarkContext', () => clearBenchmarkContext(api, benchmarkState)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.chooseBenchmarkRoot', () => chooseBenchmarkRootAndBenchmark(context, index, tree, api, indexDiagnostics, benchmarkState)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.selectBenchmark', () => selectBenchmarkRoot(context, index, tree, api, indexDiagnostics, benchmarkState)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.selectBenchmarkRoot', () => selectBenchmarkRoot(context, index, tree, api, indexDiagnostics, benchmarkState)));
  // Keep the Home counters on dedicated commands.  Webview command arguments
  // are intentionally not used for these primary navigation targets: older
  // retained Home panels can otherwise replay the generic context command and
  // land on the Benchmark overview instead of the searchable source chooser.
  const openBenchmarkSection = async (section: 'rules' | 'applicability' | 'conditions' | 'assessments', filter = '') => {
    if (section === 'assessments') return openBenchmarkAssessmentPanel(context, index, api, benchmarkState);
    const analysisLookup = filter === 'likely-automatable' ? (key: string) => automationAnalysis.get(key) : undefined;
    return openBenchmarkSourceChooserPanel(context, index, api, benchmarkState, section, () => pack, filter, analysisLookup, configuredAiGenerator);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('scapNg.openBenchmarkRules', (filter?: string) => openBenchmarkSection('rules', typeof filter === 'string' ? filter : '')),
    vscode.commands.registerCommand('scapNg.openBenchmarkAutomationGaps', () => openBenchmarkSection('rules', 'needs-automation')),
    vscode.commands.registerCommand('scapNg.openBenchmarkLikelyAutomation', () => openBenchmarkSection('rules', 'likely-automatable')),
    vscode.commands.registerCommand('scapNg.openBenchmarkApplicability', () => openBenchmarkSection('applicability')),
    vscode.commands.registerCommand('scapNg.openBenchmarkConditions', () => openBenchmarkSection('conditions')),
    vscode.commands.registerCommand('scapNg.openBenchmarkAssessments', () => openBenchmarkSection('assessments')),
    vscode.commands.registerCommand('scapNg.openBenchmarkContext', async (argument?: any) => {
      const section = typeof argument?.section === 'string' ? argument.section : undefined;
      if (section === 'assessments' || section === 'rules' || section === 'applicability' || section === 'conditions') return openBenchmarkSection(section, typeof argument?.filter === 'string' ? argument.filter : '');
      return openBenchmarkContextPanel(context, index, tree, indexDiagnostics, benchmarkState, section);
    })
  );
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.analyzeBenchmarkAutomation', async () => {
    const selected = benchmarkState.authoringMode === 'benchmark'
      ? benchmarkContextForKey(benchmarkContexts(index, benchmarkState.importedRoots), benchmarkState.activeKey)
      : undefined;
    if (!selected) { await api.window.showInformationMessage('Select a Benchmark before analyzing automation gaps.'); return; }
    const loaded = loadPack(selected.benchmark.path) ?? pack;
    if (!loaded) { await api.window.showWarningMessage('A verified offline metadata pack is required for automation analysis.'); return; }
    const result = await api.window.withProgress({ location: api.ProgressLocation?.Notification ?? 15, title: 'Analyzing Benchmark automation gaps…', cancellable: true }, (progress: any, token: any) => analyzeBenchmarkAutomation(api, index, benchmarkState, loaded, selected, progress, token));
    automationAnalysis.set(selected.key, result);
    WelcomePanel.updateContext(welcomeContextInfo(), Boolean(pack));
    await api.window.showInformationMessage(`Automation analysis complete: ${result.likelyAutomatable} of ${result.total} Rules look promising for author review.`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.testRegex', (argument: any) => RegexTesterPanel.open(context, argument?.document ?? api.window.activeTextEditor?.document, pack, { useFirst: argument?.useFirst === true })));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.testObject', () => SampleObjectTesterPanel.open(context, api.window.activeTextEditor?.document, pack)));
  const inspect = (document: vscode.TextDocument) => {
    loadPack(document.uri.fsPath);
    if (document.languageId === 'yaml' || /\.(ya?ml)$/.test(document.uri.fsPath)) {
      validateDocument(document, profile, diagnostics, pack);
      publishSchemaRequiredDiagnostics(document, pack, schemaDiagnostics);
    }
    const activeEditor = api.window.activeTextEditor;
    if (activeEditor?.document?.uri?.toString?.() === document.uri?.toString?.()) authoringSidebar.setEditor(activeEditor);
    void refreshYamlStatus(document);
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(inspect), vscode.workspace.onDidSaveTextDocument(document => { automationAnalysis.clear(); inspect(document); WelcomePanel.updateContext(welcomeContextInfo(), Boolean(pack)); }));
  if (api.workspace.onDidChangeTextDocument) context.subscriptions.push(api.workspace.onDidChangeTextDocument((event: any) => inspect(event.document)));
  if (api.window.onDidChangeActiveTextEditor) context.subscriptions.push(api.window.onDidChangeActiveTextEditor((editor: any) => { authoringSidebar.setEditor(editor); void refreshYamlStatus(editor?.document); }));
  if (api.window.onDidChangeTextEditorSelection) context.subscriptions.push(api.window.onDidChangeTextEditorSelection((event: any) => authoringSidebar.setEditor(event.textEditor)));
  if (api.window.activeTextEditor?.document) { authoringSidebar.setEditor(api.window.activeTextEditor); inspect(api.window.activeTextEditor.document); void refreshYamlStatus(api.window.activeTextEditor.document); }
  // On every workspace activation with no document open, put the
  // spacious product Home tab in front of generic VS Code Get Started.
  // This is intentionally per-launch rather than a permanent workspace flag:
  // users commonly close the tab and expect it to be available again after
  // restarting VS Code. Keep the Authoring sidebar focused on editing.
  if (!api.window.activeTextEditor?.document) {
    setTimeout(() => WelcomePanel.open(context, () => Boolean(pack), build, welcomeContextInfo), 500);
  }
}
export function deactivate() { /* no network, telemetry or scanner process */ }
