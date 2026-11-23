import * as vscode from 'vscode';
import { normalizeYamlObjectStyle, type YamlObjectStyle } from './yaml-style.js';
import { isAssessmentEditorMode, type AssessmentEditorMode } from './editor-preferences.js';

export interface EditorOptions {
  assessmentEditor: AssessmentEditorMode;
  objectStyle: YamlObjectStyle;
  schemaPackPath: string;
}

export type EditorOptionsReader = () => EditorOptions;
export type EditorOptionsWriter = (options: EditorOptions) => Promise<EditorOptions | void>;

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function html(options: EditorOptions): string {
  const editor = isAssessmentEditorMode(options.assessmentEditor) ? options.assessmentEditor : 'yaml';
  const objectStyle = normalizeYamlObjectStyle(options.objectStyle);
  const schemaPackPath = escapeHtml(options.schemaPackPath);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-scap-ng-editor-options';"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.5 var(--vscode-font-family)}main{max-width:820px;margin:0 auto;padding:38px 46px 42px}h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:17px;margin:26px 0 8px}.lede,.hint{color:var(--vscode-descriptionForeground)}.card{border:1px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background);padding:18px;margin:18px 0}.field{margin:15px 0}.field label{display:block;font-weight:600;margin-bottom:5px}.field select,.field input{display:block;width:100%;padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}.actions{display:flex;gap:8px;margin:20px 0}button{padding:8px 13px;border:1px solid var(--vscode-panel-border);font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);cursor:pointer}button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border-color:var(--vscode-button-background)}button:disabled{opacity:.55;cursor:default}.notice{border-left:3px solid var(--vscode-textLink-foreground);padding:10px 12px;background:var(--vscode-textBlockQuote-background);margin:12px 0}.error{color:var(--vscode-errorForeground)}
</style></head><body><main><p class="hint">SCAP-NG Assessment Studio</p><h1>Editor options</h1><p class="lede">Configure editor presentation and authoring defaults here. These settings affect presentation or newly authored YAML only; existing source is not reformatted automatically.</p><section class="card"><h2>Assessment editing</h2><div class="field"><label for="schemaPackPath">Verified offline metadata pack</label><input id="schemaPackPath" type="text" value="${schemaPackPath}" placeholder="Auto-discover from the workspace"><p class="hint">Optional workspace path to the pinned SCAP-NG editor pack. Leave blank to use workspace auto-discovery.</p></div><div class="field"><label for="assessmentEditor">Default Assessment editor</label><select id="assessmentEditor"><option value="yaml"${editor === 'yaml' ? ' selected' : ''}>Native YAML editor</option><option value="graphical"${editor === 'graphical' ? ' selected' : ''}>Graphical Assessment editor</option><option value="split"${editor === 'split' ? ' selected' : ''}>Graphical + native YAML (Split)</option></select><p class="hint">Choose what opens when you open an Assessment file. Use Open With… for a one-time choice.</p></div><div class="field"><label for="objectStyle">New YAML Object presentation</label><select id="objectStyle"><option value="compact"${objectStyle === 'compact' ? ' selected' : ''}>Condensed / compact</option><option value="expanded"${objectStyle === 'expanded' ? ' selected' : ''}>Expanded / readable</option><option value="tree"${objectStyle === 'tree' ? ' selected' : ''}>Follow surrounding YAML style</option></select><p class="hint">Controls the layout of newly authored Object mappings and requirement structures when the editor generates YAML. Existing YAML is never reformatted automatically.</p></div><div class="actions"><button id="save" class="primary">Save options</button><button id="close">Close</button></div><p id="status" class="hint" role="status" aria-live="polite"></p></section><section class="card"><h2>AI-assisted authoring</h2><p class="hint">AI mode, provider, model, and Codex settings have their own configuration page.</p><button id="openAi" type="button">Open AI configuration</button></section></main><script nonce="scap-ng-editor-options">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);$('save').onclick=()=>{vscode.postMessage({type:'save',assessmentEditor:$('assessmentEditor').value,objectStyle:$('objectStyle').value});$('save').disabled=true;$('status').textContent='Saving options…';};$('close').onclick=()=>vscode.postMessage({type:'close'});$('openAi').onclick=()=>vscode.postMessage({type:'openAi'});window.addEventListener('message',event=>{const message=event.data;if(message.type==='saved'){$('save').disabled=false;$('status').textContent='Saved.';}if(message.type==='error'){$('save').disabled=false;$('status').className='error';$('status').textContent=message.message||'Could not save options.';}if(message.type==='refresh'){const value=message.options||{};$('assessmentEditor').value=value.assessmentEditor||'yaml';$('objectStyle').value=value.objectStyle||'tree';$('schemaPackPath').value=value.schemaPackPath||'';}});</script></body></html>`;
}

export class EditorOptionsPanel {
  private static panel: any;
  static update(options: EditorOptions) { this.panel?.webview.postMessage({ type: 'refresh', options }); }
  static open(context: vscode.ExtensionContext, reader: EditorOptionsReader, writer: EditorOptionsWriter, onOpenAi: () => Promise<void> | void) {
    const api: any = vscode;
    if (this.panel) { this.panel.webview.html = html(reader()); this.panel.reveal(api.ViewColumn?.One ?? 1); return; }
    const panel = api.window.createWebviewPanel('scapNg.editorOptions', 'SCAP-NG Editor Options', api.ViewColumn?.One ?? 1, { enableScripts: true, retainContextWhenHidden: true });
    this.panel = panel;
    panel.webview.html = html(reader());
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'close') { panel.dispose(); return; }
      if (message.type === 'openAi') { await onOpenAi(); return; }
      if (message.type !== 'save') return;
      const options: EditorOptions = {
        assessmentEditor: isAssessmentEditorMode(message.assessmentEditor) ? message.assessmentEditor : 'yaml',
        objectStyle: normalizeYamlObjectStyle(message.objectStyle),
        schemaPackPath: typeof message.schemaPackPath === 'string' ? message.schemaPackPath.trim() : ''
      };
      try { const saved = await writer(options); panel.webview.postMessage({ type: 'saved', options: saved ?? options }); }
      catch (error) { panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
    });
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; });
    context.subscriptions.push(panel);
  }
}
