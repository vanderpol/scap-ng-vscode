/**
 * Desktop master-detail graphical surface for the native SCAP-NG TextDocument.
 * The webview owns presentation state only; the extension host owns every edit.
 */
export function graphicalHtml() {
  const nonce = 'scap-ng-graphical-desktop';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size)/1.35 var(--vscode-font-family)}button,input,select,textarea{font:inherit}button{cursor:pointer}.shell{height:100vh;display:grid;grid-template-rows:36px 1fr 22px}.topbar{display:flex;align-items:center;gap:6px;padding:0 8px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}.topbar strong{font-size:13px}.topbar .file{color:var(--vscode-descriptionForeground);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.topbar .spacer{flex:1}.topbar button{border:1px solid var(--vscode-button-border,var(--vscode-panel-border));background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:4px 8px;border-radius:3px}.workspace{min-height:0;display:grid;grid-template-columns:minmax(225px,280px) minmax(420px,1fr) minmax(220px,285px)}.tree-pane,.help-pane{min-width:0;overflow:auto;background:var(--vscode-sideBar-background)}.tree-pane{border-right:1px solid var(--vscode-panel-border);padding:8px 7px}.help-pane{border-left:1px solid var(--vscode-panel-border);padding:9px}.workspace.help-collapsed{grid-template-columns:minmax(225px,280px) minmax(420px,1fr)}.workspace.help-collapsed .help-pane{display:none}.tree-heading{display:flex;align-items:center;gap:6px;margin:2px 4px 7px}.tree-heading strong{flex:1}.tree-heading small{color:var(--vscode-descriptionForeground)}.tree-intro{font-size:11px;color:var(--vscode-descriptionForeground);margin:0 4px 5px}.tree{list-style:none;margin:0;padding:0}.tree ul{list-style:none;margin:0;padding:0 0 0 13px;border-left:1px solid var(--vscode-tree-indentGuidesStroke)}.node{display:flex;align-items:center;min-height:25px;border-radius:3px;margin:1px 0}.node:hover{background:var(--vscode-list-hoverBackground)}.node.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.node:focus-within{outline:1px solid var(--vscode-focusBorder)}.node .toggle{width:21px;border:0;background:transparent;color:var(--vscode-descriptionForeground);padding:2px 0}.node .toggle.empty{visibility:hidden}.node .node-label{min-width:0;flex:1;border:0;background:transparent;color:inherit;text-align:left;padding:4px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node .node-more{width:22px;opacity:0;border:0;background:transparent;color:inherit;padding:2px}.node:hover .node-more,.node.selected .node-more,.node:focus-within .node-more{opacity:.85}.hidden-default .node-label{color:var(--vscode-descriptionForeground);font-style:italic}.count{color:var(--vscode-descriptionForeground);font-size:10px;padding-right:3px}.center{min-width:0;overflow:auto;padding:12px 16px 20px;container-type:inline-size;container-name:inspector}.crumb{color:var(--vscode-descriptionForeground);font-size:10px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.center h1{font-size:16px;font-weight:600;margin:0}.center .sub{color:var(--vscode-descriptionForeground);font-size:11px;margin:0 0 6px}.banner,.notice{padding:9px 11px;margin:9px 0 14px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background);font-size:12px}.notice{border-left-color:var(--vscode-editorWarning-foreground)}.property-card{max-width:none;border:0;background:transparent;padding:0;margin:3px 0}.property-card h2{font-size:12px;margin:0 0 4px}.group-section{border-top:1px solid var(--vscode-panel-border);margin:6px 0 2px;background:transparent}.group-section summary{cursor:pointer;padding:5px 1px;font-size:12px;font-weight:600;background:transparent}.group-section .property-grid{padding:3px 0 5px}.group-summary{display:none}.property-card p{margin:5px 0;color:var(--vscode-descriptionForeground)}.property-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;align-items:start}.property-grid .field-entry.wide{grid-column:1/-1}.field-entry{min-width:0}.field-entry>label{display:block;font-size:12px;font-weight:500;line-height:1.35;padding:0 0 3px;overflow-wrap:anywhere}.field-entry .field-control{min-width:0}.field-control{min-width:0}.field-control input,.field-control select,.field-control textarea{width:100%;min-height:30px;padding:5px 7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:2px}.field-control textarea{resize:vertical;line-height:1.4}.field-control input[type=checkbox]{width:auto;min-height:0;margin-top:5px}.field-help{display:none}.source-path{font:11px var(--vscode-editor-font-family);color:var(--vscode-descriptionForeground);word-break:break-all}.source-link{border:0;background:transparent;color:var(--vscode-textLink-foreground);padding:3px 0;margin-top:7px;font-size:11px}.empty{border:1px dashed var(--vscode-panel-border);padding:18px;color:var(--vscode-descriptionForeground);max-width:700px}.warning{color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.help-title{font-size:13px;font-weight:600;margin:0 0 5px}.help-section{border-bottom:1px solid var(--vscode-panel-border);padding:0 0 8px;margin-bottom:8px}.help-section p{font-size:12px;margin:6px 0;overflow-wrap:anywhere}.help-section code{font:11px var(--vscode-editor-font-family)}.statusbar{display:flex;align-items:center;padding:0 10px;border-top:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);font-size:11px}.context-menu{position:fixed;z-index:10;min-width:190px;padding:4px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border,var(--vscode-panel-border));box-shadow:0 4px 12px #0005}.context-menu button{display:block;width:100%;padding:6px 9px;text-align:left;border:0;background:transparent;color:inherit}.context-menu button:hover,.context-menu button:focus{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground);outline:0}.context-menu .separator{border-top:1px solid var(--vscode-menu-separatorBackground,var(--vscode-panel-border));margin:4px 0}.hidden{display:none}.inspector-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px 12px;margin-bottom:7px}.display-toggle{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground)}.display-toggle button{font-size:11px;border:1px solid var(--vscode-panel-border);border-radius:3px;background:transparent;color:var(--vscode-foreground);padding:3px 7px}.display-toggle button[aria-pressed=true]{background:var(--vscode-button-secondaryBackground);border-color:var(--vscode-focusBorder);font-weight:600}.defaults-summary{background:var(--vscode-textBlockQuote-background);border-left:2px solid var(--vscode-textLink-foreground);padding:5px 8px;margin:3px 0 9px;font-size:11px;color:var(--vscode-foreground)}.defaults-summary .muted{color:var(--vscode-descriptionForeground)}.defaults-summary details{display:inline-block;margin-left:7px}.defaults-summary details summary{cursor:pointer;color:var(--vscode-textLink-foreground)}.defaults-summary ul{margin:5px 0 2px;padding-left:15px;max-height:125px;overflow:auto}.defaults-summary li{margin:2px 0;overflow-wrap:anywhere}.defaults-summary button{background:transparent;border:0;color:var(--vscode-textLink-foreground);padding:0 4px;font-size:11px}.help-tech{font-size:10px;color:var(--vscode-descriptionForeground)}.help-tech summary{cursor:pointer}.help-tech code{display:block;overflow-wrap:anywhere;padding:4px 0}.variable-ref-details{font-size:11px;margin:5px 0 0;border-left:2px solid var(--vscode-textLink-foreground);padding-left:7px}.variable-ref-details summary{cursor:pointer;color:var(--vscode-textLink-foreground);overflow-wrap:anywhere}.variable-ref-preview{margin:6px 0 3px;padding:6px 8px;background:var(--vscode-textBlockQuote-background)}.variable-ref-preview p{margin:3px 0;font-size:11px}.variable-ref-preview ol{margin:6px 0;padding-left:20px}.variable-ref-preview li{margin:3px 0;overflow-wrap:anywhere}.variable-ref-action{border:1px solid var(--vscode-panel-border);border-radius:3px;padding:4px 7px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);font-size:11px;margin:5px 0}.variable-ref-warning{color:var(--vscode-errorForeground)}.require-intro{font-size:12px;color:var(--vscode-descriptionForeground);margin:1px 0 6px}.require-section{border-top:1px solid var(--vscode-panel-border);padding:7px 0 3px;max-width:1100px}.require-section.compact-constant{padding:7px 0}.require-section.compact-constant h2{display:inline;margin:0 8px 0 0}.require-section.compact-constant>.hint{display:inline;line-height:1.4}.require-section h2{font-size:13px;margin:0 0 4px}.require-section .hint{font-size:11px;color:var(--vscode-descriptionForeground);margin:2px 0 5px}.require-fields{display:flex;flex-direction:column;gap:7px;max-width:1100px}.require-predicate{border:1px solid var(--vscode-panel-border);border-left:3px solid var(--vscode-textLink-foreground);padding:8px 11px}.require-predicate h3{font:600 12px var(--vscode-editor-font-family);margin:0 0 5px;overflow-wrap:anywhere}.require-predicate .hint{font-size:11px;color:var(--vscode-descriptionForeground);margin:2px 0 5px}.require-predicate-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 9px;margin:0 0 7px}.require-predicate-heading h3{margin:0;flex:0 0 auto}.require-predicate-heading .hint{margin:0;flex:1 1 180px;min-width:0;line-height:1.4}.object-source-switch{grid-column:2;display:grid;grid-template-columns:minmax(130px,170px) minmax(0,1fr) auto;gap:6px;align-items:center;margin-top:4px}.object-source-switch .object-source-value{min-width:0}.object-source-switch input,.object-source-switch select{min-width:0;width:100%;padding:4px 6px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}.object-source-switch button{padding:4px 8px}.object-source-switch datalist{display:none}@container inspector (max-width:440px){.object-source-switch{grid-column:1;grid-template-columns:minmax(0,1fr)}}.property-grid.comparison-fields{grid-template-columns:minmax(0,1fr)}.property-grid.comparison-fields .field-entry{grid-template-columns:minmax(105px,25%) minmax(0,1fr)}.property-grid.comparison-fields .operator-choice{grid-column:2}.operator-choice{grid-column:2;display:grid;grid-template-columns:minmax(105px,160px) minmax(0,1fr) auto;align-items:center;gap:6px;margin-top:3px;min-width:0}.operator-value{min-width:0}.operator-value input,.operator-value select{width:100%;min-width:0;padding:5px 7px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}.operator-choice label{font-size:11px;color:var(--vscode-descriptionForeground)}.operator-choice select{flex:1;min-width:0;max-width:290px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:4px}.operator-choice button{white-space:nowrap;font-size:11px}.require-operator-controls{display:flex;flex-direction:column;gap:5px}.require-operator-controls .operator-choice{grid-column:auto}@media(max-width:760px){.operator-choice{flex-wrap:wrap;grid-column:1/-1}}/* Object selectors need readable full-width editors, not the generic two-column density. */.property-grid.object-fields{grid-template-columns:minmax(0,1fr);gap:7px}.property-grid.object-fields .field-entry,.property-grid.object-fields .field-entry.wide{grid-column:1/-1;grid-template-columns:minmax(105px,25%) minmax(0,1fr);align-items:start;gap:3px 12px}.property-grid.object-fields .field-entry .object-field-label{display:flex;flex-direction:column;gap:2px;min-width:0}.property-grid.object-fields .field-entry .object-field-label>label{padding:4px 0 0;font-weight:600}.property-grid.object-fields .field-entry .object-field-description{font-size:11px;line-height:1.35;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}.property-grid.object-fields .field-control{min-width:0;width:100%}.property-grid.object-fields .field-control input,.property-grid.object-fields .field-control select,.property-grid.object-fields .field-control textarea{width:100%;min-width:0}.property-grid.object-fields .field-entry>.variable-ref-details{grid-column:2;min-width:0}.property-grid.object-fields .field-control textarea{resize:vertical}@container inspector (max-width:440px){.property-grid.object-fields .field-entry,.property-grid.object-fields .field-entry.wide{grid-template-columns:minmax(0,1fr)}.property-grid.object-fields .field-entry>.variable-ref-details{grid-column:1}}/* Shared desktop property layout: label beside editor; retain wide text controls and narrow-view wrapping. */.property-grid .field-entry{display:grid;grid-template-columns:minmax(96px,34%) minmax(0,1fr);align-items:center;gap:3px 9px}.property-grid .field-entry>label{padding:0}.property-grid .field-entry>.field-control{min-width:0}.property-grid .field-entry>.variable-ref-details{grid-column:1/-1}.property-grid .field-entry.wide{grid-template-columns:minmax(110px,24%) minmax(0,1fr)}@media(max-width:760px){.property-grid .field-entry{grid-template-columns:minmax(90px,37%) minmax(0,1fr)}.property-grid .field-entry.wide{grid-template-columns:minmax(90px,30%) minmax(0,1fr)}}/* Require policies and simple predicates: keep fixed-size labels beside their controls on desktop. */.require-section>.property-grid .field-entry,.require-predicate>.property-grid .field-entry{display:grid;grid-template-columns:minmax(92px,37%) minmax(0,1fr);align-items:center;column-gap:9px;row-gap:3px}.require-section>.property-grid .field-entry>label,.require-predicate>.property-grid .field-entry>label{display:block;padding:0;line-height:1.35}.require-section>.property-grid .field-entry>.field-control,.require-predicate>.property-grid .field-entry>.field-control{min-width:0}.require-section>.property-grid .field-entry>.source-link,.require-predicate>.property-grid .field-entry>.source-link{grid-column:2}.require-section>.property-grid .field-entry.wide,.require-predicate>.property-grid .field-entry.wide{grid-template-columns:minmax(110px,25%) minmax(0,1fr)}@media(max-width:760px){.require-section>.property-grid,.require-predicate>.property-grid{grid-template-columns:minmax(0,1fr)}.require-section>.property-grid .field-entry,.require-predicate>.property-grid .field-entry{grid-template-columns:minmax(92px,38%) minmax(0,1fr)}}.require-section>h2{display:inline;margin:0 8px 0 0}.require-section>.hint{display:inline;line-height:1.4}.require-section>.property-grid{margin-top:6px}.require-regex{margin:7px 0;border-top:1px solid var(--vscode-panel-border);padding-top:5px}.require-regex summary{font-size:12px;font-weight:600;cursor:pointer;padding:4px 0}.require-regex-preview{font:11px var(--vscode-editor-font-family);color:var(--vscode-descriptionForeground);margin:5px 0;overflow-wrap:anywhere}.require-regex-row{grid-template-columns:minmax(70px,90px) minmax(0,1fr) auto}.require-regex-remove{font-size:11px;padding:5px 8px}.require-regex-add{display:flex;gap:7px;margin:8px 0 4px;padding-left:98px}.require-regex-add input{flex:1;min-width:0;padding:5px 7px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}.require-regex-add button{white-space:nowrap}@container inspector (max-width:440px){.require-regex-add{padding-left:0}.require-regex-row{grid-template-columns:minmax(60px,75px) minmax(0,1fr) auto}}.require-regex-row{display:grid;grid-template-columns:minmax(70px,90px) minmax(0,1fr) auto;align-items:start;gap:8px;margin:5px 0}.require-regex-row label{font-size:11px;display:block;padding:6px 0 0}.require-regex-row .field-control{min-width:0}.require-regex-row .field-control textarea{width:100%;resize:vertical;overflow-wrap:anywhere}.require-regex-row input,.require-regex-row textarea{font-family:var(--vscode-editor-font-family);font-size:12px}.require-badge{font-size:11px;background:var(--vscode-textBlockQuote-background);padding:4px 7px;display:inline-block;border-radius:3px;margin:0 0 6px}.require-advanced{margin-top:7px;font-size:12px}.require-advanced summary{cursor:pointer;font-weight:500}.shared-object-inspector{max-width:1050px}.shared-object-explanation{color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.45;margin:5px 0 12px}.shared-object-warning{color:var(--vscode-editorWarning-foreground);border-left:3px solid var(--vscode-editorWarning-foreground);padding:6px 9px;font-size:12px;margin:8px 0}.shared-object-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 14px}.shared-object-actions button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);padding:6px 10px;border-radius:3px;cursor:pointer;font-size:12px}.shared-object-usage{margin:10px 0 4px;padding:7px 9px;background:var(--vscode-textBlockQuote-background);font-size:11px;color:var(--vscode-descriptionForeground)}.input-overview{max-width:760px;padding:10px 0}.input-explanation{font-size:12px;color:var(--vscode-descriptionForeground);line-height:1.5;margin:0 0 12px}.input-empty{font-size:12px;border:1px dashed var(--vscode-panel-border);padding:12px;margin:0 0 10px;color:var(--vscode-descriptionForeground)}.input-list-entry{padding:7px 0;border-bottom:1px solid var(--vscode-panel-border)}.input-list-entry button{background:transparent;border:0;color:var(--vscode-textLink-foreground);cursor:pointer;padding:3px 0;font-size:12px}.input-add{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:3px;padding:7px 11px;cursor:pointer;font-size:12px;margin:7px 0 12px}.input-add:hover{background:var(--vscode-button-hoverBackground)}.variable-summary{font-size:12px;margin:3px 0 9px}.variable-flow{display:flex;flex-direction:column;gap:8px;margin:8px 0 12px;max-width:1100px}.variable-step{border:1px solid var(--vscode-panel-border);border-left:3px solid var(--vscode-textLink-foreground);padding:8px 12px;background:var(--vscode-editor-background)}.variable-step-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 9px;margin:0 0 5px}.variable-step-heading>.hint{margin:0;flex:1 1 240px;min-width:0;line-height:1.35}.variable-step-number{font-size:11px;font-weight:700;color:var(--vscode-descriptionForeground)}.variable-step h2{margin:0;font-size:13px}.variable-step .hint{margin:0 0 6px;font-size:11px;color:var(--vscode-descriptionForeground)}.variable-operands{display:flex;flex-wrap:wrap;gap:4px 8px;margin:5px 0 8px}.variable-operand{border-radius:3px;background:var(--vscode-textBlockQuote-background);padding:3px 7px;font:11px var(--vscode-editor-font-family);max-width:100%;overflow-wrap:anywhere}.variable-output-note{padding:6px 8px;border-left:2px solid var(--vscode-editorInfo-foreground,var(--vscode-textLink-foreground));font-size:11px;color:var(--vscode-descriptionForeground)}.variable-metadata{padding:0 0 8px;border-bottom:1px solid var(--vscode-panel-border)}.variable-usage{font-size:11px;color:var(--vscode-descriptionForeground);margin:5px 0 10px;overflow-wrap:anywhere}.semantic-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));gap:10px;margin-top:12px}.semantic-card{border:1px solid var(--vscode-panel-border);border-left:3px solid var(--vscode-textLink-foreground);padding:9px 11px;min-width:0}.semantic-card.require-card{border-left-color:var(--vscode-editorWarning-foreground)}.semantic-card h2{font-size:13px;margin:0 0 3px}.semantic-card .hint{font-size:11px;color:var(--vscode-descriptionForeground);margin:0 0 7px}.semantic-card ul{margin:0 0 7px;padding-left:16px;font-size:11px}.semantic-card li{margin:3px 0;overflow-wrap:anywhere}.semantic-card button,.collection-list button{font-size:12px;color:var(--vscode-textLink-foreground);background:transparent;border:0;padding:2px 0;text-align:left;cursor:pointer}.semantic-card button:hover,.collection-list button:hover{text-decoration:underline}.collection-list{list-style:none;margin:5px 0;padding:0}.collection-list li{border-bottom:1px solid var(--vscode-panel-border);padding:6px 0}@container inspector (max-width:440px){.property-grid{grid-template-columns:minmax(0,1fr)}.property-grid .field-entry.wide{grid-column:auto}}@media(max-width:1100px){.workspace{grid-template-columns:minmax(205px,245px) minmax(420px,1fr)}.help-pane{display:none}.help-pane.open{display:block;position:absolute;right:0;top:36px;bottom:22px;width:285px;z-index:3;box-shadow:-4px 0 12px #0004}}@media(max-width:760px){.workspace{grid-template-columns:1fr}.tree-pane{max-height:34vh;border-right:0;border-bottom:1px solid var(--vscode-panel-border)}.center{padding:10px}.property-grid{grid-template-columns:1fr}.help-pane.open{top:0}}
</style></head><body><div class="shell"><header class="topbar"><strong>Assessment Studio</strong><span class="file" id="fileName">SCAP-NG Assessment</span><span class="spacer"></span><button id="openSource" title="Open the same authoritative native YAML document">YAML</button><button id="toggleHelp" aria-expanded="true">Hide help</button></header><div class="workspace"><aside class="tree-pane" aria-label="Assessment tree"><div class="tree-heading"><strong>Assessment</strong><small id="treeCount"></small></div><p class="tree-intro">Select one node to inspect. The tree shows meaningful nodes only. Right-click or Shift+F10 for structural actions.</p><nav id="tree" class="tree" aria-label="Assessment structure"></nav></aside><main id="center" class="center" aria-live="polite"><div class="empty">Loading the pinned schema model…</div></main><aside id="helpPane" class="help-pane" aria-label="Contextual schema help and diagnostics"><section class="help-section"><h2 class="help-title">Contextual help</h2><div id="helpContent"><p>Select a node to see its schema-backed help.</p></div></section><section class="help-section"><h2 class="help-title">Validation boundary</h2><p>Parse/schema diagnostics are reported here when available. Runtime evaluation is unavailable; this view never fabricates PASS/FAIL.</p><p id="diagnosticSummary"></p></section><section class="help-section"><h2 class="help-title">Source</h2><p id="pinSummary"></p><button class="source-link" id="helpSource">Reveal selected node in YAML</button></section></aside></div><footer class="statusbar"><span id="status">Native YAML is authoritative · graphical edits are minimal WorkspaceEdits</span></footer></div><div id="menu" class="context-menu hidden" role="menu"></div><script nonce="${nonce}">
const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let fatalErrorReported=false;function reportWebviewError(message){if(fatalErrorReported)return;fatalErrorReported=true;const text=String(message||'Unknown graphical editor error');const status=$('status');if(status){status.className='error';status.textContent='Graphical editor failed to load: '+text}try{vscode.postMessage({type:'webviewError',message:text})}catch{}}window.addEventListener('error',event=>reportWebviewError(event.error?.stack||event.message||'Script error'));window.addEventListener('unhandledrejection',event=>reportWebviewError(event.reason?.stack||event.reason||'Unhandled promise rejection'));let current=null;let selectedPath=[];let showDefaults=false;let helpOpen=true;let menuPath=null;let evaluationNodes=new Map();let visualTestPaths=new Map();let expanded=new Set(['assessment','assessment/evaluate','assessment/inputs','assessment/variables','assessment/shared_objects']);
function key(path){return path.map(String).join('/')}function same(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i])}function human(v){return String(v??'').replaceAll('_',' ').replace(/^./,x=>x.toUpperCase())}function pathText(path){return path.map(x=>typeof x==='number'?'['+x+']':String(x)).join('.').replaceAll('.[','[')}function field(path){return current?.fields?.find(x=>same(x.path,path))}function isHidden(path){return Boolean(field(path)?.hidden&&!showDefaults)}function hasPrefix(path,prefix){return path.length>prefix.length&&prefix.every((v,i)=>path[i]===v)}function allFieldsUnder(path){return (current?.fields||[]).filter(x=>Array.isArray(x.path)&&hasPrefix(x.path,path))}function fieldsUnder(path){return allFieldsUnder(path).filter(x=>!isHidden(x.path))}function labelFor(path,node){const last=path.at(-1);if(path.length===1)return 'Assessment';if(node?.evalNode)return node.label;if(last==='tests')return 'Test definitions';if(last==='unreferenced_tests')return 'Unreferenced Tests ('+String(node?.children?.length||0)+')';if(last==='inputs')return 'Organizational Inputs';if(last==='variables')return 'Variables';if(last==='shared_objects')return 'Shared Objects';if(last==='evaluate')return 'Evaluate';if(last==='require')return 'Require · pass conditions';if(last==='object')return 'Object · inspected items';if(last==='filters')return 'Filters';if(last==='set')return 'Set composition';if(last==='operands'||typeof last==='number')return 'Operand '+(Number(last)+1);if(path.includes('tests')&&path.length===3)return node?.label||'Test: '+String(last);if(path.includes('variables')&&path.length===3)return node?.label||String(last);if(path.includes('inputs')&&path.length===3)return 'Input: '+String(last);if(path.includes('shared_objects')&&path.length===3)return 'Shared Object: '+String(last);return node?.label||human(last)}
function evalChild(parent,path){const node={path,children:[],field:undefined,structural:true,evalNode:true,label:''};parent.children.push(node);return node}function fillEvalTree(node,expr,path,root=false,depth=0){node.evalNode=true;evaluationNodes.set(key(path),node);if(depth>48){node.label=root?'Evaluate — expression too deep':'Expression too deep';return}if(!expr||typeof expr!=='object'||Array.isArray(expr)){node.label=root?'Evaluate — invalid expression':'Invalid expression';return}if(typeof expr.test==='string'){if(root){node.label='Evaluate — Test';const ref=evalChild(node,path.concat('test'));ref.label=expr.test;ref.evalTestId=expr.test;evaluationNodes.set(key(ref.path),ref)}else{node.label=expr.test;node.evalTestId=expr.test}return}const ops=['and','or','one','xor'];const op=ops.find(name=>Array.isArray(expr[name]));if(op){node.label=(root?'Evaluate — ':'')+op.toUpperCase();for(let i=0;i<expr[op].length;i++){const nextPath=path.concat(op,i);fillEvalTree(evalChild(node,nextPath),expr[op][i],nextPath,false,depth+1)}return}if(expr.not&&typeof expr.not==='object'){node.label=root?'Evaluate — NOT':'NOT';const nextPath=path.concat('not');fillEvalTree(evalChild(node,nextPath),expr.not,nextPath,false,depth+1);return}if(expr.if&&expr.then&&expr.else){node.label=root?'Evaluate — IF':'IF';const when=evalChild(node,path.concat('if'));fillEvalTree(when,expr.if,when.path,false,depth+1);when.label='IF: '+when.label;const then=evalChild(node,path.concat('then'));fillEvalTree(then,expr.then,then.path,false,depth+1);then.label='THEN: '+then.label;if(Array.isArray(expr.else_if)){for(let i=0;i<expr.else_if.length;i++){const branch=expr.else_if[i];const branchNode=evalChild(node,path.concat('else_if',i));branchNode.label='ELSE IF '+(i+1);evaluationNodes.set(key(branchNode.path),branchNode);for(const name of ['if','then']){if(branch?.[name]){const child=evalChild(branchNode,branchNode.path.concat(name));fillEvalTree(child,branch[name],child.path,false,depth+1);child.label=name.toUpperCase()+': '+child.label}}}}const other=evalChild(node,path.concat('else'));fillEvalTree(other,expr.else,other.path,false,depth+1);other.label='ELSE: '+other.label;return}if(typeof expr.input_provided==='string'){node.label='Input provided: '+expr.input_provided;return}if(typeof expr.assessment==='string'){node.label='Assessment: '+expr.assessment;return}if(expr.not_applicable){node.label='Not applicable';return}if(expr.not_evaluated){node.label='Not evaluated';return}node.label=root?'Evaluate — unsupported expression':'Unsupported expression'}function evaluationSelection(path){return path[1]==='evaluate'?evaluationNodes.get(key(path)):undefined}function testPathForSelection(path){
  if(path[1]==='unreferenced_tests'&&path.length>=3)return ['assessment','tests',...path.slice(2)];
  if(path[1]!=='evaluate')return null;
  for(let n=path.length;n>=2;n--){
    const ref=evaluationNodes.get(key(path.slice(0,n)));
    if(ref?.evalTestId&&current?.assessment?.tests?.some(t=>t.id===ref.evalTestId))
      return ['assessment','tests',ref.evalTestId,...path.slice(n)]
  }
  return null
}
function visiblePathForSource(path){
  if(path[1]!=='tests'||path.length<3)return path;
  const base=visualTestPaths.get(path[2]);
  return base?base.concat(path.slice(3)):path
}function renderEvalOverview(node){const box=document.createElement('section');box.className='semantic-card';const title=document.createElement('h2');title.textContent=node?.label||'Evaluate';box.append(title);const hint=document.createElement('p');hint.className='hint';hint.textContent='This is the authored logical evaluation tree. Select a Test ID in the left tree to edit its definition. To change the logic, use Reveal in YAML until source-safe group editing is implemented.';box.append(hint);if(node?.children?.length){const list=document.createElement('ul');for(const child of node.children){const li=document.createElement('li');li.textContent=child.label;list.append(li)}box.append(list)}return box}
function treeModel(){evaluationNodes=new Map();visualTestPaths=new Map();const root={path:['assessment'],children:[],field:undefined,structural:true};const ensure=(path,structural=true)=>{let node=root;for(let i=1;i<path.length;i++){const next=path.slice(0,i+1);let child=node.children.find(x=>same(x.path,next));if(!child){child={path:next,children:[],field:undefined,structural:false};node.children.push(child)}node=child}node.structural=node.structural||structural;return node};const meaningful=new Set(['assessment']);for(const path of [['assessment','inputs'],['assessment','variables'],['assessment','shared_objects'],...(current?.assessment?.mode==='manual'?[]:[['assessment','evaluate']]),['assessment','tests']]){ensure(path);meaningful.add(key(path))}for(const test of current?.assessment?.tests||[]){const base=['assessment','tests',test.id];const testNode=ensure(base);testNode.label=String(test.id);testNode.tooltip=String(test.title||test.id);meaningful.add(key(base));const object=base.concat('object');ensure(object);meaningful.add(key(object));const objectFields=allFieldsUnder(object);const hasSet=objectFields.some(x=>hasPrefix(x.path,object.concat('set')));if(hasSet){const set=object.concat(['set']);ensure(set);meaningful.add(key(set));const operands=new Set(objectFields.filter(x=>hasPrefix(x.path,set.concat('operands'))).map(x=>x.path[set.length+1]).filter(x=>typeof x==='number'));for(const index of operands){const operand=set.concat(['operands',index]);ensure(operand);meaningful.add(key(operand));const filters=operand.concat('filters');if(objectFields.some(x=>hasPrefix(x.path,filters))){ensure(filters);meaningful.add(key(filters));for(const index of new Set(objectFields.filter(x=>hasPrefix(x.path,filters)).map(x=>x.path[filters.length]).filter(x=>typeof x==='number'))){const filter=filters.concat(index);ensure(filter);meaningful.add(key(filter))}}}}else if(objectFields.some(x=>hasPrefix(x.path,object.concat('filters')))){const filters=object.concat('filters');ensure(filters);meaningful.add(key(filters));for(const index of new Set(objectFields.filter(x=>hasPrefix(x.path,filters)).map(x=>x.path[filters.length]).filter(x=>typeof x==='number'))){const filter=filters.concat(index);ensure(filter);meaningful.add(key(filter))}}const require=base.concat('require');ensure(require);meaningful.add(key(require))}const addNamed=(section)=>{const prefix=['assessment',section];const names=new Set((current?.fields||[]).filter(x=>hasPrefix(x.path,prefix)).map(x=>x.path[2]).filter(x=>typeof x==='string'));for(const name of names){const path=prefix.concat(name);ensure(path);meaningful.add(key(path))}};addNamed('inputs');addNamed('variables');addNamed('shared_objects');if(current?.assessment?.mode!=='manual'){const evalRoot=ensure(['assessment','evaluate']);fillEvalTree(evalRoot,current?.assessment?.evaluate,evalRoot.path,true);
  // Test definitions remain in YAML but are navigated through authored Evaluate references.
  const definitions=root.children.find(node=>node.path[1]==='tests');
  const byId=new Map((definitions?.children||[]).map(node=>[node.path[2],node]));
  function attachDefinition(source,parent){
    const copy=(node,target,sourceDepth)=>{
      for(const child of node.children){
        const next={...child,path:target.path.concat(child.path.slice(sourceDepth)),children:[],structural:true};
        target.children.push(next);meaningful.add(key(next.path));copy(child,next,child.path.length)
      }
    };
    copy(source,parent,source.path.length);
  }
  for(const ref of evaluationNodes.values()){
    if(!ref.evalTestId||!byId.has(ref.evalTestId))continue;
    if(!visualTestPaths.has(ref.evalTestId))visualTestPaths.set(ref.evalTestId,ref.path);
    attachDefinition(byId.get(ref.evalTestId),ref)
  }
  const missing=(current?.assessment?.tests||[]).filter(t=>!visualTestPaths.has(t.id));
  if(missing.length){
    const orphans={path:['assessment','unreferenced_tests'],children:[],structural:true,
      label:'Unreferenced Tests ('+missing.length+')',
      tooltip:'These authored Tests are not referenced by Evaluate and do not affect its result.'};
    for(const test of missing){
      const node=byId.get(test.id);if(!node)continue;
      const ref={path:orphans.path.concat(test.id),children:[],structural:true,
        label:test.id,tooltip:'Not evaluated: '+(test.title||test.id)};
      orphans.children.push(ref);visualTestPaths.set(test.id,ref.path);
      meaningful.add(key(ref.path));attachDefinition(node,ref)
    }
    if(orphans.children.length){root.children.push(orphans);meaningful.add(key(orphans.path))}
  }
  root.children=root.children.filter(node=>node.path[1]!=='tests');for(const entry of [...meaningful])if(entry==='assessment/tests'||entry.startsWith('assessment/tests/'))meaningful.delete(entry)
}if(current?.assessment?.mode==='manual'){root.children=root.children.filter(node=>node.path[1]!=='tests');for(const entry of [...meaningful])if(entry==='assessment/tests'||entry.startsWith('assessment/tests/'))meaningful.delete(entry)}return {root,meaningful}}
function hasVisible(node){return Boolean(node&&Array.isArray(node.path)&&(node.path.length===1||node.structural||(Array.isArray(node.children)&&node.children.some(hasVisible))||allFieldsUnder(node.path).length>0))}function visibleChildren(node){return Array.isArray(node?.children)?node.children.filter(hasVisible):[]}
function renderTree(){const root=$('tree');root.replaceChildren();const tree=treeModel();const draw=(node,parent)=>{if(!hasVisible(node))return;const li=document.createElement('li');const row=document.createElement('div');row.className='node'+(same(node.path,selectedPath)?' selected':'');row.tabIndex=0;row.dataset.path=JSON.stringify(node.path);const children=visibleChildren(node);const toggle=document.createElement('button');toggle.className='toggle'+(children.length?'':' empty');toggle.textContent=expanded.has(key(node.path))?'▾':'▸';toggle.setAttribute('aria-label',children.length?(expanded.has(key(node.path))?'Collapse ':'Expand ')+labelFor(node.path,node):'');toggle.onclick=e=>{e.stopPropagation();if(expanded.has(key(node.path)))expanded.delete(key(node.path));else expanded.add(key(node.path));renderTree()};const label=document.createElement('button');label.className='node-label';label.textContent=labelFor(node.path,node);label.title=node.tooltip||pathText(node.path);label.onclick=()=>select(node.path);const more=document.createElement('button');more.className='node-more';more.textContent='⋯';more.title='Node actions';more.setAttribute('aria-label','Actions for '+label.textContent);more.onclick=e=>{e.stopPropagation();showMenu(node.path,e.clientX,e.clientY)};row.append(toggle,label,more);if(node.children.length>0){const count=document.createElement('span');count.className='count';count.textContent=String(node.children.length);row.append(count)}row.onclick=()=>select(node.path);row.oncontextmenu=e=>{e.preventDefault();showMenu(node.path,e.clientX,e.clientY)};row.onkeydown=e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();showMenu(node.path,row.getBoundingClientRect().left+22,row.getBoundingClientRect().bottom)}if(e.key==='Enter'){e.preventDefault();select(node.path)}};li.append(row);if(children.length&&expanded.has(key(node.path))){const ul=document.createElement('ul');children.forEach(child=>draw(child,ul));li.append(ul)}parent.append(li)};draw(tree.root,root);$('treeCount').textContent=String(current?.assessment?.tests?.length||0)+' Tests'}
function revealPath(path){for(let i=1;i<=path.length;i++)expanded.add(key(path.slice(0,i)))}function select(path){selectedPath=path.slice();revealPath(selectedPath);renderTree();renderCenter();renderHelp()}
function fieldNeedsWide(f){const p=f.path||[];const key=String(p.at(-1)||'').toLowerCase();const parent=String(p.at(-2)||'').toLowerCase();if(['assessment_title','test_title','description','procedure','key','filepath','filename','path','directory','regex','pattern','matches_regex','not_matches_regex'].includes(key))return true;if(['matches_regex','not_matches_regex','key','filepath','filename','pattern'].includes(parent))return true;const value=typeof f.value==='string'?f.value:'';return value.length>48||value.includes(String.fromCharCode(10))}function fieldNeedsMultiline(f){if(Array.isArray(f.choices)&&f.choices.length)return false;if(f.kind!=='string')return false;const value=String(f.value??'');return value.includes(String.fromCharCode(10))||(fieldNeedsWide(f)&&value.length>48)}
function makeInput(f){const wrap=document.createElement('div');wrap.className='field-control';let input;const choices=Array.isArray(f.choices)?f.choices:[];if(choices.length||f.pickerOnly){input=document.createElement('select');if(f.pickerOnly&&!choices.length){const missing=document.createElement('option');missing.value='';missing.textContent='No Variables declared';missing.disabled=true;missing.selected=true;input.append(missing)}if(f.pickerOnly&&f.value&&!choices.includes(f.value)){const unknown=document.createElement('option');unknown.value=JSON.stringify(f.value);unknown.textContent='Unresolved: '+String(f.value);unknown.selected=true;unknown.disabled=true;input.append(unknown)}choices.forEach(choice=>{const o=document.createElement('option');o.value=JSON.stringify(choice);o.textContent=String(choice);o.selected=JSON.stringify(choice)===JSON.stringify(f.value);input.append(o)})}else if(f.kind==='boolean'){input=document.createElement('input');input.type='checkbox';input.checked=f.value===true}else if(f.kind==='number'||f.kind==='integer'){input=document.createElement('input');input.type='number';input.value=f.value===undefined?'':String(f.value)}else if(fieldNeedsMultiline(f)){input=document.createElement('textarea');input.rows=Math.min(4,Math.max(2,Math.ceil(String(f.value??'').length/90)));input.value=String(f.value??'')}else{input=document.createElement('input');input.value=f.value===undefined||f.value===null?'':String(f.value)}input.setAttribute('aria-label',friendlyLabel(f));input.title=f.description||friendlyLabel(f);input.onfocus=()=>renderHelp(f);input.onchange=()=>{let value;if(input.type==='checkbox')value=input.checked;else if(input.tagName==='SELECT'){try{value=JSON.parse(input.value)}catch{value=input.value}}else if(f.kind==='number'||f.kind==='integer')value=Number(input.value);else value=input.value;vscode.postMessage({type:'edit',path:f.path,value,revision:current.revision,version:current.version})};wrap.append(input);return wrap}
function friendlyLabel(f){const p=f.path||[];const last=String(p.at(-1)||'');const o=p.indexOf('object');const r=p.indexOf('require');
if(o>=0&&p.length>o+2){const name=human(p[o+1]);return last==='equals'?name:name+' · '+human(last)}
if(p[1]==='shared_objects'&&p.length>4){const name=human(p[3]);return last==='equals'?name:name+' · '+human(last)}
if(r>=0&&p.length>r+2){if(p[r+1]==='fields'&&p.length>r+3){const name=human(p[r+2]);return last==='equals'?name:name+' · '+human(last)}return human(last)}
const label=String(f.label||'');return label&&label!==pathText(p)&&!label.startsWith('assessment.')&&label.length<48?label:human(last)}
function isCollection(path){return path.length===2&&path[0]==='assessment'&&['tests','inputs','variables','shared_objects'].includes(path[1])}
function sectionFields(path){if(isCollection(path))return [];if(path.length===1)return (current?.fields||[]).filter(f=>f.path?.length===2&&f.path[0]==='assessment');if(path.length===3&&path[1]==='tests')return (current?.fields||[]).filter(f=>f.path?.length===4&&hasPrefix(f.path,path));return (current?.fields||[]).filter(f=>hasPrefix(f.path,path))}
function hiddenFor(path){return sectionFields(path).filter(f=>f.hidden)}
function setDefaultsView(next){if(showDefaults===next)return;const panel=$('center');const scroll=panel?.scrollTop||0;showDefaults=next;renderCenter();renderHelp();if(panel)panel.scrollTop=scroll;const activeLabel=next?'All fields':'Simplified';const pressed=Array.from(panel?.querySelectorAll('.display-toggle button')||[]).find(button=>button.textContent===activeLabel);pressed?.focus({preventScroll:true})}
function defaultsSummary(path){const defaults=hiddenFor(path);const line=document.createElement('div');line.className='defaults-summary';const label=document.createElement('span');if(!defaults.length){label.className='muted';label.textContent='No schema defaults are hidden in this section.';line.append(label);return line}label.textContent=showDefaults?defaults.length+' schema-default field'+(defaults.length===1?' is':'s are')+' visible in this section.':defaults.length+' schema-default field'+(defaults.length===1?' is':'s are')+' hidden in this section. ';line.append(label);if(!showDefaults){const preview=document.createElement('span');preview.textContent=defaults.slice(0,2).map(f=>friendlyLabel(f)+' = '+String(f.value)).join('; ')+(defaults.length>2?'; …':'');line.append(preview);const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='What is hidden?';details.append(summary);const list=document.createElement('ul');for(const f of defaults){const item=document.createElement('li');item.textContent=friendlyLabel(f)+' = '+String(f.value);list.append(item)}details.append(list);line.append(details)}const action=document.createElement('button');action.textContent=showDefaults?'Use simplified view':'Show all fields';action.onclick=()=>setDefaultsView(!showDefaults);line.append(action);return line}
function viewToggle(path){const wrap=document.createElement('div');wrap.className='display-toggle';const label=document.createElement('span');label.textContent='View:';wrap.append(label);
for(const item of [{text:'Simplified',value:false},{text:'All fields',value:true}]){const button=document.createElement('button');button.textContent=item.text;button.type='button';button.setAttribute('aria-pressed',String(showDefaults===item.value));button.onclick=()=>setDefaultsView(item.value);wrap.append(button)}
const count=document.createElement('span');count.textContent=hiddenFor(path).length+' defaults';wrap.append(count);return wrap}
function editorFields(path){if(isCollection(path))return [];if(path.length===1)return sectionFields(path).filter(f=>!isHidden(f.path));if(path.length===3&&path.includes('tests'))return (current?.fields||[]).filter(x=>x.path.length===path.length+1&&path.every((v,i)=>x.path[i]===v)&&!isHidden(x.path));return fieldsUnder(path)}

function variableReferenceId(f){
  if(!Array.isArray(f?.path)||f.path.at(-1)!=='variable'||typeof f.value!=='string'||!f.value)return null;
  if(!f.path.includes('object')&&!f.path.includes('shared_objects'))return null;
  return f.value
}
function variableReferenceLink(f){
  const id=variableReferenceId(f);if(!id)return null;
  const def=current?.variableDefinitions?.[id];
  const details=document.createElement('details');details.className='variable-ref-details';
  const summary=document.createElement('summary');
  summary.textContent=def?'Show Variable: '+id:'Unresolved Variable: '+id;
  summary.title=def?'Expand the authored Variable definition without leaving this Object':'No matching Assessment Variable declaration';
  details.append(summary);
  const content=document.createElement('div');content.className='variable-ref-preview';
  if(!def){const missing=document.createElement('p');missing.className='variable-ref-warning';
    missing.textContent='This Object references a Variable that is not defined in this Assessment.';content.append(missing)}
  else{
    const info=document.createElement('p');info.textContent=(def.title?String(def.title)+' — ':'')+
      'Declared '+String(def.kind||'local')+' Variable · datatype '+String(def.datatype||'unspecified')+
      '. Its value is derived from the following expression (not evaluated here).';content.append(info);
    const sourcePath=['assessment','variables',id,'expression'];
    const stages=variablePlan(def.expression,sourcePath);
    const list=document.createElement('ol');
    for(const stage of stages){const item=document.createElement('li');item.textContent=stage.title+
      (stage.operands?.length?' — '+stage.operands.join(' + '):'');list.append(item)}
    content.append(list);
    const open=document.createElement('button');open.type='button';open.className='variable-ref-action';
    open.textContent='Open Variable editor';open.title='Edit the original Variable definition in the graphical editor';
    open.onclick=()=>select(['assessment','variables',id]);content.append(open)
  }
  details.append(content);return details
}

function operationChoiceForField(field){
 const options=Array.isArray(field.operatorChoices)?field.operatorChoices:[];
 const original=String(field.path?.at(-1)||'');
 if(options.length<2||!options.includes(original))return null;
 const bar=document.createElement('div');bar.className='operator-choice';
 const mode=document.createElement('select');mode.setAttribute('aria-label','Comparison or value source');
 for(const name of options){
  const opt=document.createElement('option');opt.value=name;
  opt.textContent=name==='variable'?'Variable reference':human(name);
  mode.append(opt)
 }
 mode.value=original;
 const slot=document.createElement('div');slot.className='operator-value';
 const apply=document.createElement('button');apply.type='button';apply.textContent='Apply';apply.disabled=true;
 const refs=Object.keys(current?.variableDefinitions||{});
 let input;
 const changed=()=>{apply.disabled=!input.value||
  (mode.value===original&&input.value===String(field.value??''))};
 function draw(){
  slot.replaceChildren();
  if(mode.value==='variable'){
   input=document.createElement('select');input.setAttribute('aria-label','Assessment Variable');
   const values=refs.slice();
   if(original==='variable'&&field.value&&!values.includes(String(field.value)))values.unshift(String(field.value));
   if(!values.length){const option=document.createElement('option');option.value='';option.textContent='No Variables declared';option.disabled=true;input.append(option)}
   for(const v of values){const option=document.createElement('option');option.value=v;option.textContent=v;input.append(option)}
   input.value=original==='variable'?String(field.value):refs[0]||'';
  }else if(mode.value==='equals' && Array.isArray(field.fixedChoices) && field.fixedChoices.length){
   input=document.createElement('select');input.setAttribute('aria-label','Comparison value');
   for(const v of field.fixedChoices){const option=document.createElement('option');option.value=String(v);option.textContent=String(v);input.append(option)}
   if(mode.value===original)input.value=String(field.value??'');
  }else{
   input=document.createElement('input');input.type='text';
   input.setAttribute('aria-label','Comparison value');
   input.placeholder=mode.value==='matches_regex'?'Regular expression':'Expected value';
   input.value=mode.value===original?String(field.value??''):'';
  }
  input.onchange=changed;input.oninput=changed;
  slot.append(input);changed()
 }
 mode.onchange=draw;
 apply.onclick=()=>{
  if(!input.value)return;
  const val=mode.value==='matches_regex'?[input.value]:input.value;
  if(mode.value!==original&&!confirm('Change '+original+' to '+mode.value+'? This alters the Assessment condition.'))return;
  vscode.postMessage({type:'comparisonChange',path:field.path.slice(0,-1),
   operation:mode.value,value:val,allowedOperations:options,
   revision:current.revision,version:current.version})
 };
 bar.append(mode,slot,apply);draw();
 return bar
}
function sourceChoiceForObject(field){
 const parts=field.path||[];
 const variant=String(parts.at(-1)||'');
 if(variant!=='equals'&&variant!=='variable')return null;
 const inTest=parts[1]==='tests'&&parts[3]==='object'&&parts.length===6;
 const inShared=parts[1]==='shared_objects'&&parts.length===5;
 if(!inTest&&!inShared||field.kind!=='string')return null;
 const bar=document.createElement('div');bar.className='object-source-switch';
 const choice=document.createElement('select');choice.setAttribute('aria-label','Value source');
 for(const [id,label] of [['equals','Fixed value'],['variable','Variable reference']]){
  const option=document.createElement('option');option.value=id;option.textContent=label;choice.append(option);
 }
 choice.value=variant;
 let value;const valueSlot=document.createElement('div');valueSlot.className='object-source-value';
 const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Apply';
 confirm.disabled=true;
 const names=Object.keys(current?.variableDefinitions||{});
 function refresh(){
  valueSlot.replaceChildren();
  if(choice.value==='variable'){
   value=document.createElement('select');value.setAttribute('aria-label','Choose Assessment Variable');
   if(!names.length){const opt=document.createElement('option');opt.value='';opt.textContent='No Variables declared';opt.disabled=true;opt.selected=true;value.append(opt)}
   if(variant==='variable'&&!names.includes(String(field.value))){const opt=document.createElement('option');opt.value=String(field.value);opt.textContent='Unresolved: '+String(field.value);opt.disabled=true;value.append(opt)}
   for(const name of names){const opt=document.createElement('option');opt.value=name;opt.textContent=name;value.append(opt)}
   value.value=variant==='variable'?String(field.value):names[0]||'';
  }else{
   value=document.createElement('input');value.type='text';value.placeholder='Enter fixed value';
   value.value=variant==='equals'?String(field.value??''):'';
  }
  value.oninput=value.onchange=()=>{confirm.disabled=!value.value||(choice.value===variant&&value.value===String(field.value))};
  valueSlot.append(value);
  confirm.disabled=!value.value||(choice.value===variant&&value.value===String(field.value));
 }
 choice.onchange=refresh;
 confirm.onclick=()=>vscode.postMessage({type:'selectorSource',path:parts.slice(0,-1),variant:choice.value,value:value.value,revision:current.revision,version:current.version});
 bar.append(choice,valueSlot,confirm);refresh();
 return bar
}
function compactGrid(fields,style){const grid=document.createElement('div');grid.className='property-grid'+(style?' '+style:'');for(const item of fields){const entry=document.createElement('div');entry.className='field-entry'+(fieldNeedsWide(item)?' wide':'');const lab=document.createElement('label');lab.textContent=friendlyLabel(item);lab.title=item.description||pathText(item.path);entry.append(lab);const operators=(style==='object-fields'||style==='comparison-fields')?operationChoiceForField(item):null;if(operators){entry.append(operators)}else{entry.append(makeInput(item));if(style==='object-fields'){const chooser=sourceChoiceForObject(item);if(chooser)entry.append(chooser)}}const ref=variableReferenceLink(item);if(ref)entry.append(ref);grid.append(entry)}return grid}

function variableDefinition(path){return path.length===3&&path[1]==='variables'?current?.variableDefinitions?.[path[2]]:undefined}
function expressionBrief(expr){
  if(!expr||typeof expr!=='object'||Array.isArray(expr))return 'Expression';
  if('literal' in expr){const v=expr.literal&&typeof expr.literal==='object'&&!Array.isArray(expr.literal)?expr.literal.value:expr.literal;const display=Array.isArray(v)?v.join(', '):String(v??'');return 'Literal '+JSON.stringify(display.length>56?display.slice(0,53)+'…':display)}
  if('values' in expr)return 'Collected '+String(expr.values?.field||'field')+' values';
  if('regex_capture' in expr)return 'Regex capture result';
  if('variable' in expr)return 'Variable '+String(expr.variable);
  if('concat' in expr)return 'Concatenation result';
  if('unique' in expr)return 'Unique values';
  if('merge' in expr)return 'Merged values';
  return 'Expression'
}
function variablePlan(expr,path,depth=0){
  if(depth>24)return [{title:'Complex nested expression',note:'The expression exceeds the graphical outline limit. The full YAML remains available.',path,controls:[path]}];
  if(!expr||typeof expr!=='object'||Array.isArray(expr))return [{title:'Expression',note:'Review the authored expression in YAML.',path,controls:[path]}];
  if('values' in expr){
    const source=expr.values||{};const name=source.object?.capability;
    const kind=name==='windows.registry'?'Read registry values':name?'Collect '+name+' values':'Collect Object field values';
    return [{title:kind,note:'Read the selected field from collected Items. No target system is queried by this editor.',path:path.concat('values'),controls:[path.concat('values')]}]
  }
  if('literal' in expr)return [{title:'Use literal value',note:'An explicitly authored value, not a collected system result.',path:path.concat('literal'),controls:[path.concat('literal')]}];
  if('variable' in expr)return [{title:'Use another Variable',note:'Reads the values and status of the named Variable.',path:path.concat('variable'),controls:[path.concat('variable')]}];
  if('regex_capture' in expr){
    const source=expr.regex_capture||{};
    return [...variablePlan(source.value,path.concat('regex_capture','value'),depth+1),
      {title:'Extract with regular expression',note:'Return the first capture group from each input value. No actual capture has been evaluated.',path:path.concat('regex_capture'),controls:[path.concat('regex_capture','pattern')]}]
  }
  if('concat' in expr){
    const operands=Array.isArray(expr.concat)?expr.concat:[];
    const before=operands.flatMap((operand,index)=>(operand&&typeof operand==='object'&&'literal' in operand)?[]:variablePlan(operand,path.concat('concat',index),depth+1));
    const literalPaths=operands.flatMap((operand,index)=>(operand&&typeof operand==='object'&&'literal' in operand)?[path.concat('concat',index,'literal')]:[]);
    return [...before,{title:'Combine values in order',note:'Concatenate these components in the authored order. Multiple values can produce combinations; collection/status semantics are not evaluated here.',path,controls:literalPaths,operands:operands.map(expressionBrief)}]
  }
  if('unique' in expr)return [...variablePlan(expr.unique,path.concat('unique'),depth+1),{title:'Remove duplicates',note:'Keep distinct scalar values under the inherited ordering/status rules.',path,controls:[]}];
  if('merge' in expr){
    const merge=expr.merge||{};
    return [...variablePlan(merge.values,path.concat('merge','values'),depth+1),{title:'Sort and join values',note:'Join input values with the explicit delimiter, sort mode and order.',path:path.concat('merge'),controls:[path.concat('merge','delimiter'),path.concat('merge','sort'),path.concat('merge','order')]}]
  }
  return [{title:'Other expression',note:'The full schema-backed properties remain editable below and in YAML.',path,controls:[path]}]
}
function stepControls(step){
  const wanted=step.controls||[];
  const found=(current?.fields||[]).filter(f=>wanted.some(path=>same(f.path,path)||hasPrefix(f.path,path))&&!isHidden(f.path));
  const seen=new Set();
  return found.filter(f=>{const id=key(f.path);if(seen.has(id))return false;seen.add(id);return true})
}
function variableUsage(id){
  const seen=new Set();
  for(const f of current?.fields||[]){
    if(f.value!==id||f.path?.[1]!=='tests'||f.path.at(-1)!=='variable')continue;
    if(typeof f.path[2]==='string')seen.add(f.path[2]);
  }
  return [...seen]
}
function variableInspector(path){
  const variable=variableDefinition(path);
  const panel=document.createElement('div');
  if(!variable){const p=document.createElement('p');p.className='empty';p.textContent='No authored Variable definition was found. Review YAML or add a Variable from the tree.';panel.append(p);return panel}
  const meta=document.createElement('section');meta.className='variable-metadata';
  const header=document.createElement('p');header.className='variable-summary';header.textContent='This '+String(variable.kind||'named')+' Variable supplies '+String(variable.datatype||'typed')+' values. Follow the stages below to see how they are constructed.';meta.append(header);
  const metadata=editorFields(path).filter(f=>f.path.length===4&&['kind','datatype','title'].includes(String(f.path.at(-1))));
  if(metadata.length)meta.append(compactGrid(metadata));
  panel.append(meta);
  const usage=variableUsage(path[2]);if(usage.length){const note=document.createElement('p');note.className='variable-usage';note.textContent='Used by Test'+(usage.length===1?'':'s')+': '+usage.join(', ');panel.append(note)}
  const steps=variablePlan(variable.expression,path.concat('expression'));
  const flow=document.createElement('div');flow.className='variable-flow';const lead=document.createElement('h2');lead.textContent='How this Variable is built';lead.style.fontSize='13px';lead.style.margin='0 0 1px';flow.append(lead);
  steps.forEach((step,i)=>{
    const card=document.createElement('section');card.className='variable-step';
    const heading=document.createElement('div');heading.className='variable-step-heading';
    const number=document.createElement('span');number.className='variable-step-number';number.textContent='STEP '+(i+1);
    const name=document.createElement('h2');name.textContent=step.title;heading.append(number,name);card.append(heading);
    const help=document.createElement('p');help.className='hint';help.textContent=step.note;heading.append(help);
    if(Array.isArray(step.operands)&&step.operands.length){const parts=document.createElement('div');parts.className='variable-operands';step.operands.forEach((part,j)=>{const span=document.createElement('span');span.className='variable-operand';span.textContent=(j+1)+'. '+part;parts.append(span)});card.append(parts)}
    const fields=stepControls(step);if(fields.length)card.append(compactGrid(fields));flow.append(card)
  });
  panel.append(flow);
  const disclaimer=document.createElement('p');disclaimer.className='variable-output-note';disclaimer.textContent='Expression preview only — no registry value was collected, regex executed, or resulting command run.';panel.append(disclaimer);
  return panel
}

function collectionOverview(path){const list=document.createElement('ul');list.className='collection-list';const section=path[1];const targets=section==='tests'?(current?.assessment?.tests||[]).map(t=>({id:t.id,label:t.title||t.id})):[...new Set((current?.fields||[]).filter(f=>hasPrefix(f.path,path)).map(f=>f.path[2]).filter(v=>typeof v==='string'))].map(id=>({id,label:id}));if(section==='inputs'){const wrap=document.createElement('section');wrap.className='input-overview';const intro=document.createElement('p');intro.className='input-explanation';intro.textContent='Organizational Inputs declare values supplied by a Rule or policy when the Assessment runs. For example, an organization may require a minimum password length of 14. They do not reference external Assessment files; those use dependencies.';wrap.append(intro);if(targets.length){for(const item of targets){const entry=document.createElement('div');entry.className='input-list-entry';const button=document.createElement('button');button.type='button';button.textContent=item.label;button.onclick=()=>select([...path,item.id]);entry.append(button);wrap.append(entry)}}else{const empty=document.createElement('p');empty.className='input-empty';empty.textContent='No Organizational Inputs declared. This is valid if the Assessment needs none.';wrap.append(empty)}const add=document.createElement('button');add.type='button';add.className='input-add';add.textContent='+ Add Organizational Input';add.onclick=()=>vscode.postMessage({type:'structural',action:'add',path,revision:current?.revision,version:current?.version});wrap.append(add);const note=document.createElement('p');note.className='input-explanation';note.textContent='An Input specifies its datatype, how many values may be supplied, and whether the caller must provide it. No value is invented by this declaration.';wrap.append(note);return wrap}if(!targets.length){const p=document.createElement('p');p.className='empty';p.textContent='No '+human(section).toLowerCase()+' authored yet. Right-click this heading in the tree to add one.';return p}for(const item of targets){const li=document.createElement('li');const button=document.createElement('button');button.type='button';button.textContent=String(item.label);button.title='Open '+String(item.label);button.onclick=()=>select([...path,item.id]);li.append(button);list.append(li)}return list}function shortValue(value){const text=String(value??'');return text.length>90?text.slice(0,87)+'…':text}function selectedTest(){return (current?.assessment?.tests||[]).find(t=>t.id===selectedPath[2])}function semanticCard(testPath,which){const isObject=which==='object';const path=[...testPath,which];const section=document.createElement('section');section.className='semantic-card'+(isObject?'':' require-card');const heading=document.createElement('h2');heading.textContent=isObject?'Object — what to inspect':'Require — what must be true';section.append(heading);const hint=document.createElement('p');hint.className='hint';hint.textContent=isObject?'Defines the Items selected from the target system.':'Defines which collected Items and field values satisfy the policy.';section.append(hint);const values=(current?.fields||[]).filter(f=>hasPrefix(f.path,path));const preview=document.createElement('ul');const ranked=isObject?values:values.slice().sort((a,b)=>Number(b.path[path.length]==='fields')-Number(a.path[path.length]==='fields'));for(const f of ranked){const li=document.createElement('li');li.textContent=friendlyLabel(f)+': '+shortValue(f.value);preview.append(li)}if(!values.length){const note=document.createElement('p');note.className='hint';note.textContent='No authored values yet';section.append(note)}else section.append(preview);const open=document.createElement('button');open.type='button';open.textContent=isObject?'Edit Object':'Edit Require';open.onclick=()=>select(path);section.append(open);return section}function testOverview(path){const container=document.createElement('div');container.className='test-overview';const headFields=sectionFields(path);if(headFields.length)container.append(compactGrid(headFields,'test-header'));const sections=document.createElement('div');sections.className='semantic-sections';sections.append(semanticCard(path,'object'),semanticCard(path,'require'));container.append(sections);return container}

function requireDefinition(path){
  return path.length===4&&path[1]==='tests'&&path[3]==='require'
    ?current?.requireDefinitions?.[path[2]]:undefined
}
function cardinalityWords(value){
  const m={one_or_more:'at least one',zero_or_more:'zero or more',exactly_one:'exactly one',
    zero_or_one:'zero or one',every:'every',none:'none',one:'one',xor:'exclusive-or'};
  return m[String(value)]||String(value??'not specified')
}
function requireSection(title,description,controls){
  const section=document.createElement('section');section.className='require-section';
  const heading=document.createElement('h2');heading.textContent=title;section.append(heading);
  const help=document.createElement('p');help.className='hint';help.textContent=description;section.append(help);
  if(controls.length)section.append(compactGrid(controls));
  else section.classList.add('compact-constant'); // Summarize effective hidden defaults once; do not imply the requirements are missing.
  return section
}
function predicatePlan(requirement){
  const predicates=requirement&&typeof requirement==='object'&&!Array.isArray(requirement)
    &&requirement.fields&&typeof requirement.fields==='object'&&!Array.isArray(requirement.fields)
    ?requirement.fields:{};
  return Object.entries(predicates).map(([name,raw])=>{
    const predicate=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    const operators=Object.keys(predicate).filter(k=>!['value_match','values_found','values_matching','datatype','redact_result'].includes(k));
    const patterns=Array.isArray(predicate.matches_regex)?predicate.matches_regex:[];
    return {name,operators,patterns,expectedMatch:predicate.value_match,
      absence:predicate.values_found==='none'&&operators.length===0,
      visibleKeys:Object.keys(predicate)}
  })
}
function fieldCheckCard(path,plan){
  const base=path.concat('fields',plan.name);const section=document.createElement('section');section.className='require-predicate';
  const heading=document.createElement('div');heading.className='require-predicate-heading';
  const title=document.createElement('h3');title.textContent=plan.name;heading.append(title);
  const note=document.createElement('p');note.className='hint';
  note.textContent=plan.absence?'No collected values are permitted for this field.':
    plan.patterns.length?'The collected text is compared with the listed regular expressions.':
    plan.operators.length?'Compare this field with its authored expected value.':
    'Apply the authored presence and matching requirements to this field.';
  heading.append(note);section.append(heading);
  if(plan.absence){const badge=document.createElement('span');badge.className='require-badge';badge.textContent='Values found: none';section.append(badge)}
  const visible=editorFields(path).filter(f=>hasPrefix(f.path,base));
  // Field-level schema help belongs in Contextual Help and on control hover.
  // Never attach the first scalar's description to the entire Require group.
  const meta=visible.filter(f=>f.path.length===base.length+1&&f.path.at(-1)!=='matches_regex');
  if(meta.length)section.append(compactGrid(meta,'comparison-fields'));
  if(plan.patterns.length){
    const policy=document.createElement('p');policy.className='hint';
    policy.textContent='Expected-pattern policy: '+cardinalityWords(plan.expectedMatch)+' ('+String(plan.expectedMatch||'not specified')+'). This is distinct from the field-value and Item requirements above.';
    section.append(policy);
    const regex=document.createElement('details');regex.className='require-regex';
    regex.open=plan.patterns.length<=3;
    const summary=document.createElement('summary');summary.textContent='Regex patterns ('+plan.patterns.length+') — expand to edit';regex.append(summary);
    if(plan.patterns.length>3){const preview=document.createElement('p');preview.className='require-regex-preview';
      preview.textContent='First: '+String(plan.patterns[0]);section.append(preview)}
    const controls=visible.filter(f=>f.path.length===base.length+2&&f.path[base.length]==='matches_regex'&&typeof f.path.at(-1)==='number')
      .sort((a,b)=>a.path.at(-1)-b.path.at(-1));
    if(!controls.length){const missing=document.createElement('p');missing.className='hint';missing.textContent='Regex patterns are authored but no scalar controls were resolved; review YAML.';regex.append(missing)}
    for(const f of controls){
      const entry=document.createElement('div');entry.className='require-regex-row';
      const label=document.createElement('label');label.textContent='Pattern '+(Number(f.path.at(-1))+1);
      entry.append(label,makeInput(f));
      const remove=document.createElement('button');remove.type='button';remove.className='require-regex-remove';
      remove.textContent='Remove';remove.title='Remove Pattern '+(Number(f.path.at(-1))+1);
      remove.disabled=plan.patterns.length<=1;
      remove.onclick=()=>vscode.postMessage({type:'regexList',action:'remove',path:base.concat('matches_regex'),index:f.path.at(-1),revision:current.revision,version:current.version});
      entry.append(remove);regex.append(entry)
    }
    const add=document.createElement('div');add.className='require-regex-add';
    const pattern=document.createElement('input');pattern.type='text';pattern.placeholder='New regex pattern';pattern.setAttribute('aria-label','New regex pattern');
    const addButton=document.createElement('button');addButton.type='button';addButton.textContent='+ Add pattern';addButton.disabled=true;
    pattern.oninput=()=>{addButton.disabled=!pattern.value.trim()};
    addButton.onclick=()=>vscode.postMessage({type:'regexList',action:'add',path:base.concat('matches_regex'),value:pattern.value,revision:current.revision,version:current.version});
    add.append(pattern,addButton);regex.append(add);
    section.append(regex)
  }
  const expected=new Set([...meta,...visible.filter(f=>f.path.length===base.length+2&&f.path[base.length]==='matches_regex')].map(f=>key(f.path)));
  const extra=visible.filter(f=>!expected.has(key(f.path)));
  if(extra.length){const details=document.createElement('details');details.className='require-advanced';
    const heading=document.createElement('summary');heading.textContent='Additional field conditions ('+extra.length+')';details.append(heading,compactGrid(extra));section.append(details)}
  return section
}
function requireInspector(path){
  const requirement=requireDefinition(path),panel=document.createElement('div');
  if(!requirement||typeof requirement!=='object'){return groupedForm(path)}
  const intro=document.createElement('p');intro.className='require-intro';
  intro.textContent='This Test passes only when collected evidence satisfies the authored Item and field conditions. No system evaluation occurs in this editor.';panel.append(intro);
  const all=editorFields(path);
  const item=requirement.item_requirement||{},field=requirement.field_requirement||{};
  const itemFields=all.filter(f=>hasPrefix(f.path,path.concat('item_requirement')));
  const fieldFields=all.filter(f=>hasPrefix(f.path,path.concat('field_requirement')));
  panel.append(requireSection('1. Item requirements','Items found: '+cardinalityWords(item.items_found)+'; Items satisfying: '+cardinalityWords(item.items_satisfying)+'.',itemFields));
  if(requirement.field_requirement)panel.append(requireSection('2. Field-value requirements','Field values found: '+cardinalityWords(field.values_found)+'; Values matching: '+cardinalityWords(field.values_matching)+'.',fieldFields));
  const plans=predicatePlan(requirement);
  if(plans.length){const group=document.createElement('section');group.className='require-section';
    const title=document.createElement('h2');title.textContent='3. Field conditions';group.append(title);
    const guide=document.createElement('p');guide.className='hint';guide.textContent='These are the conditions applied to collected evidence fields.';group.append(guide);
    const fields=document.createElement('div');fields.className='require-fields';plans.forEach(p=>fields.append(fieldCheckCard(path,p)));group.append(fields);panel.append(group)}
  const handled=new Set([...itemFields,...fieldFields,...all.filter(f=>plans.some(p=>hasPrefix(f.path,path.concat('fields',p.name))))].map(f=>key(f.path)));
  const other=all.filter(f=>!handled.has(key(f.path)));
  if(other.length){const details=document.createElement('details');details.className='require-advanced';const summary=document.createElement('summary');summary.textContent='Advanced / other conditions ('+other.length+')';details.append(summary,compactGrid(other));panel.append(details)}
  if(!plans.length&&!itemFields.length&&!fieldFields.length)panel.append(groupedForm(path));
  return panel
}


function sharedObjectDefinition(path){
  return path.length===3&&path[1]==='shared_objects' ? current?.sharedObjectDefinitions?.[path[2]] : undefined
}
function sharedObjectUsage(id){
  const tests=new Set();
  for(const f of current?.fields||[]){
    if(f.value!==id||f.path[1]!=='tests'||f.path.at(-1)!=='object_ref')continue;
    if(typeof f.path[2]==='string')tests.add(f.path[2])
  }
  return [...tests]
}
function sharedObjectInspector(path){
  const definition=sharedObjectDefinition(path);
  const section=document.createElement('section');section.className='shared-object-inspector';
  if(!definition||typeof definition!=='object'){
    const error=document.createElement('p');error.className='shared-object-warning';
    error.textContent='No Shared Object definition is present at this path. Review the YAML source.';section.append(error);return section
  }
  const intro=document.createElement('p');intro.className='shared-object-explanation';
  intro.textContent='A Shared Object defines reusable evidence collection: its capability determines what can be collected, and its selectors identify which Items to retrieve. Tests reference the Object by ID; declaring it alone does not execute collection.';
  section.append(intro);
  const validId=/^[a-z0-9]+(?:-[a-z0-9]+)*-object$/.test(String(path[2]))&&String(path[2]).length<=64;
  if(!validId){const warning=document.createElement('p');warning.className='shared-object-warning';
    warning.textContent='Invalid Object ID: "'+String(path[2])+'". Shared Object names must end in -object. Right-click this node, choose Rename key, and use a valid ID.';section.append(warning)}
  if(!Object.prototype.hasOwnProperty.call(definition,'object_title')){
    const warning=document.createElement('p');warning.className='shared-object-warning';
    warning.textContent='Missing required object_title. This Object was created by an incomplete authoring flow and is not schema-valid yet.';section.append(warning)
  }
  const controls=editorFields(path);
  if(controls.length)section.append(compactGrid(controls,'object-fields'));
  const selectorFields=Object.keys(definition).filter(k=>!['object_title','capability','filters','set'].includes(k));
  const explanatory=document.createElement('p');explanatory.className='shared-object-explanation';
  explanatory.textContent=selectorFields.length?selectorFields.length+' authored selector'+(selectorFields.length===1?'':'s')+': '+selectorFields.join(', ')+'.':'No selectors are authored. Add the capability-specific selector(s) required to identify collected Items.';
  section.append(explanatory);
  const actions=document.createElement('div');actions.className='shared-object-actions';
  const add=document.createElement('button');add.type='button';
  add.textContent=Object.prototype.hasOwnProperty.call(definition,'object_title')?'+ Add selector':'Add required title';
  add.disabled=!validId;
  add.title=validId?'Add the next schema-supported selector or repair a missing Object title':'Rename this Shared Object to a valid -object ID first';
  add.onclick=()=>vscode.postMessage({type:'structural',action:'add',path,revision:current?.revision,version:current?.version});
  actions.append(add);
  if(!validId){const rename=document.createElement('button');rename.type='button';rename.textContent='Rename Object ID';rename.title='Choose a valid ID ending in -object';rename.onclick=()=>vscode.postMessage({type:'structural',action:'rename',path,revision:current?.revision,version:current?.version});actions.append(rename)}
  section.append(actions);
  const users=sharedObjectUsage(path[2]);
  const usage=document.createElement('p');usage.className='shared-object-usage';
  usage.textContent=users.length?'Referenced by Test'+(users.length===1?' ':'s ')+users.join(', ')+'.':'No Test currently references this Shared Object. A Test must use its object_ref ID to collect evidence from it.';
  section.append(usage);
  return section
}

function groupedForm(path){const fields=editorFields(path);const card=document.createElement('section');card.className='property-card';if(!fields.length){const p=document.createElement('p');p.textContent='No authored fields in this section. Right-click the tree node to add a supported child or reveal YAML.';card.append(p);return card}if(path.length===1||path.at(-1)==='object'||path.length===3&&path[1]==='tests'){card.append(compactGrid(fields,path.at(-1)==='object'?'object-fields':undefined));return card}const groups=new Map();for(const item of fields){const group=String(item.path[path.length]);const list=groups.get(group)||[];list.push(item);groups.set(group,list)}for(const [group,items] of groups){const details=document.createElement('details');details.className='group-section';details.open=path.at(-1)==='require'||items.length<=3;const summary=document.createElement('summary');summary.textContent=human(group);details.append(summary,compactGrid(items));card.append(details)}return card}
function renderCenter(){const root=$('center');root.replaceChildren();if(!current?.ok){const error=document.createElement('div');error.className='empty error';error.textContent=current?.error||'Graphical model unavailable; use native YAML Source.';root.append(error);return}const selectedExpr=evaluationSelection(selectedPath);const linkedPath=testPathForSelection(selectedPath);const editPath=linkedPath||selectedPath;const crumb=document.createElement('div');crumb.className='crumb';const chosen=(current?.assessment?.tests||[]).find(t=>t.id===editPath[2]);crumb.textContent=selectedExpr?'Evaluate / '+(selectedExpr.label||'Expression'):(editPath.length>2&&editPath[1]==='tests'?'Tests / '+(chosen?.title||editPath[2])+(editPath.length>3?' / '+human(editPath.at(-1)):''):editPath.length>1?'Assessment / '+human(editPath.at(-1)):'' );const heading=document.createElement('div');heading.className='inspector-header';const title=document.createElement('h1');title.textContent=linkedPath?(editPath.length===3?'Test — '+linkedPath[2]:editPath.at(-1)==='object'?'Object — inspected items':editPath.at(-1)==='require'?'Require — pass conditions':labelFor(editPath)):selectedExpr?selectedExpr.label:editPath.length===1?'Assessment metadata':editPath.length===3&&editPath[1]==='tests'?'Test overview':editPath.at(-1)==='require'?'Require — pass conditions':editPath.at(-1)==='object'?'Object — inspected items':labelFor(editPath);heading.append(title);const isTestOverview=editPath.length===3&&editPath[1]==='tests';if((!selectedExpr||linkedPath)&&!isTestOverview&&!isCollection(editPath))heading.append(viewToggle(editPath));root.append(crumb,heading);if(selectedExpr&&!linkedPath)root.append(renderEvalOverview(selectedExpr));else if(selectedPath[1]==='unreferenced_tests'&&selectedPath.length===2){const note=document.createElement('p');note.className='hint';note.textContent='These authored Tests have no Evaluate reference and do not contribute to the Assessment result. Select a Test below to inspect it, or use YAML to attach an explicit reference.';root.append(note)}else if(isCollection(editPath))root.append(collectionOverview(editPath));else{if(!isTestOverview)root.append(defaultsSummary(editPath));root.append(variableDefinition(editPath)?variableInspector(editPath):sharedObjectDefinition(editPath)?sharedObjectInspector(editPath):requireDefinition(editPath)?requireInspector(editPath):isTestOverview?testOverview(editPath):groupedForm(editPath))}const source=document.createElement('button');source.className='source-link';source.textContent=linkedPath?'Reveal Test definition in YAML':'Reveal in YAML';source.onclick=()=>vscode.postMessage({type:'selectPath',path:linkedPath||selectedPath});root.append(source)}

function renderHelp(focused){const first=focused||editorFields(testPathForSelection(selectedPath)||selectedPath)[0];$('helpContent').replaceChildren();const title=document.createElement('p');const strong=document.createElement('strong');strong.textContent=first?friendlyLabel(first):labelFor(selectedPath);title.append(strong);$('helpContent').append(title);const desc=document.createElement('p');desc.textContent=first?.description||'Focus a field to see its schema definition and allowed options.';$('helpContent').append(desc);const choices=(first?.choices||[]).map(String);if(choices.length){const allowed=document.createElement('p');allowed.textContent='Allowed: '+choices.slice(0,16).join(', ')+(choices.length>16?' …':'');$('helpContent').append(allowed)}const tech=document.createElement('details');tech.className='help-tech';const heading=document.createElement('summary');heading.textContent='Technical YAML path';const code=document.createElement('code');code.textContent=pathText(first?.path||selectedPath);tech.append(heading,code);$('helpContent').append(tech);$('diagnosticSummary').textContent=current?.diagnostics?.length?current.diagnostics.join(' · '):'Schema diagnostics appear here. No scanner result is inferred.';$('pinSummary').textContent=(current?.schemaVersion?('SCAP-NG '+current.schemaVersion):'Pinned metadata')+' · '+(current?.packSha256?'verified offline pack':'pack status unavailable')}
function escapeText(value){const div=document.createElement('div');div.textContent=String(value??'');return div.innerHTML}
function menuItems(path){
  const navigationPath=path;path=testPathForSelection(navigationPath)||path;
  const last=String(path.at(-1)||'');
  const items=[];
  const named=path[0]==='assessment'&&path.length===3&&
    ['tests','variables','inputs','shared_objects'].includes(path[1]);
  const entity=path[1]==='tests'?'Test':path[1]==='variables'?'Variable':
    path[1]==='inputs'?'Organizational Input':path[1]==='shared_objects'?'Shared Object':'';
  if(path.length===2&&last==='tests')items.push({label:'Add Test',action:'add'});
  else if(path.length===2&&last==='variables')items.push({label:'Add Variable',action:'add'});
  else if(path.length===2&&last==='inputs')items.push({label:'Add Organizational Input',action:'add'});
  else if(path.length===2&&last==='shared_objects')items.push({label:'Add Shared Object',action:'add'});
  else if(named&&last&&path[1]==='shared_objects')items.push({label:'Add Object selector / required title',action:'add'});
  else if(last==='object'&&path[1]==='tests')items.push({label:'Add Object selector',action:'add'});
  // Do not advertise generic child/Set/Require insertion until those actions
  // are schema-qualified. They formerly inserted a null "new-property".
  if(named){
    items.push({label:'Duplicate '+entity,action:'duplicate'});
    items.push({label:'Rename '+entity+' ID',action:'rename'});
    items.push({label:'Remove '+entity,action:'remove'});
  }
  items.push({separator:true});
  items.push({label:'Reveal in YAML',action:'reveal'});
  return items
}
function showMenu(path,x,y){menuPath=path.slice();const menu=$('menu');menu.replaceChildren();menuItems(path).forEach(item=>{if(item.separator){const sep=document.createElement('div');sep.className='separator';menu.append(sep);return}const b=document.createElement('button');b.textContent=item.label;b.setAttribute('role','menuitem');b.onclick=()=>{const target=menuPath?.slice();hideMenu();vscode.postMessage({type:'structural',action:item.action,path:testPathForSelection(target)||target,revision:current?.revision,version:current?.version})};menu.append(b)});menu.style.left=Math.min(x,innerWidth-205)+'px';menu.style.top=Math.min(y,innerHeight-menu.offsetHeight-12)+'px';menu.classList.remove('hidden');menu.querySelector('button')?.focus()}
function hideMenu(){menuPath=null;const menu=$('menu');menu.classList.add('hidden')}document.addEventListener('click',e=>{if(!e.target.closest('#menu,.node'))hideMenu()});$('openSource').onclick=()=>vscode.postMessage({type:'openSource'});$('helpSource').onclick=()=>vscode.postMessage({type:'selectPath',path:testPathForSelection(selectedPath)||selectedPath});$('toggleHelp').onclick=()=>{helpOpen=!helpOpen;document.querySelector('.workspace').classList.toggle('help-collapsed',!helpOpen);$('helpPane').classList.toggle('open',helpOpen);$('toggleHelp').textContent=helpOpen?'Hide help':'Show help';$('toggleHelp').setAttribute('aria-expanded',String(helpOpen))};window.addEventListener('message',e=>{const m=e.data;if(m.type==='model')render(m.model);if(m.type==='selectGraphical'&&Array.isArray(m.path)){treeModel();selectedPath=visiblePathForSource(m.path);revealPath(selectedPath);renderTree();renderCenter();renderHelp()}if(m.type==='error'){$('status').className='error';$('status').textContent=m.message||'Graphical edit failed'}if(m.type==='status'){$('status').textContent=m.message||''}});function render(model){current=model;$('fileName').textContent=model?.sourceName||'SCAP-NG Assessment';const tree=treeModel();if(!tree.meaningful.has(key(selectedPath))){selectedPath=visiblePathForSource(selectedPath);if(!tree.meaningful.has(key(selectedPath)))selectedPath=['assessment'];}revealPath(selectedPath);renderTree();renderCenter();renderHelp()}$('helpPane').classList.add('open');try{vscode.postMessage({type:'ready'});}catch(error){reportWebviewError(error?.stack||error?.message||error)}
</script></body></html>`;
}
