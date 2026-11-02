import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MetadataPack, sha256, type Pin } from './metadata.js';
import { SourceBuffer } from './source.js';
import { WorkspaceIndex, type IndexedDocument } from './indexer.js';
import { GuidedCatalog, createGuidedAssessment } from './guided.js';

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
    view.webview.html = `<!doctype html><html><body><h2>SCAP-NG Assessment Studio</h2><p>Schema ${escapeHtml(profile.schemaVersion)}</p><p>Source commit <code>${escapeHtml(profile.sourceCommit)}</code></p><p>Offline validation is enabled only when a verified local metadata pack is configured.</p></body></html>`;
  }
}
function readProfile(root: string): Pin {
  const raw = readFileSync(profilePath(root), 'utf8');
  return JSON.parse(raw) as Pin;
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }


import { modelFor } from './structured-model.js';

function structuredHtml() {
  const nonce = 'scap-ng-structured';
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}.field{display:grid;grid-template-columns:minmax(12em,30%) 1fr;gap:8px;align-items:center;margin:6px 0}input{color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:4px}code{word-break:break-all}.error{color:var(--vscode-errorForeground)}button{margin-top:10px}
</style></head><body><h2>Structured view</h2><p id="status">Loading source-backed fields…</p><p id="explanation" class="explanation" aria-live="polite"></p><main id="fields"></main><script nonce="${nonce}">
const vscode=acquireVsCodeApi(); const fields=document.getElementById('fields'); const status=document.getElementById('status'); const explanation=document.getElementById('explanation'); let revision=null; let version=null;
function render(model){ revision=model.revision||null; version=model.version??null; explanation.textContent=model.explanation||''; fields.replaceChildren(); if(!model.ok){status.className='error';status.textContent=model.error+' Open Source mode to repair it.';return;} status.className='';status.textContent='Edits use minimal source ranges; VS Code undo/redo and save remain authoritative.'; for(const f of model.fields){const row=document.createElement('label');row.className='field';const name=document.createElement('code');name.textContent=f.label;name.title=f.description||f.kind;row.append(name);let input;if(f.choices&&f.choices.length){input=document.createElement('select');for(const choice of f.choices){const option=document.createElement('option');option.value=JSON.stringify(choice);option.textContent=String(choice);option.selected=JSON.stringify(choice)===JSON.stringify(f.value);input.append(option);}}else{input=document.createElement('input');input.dataset.kind=f.kind;if(f.kind==='boolean'){input.type='checkbox';input.checked=f.value;}else{input.type='text';input.value=f.value===null?'':String(f.value);input.title=f.kind;}}input.dataset.path=JSON.stringify(f.path);input.addEventListener('change',()=>{let value=input.tagName==='SELECT'?JSON.parse(input.value):input.type==='checkbox'?input.checked:input.value;if(f.kind==='number'&&!Array.isArray(f.choices)){value=Number(value);}if(f.kind==='null'&&!input.value)value=null;vscode.postMessage({type:'edit',path:f.path,value,revision,version});});row.append(input);fields.append(row);}}
window.addEventListener('message',event=>{if(event.data.type==='model')render(event.data.model);if(event.data.type==='error'){status.className='error';status.textContent=event.data.message;}});vscode.postMessage({type:'ready'});
</script></body></html>`;
}
class AssessmentEditorProvider {
  constructor(private readonly pack?: MetadataPack) {}
  async resolveCustomTextEditor(document: any, panel: any, _token: any) {
    const api: any = vscode; panel.webview.options = { enableScripts: true }; panel.webview.html = structuredHtml();
    const send = () => panel.webview.postMessage({ type: 'model', model: modelFor(document, this.pack) });
    let editQueue = Promise.resolve();
    const applyMessage = async (message: any) => {
      if (message.type === 'ready') return send();
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
    panel.onDidDispose(() => { onMessage.dispose(); onChange.dispose(); });
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
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-guided';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;max-width:900px}fieldset{border:1px solid var(--vscode-panel-border);margin:12px 0;padding:12px}legend{font-weight:600}label{display:block;margin:9px 0}input,select,textarea{display:block;width:100%;box-sizing:border-box;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:6px}input[type=checkbox]{display:inline;width:auto}textarea{min-height:64px;font-family:var(--vscode-editor-font-family)}.row{display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:8px;margin:8px 0;align-items:end}.row label{margin:0}.hint{color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}.explanation{border-left:3px solid var(--vscode-textLink-foreground);padding:8px}.summary{border-left:3px solid var(--vscode-textLink-foreground);padding:8px;margin:10px 0}.advanced{border-top:1px solid var(--vscode-panel-border);margin-top:12px;padding-top:8px}button{padding:7px 12px}.unsupported{color:var(--vscode-descriptionForeground);font-style:italic}</style></head><body><h1>Guided Assessment authoring</h1><p class="hint">Answer the policy question first. Exact YAML keywords remain available in Source and Structured mode. Platform is an authoring context only; it does not assert CPE applicability.</p><p id="status" role="status"></p><fieldset><legend>1. Assessment purpose</legend><label for="platform">Target platform<select id="platform">${optionHtml(catalog.platforms())}</select></label><label for="mode">Assessment mode<select id="mode">${optionHtml(catalog.modes())}</select></label><label for="className">Assessment class<select id="className">${optionHtml(catalog.classes())}</select></label><label for="id">Assessment ID<input id="id" value="guided-assessment"></label><label for="title">Security requirement<input id="title" placeholder="What security requirement should be checked?"></label><label for="procedure">Manual procedure<textarea id="procedure">Review the target according to the documented procedure.</textarea></label><div id="manualResponse"><p class="hint">Manual responses are author-defined choices, not scanner results.</p><label for="responseType">Response contract name<input id="responseType" value="manual-review"></label><div class="row"><label>Value<input id="choice1Value" value="yes"></label><label>Label<input id="choice1Label" value="Yes"></label><label>Outcome<select id="choice1Outcome"><option>true</option><option>false</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><div class="row"><label>Value<input id="choice2Value" value="no"></label><label>Label<input id="choice2Label" value="No"></label><label>Outcome<select id="choice2Outcome"><option>false</option><option>true</option><option>unknown</option><option>not_evaluated</option><option>not_applicable</option><option>error</option></select></label></div><label><input id="allowComment" type="checkbox" checked> Allow reviewer comment</label><label><input id="allowEvidence" type="checkbox" checked> Allow evidence attachment</label></div></fieldset><fieldset id="automated"><legend>2. What evidence should be collected?</legend><label for="capability">Evidence collection capability<select id="capability">${optionHtml(catalog.capabilities())}</select></label><p id="capabilityHelp" class="hint"></p><div id="objectFields"></div><details class="advanced"><summary>Advanced source fields</summary><p class="unsupported">This slice exposes the schema-declared primary selector fields. Advanced Objects, Variables and dependent sources remain available through Source/Structured mode without being discarded.</p></details><legend>3. What counts as sufficient evidence?</legend><label for="testId">Test ID<input id="testId" value="guided-test"></label><label for="testTitle">Human-readable Test summary<input id="testTitle" placeholder="Generated summary; editable before save"></label><label for="itemsFound">Collected Items found<select id="itemsFound">${optionHtml(catalog.itemFound())}</select></label><label id="itemsSatisfyingLabel" for="itemsSatisfying">Selected Items satisfying condition<select id="itemsSatisfying">${optionHtml(catalog.itemsSatisfying())}</select></label><label id="valuesFoundLabel" for="valuesFound">Field values found<select id="valuesFound">${optionHtml(catalog.fieldValuesFound())}</select></label><label id="valuesMatchingLabel" for="valuesMatching">Field values matching<select id="valuesMatching">${optionHtml(catalog.fieldValuesMatching())}</select></label><label><input id="presenceOnly" type="checkbox"> Presence-only check (no field comparison)</label><div id="comparisonFields"></div><button id="addField" type="button">Add comparison field</button><div id="summary" class="summary" aria-live="polite"></div><p class="hint">This first Guided slice creates one Test. Multiple-Test evaluation trees remain editable in Structured/Source mode until the dedicated tree editor lands.</p></fieldset><button id="create">Create Assessment</button><script nonce="guided">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const status=$('status');let objectDefinitions=[];let resultDefinitions=[];function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function opts(items,selected){return items.map(x=>'<option value=\"'+esc(x.value)+'\" '+(x.value===selected?'selected':'')+'>'+esc(x.label||x.value)+'</option>').join('');}function renderObjectFields(fields){objectDefinitions=fields;const root=$('objectFields');root.replaceChildren();if(!fields.length){root.innerHTML='<p class="unsupported">No primary selector controls are available for this capability yet. Continue in Structured or Source mode.</p>';return;}for(const f of fields){const row=document.createElement('div');row.className='row object-row';row.dataset.name=f.name;const label=document.createElement('label');label.textContent=f.label;label.title=f.description||'';const operation=document.createElement('select');operation.className='object-operation';operation.innerHTML=opts(f.operations,'equals');const value=document.createElement(f.enumValues?.length?'select':'input');value.className='object-value';if(f.enumValues?.length)value.innerHTML=opts(f.enumValues.map(v=>({value:v,label:v})));else value.placeholder='Enter '+f.label.toLowerCase();row.append(label,operation,value);root.append(row);}}function renderComparisonFields(fields){resultDefinitions=fields;const root=$('comparisonFields');root.replaceChildren();addComparisonRow(fields[0]?.name||'');}function addComparisonRow(selected){const root=$('comparisonFields');const row=document.createElement('div');row.className='row field-row';const name=document.createElement('select');name.className='field-name';name.innerHTML=opts(resultDefinitions.map(f=>({value:f.name,label:f.label})),selected);const operation=document.createElement('select');operation.className='field-operation';operation.innerHTML=opts(resultDefinitions[0]?.operations||[],'equals');const datatype=document.createElement('select');datatype.className='field-datatype';datatype.innerHTML=opts((resultDefinitions.find(f=>f.name===selected)?.datatypes||['string']).map(v=>({value:v,label:v})),'string');const value=document.createElement('input');value.className='field-value';value.placeholder='Expected value';name.onchange=()=>{const definition=resultDefinitions.find(f=>f.name===name.value);operation.innerHTML=opts(definition?.operations||[],'equals');datatype.innerHTML=opts((definition?.datatypes||['string']).map(v=>({value:v,label:v})),definition?.datatype||'string');};const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.onclick=()=>row.remove();row.append(name,operation,datatype,value,remove);root.append(row);}function collectObject(){const object={};document.querySelectorAll('.object-row').forEach(row=>{const value=row.querySelector('.object-value').value;if(value) object[row.dataset.name]={[row.querySelector('.object-operation').value]:value};});return object;}function collectFields(){const fields={};document.querySelectorAll('.field-row').forEach(row=>{const value=row.querySelector('.field-value').value;if(value){const datatype=row.querySelector('.field-datatype').value;if(datatype==='integer')value=Number(value);else if(datatype==='boolean')value=value==='true';fields[row.querySelector('.field-name').value]={[row.querySelector('.field-operation').value]:value};}});return fields;}function updateSummary(){const cap=$('capability').selectedOptions[0]?.textContent||$('capability').value;const item=$('itemsFound').selectedOptions[0]?.textContent;const match=$('presenceOnly').checked?'presence only':($('itemsSatisfying').selectedOptions[0]?.textContent+' of selected Items');const field=$('presenceOnly').checked?'No field comparison':($('valuesMatching').selectedOptions[0]?.textContent+' of found values');$('summary').textContent=cap+': at least '+item+' Item(s) must exist; '+match+' must satisfy the condition; '+field+' must match.';}function refresh(){const automated=$('mode').value==='automated';$('automated').hidden=!automated;$('manualResponse').hidden=automated;updateSummary();}$('mode').onchange=refresh;$('capability').onchange=()=>vscode.postMessage({type:'capability',value:$('capability').value});$('presenceOnly').onchange=()=>{const hidden=$('presenceOnly').checked;for(const id of ['itemsSatisfyingLabel','valuesFoundLabel','valuesMatchingLabel','comparisonFields','addField'])$(id).hidden=hidden;updateSummary();};$('itemsFound').onchange=updateSummary;$('itemsSatisfying').onchange=updateSummary;$('valuesMatching').onchange=updateSummary;$('addField').onclick=()=>addComparisonRow('');$('create').onclick=()=>{try{const automated=$('mode').value==='automated';const message={type:'create',platform:$('platform').value,id:$('id').value,title:$('title').value,mode:$('mode').value,className:$('className').value,procedure:$('procedure').value};if(automated){message.tests=[{id:$('testId').value,title:$('testTitle').value||$('title').value,capability:$('capability').value,object:collectObject(),fields:collectFields(),presenceOnly:$('presenceOnly').checked}];}else{message.response={type:$('responseType').value,choices:[{value:$('choice1Value').value,label:$('choice1Label').value,outcome:$('choice1Outcome').value},{value:$('choice2Value').value,label:$('choice2Label').value,outcome:$('choice2Outcome').value}],allow_comment:$('allowComment').checked,allow_evidence:$('allowEvidence').checked};}vscode.postMessage(message);}catch(error){status.className='error';status.textContent=error.message;}};window.addEventListener('message',event=>{if(event.data.type==='objectFields')renderObjectFields(event.data.fields);if(event.data.type==='resultFields')renderComparisonFields(event.data.fields);status.className=event.data.ok?'':'error';if(event.data.message)status.textContent=event.data.message;});refresh();vscode.postMessage({type:'capability',value:$('capability').value});</script></body></html>`;
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

function validateDocument(document: vscode.TextDocument, profile: Pin, diagnostics: vscode.DiagnosticCollection) {
  const parsed = parseDocument(document.getText(), { uniqueKeys: true });
  const output: vscode.Diagnostic[] = [];
  for (const error of parsed.errors) {
    const offset = error.pos?.[0] ?? 0;
    const position = (document as any).positionAt ? (document as any).positionAt(offset) : { line: 0, character: 0 };
    output.push(new vscode.Diagnostic(new vscode.Range(position.line, position.character, position.line, position.character + 1), error.message, vscode.DiagnosticSeverity.Error));
  }
  if (!output.length) {
    const value = parsed.toJS({ maxAliasCount: 50 }) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) output.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'Assessment document must be a YAML mapping', vscode.DiagnosticSeverity.Error));
    const version = value && (value.version ?? value.specification_version ?? value.schema_version);
    if (typeof version === 'string' && version !== profile.schemaVersion) output.push(new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), `Document version ${version} does not match pinned SCAP-NG ${profile.schemaVersion}`, vscode.DiagnosticSeverity.Error));
  }
  diagnostics.set(document.uri, output);
}
export function activate(context: vscode.ExtensionContext) {
  const profile = readProfile(context.extensionPath);
  const configuredPack = vscode.workspace.getConfiguration('scapNg').get<string>('schemaPackPath');
  let pack: MetadataPack | undefined;
  if (configuredPack) {
    try { pack = new MetadataPack(configuredPack, profile); }
    catch (error) { void vscode.window.showWarningMessage(`SCAP-NG metadata pack rejected: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const index = new WorkspaceIndex();
  const tree = new StudioTree(index);
  const diagnostics = vscode.languages.createDiagnosticCollection('scap-ng');
  const indexDiagnostics = vscode.languages.createDiagnosticCollection('scap-ng-index');
  const api: any = vscode;
  context.subscriptions.push(diagnostics, indexDiagnostics, vscode.window.registerTreeDataProvider('scapNg.assessmentStudio', tree), vscode.window.registerWebviewViewProvider('scapNg.pinView', new PinView(context)));
  void indexWorkspace(index, tree, api, indexDiagnostics);
  if (api.workspace.createFileSystemWatcher) {
    for (const pattern of ['**/*.yaml', '**/*.yml']) {
      const watcher = api.workspace.createFileSystemWatcher(pattern);
      context.subscriptions.push(watcher, watcher.onDidCreate((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics)), watcher.onDidChange((uri: any) => void updateIndexedUri(index, uri, tree, api, indexDiagnostics)), watcher.onDidDelete((uri: any) => { index.remove(uri.toString()); publishIndexDiagnostics(index, indexDiagnostics, api); tree.refresh(); }));
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.searchIndex', async () => tree.setQuery(await api.window.showInputBox({ prompt: 'Search Assessment Studio index' }) ?? '')));
  context.subscriptions.push(api.window.registerCustomEditorProvider('scapNg.assessment', new AssessmentEditorProvider(pack), { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.showPin', () => vscode.window.showInformationMessage(`SCAP-NG ${profile.schemaVersion} · ${profile.sourceCommit}`)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.createGuidedAssessment', () => GuidedPanel.open(context, pack)));
  const inspect = (document: vscode.TextDocument) => { if (document.languageId === 'yaml' || /\.(ya?ml)$/.test(document.uri.fsPath)) validateDocument(document, profile, diagnostics); };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(inspect), vscode.workspace.onDidSaveTextDocument(inspect));
}
export function deactivate() { /* no network, telemetry or scanner process */ }
