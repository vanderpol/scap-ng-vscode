import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { MetadataPack, type Pin } from './metadata.js';
import { SourceBuffer } from './source.js';
import { contextualHelp } from './yaml-help.js';
import { findRegexContext } from './regex-tester.js';
import { previewRegexSafe } from './playground.js';

export interface SidebarBuildInfo { buildId: string; sourceCommit: string; builtAt: string; }

function html() {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-authoring-sidebar';"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:var(--vscode-font-size)/1.4 var(--vscode-font-family)}.toolbar{display:flex;gap:4px;align-items:center;padding:6px;border-bottom:1px solid var(--vscode-panel-border);position:sticky;top:0;background:var(--vscode-sideBar-background);z-index:2}.toolbar strong{flex:1}.toolbar button,.tabs button,button.action{border:0;padding:5px 8px;color:var(--vscode-foreground);background:transparent;cursor:pointer}.toolbar button:hover,.tabs button:hover{background:var(--vscode-list-hoverBackground)}.tabs{display:flex;gap:2px;border-bottom:1px solid var(--vscode-panel-border);overflow:auto}.tabs button{white-space:nowrap;border-bottom:2px solid transparent}.tabs button.active{border-bottom-color:var(--vscode-focusBorder);color:var(--vscode-textLink-foreground)}.content{padding:10px}.panel{display:none}.panel.active{display:block}h2,h3{margin:0 0 8px;font-size:1.1em}p{margin:7px 0}.muted{color:var(--vscode-descriptionForeground)}.notice{border-left:3px solid var(--vscode-textLink-foreground);padding:8px;background:var(--vscode-textBlockQuote-background);margin:8px 0}.warning{border-left-color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.path{font-family:var(--vscode-editor-font-family);overflow-wrap:anywhere;color:var(--vscode-textLink-foreground)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:8px;margin:8px 0}textarea,input,select{width:100%;box-sizing:border-box;padding:6px;margin:4px 0 8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}textarea{min-height:100px;font-family:var(--vscode-editor-font-family)}label{display:block;font-weight:600}.actions{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.action{background:var(--vscode-button-background)!important;color:var(--vscode-button-foreground)!important}.secondary{background:var(--vscode-button-secondaryBackground)!important;color:var(--vscode-button-secondaryForeground)!important}.result{padding:7px;margin:6px 0;border-left:3px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background)}.matched{border-left-color:var(--vscode-testing-iconPassed)}.mismatched{border-left-color:var(--vscode-testing-iconFailed)}.indeterminate{border-left-color:var(--vscode-editorWarning-foreground)}.small{font-size:.9em}.option-list{margin:8px 0 12px;border-top:1px solid var(--vscode-panel-border)}.option-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--vscode-panel-border)}.option-label{font-weight:600}.option-value{text-align:right;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}.diagnostic{padding:8px;margin:7px 0;border-left:3px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background)}.diagnostic strong{display:block}.diagnostic.ok{border-left-color:var(--vscode-testing-iconPassed)}.diagnostic.warning{border-left-color:var(--vscode-editorWarning-foreground)}.diagnostic.error{border-left-color:var(--vscode-testing-iconFailed)}
</style></head><body><div class="toolbar"><strong>Authoring</strong></div><nav class="tabs" role="tablist"><button data-tab="help" class="active" role="tab">Help</button><button data-tab="regex" role="tab">Regex</button><button data-tab="options" role="tab">Options</button><button data-tab="diagnostics" role="tab">Diagnostics</button></nav><main class="content"><section id="help" class="panel active" role="tabpanel"><h2>Schema help</h2><div id="helpBody" class="notice">Place the cursor on an Assessment YAML field.</div></section><section id="regex" class="panel" role="tabpanel"><h2>Regex preview</h2><p class="muted" id="regexContext">Place the cursor inside a supported regex value.</p><div class="actions" id="regexEmptyActions"><button id="openRegexNoContext" class="secondary">Open full Regex Tester</button></div><div id="regexEditor" hidden><label for="regexSample">Sample text</label><textarea id="regexSample" aria-label="Regex preview sample text" placeholder="Paste representative text here"></textarea><div class="actions"><button id="runRegex" class="action">Preview match</button><button id="openRegex" class="secondary">Open full Regex Tester</button></div><div id="regexResults" aria-live="polite"></div></div></section><section id="options" class="panel" role="tabpanel"><h2>Options</h2><div id="optionsBody" class="option-list" role="list" aria-label="SCAP-NG editor options"></div><label for="schemaPackPath">Verified offline schema pack path</label><input id="schemaPackPath" type="text" spellcheck="false" placeholder="Optional workspace path"><p class="muted small">Saved as a workspace setting. Leave blank to use workspace auto-discovery.</p><div class="actions"><button id="saveSchemaPack" class="action">Save schema pack setting</button><button id="openSource" class="secondary">Open native YAML beside sidebar</button></div><p id="optionsStatus" class="muted" role="status" aria-live="polite"></p></section><section id="diagnostics" class="panel" role="tabpanel"><h2>Diagnostics</h2><p class="muted">Local YAML/schema status only. No scanner or compliance result is inferred.</p><div id="diagnosticsBody" aria-live="polite"></div><details><summary>Build and pin details</summary><pre id="debugBody">No active YAML editor.</pre></details><button id="refresh" class="secondary">Refresh diagnostics</button></section></main><script nonce="authoring-sidebar">
const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let current=null;let regex=null;function text(node,value){node.replaceChildren(document.createTextNode(value??''));}function showTab(name){document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===name));}document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));$('refresh').onclick=()=>vscode.postMessage({type:'refresh'});$('saveSchemaPack').onclick=()=>vscode.postMessage({type:'saveSchemaPackPath',value:$('schemaPackPath').value});$('openSource').onclick=()=>vscode.postMessage({type:'openSource'});$('openRegex').onclick=()=>vscode.postMessage({type:'openRegex'});$('openRegexNoContext').onclick=()=>vscode.postMessage({type:'openRegex'});$('runRegex').onclick=()=>{if(!regex)return;const input=$('regexSample').value;vscode.postMessage({type:'runRegex',patterns:regex.patterns,input});$('regexResults').replaceChildren(document.createTextNode('Previewing in a bounded offline worker…'));};function renderRegex(context){regex=context?.regex||null;if(!regex){text($('regexContext'),'No regex is selected. The full tester can open the first schema-recognized expression in this Assessment.');$('regexEmptyActions').hidden=false;$('regexEditor').hidden=true;return;}$('regexEmptyActions').hidden=true;$('regexEditor').hidden=false;text($('regexContext'),'PCRE2-safe-preview · '+(regex.path?.join('.')||''));$('regexSample').value='';$('regexResults').replaceChildren();}function renderOptions(model){const root=$('optionsBody');root.replaceChildren();const rows=[['Schema pack',model?.options?.schemaPack||'Not loaded'],['Pinned schema',model?.options?.schemaVersion||'Unavailable'],['Source editing',model?.options?.sourceEditing||'Native YAML document']];for(const [label,value] of rows){const row=document.createElement('div');row.className='option-row';row.setAttribute('role','listitem');const name=document.createElement('span');name.className='option-label';name.textContent=label;const state=document.createElement('span');state.className='option-value';state.textContent=value;row.append(name,state);root.append(row);}$('schemaPackPath').value=model?.options?.schemaPackPath||'';}function renderDiagnostics(model){const root=$('diagnosticsBody');root.replaceChildren();const entries=model?.diagnostics||[{level:'info',label:'Document',message:'No active Assessment YAML editor.'}];for(const entry of entries){const box=document.createElement('div');box.className='diagnostic '+(entry.level||'info');const label=document.createElement('strong');label.textContent=entry.label;const message=document.createElement('span');message.textContent=entry.message;box.append(label,message);if(Array.isArray(entry.path)){const reveal=document.createElement('button');reveal.className='action secondary';reveal.textContent='Reveal in YAML';reveal.onclick=()=>vscode.postMessage({type:'revealPath',path:entry.path});box.append(reveal)}root.append(box);}}function render(model){current=model;text($('helpBody'),model?.help?.markdown||'Place the cursor on an Assessment YAML field to see schema-backed help.');renderOptions(model);renderDiagnostics(model);renderRegex(model);text($('debugBody'),JSON.stringify(model?.debug||{},null,2));}window.addEventListener('message',event=>{const m=event.data;if(m.type==='context')render(m);if(m.type==='optionsSaved'){text($('optionsStatus'),m.message||'Saved.');}if(m.type==='optionsError'){text($('optionsStatus'),m.message||'Could not save the setting.');$('optionsStatus').className='error';}if(m.type==='regexResults'){const root=$('regexResults');root.replaceChildren();for(const result of m.results||[]){const box=document.createElement('div');box.className='result '+(result.error?'indeterminate':result.matched?'matched':'mismatched');box.textContent=result.error?result.pattern+': '+result.error:result.pattern+': '+(result.matched?'matched sample':'did not match sample')+(result.timedOut?' (cancelled)':'');root.append(box);}}});vscode.postMessage({type:'ready'});
</script></body></html>`;
}

function schemaPath(instancePath: string): (string | number)[] {
  if (!instancePath) return [];
  return instancePath.split('/').slice(1).map(part => { const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~'); return /^\d+$/.test(decoded) ? Number(decoded) : decoded; });
}
function diagnosticsFor(document: any, pack: MetadataPack | undefined, profile: Pin) {
  const entries: Array<{ level: 'ok' | 'warning' | 'error' | 'info'; label: string; message: string; path?: (string | number)[] }> = [];
  if (!/\.assessment\.ya?ml$/i.test(document.uri?.fsPath ?? document.fileName ?? '')) {
    return [{ level: 'info' as const, label: 'Document', message: 'The active file is not an Assessment YAML document.' }];
  }
  const parsed = parseDocument(document.getText(), { uniqueKeys: true });
  if (parsed.errors.length) {
    entries.push({ level: 'error', label: 'YAML parse', message: parsed.errors[0].message });
    entries.push({ level: 'warning', label: 'Pinned schema', message: 'Schema validation is unavailable until YAML parses successfully.' });
  } else {
    entries.push({ level: 'ok', label: 'YAML parse', message: 'Document parsed successfully.' });
    let value: any;
    try { value = parsed.toJS({ maxAliasCount: 50 }); }
    catch (error) { entries.push({ level: 'error', label: 'YAML values', message: error instanceof Error ? error.message : String(error) }); }
    const version = value && typeof value === 'object' && !Array.isArray(value) ? (value.version ?? value.specification_version ?? value.schema_version) : undefined;
    if (typeof version === 'string' && version !== profile.schemaVersion) entries.push({ level: 'error', label: 'Document version', message: `${version} does not match pinned SCAP-NG ${profile.schemaVersion}.` });
    if (pack && value !== undefined) {
      const root = pack.manifest.resources.find((resource: any) => resource.kind === 'schema' && resource.uri.endsWith('/assessment.schema.json'))?.uri;
      const detailed = root ? pack.validateDetailed(root, value) : [];
      if (!root) entries.push({ level: 'error', label: 'Pinned schema', message: 'Pinned Assessment schema is unavailable.' });
      else if (detailed.length) {
        detailed.slice(0, 3).forEach(error => entries.push({ level: 'error', label: 'Pinned schema', message: `${error.instancePath || '/'}: ${error.message ?? 'schema validation error'}`, path: schemaPath(String(error.instancePath ?? '')) }));
        if (detailed.length > 3) entries.push({ level: 'warning', label: 'Pinned schema', message: `Additional schema diagnostics: ${detailed.length - 3}` });
      } else entries.push({ level: 'ok', label: 'Pinned schema', message: 'Document matches the pinned Assessment schema.' });
    } else entries.push({ level: 'warning', label: 'Pinned schema', message: 'Verified offline metadata pack is unavailable.' });
  }
  entries.push({ level: 'info', label: 'Assessment execution', message: 'Unavailable: no scanner or evaluator was executed.' });
  return entries;
}

export class AuthoringSidebarProvider implements vscode.WebviewViewProvider {
  private view: any;
  private editor: any;
  constructor(private readonly context: vscode.ExtensionContext, private readonly getPack: () => MetadataPack | undefined, private readonly profile: Pin, private readonly build: SidebarBuildInfo, private readonly onOptionsChanged?: () => void) {}
  resolveWebviewView(view: any) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html();
    view.webview.onDidReceiveMessage((message: any) => void this.message(message));
    this.refresh();
  }
  setEditor(editor: any) { this.editor = editor; this.refresh(); }
  private model() {
    const editor = this.editor;
    const document = editor?.document;
    const pack = this.getPack();
    let help: any;
    let regex: any;
    if (pack && document && /\.assessment\.ya?ml$/i.test(document.uri?.fsPath ?? document.fileName ?? '')) {
      const position = editor.selection?.active;
      help = position ? contextualHelp(pack, document, position) : undefined;
      if (position) {
        const offset = document.offsetAt(position); const end = editor.selection?.end ? document.offsetAt(editor.selection.end) : offset;
        regex = findRegexContext(document.getText(), offset, end);
      }
    }
    const filePath = document?.uri?.fsPath ?? document?.fileName;
    return {
      editor: document ? { path: filePath, languageId: document.languageId, version: document.version, pathLabel: document.uri?.toString?.() ?? document.fileName, capability: help?.capability } : undefined,
      help,
      regex,
      options: { schemaPack: pack ? 'Verified offline pack loaded' : (vscode.workspace.getConfiguration('scapNg').get<string>('schemaPackPath') ? 'Configured path not loaded' : 'Auto-discovery not loaded'), schemaVersion: pack?.pin.schemaVersion ?? this.profile.schemaVersion, sourceEditing: 'Native YAML document', schemaPackPath: vscode.workspace.getConfiguration('scapNg').get<string>('schemaPackPath') ?? '' },
      diagnostics: document ? diagnosticsFor(document, pack, this.profile) : [{ level: 'info', label: 'Document', message: 'No active Assessment YAML editor.' }],
      debug: { document: document?.uri?.fsPath ?? 'none', languageId: document?.languageId ?? 'none', version: document?.version ?? 'none', selection: editor?.selection ? { line: editor.selection.active.line, character: editor.selection.active.character } : 'none', schemaVersion: this.profile.schemaVersion, sourceCommit: this.profile.sourceCommit, pack: pack?.directory ?? 'not loaded', packManifestSha256: pack?.pin?.manifestSha256 ?? 'not loaded', build: this.build }
    };
  }
  private refresh() { if (this.view) this.view.webview.postMessage({ type: 'context', ...this.model() }); }
  private async message(message: any) {
    const api: any = vscode;
    if (message.type === 'ready' || message.type === 'refresh') { this.refresh(); return; }
    if (message.type === 'saveSchemaPackPath') {
      const value = typeof message.value === 'string' ? message.value.trim() : '';
      try {
        const configuration = api.workspace.getConfiguration('scapNg');
        if (typeof configuration?.update !== 'function') throw new Error('Workspace settings are unavailable in this VS Code session.');
        await configuration.update('schemaPackPath', value || undefined, api.ConfigurationTarget?.Workspace ?? 2);
        this.onOptionsChanged?.();
        this.refresh();
        this.view?.webview.postMessage({ type: 'optionsSaved', message: value ? 'Workspace schema pack setting saved.' : 'Workspace schema pack setting cleared; auto-discovery will be used.' });
      } catch (error) {
        this.view?.webview.postMessage({ type: 'optionsError', message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (message.type === 'openSource' && this.editor?.document) { await api.window.showTextDocument(this.editor.document, { viewColumn: api.ViewColumn?.Beside ?? 2, preserveFocus: false, preview: false }); return; }
    if (message.type === 'revealPath' && this.editor?.document && Array.isArray(message.path)) {
      const shown = await api.window.showTextDocument(this.editor.document, { viewColumn: api.ViewColumn?.Beside ?? 2, preserveFocus: false, preview: false });
      try {
        const range = new SourceBuffer(this.editor.document.getText()).scalarRange(message.path);
        shown.selection = new api.Selection(this.editor.document.positionAt(range[0]), this.editor.document.positionAt(range[1]));
        shown.revealRange(new api.Range(this.editor.document.positionAt(range[0]), this.editor.document.positionAt(range[1])), api.TextEditorRevealType?.InCenterIfOutsideViewport);
      } catch { /* Root/missing-property diagnostics still open the source document. */ }
      return;
    }
    if (message.type === 'openRegex') { await api.commands.executeCommand('scapNg.testRegex', { document: this.editor?.document, useFirst: true }); return; }
    if (message.type === 'runRegex') {
      const patterns = Array.isArray(message.patterns) ? message.patterns.filter((value: any) => typeof value === 'string') : [];
      const input = typeof message.input === 'string' ? message.input : '';
      const results = await previewRegexSafe(patterns, input, '', 100);
      this.view?.webview.postMessage({ type: 'regexResults', results });
    }
  }
}
