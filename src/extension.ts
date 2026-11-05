import * as vscode from 'vscode';
import { parseDocument, stringify } from 'yaml';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { MetadataPack, sha256, type Pin } from './metadata.js';
import { SourceBuffer, sourceRevisionMatches } from './source.js';
import { previewRegexSafe, regexSafetyError } from './playground.js';
import { findFirstRegexContext, findRegexContext, replaceRegexScalars } from './regex-tester.js';
import { evaluateObjectSamples, findObjectContext, objectTesterGuidance, starterSampleItems } from './sample-object.js';
import { WorkspaceIndex, type IndexedDocument } from './indexer.js';
import { GuidedCatalog, createGuidedAssessment } from './guided.js';
import { completionChoices, propertyChoicesForPath } from './completion.js';
import { registerYamlDefinitionProvider, registerYamlHoverProvider } from './yaml-help.js';
import { schemaCapabilityObjectProperties } from './schema-resolver.js';
import { AuthoringSidebarProvider } from './authoring-sidebar.js';
import { AssessmentAuthoringPrototypePanel } from './assessment-inspector.js';
import { graphicalHtml } from './graphical.js';

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
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }


import { modelFor, assessmentEditorModel } from './structured-model.js';

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


function valueAtPathForGraphical(value: any, path: (string | number)[]) { let current = value; for (const part of path) current = current?.[part as any]; return current; }
function preferred<T extends { value: string; isDefault?: boolean }>(options: T[]) { return options.find(option => option.isDefault)?.value ?? options[0]?.value; }
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
    (await api.window.showQuickPick(ops.map(value => ({ label: value.label || value.value,
      description: value.value, value })), { placeHolder: 'Choose how to select ' + field.name }))?.value;
  if (!operation) return undefined;
  let value: string | undefined;
  if (field.enumValues.length) {
    const picked = await api.window.showQuickPick(field.enumValues.map(entry => ({
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

async function graphicalAdd(api: any, document: any, pack: MetadataPack | undefined, path: (string | number)[], expectedHash: string): Promise<any> {
  if (!pack) throw new Error('A verified offline metadata pack is required for schema-driven structural additions.');
  const source = new SourceBuffer(document.getText()); const catalog = new GuidedCatalog(pack);
  const last = String(path.at(-1) ?? '');
  if (last === 'tests') {
    const id = await api.window.showInputBox({ prompt: 'New Test ID (drafts end in -test)', value: 'new-test' }); if (!id) return undefined;
    const capability = await api.window.showQuickPick(catalog.capabilities(), { placeHolder: 'Choose the Test capability from the pinned metadata' }); if (!capability) return undefined;
    const title = await api.window.showInputBox({ prompt: 'Human-readable Test summary', value: 'New Assessment Test' }); if (!title) return undefined;
    const skeleton = graphicalTestSkeleton(pack, id, title, capability.value); const collection = valueAtPathForGraphical(source.json(), path); return collection === undefined ? source.insertMapEntry(path.slice(0, -1), 'tests', { [id]: skeleton } as any, expectedHash) : source.insertMapEntry(path, id, skeleton, expectedHash);
  }
  if (last === 'inputs' && path.length === 2 && path[0] === 'assessment') {
    // An Input declares a typed value supplied by the referring policy/Rule.
    // It is not an external Assessment file reference (those use dependencies).
    const assessmentSchema: any = pack.resource('https://scap-ng.dev/schema/v0.4.0/assessment.schema.json');
    const definition: any = assessmentSchema.properties?.assessment?.properties?.inputs;
    const inputSpec: any = definition?.additionalProperties;
    const nameSpec: any = definition?.propertyNames;
    const cardinalityOptions: string[] = inputSpec?.properties?.cardinality?.enum;
    const capabilitySchema: any = pack.resource('https://scap-ng.dev/schema/v0.4.0/capability-common.schema.json');
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
      ? source.insertMapEntry(['assessment'], 'inputs', { [name]: skeleton } as any, expectedHash)
      : source.insertMapEntry(path, name, skeleton as any, expectedHash);
    const errors = pack.validate('https://scap-ng.dev/schema/v0.4.0/assessment.schema.json', edit.document.json());
    if (errors.length) throw new Error('Pinned schema rejected the new Input: ' + errors.join('; '));
    return edit;
  }
  if (last === 'variables') {
    const id = await api.window.showInputBox({ prompt: 'New Variable name', value: 'new-variable' }); if (!id) return undefined;
    const skeleton = { kind: 'constant', datatype: 'string', expression: { literal: '' } } as any; const collection = valueAtPathForGraphical(source.json(), path); return collection === undefined ? source.insertMapEntry(path.slice(0, -1), 'variables', { [id]: skeleton } as any, expectedHash) : source.insertMapEntry(path, id, skeleton, expectedHash);
  }
  if (last === 'shared_objects' && path.length === 2) {
    const schemaUri = 'https://scap-ng.dev/schema/v0.4.0/assessment.schema.json';
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
    const schemaUri = 'https://scap-ng.dev/schema/v0.4.0/assessment.schema.json';
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
    const schemaUri = 'https://scap-ng.dev/schema/v0.4.0/assessment.schema.json';
    const errors = pack.validate(schemaUri, edit.document.json());
    if (errors.length) throw new Error('Pinned schema rejected the added Object selector: ' + errors.join('; '));
    return edit;
  }
  const existing = valueAtPathForGraphical(source.json(), path);
  if (Array.isArray(existing)) {
    if (last === 'filters') return source.insertArrayItem(path, { include: {} } as any, expectedHash);
    if (last === 'operands') return source.insertArrayItem(path, { object: {}, filters: [] } as any, expectedHash);
    return source.insertArrayItem(path, {} as any, expectedHash);
  }
  if (existing && typeof existing === 'object') {
    const key = await api.window.showInputBox({ prompt: `Add a schema property under ${last}`, value: 'new-property' }); if (!key) return undefined;
    return source.insertMapEntry(path, key, null, expectedHash);
  }
  throw new Error(`Cannot add a child to ${path.join('.')}; use native YAML for this incomplete structure.`);
}
async function applySourceWorkspaceEdit(api: any, document: any, edit: any) {
  const workspaceEdit = new api.WorkspaceEdit();
  workspaceEdit.replace(document.uri, new api.Range(document.positionAt(edit.range[0]), document.positionAt(edit.range[1])), edit.replacement);
  if (!await api.workspace.applyEdit(workspaceEdit)) throw new Error('VS Code declined the source edit.');
}
class AssessmentEditorProvider {
  constructor(private readonly getPack: () => MetadataPack | undefined) {}
  async resolveCustomTextEditor(document: any, panel: any, _token: any) {
    const api: any = vscode; panel.webview.options = { enableScripts: true }; panel.webview.html = graphicalHtml();
    const send = () => {
      try {
        const model = assessmentEditorModel(document, this.getPack());
        void panel.webview.postMessage({ type: 'model', model: { ...model, sourceName: document.uri?.fsPath ?? document.fileName ?? 'active document' } });
      } catch (error) {
        // A malformed/exotic YAML document must never strand the custom editor
        // on its loading placeholder. Keep the native YAML editor available
        // and expose the exact model-building failure in the webview/status bar.
        const message = error instanceof Error ? error.message : String(error);
        void panel.webview.postMessage({ type: 'model', model: { ok: false, error: message, fields: [], sourceName: document.uri?.fsPath ?? document.fileName ?? 'active document' } });
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
      // Open native YAML editor beside workbench: the webview never becomes a second source document.
      if (message.type === 'openSource') { await revealNativeSource(api, document); return; }
      if (message.type === 'openRegex') { await api.commands.executeCommand('scapNg.testRegex', { document, useFirst: true }); return; }
      if (message.type === 'openGuided') { await api.commands.executeCommand('scapNg.createGuidedAssessment'); return; }
      if (message.type === 'selectPath' && Array.isArray(message.path)) {
        try { const range = new SourceBuffer(document.getText()).scalarRange(message.path); await revealNativeSource(api, document, range); } catch { await revealNativeSource(api, document); }
        return;
      }
      if (message.type === 'regexPreview' && Array.isArray(message.patterns) && typeof message.input === 'string') {
        const previews = await previewRegexSafe(message.patterns.filter((pattern: any) => typeof pattern === 'string'), message.input, typeof message.flags === 'string' ? message.flags : '', 100);
        panel.webview.postMessage({ type: 'regexPreviewResult', previews }); return;
      }
      if (message.type === 'structural') {
        try {
          const currentRevision = sha256(document.getText());
          if (message.revision !== currentRevision || (message.version !== undefined && message.version !== document.version)) throw new Error('Document changed before this structural edit; refresh and try again.');
          const path = Array.isArray(message.path) ? message.path : [];
          if (message.action === 'reveal') { try { await revealNativeSource(api, document, new SourceBuffer(document.getText()).scalarRange(path)); } catch { await revealNativeSource(api, document); } return; }
          if (message.action === 'rename') {
            if (path.length < 2 || typeof path.at(-1) !== 'string') throw new Error('Only authored mapping keys can be renamed safely.');
            const oldKey = String(path.at(-1)); const newKey = await api.window.showInputBox({ prompt: `Rename ${oldKey}`, value: oldKey, validateInput: (value: string) => /^[A-Za-z0-9._/-]+$/.test(value) ? undefined : 'Use a simple YAML mapping key.' });
            if (!newKey || newKey === oldKey) return;
            const edit = new SourceBuffer(document.getText()).editMappingKey(path.slice(0, -1), oldKey, newKey, currentRevision);
            await applySourceWorkspaceEdit(api, document, edit);
            return;
          }
          if (message.action === 'remove') {
            if (path.at(-1) === 'require') throw new Error('Test require is required by the pinned 0.4 schema; replace a branch or leave an explicit incomplete draft.');
            if (path.length < 2) throw new Error('The Assessment root cannot be removed.');
            const confirmation = await api.window.showWarningMessage(`Remove ${String(path.at(-1))}? References are not auto-repaired.`, { modal: true }, 'Remove');
            if (confirmation !== 'Remove') return;
            const edit = new SourceBuffer(document.getText()).removePath(path, currentRevision);
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
            const schemaUri = 'https://scap-ng.dev/schema/v0.4.0/assessment.schema.json';
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
            const edit = await graphicalAdd(api, document, this.getPack(), path, currentRevision);
            if (edit) await applySourceWorkspaceEdit(api, document, edit);
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
      if (message.type !== 'edit' || !Array.isArray(message.path)) return;
      try {
        const currentRevision = sha256(document.getText());
        if (message.revision !== currentRevision || (message.version !== undefined && message.version !== document.version)) {
          panel.webview.postMessage({ type: 'error', message: 'Document changed before this edit was applied; refreshed the Structured view.' });
          return send();
        }
        const source = new SourceBuffer(document.getText());
        const edit = source.editScalar(message.path, message.value, currentRevision);
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
async function indexWorkspace(index: WorkspaceIndex, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection) {
  if (!api.workspace.findFiles || !api.workspace.openTextDocument) return;
  const patterns = ['**/*.assessment.yaml', '**/*.assessment.yml', '**/*.rule.yaml', '**/*.rule.yml', '**/*.benchmark.yaml', '**/*.benchmark.yml'];
  const found = (await Promise.all(patterns.map(pattern => api.workspace.findFiles(pattern, '**/{node_modules,.git}/**')))).flat();
  const files = [...new Map(found.map((uri: any) => [uri.toString(), uri])).values()];
  const entries: { uri: string; text: string; path: string }[] = []; let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const uri = files[cursor++];
      try { const document = await api.workspace.openTextDocument(uri); entries.push({ uri: uri.toString(), text: document.getText(), path: uri.fsPath }); } catch { /* unreadable files remain outside the index */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(INDEX_WORKERS, files.length) }, worker));
  index.updateMany(entries); publishIndexDiagnostics(index, indexDiagnostics, api); tree.refresh();
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
async function updateIndexedUri(index: WorkspaceIndex, uri: any, tree: StudioTree, api: any, indexDiagnostics: vscode.DiagnosticCollection) {
  try { const document = await api.workspace.openTextDocument(uri); index.update(uri.toString(), document.getText(), uri.fsPath); publishIndexDiagnostics(index, indexDiagnostics, api); tree.refresh(); } catch { /* file may have been removed between watcher events */ }
}

function optionHtml(options: readonly { value: string; label: string; description?: string }[]) { return options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join(''); }
function guidedHtml(catalog: GuidedCatalog) {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-guided';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;max-width:900px}fieldset{border:1px solid var(--vscode-panel-border);margin:12px 0;padding:12px}legend{font-weight:600}label{display:block;margin:9px 0}input,select,textarea{display:block;width:100%;box-sizing:border-box;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:6px}input[type=checkbox]{display:inline;width:auto}textarea{min-height:64px;font-family:var(--vscode-editor-font-family)}.row{display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:8px;margin:8px 0;align-items:end}.row label{margin:0}.hint{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.explanation{border-left:3px solid var(--vscode-textLink-foreground);padding:8px}.summary{border-left:3px solid var(--vscode-textLink-foreground);padding:8px;margin:10px 0}.advanced{border-top:1px solid var(--vscode-panel-border);margin-top:12px;padding-top:8px}button{padding:7px 12px}.unsupported{color:var(--vscode-descriptionForeground);font-style:italic}</style></head><body><h1>Guided Assessment authoring</h1><p class="hint">Answer the policy question first. Exact YAML keywords remain available in the Graphical editor and native YAML editor. Platform is an authoring context only; it does not assert CPE applicability.</p><p id="status" role="status"></p><fieldset><legend>1. Assessment purpose</legend><label for="platform">Target platform<select id="platform">${optionHtml(catalog.platforms())}</select></label><label for="mode">Assessment mode<select id="mode">${optionHtml(catalog.modes())}</select></label><label for="className">Assessment class<select id="className">${optionHtml(catalog.classes())}</select></label><label for="id">Assessment ID<input id="id" value="guided-assessment"></label><label for="title">Security requirement<input id="title" placeholder="What security requirement should be checked?"></label><label for="procedure">Manual procedure<textarea id="procedure">Review the target according to the documented procedure.</textarea></label><div id="manualResponse"><p class="hint">Manual responses are author-defined choices, not scanner results.</p><label for="responseType">Response contract name<input id="responseType" value="manual-review"></label><div class="row"><label>Value<input id="choice1Value" value="yes"></label><label>Label<input id="choice1Label" value="Yes"></label><label>Outcome<select id="choice1Outcome"><option>true</option><option>false</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><div class="row"><label>Value<input id="choice2Value" value="no"></label><label>Label<input id="choice2Label" value="No"></label><label>Outcome<select id="choice2Outcome"><option>false</option><option>true</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><label><input id="allowComment" type="checkbox" checked> Allow reviewer comment</label><label><input id="allowEvidence" type="checkbox" checked> Allow evidence attachment</label></div></fieldset><fieldset id="automated"><legend>2. What evidence should be collected?</legend><label for="capability">Evidence collection capability<select id="capability">${optionHtml(catalog.capabilities())}</select></label><p id="capabilityHelp" class="hint"></p><div id="objectRequirements" class="hint" aria-live="polite"></div><div id="objectFields"></div><details class="advanced"><summary>Advanced source fields</summary><p class="unsupported">This slice exposes the schema-declared primary selector fields. Advanced Objects, Variables and dependent sources remain available through the native YAML editor without being discarded.</p></details><legend>3. What counts as sufficient evidence?</legend><label for="testId">Test ID<input id="testId" value="guided-test"></label><label for="testTitle">Human-readable Test summary<input id="testTitle" placeholder="Generated summary; editable before save"></label><label for="itemsFound">Collected Items found<select id="itemsFound">${optionHtml(catalog.itemFound())}</select></label><label id="itemsSatisfyingLabel" for="itemsSatisfying">Selected Items satisfying condition<select id="itemsSatisfying">${optionHtml(catalog.itemsSatisfying())}</select></label><label id="valuesFoundLabel" for="valuesFound">Field values found<select id="valuesFound">${optionHtml(catalog.fieldValuesFound())}</select></label><label id="valuesMatchingLabel" for="valuesMatching">Field values matching<select id="valuesMatching">${optionHtml(catalog.fieldValuesMatching())}</select></label><label><input id="presenceOnly" type="checkbox"> Presence-only check (no field comparison)</label><div id="comparisonFields"></div><button id="addField" type="button">Add comparison field</button><div id="summary" class="summary" aria-live="polite"></div><p class="hint">This first Guided slice creates one Test. Multiple-Test evaluation trees remain editable in Graphical/the native YAML editor until the dedicated tree editor lands.</p></fieldset><button id="create">Create Assessment</button><script nonce="guided">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const status=$('status');let objectDefinitions=[];let objectRequirements=[];let resultDefinitions=[];function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function opts(items,selected){return items.map(x=>'<option value=\"'+esc(x.value)+'\" '+(x.value===selected?'selected':'')+'>'+esc(x.label||x.value)+'</option>').join('');}function renderObjectFields(fields,requirements){objectDefinitions=fields;objectRequirements=requirements||[];const requirementRoot=$('objectRequirements');requirementRoot.replaceChildren();if(objectRequirements.length>1){const text=document.createElement('p');text.textContent='Choose one complete item identity: '+objectRequirements.map(requirement=>requirement.fields.join(' + ')).join(' OR ')+'.';requirementRoot.append(text);}else if(objectRequirements.length===1){const text=document.createElement('p');text.textContent='Required item selectors: '+objectRequirements[0].fields.join(', ')+'.';requirementRoot.append(text);}const root=$('objectFields');root.replaceChildren();if(!fields.length){root.innerHTML='<p class="unsupported">No primary selector controls are available for this capability yet. Continue in Structured or the native YAML editor.</p>';return;}for(const f of fields){const row=document.createElement('div');row.className='row object-row';row.dataset.name=f.name;const label=document.createElement('label');label.textContent=f.label;label.title=f.description||'';const operation=document.createElement('select');operation.className='object-operation';const preferredOperation=f.operations.find(value=>value.value==='equals')?.value||f.operations[0]?.value;operation.innerHTML=opts(f.operations,preferredOperation);const value=document.createElement(f.enumValues?.length?'select':'input');value.className='object-value';if(f.enumValues?.length)value.innerHTML='<option value="">Choose '+esc(f.label.toLowerCase())+'</option>'+opts(f.enumValues.map(v=>({value:v,label:v})));else {value.placeholder='Enter '+f.label.toLowerCase();if(f.datatype==='integer'||f.datatype==='number')value.type='number';if(f.datatype==='boolean')value.type='checkbox';}row.append(label,operation,value);root.append(row);}}function renderComparisonFields(fields){resultDefinitions=fields;const root=$('comparisonFields');root.replaceChildren();addComparisonRow(fields[0]?.name||'');}function addComparisonRow(selected){const root=$('comparisonFields');const row=document.createElement('div');row.className='row field-row';const name=document.createElement('select');name.className='field-name';name.innerHTML=opts(resultDefinitions.map(f=>({value:f.name,label:f.label})),selected);const operation=document.createElement('select');operation.className='field-operation';operation.innerHTML=opts(resultDefinitions[0]?.operations||[],'equals');const datatype=document.createElement('select');datatype.className='field-datatype';datatype.innerHTML=opts((resultDefinitions.find(f=>f.name===selected)?.datatypes||['string']).map(v=>({value:v,label:v})),'string');const value=document.createElement('input');value.className='field-value';value.placeholder='Expected value';name.onchange=()=>{const definition=resultDefinitions.find(f=>f.name===name.value);operation.innerHTML=opts(definition?.operations||[],'equals');datatype.innerHTML=opts((definition?.datatypes||['string']).map(v=>({value:v,label:v})),definition?.datatype||'string');};const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(name,operation,datatype,value,remove);root.append(row);}function collectObject(){const object={};document.querySelectorAll('.object-row').forEach(row=>{const input=row.querySelector('.object-value');const value=input.type==='checkbox'?input.checked:input.value;if(value) object[row.dataset.name]={[row.querySelector('.object-operation').value]:value};});return object;}function objectRequirementError(object){if(!objectRequirements.length)return '';if(objectRequirements.some(requirement=>requirement.fields.every(name=>Object.hasOwn(object,name))))return '';if(objectRequirements.length===1)return 'Complete the required item selectors: '+objectRequirements[0].fields.join(', ')+'.';return 'Complete one item identity: '+objectRequirements.map(requirement=>requirement.fields.join(' + ')).join(' OR ')+'.';}function collectFields(){const fields={};document.querySelectorAll('.field-row').forEach(row=>{let value=row.querySelector('.field-value').value;if(value){const datatype=row.querySelector('.field-datatype').value;if(datatype==='integer')value=Number(value);else if(datatype==='boolean')value=value==='true';fields[row.querySelector('.field-name').value]={[row.querySelector('.field-operation').value]:value};}});return fields;}function updateSummary(){const cap=$('capability').selectedOptions[0]?.textContent||$('capability').value;const item=$('itemsFound').selectedOptions[0]?.textContent;const match=$('presenceOnly').checked?'presence only':($('itemsSatisfying').selectedOptions[0]?.textContent+' of selected Items');const field=$('presenceOnly').checked?'No field comparison':($('valuesMatching').selectedOptions[0]?.textContent+' of found values');$('summary').textContent=cap+': at least '+item+' Item(s) must exist; '+match+' must satisfy the condition; '+field+' must match.';}function refresh(){const automated=$('mode').value==='automated';$('automated').hidden=!automated;$('manualResponse').hidden=automated;updateSummary();}$('mode').onchange=refresh;$('capability').onchange=()=>vscode.postMessage({type:'capability',value:$('capability').value});$('presenceOnly').onchange=()=>{const hidden=$('presenceOnly').checked;for(const id of ['itemsSatisfyingLabel','valuesFoundLabel','valuesMatchingLabel','comparisonFields','addField'])$(id).hidden=hidden;updateSummary();};$('itemsFound').onchange=updateSummary;$('itemsSatisfying').onchange=updateSummary;$('valuesMatching').onchange=updateSummary;$('addField').onclick=()=>addComparisonRow('');$('create').onclick=()=>{try{const automated=$('mode').value==='automated';const message={type:'create',platform:$('platform').value,id:$('id').value,title:$('title').value,mode:$('mode').value,className:$('className').value,procedure:$('procedure').value};if(automated){const object=collectObject();const objectError=objectRequirementError(object);if(objectError){status.className='error';status.textContent=objectError;return;}message.tests=[{id:$('testId').value,title:$('testTitle').value||$('title').value,capability:$('capability').value,object,fields:collectFields(),presenceOnly:$('presenceOnly').checked}];}else{message.response={type:$('responseType').value,choices:[{value:$('choice1Value').value,label:$('choice1Label').value,outcome:$('choice1Outcome').value},{value:$('choice2Value').value,label:$('choice2Label').value,outcome:$('choice2Outcome').value}],allow_comment:$('allowComment').checked,allow_evidence:$('allowEvidence').checked};}vscode.postMessage(message);}catch(error){status.className='error';status.textContent=error.message;}};window.addEventListener('message',event=>{if(event.data.type==='objectFields')renderObjectFields(event.data.fields,event.data.requirements);if(event.data.type==='resultFields')renderComparisonFields(event.data.fields);status.className=event.data.ok?'':'error';if(event.data.message)status.textContent=event.data.message;});refresh();vscode.postMessage({type:'capability',value:$('capability').value});</script></body></html>`;
}
class GuidedPanel {
  static open(context: vscode.ExtensionContext, pack: MetadataPack | undefined) {
    const api: any = vscode;
    if (!pack) return void vscode.window.showWarningMessage('Configure a verified offline SCAP-NG metadata pack before using Guided authoring.');
    const catalog = new GuidedCatalog(pack); const panel = api.window.createWebviewPanel('scapNg.guided', 'SCAP-NG Guided Assessment', api.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = guidedHtml(catalog);
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'capability') { panel.webview.postMessage({ type: 'objectFields', fields: catalog.objectFields(message.value), requirements: catalog.objectRequirements(message.value) }); panel.webview.postMessage({ type: 'resultFields', fields: catalog.resultFields(message.value) }); return; }
      if (message.type !== 'create') return;
      try {
        const result = createGuidedAssessment(pack, message);
        if (result.diagnostics.length) { panel.webview.postMessage({ ok: false, message: `Schema validation: ${result.diagnostics.join('; ')}` }); return; }
        const document = await api.workspace.openTextDocument({ content: result.yaml, language: 'yaml' }); await api.window.showTextDocument(document);
        panel.webview.postMessage({ ok: true, message: 'Assessment created. Review it in Source or Structured mode; no scanner result was produced.' });
      } catch (error) { panel.webview.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    });
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
function quickFixFragment(choice: { value: string; insertText?: string; defaultValue?: unknown }, block: boolean): string {
  if (choice.defaultValue !== undefined) return `${choice.value}: ${inlineYaml(choice.defaultValue)}`;
  // Keep newly inserted schema objects in the parent's style. A block opener
  // is intentionally left as a skeleton so the next completion can add its
  // schema-defined child; `{}` would create a visually mixed object and an
  // equally incomplete flow mapping beside block-form siblings.
  if (choice.insertText?.endsWith('{')) return block ? `${choice.value}:` : `${choice.value}: {}`;
  return choice.insertText ?? `${choice.value}: `;
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
  if (!pack || !/\.assessment\.ya?ml$/i.test(document.uri?.fsPath ?? document.fileName ?? '')) { diagnostics.delete(document.uri); return; }
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
  if (!/\.assessment\.ya?ml$/i.test(document.fileName ?? document.uri?.fsPath ?? '')) return [];
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
    const fragment = quickFixFragment(choice, !flow);
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
      text = `${prefix}${' '.repeat(indent)}${fragment}${suffix}`;
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
    const fragments = uniqueChoices.map((choice: any) => quickFixFragment(choice, !group.flow));
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
      text = `${prefix}${fragments.map((fragment: string) => `${' '.repeat(indent)}${fragment}`).join('\n')}${suffix}`;
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
function validateDocument(document: vscode.TextDocument, profile: Pin, diagnostics: vscode.DiagnosticCollection) {
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
  }
  diagnostics.set(document.uri, output);
}
function yamlAssociationMap(pack: MetadataPack) {
  const byFile: Array<{ suffix: string; patterns: string[] }> = [
    { suffix: '/assessment.schema.json', patterns: ['**/*.assessment.yaml', '**/*.assessment.yml'] },
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
  return Boolean(document && /\.assessment\.ya?ml$/i.test(document.uri?.fsPath ?? document.fileName ?? ''));
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
      if (!/\.assessment\.ya?ml$/i.test(document.uri?.fsPath ?? document.fileName ?? '')) return [];
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
        const flowMapping = linePrefix.lastIndexOf('{') > linePrefix.lastIndexOf('}');
        let propertyInsert = choice.insertText ?? `${choice.value}: `;
        // A schema object must not force authors into flow syntax. In a block
        // mapping, `require: {` followed by newline-authored children is
        // invalid YAML unless commas are added. Keep the flow template only
        // when the cursor is actually inside a flow mapping.
        if (!flowMapping && propertyInsert.endsWith('{')) propertyInsert = `${choice.value}:`;
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
        if (choice.kind === 'property' && !flowMapping && blankParent && nextCharacter !== ':') {
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
  loadPack((vscode.window as any).activeTextEditor?.document.uri.fsPath);
  const index = new WorkspaceIndex();
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
    const candidate = active && /\.assessment\.ya?ml$/i.test(active.uri?.fsPath ?? '') ? active : undefined;
    if (candidate) await api.commands.executeCommand('vscode.openWith', candidate.uri, 'scapNg.assessment', { viewColumn: api.ViewColumn?.One ?? 1, preserveFocus: false, preview: false });
  }, 3000);
  const resetPack = () => {
    pack = undefined;
    packConfiguration = undefined;
    packError = undefined;
    packWarningShown = false;
    loadPack((api.window as any).activeTextEditor?.document?.uri?.fsPath);
  };
  const authoringSidebar = new AuthoringSidebarProvider(context, () => pack, profile, build, resetPack);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('scapNg-authoringSidebar', authoringSidebar));
  const revealAuthoring = async () => {
    try { await api.commands.executeCommand('workbench.view.extension.scapNg-authoring'); return true; }
    catch { return false; }
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
  void indexWorkspace(index, tree, api, indexDiagnostics);
  if (api.workspace.createFileSystemWatcher) {
    for (const pattern of ['**/*.yaml', '**/*.yml']) {
      const watcher = api.workspace.createFileSystemWatcher(pattern);
      context.subscriptions.push(watcher, watcher.onDidCreate((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics)), watcher.onDidChange((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics)), watcher.onDidDelete((uri: any) => { index.remove(uri.toString()); publishIndexDiagnostics(index, indexDiagnostics, api); tree.refresh(); }));
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
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.searchIndex', async () => tree.setQuery(await api.window.showInputBox({ prompt: 'Search Assessment Studio index' }) ?? '')));
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
    if (!uri || !/\.assessment\.ya?ml$/i.test(uri.fsPath ?? '')) { await api.window.showWarningMessage('Open an *.assessment.yaml or *.assessment.yml document first.'); return; }
    await api.commands.executeCommand('vscode.openWith', uri, 'scapNg.assessment', { viewColumn: api.ViewColumn?.Active ?? 1, preserveFocus: false, preview: false });
  }));
  context.subscriptions.push(api.window.registerCustomEditorProvider('scapNg.assessment', new AssessmentEditorProvider(() => pack), { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } }));
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
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.createGuidedAssessment', () => GuidedPanel.open(context, pack)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.testRegex', (argument: any) => RegexTesterPanel.open(context, argument?.document ?? api.window.activeTextEditor?.document, pack, { useFirst: argument?.useFirst === true })));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.testObject', () => SampleObjectTesterPanel.open(context, api.window.activeTextEditor?.document, pack)));
  const inspect = (document: vscode.TextDocument) => {
    loadPack(document.uri.fsPath);
    if (document.languageId === 'yaml' || /\.(ya?ml)$/.test(document.uri.fsPath)) {
      validateDocument(document, profile, diagnostics);
      publishSchemaRequiredDiagnostics(document, pack, schemaDiagnostics);
    }
    const activeEditor = api.window.activeTextEditor;
    if (activeEditor?.document?.uri?.toString?.() === document.uri?.toString?.()) authoringSidebar.setEditor(activeEditor);
    void refreshYamlStatus(document);
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(inspect), vscode.workspace.onDidSaveTextDocument(inspect));
  if (api.workspace.onDidChangeTextDocument) context.subscriptions.push(api.workspace.onDidChangeTextDocument((event: any) => inspect(event.document)));
  if (api.window.onDidChangeActiveTextEditor) context.subscriptions.push(api.window.onDidChangeActiveTextEditor((editor: any) => { authoringSidebar.setEditor(editor); void refreshYamlStatus(editor?.document); }));
  if (api.window.onDidChangeTextEditorSelection) context.subscriptions.push(api.window.onDidChangeTextEditorSelection((event: any) => authoringSidebar.setEditor(event.textEditor)));
  if (api.window.activeTextEditor?.document) { authoringSidebar.setEditor(api.window.activeTextEditor); inspect(api.window.activeTextEditor.document); void refreshYamlStatus(api.window.activeTextEditor.document); }
}
export function deactivate() { /* no network, telemetry or scanner process */ }
