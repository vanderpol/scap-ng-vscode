import * as vscode from 'vscode';
import type { RuleAutomationSummary } from './content-context.js';

export interface WelcomeBuildInfo { buildId: string; sourceCommit: string; builtAt: string; }

export interface WelcomeContextInfo {
  benchmarkRootSelected: boolean;
  authoringMode?: 'benchmark' | 'standalone';
  benchmarkLabel?: string;
  benchmarkRootPath?: string;
  profileCount?: number;
  ruleCount?: number;
  assessmentCount?: number;
  applicabilityCount?: number;
  conditionCount?: number;
  automation?: RuleAutomationSummary;
  automationAnalysis?: { state: 'not-run' | 'complete'; likelyAutomatable: number; scanned: number; total: number; analyzedAt?: string };
}

function escapeHtml(value: unknown): string { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function automationCardHtml(contextInfo: WelcomeContextInfo): string {
  const analysis = contextInfo.automationAnalysis;
  if (analysis?.state === 'complete') return `<div class="automation-card"><strong>Automation analysis complete</strong><span>Analyzed ${analysis.scanned} of ${analysis.total} Rules. The Likely automatable stat links to the heuristic results.</span><button data-command="scapNg.analyzeBenchmarkAutomation">Run again</button></div>`;
  return '<div class="automation-card"><strong>Automation analysis not run</strong><span>Run the opt-in heuristic analysis to identify promising Rules without automation. It only scans this selected Benchmark.</span><button data-command="scapNg.analyzeBenchmarkAutomation">Analyze automation gaps</button></div>';
}

function html(packLoaded: boolean, build: WelcomeBuildInfo, contextInfo: WelcomeContextInfo) {
  const selected = contextInfo.benchmarkRootSelected;
  const standalone = contextInfo.authoringMode === 'standalone';
  const rootSummary = contextInfo.benchmarkRootPath ? ` Benchmark root: ${contextInfo.benchmarkRootPath}.` : '';
  const status = selected
    ? `Benchmark context selected. New and existing Assessment work is scoped to this Benchmark.${rootSummary}`
    : standalone
      ? `Standalone Assessment mode. A saved Benchmark root can be restored at any time.${rootSummary}`
      : `No Benchmark is selected. You can still work on standalone Assessments; choose a root to enable Benchmark-scoped authoring.${rootSummary}`;
  const escapedStatus = escapeHtml(`${status}${packLoaded ? '' : ' Guided authoring and schema validation still require editor setup.'}`);
  const root = escapeHtml(contextInfo.benchmarkRootPath ?? '');
  const label = escapeHtml(contextInfo.benchmarkLabel ?? 'Selected Benchmark');
  const analysisComplete = contextInfo.automationAnalysis?.state === 'complete';
  const stats: Array<[string, string | number]> = [
    ['Profiles', contextInfo.profileCount ?? 0],
    ['Rules', contextInfo.ruleCount ?? 0],
    ['Rule Assessments', contextInfo.assessmentCount ?? 0],
    ['Benchmark OS/App applicability', contextInfo.applicabilityCount ?? 0],
    ['Needs automation', contextInfo.automation?.needsAutomation ?? 0],
    ['Likely automatable', analysisComplete ? contextInfo.automationAnalysis?.likelyAutomatable ?? 0 : 'TBD']
  ];
  const sections = ['profiles', 'rules', 'assessments', 'applicability', 'automation', 'likely-automatable'];
  const statHtml = stats.map(([name, value], index) => {
    const section = sections[index];
    const enabled = section !== 'likely-automatable' || analysisComplete;
    return enabled
      ? `<a class="stat stat-link" href="#" data-benchmark-section="${section}"><strong>${value}</strong><span>${name}</span></a>`
      : `<div class="stat stat-disabled" aria-disabled="true"><strong>${value}</strong><span>${name}</span></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-scap-ng-welcome';"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.5 var(--vscode-font-family)}main{max-width:1020px;margin:0 auto;padding:38px 46px 34px}.eyebrow{margin:0 0 8px;color:var(--vscode-textLink-foreground);font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}h1{font-size:30px;line-height:1.15;margin:0 0 10px}.lede{max-width:760px;margin:0;color:var(--vscode-descriptionForeground);font-size:15px}.status{display:flex;gap:9px;align-items:flex-start;border:1px solid color-mix(in srgb,var(--vscode-textLink-foreground) 38%,var(--vscode-panel-border));border-left:4px solid var(--vscode-textLink-foreground);padding:11px 14px;margin:22px 0;background:var(--vscode-textBlockQuote-background)}.status.warning{border-left-color:var(--vscode-editorWarning-foreground)}.status-dot{width:8px;height:8px;flex:0 0 auto;margin-top:6px;border-radius:50%;background:var(--vscode-textLink-foreground)}.warning .status-dot{background:var(--vscode-editorWarning-foreground)}.root-info{margin:-10px 0 18px;color:var(--vscode-descriptionForeground);font:12px var(--vscode-editor-font-family);overflow-wrap:anywhere}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}.actions button{border:1px solid transparent;padding:9px 13px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer;font:inherit}.actions button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border-color:var(--vscode-button-secondaryBackground)}.actions button:hover:not(:disabled){filter:brightness(1.12)}.actions button:disabled{opacity:.5;cursor:default}.section-label{margin:24px 0 8px;color:var(--vscode-descriptionForeground);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.card{border:1px solid var(--vscode-panel-border);padding:18px;background:var(--vscode-textCodeBlock-background);border-radius:4px}.context-card{border-top:3px solid var(--vscode-textLink-foreground)}.card h2{font-size:17px;margin:0 0 6px}.card p{margin:5px 0;color:var(--vscode-descriptionForeground)}.benchmark-name{font-size:16px!important;color:var(--vscode-foreground)!important;font-weight:600}.stats{display:grid;grid-template-columns:repeat(6,minmax(80px,1fr));gap:8px;margin-top:16px}.automation-card{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px;padding:11px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}.automation-card strong{margin-right:4px}.automation-card span{flex:1;color:var(--vscode-descriptionForeground);font-size:12px}.automation-card button{border:1px solid var(--vscode-button-secondaryBackground);padding:6px 9px;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);cursor:pointer;font:inherit}.stat{padding:10px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);border-radius:3px}.stat strong{display:block;font-size:20px;line-height:1.1}.stat span{display:block;margin-top:3px;color:var(--vscode-descriptionForeground);font-size:11px}.root-line{display:flex;gap:9px;align-items:center;margin-top:13px;padding:10px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border)}.root-line .folder-icon{color:var(--vscode-textLink-foreground);font-size:16px}.root-line code{font:12px var(--vscode-editor-font-family);overflow-wrap:anywhere}.empty-card{border-style:dashed}.empty-card strong{color:var(--vscode-foreground)}.build{margin-top:22px;color:var(--vscode-descriptionForeground);font-size:12px}.stat-link{color:var(--vscode-foreground);text-decoration:none;cursor:pointer}.stat-disabled{opacity:.65;cursor:default}.stat-link:hover{border-color:var(--vscode-textLink-foreground);color:var(--vscode-textLink-foreground)}.build summary{cursor:pointer}.muted{color:var(--vscode-descriptionForeground);font-size:12px}#status{min-height:1.5em}@media(max-width:700px){main{padding:28px 20px}h1{font-size:26px}.stats{grid-template-columns:repeat(2,minmax(100px,1fr))}.root-line{align-items:flex-start}}
</style></head><body><main><p class="eyebrow">SCAP-NG Assessment Studio</p><p class="lede">Start with a Benchmark for focused authoring, or create a standalone Assessment when no Benchmark context is needed.</p><p class="section-label">Assessment work</p><div class="actions"><button id="createAssessmentButton" data-command="scapNg.createGuidedAssessment">${selected?'Create Assessment in Benchmark':'Create Assessment'}</button></div><section id="contextCard" class="card context-card${selected?'':' empty-card'}"><h2>${selected?'Selected Benchmark':'Benchmark context'}</h2>${selected?`<p class="benchmark-name">${label}</p><p>Use this Benchmark for new Assessments and focused navigation.</p><div class="stats">${statHtml}</div>${automationCardHtml(contextInfo)}`:standalone?'<p><strong>Standalone Assessment mode</strong></p><p>Create or open an Assessment without applying Benchmark context.</p>':'<p><strong>No Benchmark selected</strong></p><p>Choose a Benchmark root first, then select the Benchmark you want to edit.</p>'}</section><div class="status${root?'':' warning'}" id="packStatus"><span class="status-dot" aria-hidden="true"></span><span>${escapedStatus}</span></div><p class="section-label">Authoring options</p><div class="actions"><button id="benchmarkRootButton" data-command="scapNg.chooseBenchmarkRoot" class="secondary">${root?'Change Benchmark root':'Choose Benchmark root'}</button><button id="benchmarkContextButton" data-command="scapNg.selectBenchmark" class="secondary"${root?'':' disabled'}>${selected?'Select a different Benchmark':'Select Benchmark'}</button><button id="standaloneButton" data-command="scapNg.enterStandaloneMode" class="secondary"${selected?'':' hidden'}>Work standalone</button><button id="clearBenchmarkButton" data-command="scapNg.clearBenchmarkContext" class="secondary"${root?'':' hidden'}>Clear Benchmark context</button><button id="viewBenchmark" data-command="scapNg.openBenchmarkContext" class="secondary"${selected?'':' hidden'}>View Benchmark Details</button><button id="refreshBenchmark" data-command="scapNg.refreshContentIndex" class="secondary"${selected?'':' hidden'}>Refresh Benchmark data</button></div><p id="status" class="muted" role="status" aria-live="polite"></p><details class="build"><summary>Build and contract details</summary><p>Build ${escapeHtml(build.buildId)} · pinned source ${escapeHtml(build.sourceCommit)}</p></details></main><script nonce="scap-ng-welcome">const vscode=acquireVsCodeApi();const status=document.getElementById('status');function postCommand(command,args){status.textContent='Opening…';vscode.postMessage({type:'command',command,args});}function openBenchmarkSection(section){const commands={profiles:'scapNg.openBenchmarkContext',rules:'scapNg.openBenchmarkRules',assessments:'scapNg.openBenchmarkAssessments',applicability:'scapNg.openBenchmarkApplicability',automation:'scapNg.openBenchmarkAutomationGaps','likely-automatable':'scapNg.openBenchmarkLikelyAutomation'};status.textContent='Opening '+section+'…';vscode.postMessage({type:'command',command:commands[section]||'scapNg.openBenchmarkContext'});}function renderStats(info){const analyzed=info.automationAnalysis?.state==='complete';return [['Profiles',info.profileCount??0,'profiles'],['Rules',info.ruleCount??0,'rules'],['Rule Assessments',info.assessmentCount??0,'assessments'],['Benchmark OS/App applicability',info.applicabilityCount??0,'applicability'],['Needs automation',info.automation?.needsAutomation??0,'automation'],['Likely automatable',analyzed?(info.automationAnalysis?.likelyAutomatable??0):'TBD','likely-automatable']].map(([name,value,section])=>{const enabled=section!=='likely-automatable'||analyzed;const stat=document.createElement(enabled?'a':'div');stat.className='stat'+(enabled?' stat-link':' stat-disabled');if(enabled){stat.href='#';stat.onclick=event=>{event.preventDefault();openBenchmarkSection(section);};}const strong=document.createElement('strong');strong.textContent=value;const span=document.createElement('span');span.textContent=name;stat.append(strong,span);return stat;});}function renderContextCard(info){const card=document.getElementById('contextCard');if(!card)return;card.replaceChildren();card.className='card context-card'+(info?.benchmarkRootSelected?'':' empty-card');const heading=document.createElement('h2');heading.textContent=info?.benchmarkRootSelected?'Selected Benchmark':'Benchmark context';card.append(heading);if(info?.benchmarkRootSelected){const name=document.createElement('p');name.className='benchmark-name';name.textContent=info.benchmarkLabel||'Selected Benchmark';card.append(name);const hint=document.createElement('p');hint.textContent='Use this Benchmark for new Assessments and focused navigation.';card.append(hint);const stats=document.createElement('div');stats.className='stats';for(const stat of renderStats(info))stats.append(stat);card.append(stats);const automation=document.createElement('div');automation.className='automation-card';const analysis=info?.automationAnalysis;const strong=document.createElement('strong');strong.textContent=analysis?.state==='complete'?'Automation analysis complete':'Automation analysis not run';const detail=document.createElement('span');detail.textContent=analysis?.state==='complete'?'Analyzed '+(analysis.scanned??0)+' of '+(analysis.total??0)+' Rules. The Likely automatable stat links to the heuristic results.':'Run the opt-in heuristic analysis to identify promising Rules without automation. It only scans this selected Benchmark.';const action=document.createElement('button');action.type='button';action.dataset.command='scapNg.analyzeBenchmarkAutomation';action.textContent=analysis?.state==='complete'?'Run again':'Analyze automation gaps';automation.append(strong,detail,action);card.append(automation);bindCommands(card);}else{const strong=document.createElement('p');const text=document.createElement('strong');text.textContent=info?.authoringMode==='standalone'?'Standalone Assessment mode':'No Benchmark selected';strong.append(text);card.append(strong);const note=document.createElement('p');note.textContent=info?.authoringMode==='standalone'?'Create or open an Assessment without applying Benchmark context.':'Choose a Benchmark root first, then select the Benchmark you want to edit.';card.append(note);}}function bindCommands(root=document){for(const button of root.querySelectorAll('[data-command]')){if(button.dataset.bound)continue;button.dataset.bound='1';button.addEventListener('click',()=>postCommand(button.dataset.command,button.dataset.filter));}}bindCommands();window.addEventListener('message',event=>{const message=event.data;if(message.type==='context'){const box=document.getElementById('packStatus');const view=document.getElementById('viewBenchmark');const refresh=document.getElementById('refreshBenchmark');const rootButton=document.getElementById('benchmarkRootButton');const benchmarkButton=document.getElementById('benchmarkContextButton');const clearButton=document.getElementById('clearBenchmarkButton');const create=document.getElementById('createAssessmentButton');if(box){box.className='status'+(message.benchmarkRootPath?'':' warning');box.replaceChildren();const dot=document.createElement('span');dot.className='status-dot';dot.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent=message.statusText|| (message.benchmarkRootSelected?'Benchmark context selected.':'No Benchmark root selected.');box.append(dot,text);}if(view)view.hidden=!message.benchmarkRootSelected;if(refresh)refresh.hidden=!message.benchmarkRootSelected;if(rootButton)rootButton.textContent=message.benchmarkRootPath?'Change Benchmark root':'Choose Benchmark root';if(benchmarkButton){benchmarkButton.disabled=!message.benchmarkRootPath;benchmarkButton.textContent=message.benchmarkRootSelected?'Select a different Benchmark':'Select Benchmark';}if(clearButton)clearButton.hidden=!message.benchmarkRootPath;if(create)create.textContent=message.benchmarkRootSelected?'Create Assessment in Benchmark':'Create Assessment';renderContextCard(message);}if(message.type==='result'){status.textContent=message.message||'';status.style.color=message.ok?'var(--vscode-testing-iconPassed)':'var(--vscode-errorForeground)';}});document.querySelectorAll('[data-benchmark-section]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();openBenchmarkSection(link.dataset.benchmarkSection);}));vscode.postMessage({type:'ready'});</script></body></html>`;
}

export class WelcomePanel {
  private static panel: any;
  static updateContext(info: WelcomeContextInfo, packLoaded = true) {
    if (!this.panel) return;
    const rootSummary = info.benchmarkRootPath ? ` Benchmark root: ${info.benchmarkRootPath}.` : '';
    const statusText = info.benchmarkRootSelected
      ? `Benchmark context selected. New and existing Assessment work is scoped to this Benchmark.${rootSummary}${packLoaded ? '' : ' Guided authoring and schema validation still require editor setup.'}`
      : info.authoringMode === 'standalone'
        ? `Standalone Assessment mode. A saved Benchmark root can be restored at any time.${rootSummary}${packLoaded ? '' : ' Guided authoring and schema validation still require editor setup.'}`
        : `No Benchmark is selected. Standalone Assessments remain available; choose a root to enable Benchmark-scoped authoring.${rootSummary}${packLoaded ? '' : ' Guided authoring and schema validation still require editor setup.'}`;
    this.panel.webview.postMessage({ type: 'context', ...info, statusText });
  }
  static open(context: vscode.ExtensionContext, getPack: () => boolean, build: WelcomeBuildInfo, getContext: () => WelcomeContextInfo = () => ({ benchmarkRootSelected: false })) {
    const api: any = vscode;
    if (this.panel) {
      this.panel.webview.html = html(getPack(), build, getContext());
      this.panel.reveal(api.ViewColumn?.One ?? 1);
      return;
    }
    const panel = api.window.createWebviewPanel('scapNg.welcome', 'SCAP-NG Home', api.ViewColumn?.One ?? 1, { enableScripts: true, retainContextWhenHidden: true });
    this.panel = panel;
    panel.webview.html = html(getPack(), build, getContext());
    panel.webview.onDidReceiveMessage(async (message: any) => {
      if (message.type === 'ready') {
        this.updateContext(getContext(), getPack());
        return;
      }
      if (message.type !== 'command' || typeof message.command !== 'string') return;
      if (message.command === 'scapNg.createGuidedAssessment' && !getPack()) {
        panel.webview.postMessage({ type: 'result', ok: false, message: 'A verified offline metadata pack is required. Open the Authoring Sidebar and configure it under Options.' });
        return;
      }
      try {
        await api.commands.executeCommand(message.command, message.args);
        panel.webview.postMessage({ type: 'result', ok: true, message: 'Command opened. This Home tab can remain open while you work.' });
      } catch (error) {
        panel.webview.postMessage({ type: 'result', ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    });
    panel.onDidDispose(() => { if (this.panel === panel) this.panel = undefined; });
    context.subscriptions.push(panel);
  }
}
