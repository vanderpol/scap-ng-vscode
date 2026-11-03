import * as vscode from 'vscode';
import { parseDocument, stringify } from 'yaml';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MetadataPack, sha256, type Pin } from './metadata.js';
import { SourceBuffer, sourceRevisionMatches } from './source.js';
import { previewRegexSafe } from './playground.js';
import { WorkspaceIndex, type IndexedDocument } from './indexer.js';
import { GuidedCatalog, createGuidedAssessment } from './guided.js';
import { completionChoices, propertyChoicesForPath } from './completion.js';

const profilePath = (root: string) => join(root, 'schema-profile.json');

class StudioNode extends vscode.TreeItem {
  constructor(label: string, state = vscode.TreeItemCollapsibleState.None, contextValue?: string) {
    super(label, state); this.contextValue = contextValue;
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
    if (!node) return [
      new StudioNode('STIG Library', vscode.TreeItemCollapsibleState.Collapsed, 'stig-library'),
      new StudioNode('Assessment Library', vscode.TreeItemCollapsibleState.Collapsed, 'assessment-library'),
      new StudioNode('Diagnostics', vscode.TreeItemCollapsibleState.Collapsed, 'index-diagnostics')
    ];
    const records = this.query ? this.index.search(this.query) : this.index.all();
    if (node.contextValue === 'stig-library') return records.filter(record => record.kind === 'benchmark').map(recordNode);
    if (node.contextValue === 'assessment-library') return records.filter(record => record.kind === 'assessment').map(recordNode);
    if (node.contextValue === 'index-diagnostics') return this.index.diagnostics().map(diagnostic => new StudioNode(`${diagnostic.code}: ${diagnostic.message}`, vscode.TreeItemCollapsibleState.None, 'index-diagnostic'));
    return [];
  }
}
function recordNode(record: IndexedDocument) {
  const node = new StudioNode(record.title ? `${record.title} (${record.id ?? 'no id'})` : (record.id ?? record.path), vscode.TreeItemCollapsibleState.None, 'indexed-document');
  node.description = `${record.kind}${record.diagnostics.length ? ` · ${record.diagnostics.length} diagnostic(s)` : ''}`;
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

function structuredHtml() {
  const nonce = 'scap-ng-structured';
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);font-family:var(--vscode-font-family);height:100vh;overflow:hidden}.layout{height:100vh;display:grid;grid-template-columns:minmax(560px,1fr);min-width:560px}.pane{overflow:auto;padding:16px;border-right:1px solid var(--vscode-panel-border)}.pane:last-child{border-right:0}h1,h2,h3{margin-top:0}.test-button{display:block;width:100%;text-align:left;color:var(--vscode-foreground);background:transparent;border:0;border-left:3px solid transparent;padding:10px 8px;cursor:pointer}.test-button:hover,.test-button.active{background:var(--vscode-list-activeSelectionBackground);border-left-color:var(--vscode-focusBorder)}.test-capability,.muted{color:var(--vscode-descriptionForeground);font-size:.9em}.workflow-banner{border:1px solid var(--vscode-focusBorder);border-left:4px solid var(--vscode-textLink-foreground);padding:12px;margin:8px 0 16px;background:var(--vscode-textBlockQuote-background)}.workflow-banner h2{font-size:1.1em;margin:0 0 6px}.workflow-banner p{margin:0 0 8px}.control{margin:12px 0}.control label{display:block;font-weight:600;margin-bottom:4px}.control small{display:block;color:var(--vscode-descriptionForeground);margin-top:3px}.control input,.control select{width:100%;padding:6px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.predicate{border:1px solid var(--vscode-panel-border);padding:10px;margin:8px 0}.predicate .row{grid-template-columns:140px 1fr}.summary{border-left:3px solid var(--vscode-textLink-foreground);padding:10px;background:var(--vscode-textBlockQuote-background);line-height:1.45}.button{padding:6px 10px;margin:4px 4px 10px 0;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}.button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.warning{color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.hidden-default{display:none}@media(max-width:700px){body{overflow:auto}.layout{height:auto;min-width:0}.pane{min-height:40vh;border-right:0;border-bottom:1px solid var(--vscode-panel-border)}}
</style></head><body><div class="layout"><main class="pane" aria-label="Graphical Assessment editor"><div class="modebar"><button class="button" aria-current="page">Graphical</button></div><section class="workflow-banner" aria-labelledby="workflow-title"><h2 id="workflow-title">Graphical + native YAML</h2><p>Edit this Assessment graphically here, or open the same authoritative file in VS Code’s native YAML editor. Both views edit the same document.</p><button class="button" id="openSource">Open native YAML editor beside workbench (split view)</button></section><h2>Tests</h2><div id="tests"></div><p id="status" class="muted" role="status"></p><button class="button secondary" id="toggleDefaults" hidden>Show serialized defaults</button><div id="editor"></div></main></div><script nonce="${nonce}">
const vscode=acquireVsCodeApi();const testsEl=document.getElementById('tests');const editor=document.getElementById('editor');const status=document.getElementById('status');let revision=null;let version=null;let selected=null;let current=null;let showDefaults=false;
function same(a,b){return a&&b&&a.length===b.length&&a.every((x,i)=>x===b[i]);}function field(path){return current?.fields?.find(f=>same(f.path,path));}function hidden(path){return !showDefaults&&field(path)?.hidden;}function postScalar(path,value){vscode.postMessage({type:'edit',path,value,revision,version});}function makeOption(value,label,selected){const o=document.createElement('option');o.value=value;o.textContent=label||value;o.selected=selected===true||value===selected;return o;}function control(label,value,path,choices,description){if(hidden(path))return null;const wrap=document.createElement('div');wrap.className='control';wrap.dataset.path=JSON.stringify(path);wrap.addEventListener('click',()=>vscode.postMessage({type:'selectPath',path}));const l=document.createElement('label');l.textContent=label;wrap.append(l);let input;if(choices&&choices.length){input=document.createElement('select');for(const choice of choices)input.append(makeOption(JSON.stringify(choice),String(choice),JSON.stringify(choice)===JSON.stringify(value)));}else{input=document.createElement('input');input.value=value===null||value===undefined?'':String(value);input.type=typeof value==='number'?'number':typeof value==='boolean'?'checkbox':'text';if(input.type==='checkbox')input.checked=value;}input.addEventListener('change',()=>{let next=input.type==='checkbox'?input.checked:input.value;if(input.tagName==='SELECT'){try{next=JSON.parse(String(next));}catch{ /* plain string choice */ }}if(typeof value==='number')next=Number(next);postScalar(path,next);});wrap.append(input);if(description){const small=document.createElement('small');small.textContent=description;wrap.append(small);}return wrap;}
function predicate(parent, item){const wrap=document.createElement('div');wrap.className='predicate';wrap.dataset.path=JSON.stringify(item.valuePath||item.mappingPath);wrap.addEventListener('click',()=>vscode.postMessage({type:'selectPath',path:item.valuePath||item.mappingPath}));const title=document.createElement('h4');title.textContent=item.label;wrap.append(title);if(item.unsupported){const note=document.createElement('p');note.className='warning';note.textContent='This complex value remains available in the native YAML editor; it will not be rewritten here.';wrap.append(note);if(item.regexPatterns?.length){const tester=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Offline regex playground (ECMAScript preview only)';tester.append(summary);const disclaimer=document.createElement('p');disclaimer.className='muted';disclaimer.textContent='Preview is bounded and local; it does not evaluate an Assessment or claim compliance. The SCAP-NG regex dialect may differ.';tester.append(disclaimer);const sample=document.createElement('input');sample.type='text';sample.placeholder='Representative sample text';sample.setAttribute('aria-label','Regex sample text');const output=document.createElement('p');output.className='muted';const run=document.createElement('button');run.className='button secondary';run.type='button';run.textContent='Preview match';run.onclick=()=>{output.textContent='Previewing in an isolated, time-limited worker…';vscode.postMessage({type:'regexPreview',patterns:item.regexPatterns,input:sample.value});};tester.append(sample,run,output);wrap.append(tester);}return wrap;}const row=document.createElement('div');row.className='row';if(item.kind==='field'){const name=document.createElement('input');name.value=item.name;name.title='Dynamic field name';name.setAttribute('aria-label','Field name');const rename=document.createElement('button');rename.className='button secondary';rename.type='button';rename.textContent='Rename';rename.onclick=event=>{event.stopPropagation();vscode.postMessage({type:'editKey',mappingPath:item.mappingPath.slice(0,-1),oldKey:item.name,newKey:name.value,revision,version});};row.append(name,rename);}const op=document.createElement('select');op.setAttribute('aria-label',item.kind==='field'?'Field operator for '+item.label:'Selector operator for '+item.label);const operations=item.definition?.operations||item.operations||[];for(const option of operations)op.append(makeOption(option.value,option.label,item.operation));op.addEventListener('change',()=>vscode.postMessage({type:'editKey',mappingPath:item.mappingPath,oldKey:item.operation,newKey:op.value,allowedOperations:operations.map(x=>x.value),revision,version}));row.append(op);const value=item.choices?.length?document.createElement('select'):document.createElement('input');value.setAttribute('aria-label',item.label+' value');if(item.choices?.length)for(const choice of item.choices)value.append(makeOption(JSON.stringify(choice),String(choice),JSON.stringify(choice)===JSON.stringify(item.value)));else{value.value=item.value===null||item.value===undefined?'':String(item.value);value.type=typeof item.value==='number'?'number':'text';}value.addEventListener('change',()=>{let next=value.value;if(value.tagName==='SELECT'){try{next=JSON.parse(String(next));}catch{ /* plain string choice */ }}if(typeof item.value==='number')next=Number(next);postScalar(item.valuePath,next);});row.append(value);wrap.append(row);if(item.description){const small=document.createElement('small');small.textContent=item.description;wrap.append(small);}return wrap;}
function renderTest(test){editor.replaceChildren();if(!test){editor.innerHTML='<p>Select a Test.</p>';return;}const heading=document.createElement('h1');heading.textContent=test.title||test.id;editor.append(heading);const title=control('Editable Test summary',test.title,test.titlePath,[], 'Saved as native test_title; this is a human explanation, not a scanner result.');if(title)editor.append(title);const cap=document.createElement('p');cap.innerHTML='<strong>How to inspect:</strong> '+test.capabilityLabel+' <span class="muted">('+test.capability+')</span>';editor.append(cap);if(current?.assessment?.evaluationControl){const evalText=document.createElement('p');evalText.className='muted';evalText.textContent='Evaluation tree: '+current.assessment.evaluationExplanation;editor.append(evalText);}const hObject=document.createElement('h3');hObject.textContent='What evidence is collected';editor.append(hObject);for(const item of test.objectControls){item.allowedOperations=item.definition?.operations||[];const c=predicate(editor,item);if(c)editor.append(c);}const hReq=document.createElement('h3');hReq.textContent='What counts as sufficient evidence';editor.append(hReq);const reqExplain=document.createElement('p');reqExplain.className='muted';reqExplain.textContent='Item existence, Item satisfaction, and field matching are separate decisions.';editor.append(reqExplain);for(const item of test.itemControls){const c=control(item.label,item.value,item.path,item.choices);if(c)editor.append(c);}for(const item of test.fieldRequirement){const c=control(item.label,item.value,item.path,item.choices);if(c)editor.append(c);}for(const item of test.fieldControls){const c=predicate(editor,item);if(c)editor.append(c);}if(current?.assessment?.inputControls?.length){const inputHeading=document.createElement('h3');inputHeading.textContent='Optional Inputs';editor.append(inputHeading);for(const input of current.assessment.inputControls){const inputLabel=document.createElement('p');inputLabel.className='muted';inputLabel.textContent=input.label+' — '+input.description;editor.append(inputLabel);for(const item of input.controls){const c=control(item.label,item.value,item.path,item.choices);if(c)editor.append(c);}}}const summary=document.createElement('p');summary.className='summary';summary.textContent=test.explanation;editor.append(summary);if(test.unsupported.length){const note=document.createElement('p');note.className='warning';note.textContent='Advanced authored members not shown here: '+test.unsupported.join(', ')+'. They remain intact; use the native YAML editor to edit safely.';editor.append(note);}}
function render(model){current=model;revision=model.revision||null;version=model.version??null;status.textContent='Wide desktop view · '+(model.hiddenCount||0)+' serialized defaults hidden';const defaultsButton=document.getElementById('toggleDefaults');defaultsButton.hidden=!(model.hiddenCount>0);defaultsButton.textContent=showDefaults?'Hide serialized defaults':'Show '+(model.hiddenCount||0)+' serialized defaults';testsEl.replaceChildren();if(!model.assessment){editor.innerHTML='<p>This document is not an Assessment. Use the native YAML editor.</p>';return;}for(const test of model.assessment.tests||[]){const b=document.createElement('button');b.className='test-button'+(test.id===selected?' active':'');b.textContent=test.title||test.id;const sub=document.createElement('div');sub.className='test-capability';sub.textContent=test.capabilityLabel;b.append(sub);b.onclick=()=>{selected=test.id;render(model);};testsEl.append(b);}if(!selected||!(model.assessment.tests||[]).some(t=>t.id===selected))selected=model.assessment.tests?.[0]?.id;renderTest(model.assessment.tests?.find(t=>t.id===selected));}
document.getElementById('openSource').onclick=()=>vscode.postMessage({type:'openSource'});document.getElementById('toggleDefaults').onclick=()=>{showDefaults=!showDefaults;if(current)render(current);};window.addEventListener('message',event=>{if(event.data.type==='model')render(event.data.model);if(event.data.type==='selectGraphical'&&Array.isArray(event.data.path)){if(event.data.testId&&selected!==event.data.testId&&current?.assessment?.tests?.some(test=>test.id===event.data.testId)){selected=event.data.testId;render(current);}const target=[...document.querySelectorAll('[data-path]')].find(node=>node.dataset.path===JSON.stringify(event.data.path));if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.style.outline='2px solid var(--vscode-focusBorder)';setTimeout(()=>{target.style.outline='';},1200);}}if(event.data.type==='regexPreviewResult'){const previews=event.data.previews||[];const text=previews.map(result=>result.error?result.pattern+': '+result.error:result.pattern+': '+(result.matched?'matched sample':'did not match sample')+(result.timedOut?' (cancelled)':'')).join(' · ');document.querySelectorAll('.predicate .muted').forEach(node=>{if(node.textContent==='Previewing in an isolated, time-limited worker…')node.textContent=text;});}if(event.data.type==='error'){status.className='error';status.textContent=event.data.message;}});vscode.postMessage({type:'ready'});
</script></body></html>`;
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

class AssessmentEditorProvider {
  constructor(private readonly getPack: () => MetadataPack | undefined) {}
  async resolveCustomTextEditor(document: any, panel: any, _token: any) {
    const api: any = vscode; panel.webview.options = { enableScripts: true }; panel.webview.html = structuredHtml();
    const send = () => panel.webview.postMessage({ type: 'model', model: assessmentEditorModel(document, this.getPack()) });
    let editQueue = Promise.resolve();
    const applyMessage = async (message: any) => {
      if (message.type === 'ready') return send();
      if (message.type === 'openSource') { await revealNativeSource(api, document); return; }
      if (message.type === 'openGuided') { await api.commands.executeCommand('scapNg.createGuidedAssessment'); return; }
      if (message.type === 'selectPath' && Array.isArray(message.path)) {
        try { const range = new SourceBuffer(document.getText()).scalarRange(message.path); await revealNativeSource(api, document, range); } catch { await revealNativeSource(api, document); }
        return;
      }
      if (message.type === 'regexPreview' && Array.isArray(message.patterns) && typeof message.input === 'string') {
        const previews = await previewRegexSafe(message.patterns.filter((pattern: any) => typeof pattern === 'string'), message.input, typeof message.flags === 'string' ? message.flags : '', 100);
        panel.webview.postMessage({ type: 'regexPreviewResult', previews }); return;
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
  const files = await api.workspace.findFiles('**/*.{yaml,yml}', '**/{node_modules,.git,.external}/**');
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
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-guided';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;max-width:900px}fieldset{border:1px solid var(--vscode-panel-border);margin:12px 0;padding:12px}legend{font-weight:600}label{display:block;margin:9px 0}input,select,textarea{display:block;width:100%;box-sizing:border-box;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:6px}input[type=checkbox]{display:inline;width:auto}textarea{min-height:64px;font-family:var(--vscode-editor-font-family)}.row{display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:8px;margin:8px 0;align-items:end}.row label{margin:0}.hint{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.explanation{border-left:3px solid var(--vscode-textLink-foreground);padding:8px}.summary{border-left:3px solid var(--vscode-textLink-foreground);padding:8px;margin:10px 0}.advanced{border-top:1px solid var(--vscode-panel-border);margin-top:12px;padding-top:8px}button{padding:7px 12px}.unsupported{color:var(--vscode-descriptionForeground);font-style:italic}</style></head><body><h1>Guided Assessment authoring</h1><p class="hint">Answer the policy question first. Exact YAML keywords remain available in the Graphical editor and native YAML editor. Platform is an authoring context only; it does not assert CPE applicability.</p><p id="status" role="status"></p><fieldset><legend>1. Assessment purpose</legend><label for="platform">Target platform<select id="platform">${optionHtml(catalog.platforms())}</select></label><label for="mode">Assessment mode<select id="mode">${optionHtml(catalog.modes())}</select></label><label for="className">Assessment class<select id="className">${optionHtml(catalog.classes())}</select></label><label for="id">Assessment ID<input id="id" value="guided-assessment"></label><label for="title">Security requirement<input id="title" placeholder="What security requirement should be checked?"></label><label for="procedure">Manual procedure<textarea id="procedure">Review the target according to the documented procedure.</textarea></label><div id="manualResponse"><p class="hint">Manual responses are author-defined choices, not scanner results.</p><label for="responseType">Response contract name<input id="responseType" value="manual-review"></label><div class="row"><label>Value<input id="choice1Value" value="yes"></label><label>Label<input id="choice1Label" value="Yes"></label><label>Outcome<select id="choice1Outcome"><option>true</option><option>false</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><div class="row"><label>Value<input id="choice2Value" value="no"></label><label>Label<input id="choice2Label" value="No"></label><label>Outcome<select id="choice2Outcome"><option>false</option><option>true</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><label><input id="allowComment" type="checkbox" checked> Allow reviewer comment</label><label><input id="allowEvidence" type="checkbox" checked> Allow evidence attachment</label></div></fieldset><fieldset id="automated"><legend>2. What evidence should be collected?</legend><label for="capability">Evidence collection capability<select id="capability">${optionHtml(catalog.capabilities())}</select></label><p id="capabilityHelp" class="hint"></p><div id="objectFields"></div><details class="advanced"><summary>Advanced source fields</summary><p class="unsupported">This slice exposes the schema-declared primary selector fields. Advanced Objects, Variables and dependent sources remain available through the native YAML editor without being discarded.</p></details><legend>3. What counts as sufficient evidence?</legend><label for="testId">Test ID<input id="testId" value="guided-test"></label><label for="testTitle">Human-readable Test summary<input id="testTitle" placeholder="Generated summary; editable before save"></label><label for="itemsFound">Collected Items found<select id="itemsFound">${optionHtml(catalog.itemFound())}</select></label><label id="itemsSatisfyingLabel" for="itemsSatisfying">Selected Items satisfying condition<select id="itemsSatisfying">${optionHtml(catalog.itemsSatisfying())}</select></label><label id="valuesFoundLabel" for="valuesFound">Field values found<select id="valuesFound">${optionHtml(catalog.fieldValuesFound())}</select></label><label id="valuesMatchingLabel" for="valuesMatching">Field values matching<select id="valuesMatching">${optionHtml(catalog.fieldValuesMatching())}</select></label><label><input id="presenceOnly" type="checkbox"> Presence-only check (no field comparison)</label><div id="comparisonFields"></div><button id="addField" type="button">Add comparison field</button><div id="summary" class="summary" aria-live="polite"></div><p class="hint">This first Guided slice creates one Test. Multiple-Test evaluation trees remain editable in Graphical/the native YAML editor until the dedicated tree editor lands.</p></fieldset><button id="create">Create Assessment</button><script nonce="guided">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const status=$('status');let objectDefinitions=[];let resultDefinitions=[];function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function opts(items,selected){return items.map(x=>'<option value=\"'+esc(x.value)+'\" '+(x.value===selected?'selected':'')+'>'+esc(x.label||x.value)+'</option>').join('');}function renderObjectFields(fields){objectDefinitions=fields;const root=$('objectFields');root.replaceChildren();if(!fields.length){root.innerHTML='<p class="unsupported">No primary selector controls are available for this capability yet. Continue in Structured or the native YAML editor.</p>';return;}for(const f of fields){const row=document.createElement('div');row.className='row object-row';row.dataset.name=f.name;const label=document.createElement('label');label.textContent=f.label;label.title=f.description||'';const operation=document.createElement('select');operation.className='object-operation';operation.innerHTML=opts(f.operations,'equals');const value=document.createElement(f.enumValues?.length?'select':'input');value.className='object-value';if(f.enumValues?.length)value.innerHTML=opts(f.enumValues.map(v=>({value:v,label:v})));else value.placeholder='Enter '+f.label.toLowerCase();row.append(label,operation,value);root.append(row);}}function renderComparisonFields(fields){resultDefinitions=fields;const root=$('comparisonFields');root.replaceChildren();addComparisonRow(fields[0]?.name||'');}function addComparisonRow(selected){const root=$('comparisonFields');const row=document.createElement('div');row.className='row field-row';const name=document.createElement('select');name.className='field-name';name.innerHTML=opts(resultDefinitions.map(f=>({value:f.name,label:f.label})),selected);const operation=document.createElement('select');operation.className='field-operation';operation.innerHTML=opts(resultDefinitions[0]?.operations||[],'equals');const datatype=document.createElement('select');datatype.className='field-datatype';datatype.innerHTML=opts((resultDefinitions.find(f=>f.name===selected)?.datatypes||['string']).map(v=>({value:v,label:v})),'string');const value=document.createElement('input');value.className='field-value';value.placeholder='Expected value';name.onchange=()=>{const definition=resultDefinitions.find(f=>f.name===name.value);operation.innerHTML=opts(definition?.operations||[],'equals');datatype.innerHTML=opts((definition?.datatypes||['string']).map(v=>({value:v,label:v})),definition?.datatype||'string');};const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(name,operation,datatype,value,remove);root.append(row);}function collectObject(){const object={};document.querySelectorAll('.object-row').forEach(row=>{const value=row.querySelector('.object-value').value;if(value) object[row.dataset.name]={[row.querySelector('.object-operation').value]:value};});return object;}function collectFields(){const fields={};document.querySelectorAll('.field-row').forEach(row=>{const value=row.querySelector('.field-value').value;if(value){const datatype=row.querySelector('.field-datatype').value;if(datatype==='integer')value=Number(value);else if(datatype==='boolean')value=value==='true';fields[row.querySelector('.field-name').value]={[row.querySelector('.field-operation').value]:value};}});return fields;}function updateSummary(){const cap=$('capability').selectedOptions[0]?.textContent||$('capability').value;const item=$('itemsFound').selectedOptions[0]?.textContent;const match=$('presenceOnly').checked?'presence only':($('itemsSatisfying').selectedOptions[0]?.textContent+' of selected Items');const field=$('presenceOnly').checked?'No field comparison':($('valuesMatching').selectedOptions[0]?.textContent+' of found values');$('summary').textContent=cap+': at least '+item+' Item(s) must exist; '+match+' must satisfy the condition; '+field+' must match.';}function refresh(){const automated=$('mode').value==='automated';$('automated').hidden=!automated;$('manualResponse').hidden=automated;updateSummary();}$('mode').onchange=refresh;$('capability').onchange=()=>vscode.postMessage({type:'capability',value:$('capability').value});$('presenceOnly').onchange=()=>{const hidden=$('presenceOnly').checked;for(const id of ['itemsSatisfyingLabel','valuesFoundLabel','valuesMatchingLabel','comparisonFields','addField'])$(id).hidden=hidden;updateSummary();};$('itemsFound').onchange=updateSummary;$('itemsSatisfying').onchange=updateSummary;$('valuesMatching').onchange=updateSummary;$('addField').onclick=()=>addComparisonRow('');$('create').onclick=()=>{try{const automated=$('mode').value==='automated';const message={type:'create',platform:$('platform').value,id:$('id').value,title:$('title').value,mode:$('mode').value,className:$('className').value,procedure:$('procedure').value};if(automated){message.tests=[{id:$('testId').value,title:$('testTitle').value||$('title').value,capability:$('capability').value,object:collectObject(),fields:collectFields(),presenceOnly:$('presenceOnly').checked}];}else{message.response={type:$('responseType').value,choices:[{value:$('choice1Value').value,label:$('choice1Label').value,outcome:$('choice1Outcome').value},{value:$('choice2Value').value,label:$('choice2Label').value,outcome:$('choice2Outcome').value}],allow_comment:$('allowComment').checked,allow_evidence:$('allowEvidence').checked};}vscode.postMessage(message);}catch(error){status.className='error';status.textContent=error.message;}};window.addEventListener('message',event=>{if(event.data.type==='objectFields')renderObjectFields(event.data.fields);if(event.data.type==='resultFields')renderComparisonFields(event.data.fields);status.className=event.data.ok?'':'error';if(event.data.message)status.textContent=event.data.message;});refresh();vscode.postMessage({type:'capability',value:$('capability').value});</script></body></html>`;
}
class GuidedPanel {
  static open(context: vscode.ExtensionContext, pack: MetadataPack | undefined) {
    const api: any = vscode;
    if (!pack) return void vscode.window.showWarningMessage('Configure a verified offline SCAP-NG metadata pack before using Guided authoring.');
    const catalog = new GuidedCatalog(pack); const panel = api.window.createWebviewPanel('scapNg.guided', 'SCAP-NG Guided Assessment', api.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = guidedHtml(catalog);
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'capability') { panel.webview.postMessage({ type: 'objectFields', fields: catalog.objectFields(message.value) }); panel.webview.postMessage({ type: 'resultFields', fields: catalog.resultFields(message.value) }); return; }
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
function quickFixFragment(choice: { value: string; insertText?: string; defaultValue?: unknown }): string {
  if (choice.defaultValue !== undefined) return `${choice.value}: ${inlineYaml(choice.defaultValue)}`;
  if (choice.insertText?.endsWith('{')) return `${choice.value}: {}`;
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
  const errors = pack.validateDetailed(schemaUri, value).filter(error => error.keyword === 'required');
  const tests = value?.assessment?.tests;
  if (tests && typeof tests === 'object' && !Array.isArray(tests)) for (const [testId, test] of Object.entries(tests)) {
    const capability = (test as any)?.capability;
    const object = (test as any)?.object;
    const capabilityUri = capability && pack.manifest.capabilities[capability]?.schema_uri;
    if (!capabilityUri || !object || typeof object !== 'object' || Array.isArray(object)) continue;
    const capabilitySchema: any = pack.resource(capabilityUri);
    const objectSchema = capabilitySchema.$defs?.object;
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
    const fragment = quickFixFragment(choice);
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
function yamlStatusDetails(pack: MetadataPack | undefined, document: any, profile: Pin, api: any, packError?: string) {
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
    text: state === 'healthy' ? `$(check) SCAP-NG ${profile.schemaVersion}` : state === 'error' ? '$(error) SCAP-NG YAML' : `$(warning) SCAP-NG ${profile.schemaVersion}`,
    document: document?.uri?.fsPath ?? '', languageId: document?.languageId ?? '',
    schemaUri: schemaUri ?? '', schemaVersion: pack?.pin.schemaVersion ?? profile.schemaVersion,
    schemaPath: schemaPath ?? '', packPath: pack?.directory ?? '', packSha256: pack?.pin.manifestSha256 ?? '',
    redhatInstalled: Boolean(redhat), redhatActive: Boolean(redhat?.isActive), associationPresent: associated,
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
        item.insertText = choice.kind === 'property'
          ? (nextCharacter === ':' ? choice.value : propertyInsert)
          : choice.value;
        item.range = typeof document.getWordRangeAtPosition === 'function'
          ? (document.getWordRangeAtPosition(position, /[A-Za-z0-9_.-]+/) ?? new api.Range(position, position))
          : new api.Range(position, position);
        item.detail = choice.kind === 'property' ? 'Selected capability schema' : `Pinned SCAP-NG metadata${choice.isDefault ? ' (schema default)' : ''}`;
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
  const configuredPack = vscode.workspace.getConfiguration('scapNg').get<string>('schemaPackPath');
  let pack: MetadataPack | undefined;
  let packConfiguration: Promise<boolean> | undefined;
  let packError: string | undefined;
  let packWarningShown = false;
  const loadPack = (documentPath?: string) => {
    if (pack) return pack;
    packError = undefined;
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
  registerYamlCodeActions(context, () => pack, api);
  const yamlStatus = api.window.createStatusBarItem(api.StatusBarAlignment?.Right ?? 2, 100);
  yamlStatus.command = 'scapNg.showYamlStatus';
  let currentYamlStatus: any;
  const refreshYamlStatus = async (document: any = api.window.activeTextEditor?.document) => {
    if (!isAssessmentDocument(document)) { yamlStatus.hide(); currentYamlStatus = undefined; return undefined; }
    loadPack(document.uri.fsPath);
    if (packConfiguration) { try { await packConfiguration; } catch { /* status reports association state */ } }
    currentYamlStatus = yamlStatusDetails(pack, document, profile, api, packError);
    yamlStatus.text = currentYamlStatus.text;
    yamlStatus.tooltip = `SCAP-NG ${profile.schemaVersion} · ${currentYamlStatus.state} · click for diagnostics`;
    yamlStatus.show();
    return currentYamlStatus;
  };
  context.subscriptions.push(yamlStatus);
  // Keep the suppression and schema association workspace-scoped. This avoids
  // changing ordinary YAML files in other workspaces or the user's global settings.
  context.subscriptions.push(diagnostics, schemaDiagnostics, indexDiagnostics, vscode.window.registerTreeDataProvider('scapNg.assessmentStudio', tree), vscode.window.registerWebviewViewProvider('scapNg.pinView', new PinView(context)));
  void indexWorkspace(index, tree, api, indexDiagnostics);
  if (api.workspace.createFileSystemWatcher) {
    for (const pattern of ['**/*.yaml', '**/*.yml']) {
      const watcher = api.workspace.createFileSystemWatcher(pattern);
      context.subscriptions.push(watcher, watcher.onDidCreate((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics)), watcher.onDidChange((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics)), watcher.onDidDelete((uri: any) => { index.remove(uri.toString()); publishIndexDiagnostics(index, indexDiagnostics, api); tree.refresh(); }));
    }
  }
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
  const build = readBuildInfo(context.extensionPath);
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.showPin', () => vscode.window.showInformationMessage(`SCAP-NG ${profile.schemaVersion} · ${profile.sourceCommit} · Build ${buildLabel(build)} · ${yamlServiceLabel(api)}`)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.showBuildInfo', () => vscode.window.showInformationMessage(`SCAP-NG build ${buildLabel(build)} · source ${build.sourceCommit} · ${yamlServiceLabel(api)}`)));
  context.subscriptions.push(api.commands.registerCommand('scapNg.showYamlStatus', async () => {
    const details = await refreshYamlStatus(api.window.activeTextEditor?.document);
    const channel = api.window.createOutputChannel('SCAP-NG YAML Status'); channel.clear();
    if (!details) channel.appendLine('No recognized SCAP-NG Assessment document is active.');
    else for (const line of [
      `State: ${details.state}`, `Document: ${details.document}`, `Language ID: ${details.languageId}`,
      `Schema: ${details.schemaUri || 'unavailable'} (${details.schemaVersion})`, `Schema path: ${details.schemaPath || 'unavailable'}`,
      `Pack: ${details.packPath || 'unavailable'}`, `Pack manifest SHA-256: ${details.packSha256 || 'unavailable'}`,
      `Red Hat YAML: ${details.redhatInstalled ? `installed, active=${details.redhatActive}` : 'not installed'}`,
      `Schema association: ${details.associationPresent ? 'present' : 'missing'}`, `Diagnostics: ${details.diagnostics}`,
      `Error: ${details.error || 'none'}`, 'Commands: SCAP-NG: Diagnose native YAML; SCAP-NG: Configure native YAML schemas'
    ]) channel.appendLine(line);
    channel.show(true); return details;
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
  const inspect = (document: vscode.TextDocument) => {
    loadPack(document.uri.fsPath);
    if (document.languageId === 'yaml' || /\.(ya?ml)$/.test(document.uri.fsPath)) {
      validateDocument(document, profile, diagnostics);
      publishSchemaRequiredDiagnostics(document, pack, schemaDiagnostics);
    }
    void refreshYamlStatus(document);
  };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(inspect), vscode.workspace.onDidSaveTextDocument(inspect));
  if (api.workspace.onDidChangeTextDocument) context.subscriptions.push(api.workspace.onDidChangeTextDocument((event: any) => inspect(event.document)));
  if (api.window.onDidChangeActiveTextEditor) context.subscriptions.push(api.window.onDidChangeActiveTextEditor((editor: any) => { void refreshYamlStatus(editor?.document); }));
  if (api.window.activeTextEditor?.document) { inspect(api.window.activeTextEditor.document); void refreshYamlStatus(api.window.activeTextEditor.document); }
}
export function deactivate() { /* no network, telemetry or scanner process */ }
