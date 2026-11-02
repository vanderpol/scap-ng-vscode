import * as vscode from 'vscode';
import { parseDocument } from 'yaml';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MetadataPack, type Pin } from './metadata.js';

const profilePath = (root: string) => join(root, 'schema-profile.json');

class StudioNode extends vscode.TreeItem {
  constructor(label: string, state = vscode.TreeItemCollapsibleState.None, contextValue?: string) {
    super(label, state); this.contextValue = contextValue;
  }
}
class StudioTree implements vscode.TreeDataProvider<StudioNode> {
  getTreeItem(node: StudioNode) { return node; }
  getChildren(node?: StudioNode) {
    if (!node) return [
      new StudioNode('STIG Library', vscode.TreeItemCollapsibleState.Collapsed, 'stig-library'),
      new StudioNode('Assessment Library', vscode.TreeItemCollapsibleState.Collapsed, 'assessment-library')
    ];
    return [new StudioNode('No indexed documents yet')];
  }
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
function validateDocument(document: vscode.TextDocument, profile: Pin, diagnostics: vscode.DiagnosticCollection) {
  const parsed = parseDocument(document.getText(), { uniqueKeys: true });
  const output: vscode.Diagnostic[] = [];
  for (const error of parsed.errors) {
    const line = error.pos?.[0] ?? 0;
    output.push(new vscode.Diagnostic(new vscode.Range(line, 0, line, 1), error.message, vscode.DiagnosticSeverity.Error));
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
  if (configuredPack) {
    try { new MetadataPack(configuredPack, profile); }
    catch (error) { void vscode.window.showWarningMessage(`SCAP-NG metadata pack rejected: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const tree = new StudioTree();
  const diagnostics = vscode.languages.createDiagnosticCollection('scap-ng');
  context.subscriptions.push(diagnostics, vscode.window.registerTreeDataProvider('scapNg.assessmentStudio', tree), vscode.window.registerWebviewViewProvider('scapNg.pinView', new PinView(context)));
  context.subscriptions.push(vscode.commands.registerCommand('scapNg.showPin', () => vscode.window.showInformationMessage(`SCAP-NG ${profile.schemaVersion} · ${profile.sourceCommit}`)));
  const inspect = (document: vscode.TextDocument) => { if (document.languageId === 'yaml' || /\.(ya?ml)$/.test(document.uri.fsPath)) validateDocument(document, profile, diagnostics); };
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(inspect), vscode.workspace.onDidSaveTextDocument(inspect));
}
export function deactivate() { /* no network, telemetry or scanner process */ }
