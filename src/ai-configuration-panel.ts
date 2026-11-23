import * as vscode from 'vscode';
import {
  aiAssistanceModes,
  aiAssistanceModeDescription,
  aiAssistanceModeLabel,
  aiEndpointError,
  normalizeAiAssistanceMode,
  type AiAssistanceMode,
  type AiAuthoringConfiguration
} from './ai-configuration.js';

export type AiConfigurationReader = () => AiAuthoringConfiguration;
export type AiConfigurationWriter = (configuration: AiAuthoringConfiguration) => Promise<AiAuthoringConfiguration | void>;
export interface RemoteActionResult { message: string; models?: string[]; ok?: boolean; }

export interface AiConfigurationActions {
  storeRemoteApiKey: () => Promise<string>;
  clearRemoteApiKey: () => Promise<string>;
  testRemote: (configuration?: AiAuthoringConfiguration) => Promise<RemoteActionResult>;
  testAuthoring: (configuration?: AiAuthoringConfiguration) => Promise<RemoteActionResult>;
  testCodex: () => Promise<RemoteActionResult>;
  discoverRemoteModels: (configuration?: AiAuthoringConfiguration) => Promise<RemoteActionResult>;
}

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

function html(configuration: AiAuthoringConfiguration): string {
  const mode = normalizeAiAssistanceMode(configuration.mode);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-scap-ng-ai-configuration';"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.5 var(--vscode-font-family)}main{max-width:820px;margin:0 auto;padding:38px 46px 42px}h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:17px;margin:26px 0 8px}.lede{max-width:680px;color:var(--vscode-descriptionForeground);font-size:15px}.card{border:1px solid var(--vscode-panel-border);background:var(--vscode-textCodeBlock-background);padding:18px;margin:18px 0}.mode-card{border-top:3px solid var(--vscode-textLink-foreground)}label{display:block;font-weight:600;margin:12px 0 5px}input,select{display:block;width:100%;padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);font:inherit}button{padding:8px 13px;border:1px solid var(--vscode-panel-border);font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);cursor:pointer}button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background);border-color:var(--vscode-button-background)}button:disabled{opacity:.55;cursor:default}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.muted{color:var(--vscode-descriptionForeground);font-size:13px}.notice{border-left:3px solid var(--vscode-textLink-foreground);padding:10px 12px;background:var(--vscode-textBlockQuote-background);margin:12px 0}.warning{border-left-color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.scope{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.scope div{border:1px solid var(--vscode-panel-border);padding:10px}.scope strong{display:block}#providerFields{position:relative;z-index:3}.notice,#remoteTools{position:relative;z-index:1}.hidden{display:none!important}@media(max-width:700px){main{padding:24px 20px}.scope{grid-template-columns:1fr}}
</style></head><body><main><p class="muted">SCAP-NG Assessment Studio</p><h1>AI-assisted authoring configuration</h1><p class="lede">Choose whether the optional AI authoring path is available. This page configures provider access only; it does not make a request or modify an Assessment.</p><section class="card mode-card"><h2>AI assistance mode</h2><label for="mode">Mode</label><select id="mode">${modeOptions(mode)}</select><p id="modeDescription" class="muted"></p><div id="remoteNotice" class="notice warning hidden"><strong>Remote transmission boundary.</strong><br>Any future request will show the exact source scope and require explicit consent before content leaves VS Code.<br><br>For an OpenAI-compatible gateway, enter its base URL and model ID. For example, GenAI.mil documents <code>https://api.genai.mil/v1</code> and <code>gemini-3.5-flash-lite-withtools</code>.</div><div id="providerFields"><label for="endpoint">AI endpoint</label><input id="endpoint" type="url" autocomplete="off" value="${escapeHtml(configuration.endpoint)}" placeholder="http://127.0.0.1:11434/v1"><p class="muted">Local mode accepts loopback HTTP(S). Remote mode requires HTTPS. This value is not a credential.</p><label for="model">Model identifier (withtools recommended)</label><select id="model">${configuration.model ? `<option value="${escapeHtml(configuration.model)}" selected>${escapeHtml(modelOptionLabel(configuration.model))}</option>` : '<option value="">Query available models</option>'}<option value="__manual_model__">Enter model ID manually…</option></select><input id="customModel" type="text" autocomplete="off" value="" placeholder="Provider-specific model name" hidden><p id="modelGuidance" class="muted">For SCAP-NG authoring, choose a model whose ID contains <code>withtools</code> when available. Models without it do not receive the pinned local capability/search/validation tools and may return prose or non-native YAML.</p></div><div id="noneNotice" class="notice hidden"><strong>No AI assistance is selected.</strong><br>The deterministic offline best-guess workflow remains available separately and is not an AI provider.</div><div id="vscodeNotice" class="notice hidden"><strong>VS Code provider discovery.</strong><br>The extension will use the VS Code Language Model API only when an approved provider is exposed by the host.</div><div id="vscodeProviderTools" class="hidden"><button id="discoverProviders" type="button">Check available VS Code providers</button><p id="providerStatus" class="muted" role="status" aria-live="polite">No provider discovery has been requested.</p><div id="providerList" class="muted"></div></div><div id="codexNotice" class="notice hidden"><strong>Codex (local)</strong><br>The editor will invoke the Codex CLI already available to this VS Code host. Credentials and provider configuration remain outside the editor.<div class="actions"><button id="testCodex" type="button">Test Codex access</button></div><p id="codexStatus" class="muted" role="status" aria-live="polite">No Codex availability test has been run.</p></div><div id="remoteTools" class="hidden"><div class="actions"><button id="storeRemoteKey" type="button">Store API key securely</button><button id="clearRemoteKey" type="button">Forget stored key</button><button id="discoverRemoteModels" type="button">Query available models</button><button id="testRemote" type="button">Test OpenAI-compatible gateway</button><button id="testAuthoring" type="button">Run AI authoring self-test</button></div><p id="remoteStatus" class="muted" role="status" aria-live="polite">The key is never shown or saved in settings.</p></div><div class="actions"><button id="save" class="primary">Save configuration</button><button id="close">Close</button></div><p id="status" class="muted" role="status" aria-live="polite"></p></section><section class="card"><h2>Safety contract</h2><p class="muted">Future providers must return a structured proposal, include the pinned schema-pack identity, validate locally, and show a human-reviewable diff before saving or linking an Assessment.</p><div class="scope"><div><strong>Never automatic</strong><span class="muted">No silent YAML mutation or Rule linkage.</span></div><div><strong>No compliance claims</strong><span class="muted">AI cannot declare PASS or FAIL.</span></div><div><strong>Explicit data scope</strong><span class="muted">Review source text before transmission.</span></div><div><strong>Offline remains valid</strong><span class="muted">No account or network is required.</span></div></div></section></main><script nonce="scap-ng-ai-configuration">const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);const modelSupportsPinnedTools=model=>/(?:^|[-_.])withtools(?:$|[-_.])/i.test(String(model||'').trim());const modelOptionLabel=model=>modelSupportsPinnedTools(model)?String(model)+' · recommended for SCAP-NG authoring':String(model)+' · provider-only; may fail structured authoring';const descriptions=${JSON.stringify(Object.fromEntries(aiAssistanceModes.map(value=>[value,aiAssistanceModeDescription(value)])))};const modeLabels=${JSON.stringify(Object.fromEntries(aiAssistanceModes.map(value=>[value,aiAssistanceModeLabel(value)])))};function selectedModel(){return $('model').value==='__manual_model__'?$('customModel').value.trim():$('model').value;}function syncModelInput(){const manual=$('model').value==='__manual_model__';$('customModel').hidden=!manual;const value=manual?$('customModel').value.trim():$('model').value;const guidance=$('modelGuidance');if(guidance)guidance.textContent=value&&!/(?:^|[-_.])withtools(?:$|[-_.])/i.test(value)?'Provider-only model: pinned local SCAP-NG capability/search/validation tools will not be offered; this model may return prose or non-native YAML. Prefer a model whose ID contains withtools when available.':'SCAP-NG authoring tools are eligible for this model; the gateway may still reject them, in which case the request will continue in provider-only mode with reduced reliability.';}function setModel(value){const current=String(value||'');const select=$('model');const matching=[...select.options].find(option=>option.value===current);if(matching){select.value=current;$('customModel').value='';}else{select.value='__manual_model__';$('customModel').value=current;}syncModelInput();}function renderRemoteModels(models){const current=selectedModel();const select=$('model');select.replaceChildren();const ordered=[...(models||[])].sort((a,b)=>Number(modelSupportsPinnedTools(b))-Number(modelSupportsPinnedTools(a))||a.localeCompare(b));for(const id of ordered){const option=document.createElement('option');option.value=id;option.textContent=modelOptionLabel(id);select.append(option);}if(current&&!(models||[]).includes(current)){const option=document.createElement('option');option.value=current;option.textContent=modelOptionLabel(current)+' (current)';select.append(option);}const manual=document.createElement('option');manual.value='__manual_model__';manual.textContent='Enter model ID manually…';select.append(manual);if(current&&[...select.options].some(option=>option.value===current))select.value=current;else if(ordered.length)select.value=ordered[0];else select.value='__manual_model__';syncModelInput();}function sync(){const mode=$('mode').value;$('modeDescription').textContent=descriptions[mode]||descriptions.none;$('providerFields').classList.toggle('hidden',mode==='none'||mode==='codex-local');$('noneNotice').classList.toggle('hidden',mode!=='none');$('vscodeNotice').classList.toggle('hidden',mode!=='vscode');$('vscodeProviderTools').classList.toggle('hidden',mode!=='vscode');$('remoteNotice').classList.toggle('hidden',mode!=='remote');$('codexNotice').classList.toggle('hidden',mode!=='codex-local');$('remoteTools').classList.toggle('hidden',mode!=='remote');}function sendSave(){vscode.postMessage({type:'save',mode:$('mode').value,endpoint:$('endpoint').value,model:selectedModel()});$('save').disabled=true;$('status').textContent='Saving configuration…';}$('mode').onchange=sync;$('model').onchange=syncModelInput;$('save').onclick=sendSave;$('close').onclick=()=>vscode.postMessage({type:'close'});$('storeRemoteKey').onclick=()=>vscode.postMessage({type:'storeRemoteApiKey'});$('clearRemoteKey').onclick=()=>vscode.postMessage({type:'clearRemoteApiKey'});$('discoverRemoteModels').onclick=()=>{const button=$('discoverRemoteModels');button.disabled=true;$('remoteStatus').textContent='Querying available models without sending Assessment content…';vscode.postMessage({type:'discoverRemoteModels',mode:$('mode').value,endpoint:$('endpoint').value,model:selectedModel()});};$('testRemote').onclick=()=>{const button=$('testRemote');button.disabled=true;$('remoteStatus').textContent='Testing gateway without sending Assessment content…';vscode.postMessage({type:'testRemote',mode:$('mode').value,endpoint:$('endpoint').value,model:selectedModel()});};$('testAuthoring').onclick=()=>{const button=$('testAuthoring');button.disabled=true;$('remoteStatus').textContent='Running a small AI authoring self-test; no workspace files will be changed…';vscode.postMessage({type:'testAuthoring',mode:$('mode').value,endpoint:$('endpoint').value,model:selectedModel()});};$('testCodex').onclick=()=>{const button=$('testCodex');button.disabled=true;$('codexStatus').textContent='Testing the local Codex CLI; this may consume a small provider request…';vscode.postMessage({type:'testCodex'});};$('discoverProviders').onclick=()=>{const button=$('discoverProviders');button.disabled=true;$('providerStatus').textContent='Checking the host Language Model API…';$('providerList').replaceChildren();vscode.postMessage({type:'discoverProviders'});};window.addEventListener('message',event=>{const message=event.data;if(message.type==='providers'){const button=$('discoverProviders');button.disabled=false;const models=Array.isArray(message.models)?message.models:[];$('providerStatus').textContent=models.length?'Available provider models: '+models.length:'No provider models are currently exposed by VS Code.';const list=$('providerList');list.replaceChildren();for(const model of models){const row=document.createElement('div');row.textContent=(model.vendor||'unknown')+'/'+(model.id||'unknown')+(model.family?' · '+model.family:'');list.append(row);}}if(message.type==='codexStatus'){const button=$('testCodex');if(button)button.disabled=false;$('codexStatus').textContent=message.message||'';$('codexStatus').className=message.ok?'muted':'error';}if(message.type==='remoteStatus'){const button=$('testRemote');if(button)button.disabled=false;const authoring=$('testAuthoring');if(authoring)authoring.disabled=false;const discover=$('discoverRemoteModels');if(discover)discover.disabled=false;if(Array.isArray(message.models))renderRemoteModels(message.models);$('remoteStatus').textContent=message.message||'';}if(message.type==='saved'){if(message.configuration){$('mode').value=message.configuration.mode||'none';$('endpoint').value=message.configuration.endpoint||'';setModel(message.configuration.model||'');sync();}$('save').disabled=false;$('status').textContent='Saved. '+(modeLabels[$('mode').value]||'None (no AI)')+' selected.';}if(message.type==='error'){$('save').disabled=false;$('status').className='error';$('status').textContent=message.message||'Could not save configuration.';}if(message.type==='refresh'){const value=message.configuration||{};$('mode').value=value.mode||'none';$('endpoint').value=value.endpoint||'';setModel(value.model||'');sync();}});sync();</script></body></html>`;
}

export class AiConfigurationPanel {
  private static panel: any;
  private static reader: AiConfigurationReader | undefined;
  private static writer: AiConfigurationWriter | undefined;

  static update(configuration: AiAuthoringConfiguration) {
    this.panel?.webview.postMessage({ type: 'refresh', configuration });
  }

  static open(context: vscode.ExtensionContext, reader: AiConfigurationReader, writer: AiConfigurationWriter, actions: AiConfigurationActions) {
    const api: any = vscode;
    this.reader = reader;
    this.writer = writer;
    if (this.panel) {
      this.panel.webview.html = html(reader());
      this.panel.reveal(api.ViewColumn?.One ?? 1);
      return;
    }
    const panel = api.window.createWebviewPanel('scapNg.aiConfiguration', 'SCAP-NG AI Configuration', api.ViewColumn?.One ?? 1, { enableScripts: true, retainContextWhenHidden: true });
    this.panel = panel;
    panel.webview.html = html(reader());
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'close') { panel.dispose(); return; }
      if (message.type === 'storeRemoteApiKey') {
        try { panel.webview.postMessage({ type: 'remoteStatus', message: await actions.storeRemoteApiKey() }); }
        catch (error) { panel.webview.postMessage({ type: 'remoteStatus', message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type === 'clearRemoteApiKey') {
        try { panel.webview.postMessage({ type: 'remoteStatus', message: await actions.clearRemoteApiKey() }); }
        catch (error) { panel.webview.postMessage({ type: 'remoteStatus', message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type === 'discoverRemoteModels') {
        const configuration: AiAuthoringConfiguration = { mode: normalizeAiAssistanceMode(message.mode), endpoint: typeof message.endpoint === 'string' ? message.endpoint.trim() : '', model: typeof message.model === 'string' ? message.model.trim() : '' };
        try { panel.webview.postMessage({ type: 'remoteStatus', ...(await actions.discoverRemoteModels(configuration)) }); }
        catch (error) { panel.webview.postMessage({ type: 'remoteStatus', message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type === 'testCodex') {
        try { panel.webview.postMessage({ type: 'codexStatus', ...(await actions.testCodex()) }); }
        catch (error) { panel.webview.postMessage({ type: 'codexStatus', ok: false, message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type === 'testRemote') {
        const testConfiguration: AiAuthoringConfiguration = { mode: normalizeAiAssistanceMode(message.mode), endpoint: typeof message.endpoint === 'string' ? message.endpoint.trim() : '', model: typeof message.model === 'string' ? message.model.trim() : '' };
        try { panel.webview.postMessage({ type: 'remoteStatus', ...(await actions.testRemote(testConfiguration)) }); }
        catch (error) { panel.webview.postMessage({ type: 'remoteStatus', message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type === 'testAuthoring') {
        const testConfiguration: AiAuthoringConfiguration = { mode: normalizeAiAssistanceMode(message.mode), endpoint: typeof message.endpoint === 'string' ? message.endpoint.trim() : '', model: typeof message.model === 'string' ? message.model.trim() : '' };
        try { panel.webview.postMessage({ type: 'remoteStatus', ...(await actions.testAuthoring(testConfiguration)) }); }
        catch (error) { panel.webview.postMessage({ type: 'remoteStatus', message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      if (message.type === 'discoverProviders') {
        try {
          const languageModel = api.lm;
          if (typeof languageModel?.selectChatModels !== 'function') throw new Error('This VS Code host does not expose the Language Model API.');
          const models = await languageModel.selectChatModels();
          panel.webview.postMessage({ type: 'providers', models: (models ?? []).map((model: any) => ({ id: String(model?.id ?? ''), vendor: String(model?.vendor ?? ''), family: String(model?.family ?? '') })) });
        } catch (error) {
          panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (message.type !== 'save') return;
      const mode = normalizeAiAssistanceMode(message.mode);
      const endpoint = typeof message.endpoint === 'string' ? message.endpoint.trim() : '';
      const model = typeof message.model === 'string' ? message.model.trim() : '';
      const endpointError = aiEndpointError(mode, endpoint);
      if (endpointError) { panel.webview.postMessage({ type: 'error', message: endpointError }); return; }
      try {
        const saved = await this.writer?.({ mode, endpoint, model });
        panel.webview.postMessage({ type: 'saved', configuration: saved ?? { mode, endpoint, model } });
      } catch (error) {
        panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) { this.panel = undefined; this.reader = undefined; this.writer = undefined; }
    });
    context.subscriptions.push(panel);
  }
}
