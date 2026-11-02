import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MetadataPack, sha256, type Pin } from './metadata.js';
import { SourceBuffer } from './source.js';
import { WorkspaceIndex, type IndexedDocument } from './indexer.js';

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
</style></head><body><h2>Structured view</h2><p id="status">Loading source-backed fields…</p><main id="fields"></main><script nonce="${nonce}">
const vscode=acquireVsCodeApi(); const fields=document.getElementById('fields'); const status=document.getElementById('status'); let revision=null; let version=null;
function render(model){ revision=model.revision||null; version=model.version??null; fields.replaceChildren(); if(!model.ok){status.className='error';status.textContent=model.error+' Open Source mode to repair it.';return;} status.className='';status.textContent='Edits use minimal source ranges; VS Code undo/redo and save remain authoritative.'; for(const f of model.fields){const row=document.createElement('label');row.className='field';const name=document.createElement('code');name.textContent=f.label;name.title=f.description||f.kind;row.append(name);let input;if(f.choices&&f.choices.length){input=document.createElement('select');for(const choice of f.choices){const option=document.createElement('option');option.value=JSON.stringify(choice);option.textContent=String(choice);option.selected=JSON.stringify(choice)===JSON.stringify(f.value);input.append(option);}}else{input=document.createElement('input');input.dataset.kind=f.kind;if(f.kind==='boolean'){input.type='checkbox';input.checked=f.value;}else{input.type='text';input.value=f.value===null?'':String(f.value);input.title=f.kind;}}input.dataset.path=JSON.stringify(f.path);input.addEventListener('change',()=>{let value=input.tagName==='SELECT'?JSON.parse(input.value):input.type==='checkbox'?input.checked:input.value;if(f.kind==='number'&&!Array.isArray(f.choices)){value=Number(value);}if(f.kind==='null'&&!input.value)value=null;vscode.postMessage({type:'edit',path:f.path,value,revision,version});});row.append(input);fields.append(row);}}
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

async function indexWorkspace(index: WorkspaceIndex, tree: StudioTree, api: any, diagnostics: vscode.DiagnosticCollection) {
  if (!api.workspace.findFiles || !api.workspace.openTextDocument) return;
  const files = await api.workspace.findFiles('**/*.{yaml,yml}', '**/{node_modules,.git,.external}/**');
  const entries: { uri: string; text: string; path: string }[] = [];
  await Promise.all(files.map(async (uri: any) => {
    try { const document = await api.workspace.openTextDocument(uri); entries.push({ uri: uri.toString(), text: document.getText(), path: uri.fsPath }); } catch { /* unreadable files remain outside the index */ }
  }));
  index.updateMany(entries);
  publishIndexDiagnostics(index, diagnostics, api); tree.refresh();
}
function publishIndexDiagnostics(index: WorkspaceIndex, diagnostics: vscode.DiagnosticCollection, api: any) {
  for (const diagnostic of index.diagnostics()) {
    const uri = api.Uri.parse(diagnostic.uri); const severity = diagnostic.severity === 'error' ? api.DiagnosticSeverity.Error : api.DiagnosticSeverity.Warning;
    diagnostics.set(uri, [new api.Diagnostic(new api.Range(0, 0, 0, 1), diagnostic.message, severity)]);
  }
}
async function updateIndexedUri(index: WorkspaceIndex, uri: any, tree: StudioTree, api: any, diagnostics: vscode.DiagnosticCollection) {
  try { const document = await api.workspace.openTextDocument(uri); index.update(uri.toString(), document.getText(), uri.fsPath); publishIndexDiagnostics(index, diagnostics, api); tree.refresh(); } catch { /* file may have been removed between watcher events */ }
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
  const api: any = vscode;
  context.subscriptions.push(diagnostics, vscode.window.registerTreeDataProvider('scapNg.assessmentStudio', tree), vscode.window.registerWebviewViewProvider('scapNg.pinView', new PinView(context)));
  void indexWorkspace(index, tree, api, diagnostics);
  if (api.workspace.createFileSystemWatcher) {
    for (const pattern of ['**/*.yaml', '**/*.yml']) {
      const watcher = api.workspace.createFileSystemWatcher(pattern);
      context.subscriptions.push(watcher, watcher.onDidCreate((uri: any) => void updateIndexedUri(index, uri, tree, api, diagnostics)), watcher.onDidChange((uri: any) => void updateIndexedUri(index, uri, tree, api, diagnostics)), watcher.onDidDelete((uri: any) => { index.remove(uri.toString()); publishIndexDiagnostics(index, diagnostics, api); tree.refresh(); }));
    }
  }
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.searchIndex', async () => tree.setQuery(await api.window.showInputBox({ prompt: 'Search Assessment Studio index' }) ?? '')));
  context.subscriptions.push(api.window.registerCustomEditorProvider('scapNg.assessment', new AssessmentEditorProvider(pack), { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.showPin', () => vscode.window.showInformationMessage(`SCAP-NG ${profile.schemaVersion} · ${profile.sourceCommit}`)));
  const inspect = (document: vscode.TextDocument) => { if (document.languageId === 'yaml' || /\.(ya?ml)$/.test(document.uri.fsPath)) validateDocument(document, profile, diagnostics); };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(inspect), vscode.workspace.onDidSaveTextDocument(inspect));
}
export function deactivate() { /* no network, telemetry or scanner process */ }
