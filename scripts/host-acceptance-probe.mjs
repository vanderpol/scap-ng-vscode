import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { MetadataPack } from '../dist/metadata.js';
import { GuidedCatalog } from '../dist/guided.js';

const packDir = process.env.SCAP_NG_METADATA_PACK;
const sampleRoot = process.env.SCAP_NG_SAMPLE_ROOT;
const code = process.env.VSCODE_BIN ?? 'code';
const extensionPath = resolve(process.env.SCAP_NG_EXTENSION_PATH ?? process.cwd());
if (!packDir || !sampleRoot) throw new Error('SCAP_NG_METADATA_PACK and SCAP_NG_SAMPLE_ROOT are required');
const pin = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(packDir, pin);
const catalog = new GuidedCatalog(pack);
const sample = resolve(sampleRoot, 'fixtures/current-v04/windows-server-2025-lock-screen.assessment.yaml');
const source = readFileSync(sample, 'utf8');
const lineChecks = (key) => {
  const lines = source.split(/\r?\n/); const line = lines.findIndex(value => value.includes(`${key}:`));
  if (line < 0) throw new Error(`Probe key not found: ${key}`);
  const character = lines[line].indexOf(`${key}:`) + key.length + 1;
  return { key, line, character };
};
const checks = ['class', 'mode', 'capability', 'items_found', 'items_satisfying', 'values_found', 'values_matching'].map(lineChecks);
const expected = {
  class: catalog.classes().map(option => option.value),
  mode: catalog.modes().map(option => option.value),
  capability: catalog.capabilities().map(option => option.value),
  items_found: catalog.itemFound().map(option => option.value),
  items_satisfying: catalog.itemsSatisfying().map(option => option.value),
  values_found: catalog.fieldValuesFound().map(option => option.value),
  values_matching: catalog.fieldValuesMatching().map(option => option.value)
};
const schema = pack.manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/assessment.schema.json'));
const workspace = mkdtempSync(join(tmpdir(), 'scap-ng-host-'));
const helper = join(workspace, 'probe-extension'); mkdirSync(helper);
const output = join(workspace, 'receipt.json');
const settings = {
  'scapNg.schemaPackPath': resolve(packDir),
  'yaml.schemas': { [pathToFileURL(resolve(pack.resourcePath(schema.uri))).toString()]: ['**/*.assessment.yaml', '**/*.assessment.yml'] }
};
mkdirSync(join(workspace, '.vscode')); writeFileSync(join(workspace, '.vscode', 'settings.json'), JSON.stringify(settings));
writeFileSync(join(helper, 'package.json'), JSON.stringify({ name: 'scap-ng-host-probe', version: '0.0.1', publisher: 'probe', engines: { vscode: '^1.90.0' }, main: './extension.js', activationEvents: ['*'] }));
const helperSource = `const vscode=require('vscode'); const fs=require('fs');
exports.activate=()=>setTimeout(async()=>{try{const uri=vscode.Uri.file(${JSON.stringify(sample)});const doc=await vscode.workspace.openTextDocument(uri);await vscode.commands.executeCommand('vscode.openWith',uri,'default',vscode.ViewColumn.One);const checks=${JSON.stringify(checks)};const completions={};for(const c of checks){const list=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',uri,new vscode.Position(c.line,c.character));completions[c.key]=(list?.items||[]).map(item=>({label:typeof item.label==='string'?item.label:item.label?.label,insertText:typeof item.insertText==='string'?item.insertText:item.insertText?.value,detail:item.detail||''}));}const hover=await vscode.commands.executeCommand('vscode.executeHoverProvider',uri,new vscode.Position(${checks[0].line},${checks[0].character}));const diagnostics=vscode.languages.getDiagnostics(uri).map(value=>({message:value.message,severity:value.severity}));const schemas=vscode.workspace.getConfiguration('yaml').get('schemas');fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({languageId:doc.languageId,redhatYaml:Boolean(vscode.extensions.getExtension('redhat.vscode-yaml')),completions,hoverCount:hover?.length||0,diagnostics,schemaAssociations:schemas},null,2));await vscode.commands.executeCommand('workbench.action.closeWindow');}catch(error){fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(error),stack:error.stack},null,2));}},1500);`;
writeFileSync(join(helper, 'extension.js'), helperSource);
const args = ['--no-sandbox', '--disable-gpu', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', '--new-window', '--user-data-dir', join(workspace, 'user-data'), '--extensionDevelopmentPath', helper, '--extensionDevelopmentPath', extensionPath, workspace];
const child = spawn(code, args, { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, VSCODE_IPC_HOOK: undefined, VSCODE_IPC_HOOK_CLI: undefined, VSCODE_PID: undefined } });
const deadline = Date.now() + Number(process.env.SCAP_NG_HOST_TIMEOUT ?? 60000);
while (Date.now() < deadline && !readFileSyncSafe(output)) await new Promise(resolveWait => setTimeout(resolveWait, 500));
child.kill('SIGTERM');
await new Promise(resolveExit => { const timer = setTimeout(resolveExit, 5000); child.once('exit', () => { clearTimeout(timer); resolveExit(); }); });
const receipt = readFileSyncSafe(output) ?? { error: 'VS Code host timed out' };
const failures = [];
if (receipt.error) failures.push(receipt.error);
if (!receipt.redhatYaml) failures.push('redhat.vscode-yaml is not installed; Red Hat language-service acceptance is unavailable');
for (const check of checks) {
  const got = (receipt.completions?.[check.key] ?? []).map(item => item.label).filter(Boolean);
  if (JSON.stringify([...new Set(got)].sort()) !== JSON.stringify([...new Set(expected[check.key])].sort())) failures.push(`${check.key}: completion set mismatch`);
}
if (!receipt.hoverCount) failures.push('no YAML hover provider returned documentation');
console.log(JSON.stringify({ expected, actual: receipt, failures }, null, 2));
if (failures.length) process.exitCode = 1;
try { rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch (error) { console.error(`Host probe cleanup deferred: ${error.message}`); }
function readFileSyncSafe(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } }
