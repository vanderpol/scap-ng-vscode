import * as vscode from 'vscode';
import { normalizeYamlObjectStyle, type YamlObjectStyle } from './yaml-style.js';
import { isAssessmentEditorMode, type AssessmentEditorMode } from './editor-preferences.js';
import {
  aiAssistanceModes,
  aiAssistanceModeDescription,
  aiAssistanceModeLabel,
  normalizeAiAssistanceMode,
  normalizeAiBatchConcurrency,
  normalizeCodexReasoningEffort,
  codexReasoningEfforts,
  type CodexReasoningEffort,
  type AiAuthoringConfiguration,
  type AiAssistanceMode
} from './ai-configuration.js';
import type { AiConfigurationActions } from './ai-configuration-panel.js';

export interface EditorOptions {
  assessmentEditor: AssessmentEditorMode;
  objectStyle: YamlObjectStyle;
  schemaPackPath: string;
  ai: AiAuthoringConfiguration;
}

export type EditorOptionsReader = () => EditorOptions;
export type EditorOptionsWriter = (options: EditorOptions) => Promise<EditorOptions | void>;

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function modelSupportsPinnedTools(model: string): boolean {
  return /(?:^|[-_.])withtools(?:$|[-_.])/i.test(model.trim());
}

function modelOptionLabel(model: string): string {
  return modelSupportsPinnedTools(model) ? `${model} · recommended for SCAP-NG authoring` : `${model} · provider-only; may fail structured authoring`;
}

function modeOptions(selected: AiAssistanceMode): string {
  return aiAssistanceModes.map(mode => `<option value="${mode}"${mode === selected ? ' selected' : ''}>${escapeHtml(aiAssistanceModeLabel(mode))}</option>`).join('');
}

function codexEffortOptions(selected: CodexReasoningEffort): string {
  const labels: Record<CodexReasoningEffort, string> = { auto: 'Automatic · choose from check text', host: 'Use host Codex setting', low: 'Low · simple checks', medium: 'Medium · recommended default', high: 'High · complex or ambiguous checks', xhigh: 'XHigh · exceptional cases', max: 'Max · exceptional cases' };
  return codexReasoningEfforts.map(effort => `<option value="${effort}"${effort === selected ? ' selected' : ''}>${labels[effort]}</option>`).join('');
}

function html(options: EditorOptions, initialSection: 'editing' | 'ai' = 'editing'): string {
  const editor = isAssessmentEditorMode(options.assessmentEditor) ? options.assessmentEditor : 'yaml';
  const objectStyle = normalizeYamlObjectStyle(options.objectStyle);
  const schemaPackPath = escapeHtml(options.schemaPackPath);
  const ai = options.ai ?? { mode: 'none', endpoint: '', model: '', codexModel: '' };
  const aiMode = normalizeAiAssistanceMode(ai.mode);
  const showAi = initialSection === 'ai';
  const providerModel = escapeHtml(ai.model);
  const codexModel = escapeHtml(ai.codexModel);
  const codexReasoningEffort = normalizeCodexReasoningEffort(ai.codexReasoningEffort);
  const batchConcurrency = normalizeAiBatchConcurrency(ai.batchConcurrency);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-scap-ng-editor-options';"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}html,body{height:100%;margin:0}body{color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.4 var(--vscode-font-family);overflow:hidden}main{height:100%;display:flex;flex-direction:column;padding:22px 28px 20px}h1{font-size:24px;line-height:1.2;margin:0 0 5px}.lede,.hint,.muted{color:var(--vscode-descriptionForeground)}.lede{margin:0 0 16px}.layout{min-height:0;flex:1;display:grid;grid-template-columns:175px minmax(0,1fr);gap:18px}.menu{border-right:1px solid var(--vscode-panel-border);padding:5px 14px 0 0}.menu button{display:block;width:100%;text-align:left;padding:9px 10px;margin:0 0 4px;border:0;border-left:3px solid transparent;color:var(--vscode-foreground);background:transparent;cursor:pointer;font:inherit}.menu button:hover{background:var(--vscode-list-hoverBackground)}.menu button.active{border-left-color:var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.content{min-width:0;overflow:auto;padding:0 4px 8px 0}.section{display:none;max-width:760px}.section.active{display:block}.section h2{font-size:17px;margin:0 0 5px}.card{border:1px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background);padding:13px 16px;margin:0 0 12px}.field{margin:10px 0}.field label{display:block;font-weight:600;margin-bottom:4px}.field select,.field input{display:block;width:100%;padding:7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}.field input[type=url]{font-family:var(--vscode-editor-font-family)}.inline-field{display:flex;gap:7px;align-items:stretch}.inline-field select{min-width:0;flex:1}.inline-field button{white-space:nowrap}.hint{margin:4px 0;font-size:12px}.actions{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}button.action,button.primary{padding:7px 11px;border:1px solid var(--vscode-button-background);font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer}button.secondary,button{padding:7px 11px;border:1px solid var(--vscode-panel-border);font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);cursor:pointer}button:disabled{opacity:.55;cursor:default}.notice{border-left:3px solid var(--vscode-textLink-foreground);padding:8px 10px;background:var(--vscode-textBlockQuote-background);margin:8px 0;font-size:12px}.warning{border-left-color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.hidden{display:none!important}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px}.section-header{margin-bottom:10px}.section-header p{margin:0}.status{min-height:18px;margin:5px 0;font-size:12px}.footer{display:flex;align-items:center;gap:10px;border-top:1px solid var(--vscode-panel-border);padding-top:10px;margin-top:10px}.footer .status{flex:1}.safety{font-size:12px;color:var(--vscode-descriptionForeground)}@media(max-width:700px){main{padding:16px}.layout{grid-template-columns:135px 1fr}.two-col{grid-template-columns:1fr}}
</style></head><body><main><p class="hint">SCAP-NG Assessment Studio</p><h1>Editor options</h1><p class="lede">Configure editor behavior and optional AI assistance in one place. Changes are saved together; existing YAML is never reformatted automatically.</p><div class="layout"><nav class="menu" aria-label="Editor options sections"><button class="${showAi ? '' : 'active'}" data-section="editing">Editing options</button><button class="${showAi ? 'active' : ''}" data-section="ai">AI options</button></nav><div class="content"><section id="editing" class="section${showAi ? '' : ' active'}"><div class="section-header"><h2>Editing options</h2><p class="hint">These settings control how the SCAP-NG editor opens files and creates new YAML.</p></div><div class="card"><div class="field"><label for="schemaPackPath">Verified offline metadata pack</label><input id="schemaPackPath" type="text" value="${schemaPackPath}" placeholder="Auto-discover from the workspace"><p class="hint">Optional workspace path to the pinned editor pack. Leave blank to use workspace auto-discovery.</p></div><div class="two-col"><div class="field"><label for="assessmentEditor">Default Assessment editor</label><select id="assessmentEditor"><option value="yaml"${editor === 'yaml' ? ' selected' : ''}>Native YAML editor</option><option value="graphical"${editor === 'graphical' ? ' selected' : ''}>Graphical Assessment editor</option><option value="split"${editor === 'split' ? ' selected' : ''}>Graphical + native YAML (Split)</option></select><p class="hint">Use Open With… for a one-time choice.</p></div><div class="field"><label for="objectStyle">New YAML Object presentation</label><select id="objectStyle"><option value="compact"${objectStyle === 'compact' ? ' selected' : ''}>Condensed / compact</option><option value="expanded"${objectStyle === 'expanded' ? ' selected' : ''}>Expanded / readable</option><option value="tree"${objectStyle === 'tree' ? ' selected' : ''}>Follow surrounding YAML style</option></select><p class="hint">Applies only to newly authored Object mappings.</p></div></div></div></section><section id="ai" class="section${showAi ? ' active' : ''}"><div class="section-header"><h2>AI options</h2><p class="hint">Configure access only. AI never silently changes YAML or links an Assessment.</p></div><div class="card"><div class="two-col"><div class="field"><label for="mode">AI assistance mode</label><select id="mode">${modeOptions(aiMode)}</select><p id="modeDescription" class="hint"></p></div><div id="endpointField" class="field"><label for="endpoint">AI endpoint</label><input id="endpoint" type="url" autocomplete="off" value="${escapeHtml(ai.endpoint)}" placeholder="https://api.example/v1"><p class="hint">Remote requires HTTPS; local requires loopback.</p></div></div><div id="providerFields"><div class="field"><label for="model">Provider model (withtools recommended)</label><select id="model">${ai.model ? `<option value="${providerModel}" selected>${escapeHtml(modelOptionLabel(ai.model))}</option>` : '<option value="">Query available models</option>'}<option value="__manual_model__">Enter model ID manually…</option></select><input id="customModel" type="text" autocomplete="off" placeholder="Provider-specific model name" hidden><p id="modelGuidance" class="hint"></p></div></div><div class="field"><label for="batchConcurrency">Batch concurrency threshold</label><input id="batchConcurrency" type="number" min="1" max="8" step="1" value="${batchConcurrency}"><p class="hint">Shared by interactive and overnight batches, across Codex and other configured AI providers. Default 4; maximum 8. Each Rule still runs accuracy stages sequentially.</p></div><div id="codexFields" class="hidden"><div class="field"><label for="codexModel">Codex model override (optional)</label><div class="inline-field"><select id="codexModel">${ai.codexModel ? `<option value="${codexModel}" selected>${codexModel}</option>` : '<option value="">Use host Codex model</option>'}<option value="__manual_codex_model__">Enter model ID manually…</option></select><button id="discoverCodexModels" type="button">Query models</button></div><label id="customCodexLabel" for="customCodexModel" hidden>Manual Codex model ID</label><input id="customCodexModel" type="text" autocomplete="off" placeholder="Type an exact Codex model ID" hidden><p class="hint">Leave blank to use the host Codex model. Choose a catalog model, or select “Enter model ID manually…” to type an exact ID.</p><div class="field"><label for="codexReasoningEffort">Reasoning effort</label><select id="codexReasoningEffort">${codexEffortOptions(codexReasoningEffort)}</select><p class="hint">Automatic analyzes the immutable check text locally and chooses Low, Medium, or High before sending anything. It uses Medium for most procedures and High for multiple checks, applicability branches, wildcards, organizational inputs, or independent review. High is slower; the bounded authoring deadline is 240 seconds. Host uses the value from Codex config.toml.</p></div><div class="actions"><button id="testCodex" type="button">Test Codex access</button></div><p id="codexStatus" class="status muted" role="status" aria-live="polite">No Codex availability test has been run.</p></div></div><div id="remoteFields" class="hidden"><div class="actions"><button id="discoverRemoteModels" type="button">Query available models</button><button id="testRemote" type="button">Test gateway</button><button id="testAuthoring" type="button">Run AI authoring self-test</button><button id="storeRemoteKey" type="button">Store API key securely</button><button id="clearRemoteKey" type="button">Forget stored key</button></div><p id="remoteStatus" class="status muted" role="status" aria-live="polite">No remote action has been run.</p></div><div id="vscodeFields" class="notice hidden"><button id="discoverProviders" type="button">Check available VS Code providers</button><p id="providerStatus" class="status muted" role="status" aria-live="polite">No provider discovery has been requested.</p><div id="providerList" class="muted"></div></div><div id="noneNotice" class="notice hidden"><strong>No AI assistance is selected.</strong> The deterministic offline workflow remains available separately.</div></div><p class="safety">Review the generated draft and local diagnostics before accepting any AI proposal.</p></section></div></div><div class="footer"><button id="save" class="primary">Save all options</button><button id="close" class="secondary">Close</button><p id="status" class="status" role="status" aria-live="polite"></p></div></main><script nonce="scap-ng-editor-options">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const descriptions=${JSON.stringify(Object.fromEntries(aiAssistanceModes.map(value=>[value,aiAssistanceModeDescription(value)])))};const modeLabels=${JSON.stringify(Object.fromEntries(aiAssistanceModes.map(value=>[value,aiAssistanceModeLabel(value)])))};const modelSupportsPinnedTools=model=>/(?:^|[-_.])withtools(?:$|[-_.])/i.test(String(model||'').trim());const modelOptionLabel=model=>modelSupportsPinnedTools(model)?String(model)+' · recommended for SCAP-NG authoring':String(model)+' · provider-only; may fail structured authoring';function activateSection(name){const section=name==='ai'?'ai':'editing';document.querySelectorAll('.menu button').forEach(button=>button.classList.toggle('active',button.dataset.section===section));document.querySelectorAll('.section').forEach(panel=>panel.classList.toggle('active',panel.id===section));}document.querySelectorAll('.menu button').forEach(button=>button.onclick=()=>activateSection(button.dataset.section));function selectedProviderModel(){return $('model').value==='__manual_model__'?$('customModel').value.trim():$('model').value;}function selectedCodexModel(){return $('codexModel').value==='__manual_codex_model__'?$('customCodexModel').value.trim():$('codexModel').value;}function syncModelInput(){const manual=$('model').value==='__manual_model__';$('customModel').hidden=!manual;const value=selectedProviderModel();$('modelGuidance').textContent=value&&!modelSupportsPinnedTools(value)?'Provider-only model: pinned local tools will not be offered; it may return prose or non-native YAML. Prefer a withtools model when available.':value?'SCAP-NG authoring tools are eligible; the gateway may still reject them.':'';}function syncCodexModelInput(){const manual=$('codexModel').value==='__manual_codex_model__';$('customCodexLabel').hidden=!manual;$('customCodexModel').hidden=!manual;}function setModels(providerValue,codexValue){const provider=String(providerValue||'');const providerSelect=$('model');if([...providerSelect.options].some(option=>option.value===provider)){providerSelect.value=provider;$('customModel').value='';}else if(provider){providerSelect.value='__manual_model__';$('customModel').value=provider;}else{providerSelect.value='';$('customModel').value='';}const codex=String(codexValue||'');const codexSelect=$('codexModel');if([...codexSelect.options].some(option=>option.value===codex)){codexSelect.value=codex;$('customCodexModel').value='';}else if(codex){codexSelect.value='__manual_codex_model__';$('customCodexModel').value=codex;}else{codexSelect.value='';$('customCodexModel').value='';}syncModelInput();syncCodexModelInput();}function renderRemoteModels(models){const current=selectedProviderModel();const select=$('model');select.replaceChildren();for(const id of [...(models||[])].sort((a,b)=>Number(modelSupportsPinnedTools(b))-Number(modelSupportsPinnedTools(a))||a.localeCompare(b))){const option=document.createElement('option');option.value=id;option.textContent=modelOptionLabel(id);select.append(option);}if(current&&!(models||[]).includes(current)){const option=document.createElement('option');option.value=current;option.textContent=modelOptionLabel(current)+' (current)';select.append(option);}const manual=document.createElement('option');manual.value='__manual_model__';manual.textContent='Enter model ID manually…';select.append(manual);if(current&&[...select.options].some(option=>option.value===current))select.value=current;else if(select.options.length>1)select.value=select.options[0].value;syncModelInput();}function renderCodexModels(models){const current=selectedCodexModel();const select=$('codexModel');select.replaceChildren();const host=document.createElement('option');host.value='';host.textContent='Use host Codex model';select.append(host);for(const id of models||[]){const option=document.createElement('option');option.value=id;option.textContent=id;select.append(option);}if(current&&!(models||[]).includes(current)){const option=document.createElement('option');option.value=current;option.textContent=current+' (current)';select.append(option);}const manual=document.createElement('option');manual.value='__manual_codex_model__';manual.textContent='Enter model ID manually…';select.append(manual);select.value=current&&[...select.options].some(option=>option.value===current)?current:'';syncCodexModelInput();}function sync(){const mode=$('mode').value;$('modeDescription').textContent=descriptions[mode]||descriptions.none;$('endpointField').classList.toggle('hidden',mode==='none'||mode==='codex-local'||mode==='vscode');$('providerFields').classList.toggle('hidden',mode==='none'||mode==='codex-local');$('codexFields').classList.toggle('hidden',mode!=='codex-local');$('remoteFields').classList.toggle('hidden',mode!=='remote');$('vscodeFields').classList.toggle('hidden',mode!=='vscode');$('noneNotice').classList.toggle('hidden',mode!=='none');syncModelInput();syncCodexModelInput();}function sendSave(){vscode.postMessage({type:'save',assessmentEditor:$('assessmentEditor').value,objectStyle:$('objectStyle').value,schemaPackPath:$('schemaPackPath').value,mode:$('mode').value,endpoint:$('endpoint').value,model:selectedProviderModel(),codexModel:selectedCodexModel(),codexReasoningEffort:$('codexReasoningEffort').value,batchConcurrency:Number($('batchConcurrency').value)});$('save').disabled=true;$('status').textContent='Saving all options…';}function postAction(type){vscode.postMessage({type,mode:$('mode').value,endpoint:$('endpoint').value,model:selectedProviderModel(),codexModel:selectedCodexModel(),codexReasoningEffort:$('codexReasoningEffort').value,batchConcurrency:Number($('batchConcurrency').value)});}$('mode').onchange=sync;$('model').onchange=syncModelInput;$('codexModel').onchange=syncCodexModelInput;$('save').onclick=sendSave;$('close').onclick=()=>vscode.postMessage({type:'close'});$('discoverRemoteModels').onclick=()=>{const button=$('discoverRemoteModels');button.disabled=true;$('remoteStatus').textContent='Querying available models without sending Assessment content…';postAction('discoverRemoteModels');};$('testRemote').onclick=()=>{const button=$('testRemote');button.disabled=true;$('remoteStatus').textContent='Testing gateway without sending Assessment content…';postAction('testRemote');};$('testAuthoring').onclick=()=>{const button=$('testAuthoring');button.disabled=true;$('remoteStatus').textContent='Running an AI authoring self-test; no workspace files will be changed…';postAction('testAuthoring');};$('storeRemoteKey').onclick=()=>postAction('storeRemoteApiKey');$('clearRemoteKey').onclick=()=>postAction('clearRemoteApiKey');$('discoverCodexModels').onclick=()=>{const button=$('discoverCodexModels');button.disabled=true;$('codexStatus').textContent='Querying the host Codex model catalog…';postAction('discoverCodexModels');};$('testCodex').onclick=()=>{const button=$('testCodex');button.disabled=true;$('codexStatus').textContent='Testing local Codex access…';postAction('testCodex');};$('discoverProviders').onclick=()=>{const button=$('discoverProviders');button.disabled=true;$('providerStatus').textContent='Checking the host Language Model API…';vscode.postMessage({type:'discoverProviders'});};function restore(value){const options=value||{};$('assessmentEditor').value=options.assessmentEditor||'yaml';$('objectStyle').value=options.objectStyle||'tree';$('schemaPackPath').value=options.schemaPackPath||'';const ai=options.ai||{};$('mode').value=ai.mode||'none';$('endpoint').value=ai.endpoint||'';$('codexReasoningEffort').value=ai.codexReasoningEffort||'auto';$('batchConcurrency').value=String(ai.batchConcurrency||4);setModels(ai.model||'',ai.codexModel||'');sync();}window.addEventListener('message',event=>{const message=event.data;if(message.type==='selectSection')activateSection(message.section);if(message.type==='providers'){const button=$('discoverProviders');button.disabled=false;const models=Array.isArray(message.models)?message.models:[];$('providerStatus').textContent=models.length?'Available provider models: '+models.length:'No provider models are currently exposed by VS Code.';const list=$('providerList');list.replaceChildren();for(const model of models){const row=document.createElement('div');row.textContent=(model.vendor||'unknown')+'/'+(model.id||'unknown')+(model.family?' · '+model.family:'');list.append(row);}}if(message.type==='codexModels'){const button=$('discoverCodexModels');if(button)button.disabled=false;if(Array.isArray(message.models))renderCodexModels(message.models);$('codexStatus').textContent=message.message||'';}if(message.type==='codexStatus'){const button=$('testCodex');if(button)button.disabled=false;$('codexStatus').textContent=message.message||'';$('codexStatus').className=message.ok?'status muted':'status error';}if(message.type==='remoteStatus'){for(const id of ['testRemote','testAuthoring','discoverRemoteModels']){const button=$(id);if(button)button.disabled=false;}if(Array.isArray(message.models))renderRemoteModels(message.models);$('remoteStatus').textContent=message.message||'';}if(message.type==='saved'){if(message.options)restore(message.options);$('save').disabled=false;$('status').textContent='Saved. '+(modeLabels[$('mode').value]||'None (no AI)')+' selected.';}if(message.type==='error'){$('save').disabled=false;$('status').className='status error';$('status').textContent=message.message||'Could not save options.';}if(message.type==='refresh')restore(message.options);});restore(${JSON.stringify({ assessmentEditor: editor, objectStyle, schemaPackPath: options.schemaPackPath, ai: { mode: aiMode, endpoint: ai.endpoint, model: ai.model, codexModel: ai.codexModel, codexReasoningEffort, batchConcurrency } })});</script></body></html>`;
}

export class EditorOptionsPanel {
  private static panel: any;

  static update(options: EditorOptions) {
    this.panel?.webview.postMessage({ type: 'refresh', options });
  }

  static open(context: vscode.ExtensionContext, reader: EditorOptionsReader, writer: EditorOptionsWriter, actions: AiConfigurationActions, initialSection: 'editing' | 'ai' = 'editing') {
    const api: any = vscode;
    if (this.panel) {
      this.panel.webview.html = html(reader(), initialSection);
      this.panel.reveal(api.ViewColumn?.One ?? 1);
      return;
    }
    const panel = api.window.createWebviewPanel('scapNg.editorOptions', 'SCAP-NG Editor Options', api.ViewColumn?.One ?? 1, { enableScripts: true, retainContextWhenHidden: true });
    this.panel = panel;
    panel.webview.html = html(reader(), initialSection);
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'close') { panel.dispose(); return; }
      if (message.type === 'storeRemoteApiKey' || message.type === 'clearRemoteApiKey' || message.type === 'discoverRemoteModels' || message.type === 'testRemote' || message.type === 'testAuthoring' || message.type === 'discoverCodexModels' || message.type === 'testCodex') {
        await handleAction(panel, actions, message);
        return;
      }
      if (message.type === 'discoverProviders') {
        try {
          const apiAny: any = vscode;
          const languageModel = apiAny.lm;
          if (typeof languageModel?.selectChatModels !== 'function') throw new Error('This VS Code host does not expose the Language Model API.');
          const models = await languageModel.selectChatModels();
          panel.webview.postMessage({ type: 'providers', models: (models ?? []).map((model: any) => ({ id: String(model?.id ?? ''), vendor: String(model?.vendor ?? ''), family: String(model?.family ?? '') })) });
        } catch (error) {
          panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (message.type !== 'save') return;
      const ai: AiAuthoringConfiguration = {
        mode: normalizeAiAssistanceMode(message.mode),
        endpoint: typeof message.endpoint === 'string' ? message.endpoint.trim() : '',
        model: typeof message.model === 'string' ? message.model.trim() : '',
        codexModel: typeof message.codexModel === 'string' ? message.codexModel.trim() : '',
        codexReasoningEffort: normalizeCodexReasoningEffort(message.codexReasoningEffort),
        batchConcurrency: normalizeAiBatchConcurrency(message.batchConcurrency)
      };
      const options: EditorOptions = {
        assessmentEditor: isAssessmentEditorMode(message.assessmentEditor) ? message.assessmentEditor : 'yaml',
        objectStyle: normalizeYamlObjectStyle(message.objectStyle),
        schemaPackPath: typeof message.schemaPackPath === 'string' ? message.schemaPackPath.trim() : '',
        ai
      };
      try {
        const saved = await writer(options);
        panel.webview.postMessage({ type: 'saved', options: saved ?? options });
      } catch (error) {
        panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    });
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; });
    context.subscriptions.push(panel);
  }
}

async function handleAction(panel: any, actions: AiConfigurationActions, message: any) {
  const type = String(message.type);
  const configuration: AiAuthoringConfiguration = {
    mode: normalizeAiAssistanceMode(message.mode),
    endpoint: typeof message.endpoint === 'string' ? message.endpoint.trim() : '',
    model: typeof message.model === 'string' ? message.model.trim() : '',
    codexModel: typeof message.codexModel === 'string' ? message.codexModel.trim() : '',
        codexReasoningEffort: normalizeCodexReasoningEffort(message.codexReasoningEffort)
  };
  try {
    if (type === 'discoverCodexModels') panel.webview.postMessage({ type: 'codexModels', ...(await actions.discoverCodexModels()) });
    else if (type === 'testCodex') panel.webview.postMessage({ type: 'codexStatus', ...(await actions.testCodex(configuration)) });
    else if (type === 'discoverRemoteModels') panel.webview.postMessage({ type: 'remoteStatus', ...(await actions.discoverRemoteModels(configuration)) });
    else if (type === 'testRemote') panel.webview.postMessage({ type: 'remoteStatus', ...(await actions.testRemote(configuration)) });
    else if (type === 'testAuthoring') panel.webview.postMessage({ type: 'remoteStatus', ...(await actions.testAuthoring(configuration)) });
    else if (type === 'storeRemoteApiKey') panel.webview.postMessage({ type: 'remoteStatus', message: await actions.storeRemoteApiKey() });
    else if (type === 'clearRemoteApiKey') panel.webview.postMessage({ type: 'remoteStatus', message: await actions.clearRemoteApiKey() });
  } catch (error) {
    const target = type === 'testCodex' || type === 'discoverCodexModels' ? 'codexStatus' : 'remoteStatus';
    panel.webview.postMessage({ type: target, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
}
