import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const code = process.env.VSCODE_BIN ?? 'code';
const extensionPath = resolve(process.env.SCAP_NG_EXTENSION_PATH ?? process.cwd());
const packDir = process.env.SCAP_NG_METADATA_PACK ? resolve(process.env.SCAP_NG_METADATA_PACK) : undefined;
const sampleRoot = process.env.SCAP_NG_SAMPLE_ROOT ? resolve(process.env.SCAP_NG_SAMPLE_ROOT) : undefined;
const useInstalled = process.env.SCAP_NG_USE_INSTALLED === '1';
const workspace = mkdtempSync(join(tmpdir(), 'scap-ng-status-host-'));
const helper = join(workspace, 'probe-extension'); mkdirSync(helper);
const document = join(workspace, packDir ? 'installed-status.assessment.yaml' : 'no-pack.assessment.yaml');
const output = join(workspace, 'receipt.json');
let documentSource = 'assessment:\n  class: vulnerability\n';
if (packDir && sampleRoot) { try { documentSource = readFileSync(join(sampleRoot, 'fixtures/current-v04/windows-server-2025-lock-screen.assessment.yaml'), 'utf8'); } catch { /* healthy-mode probe falls back to minimal evidence */ } }
writeFileSync(document, documentSource);
if (packDir) { mkdirSync(join(workspace, '.vscode')); writeFileSync(join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'scapNg.schemaPackPath': packDir })); }
writeFileSync(join(helper, 'package.json'), JSON.stringify({ name: 'scap-ng-status-probe', version: '0.0.1', publisher: 'probe', engines: { vscode: '^1.90.0' }, main: './extension.js', activationEvents: ['*'] }));
writeFileSync(join(helper, 'extension.js'), `const vscode=require('vscode'); const fs=require('fs'); exports.activate=()=>setTimeout(async()=>{try{const uri=vscode.Uri.file(${JSON.stringify(document)});const doc=await vscode.workspace.openTextDocument(uri);await vscode.window.showTextDocument(doc);await new Promise(resolve=>setTimeout(resolve,5000));const status=await vscode.commands.executeCommand('scapNg.showYamlStatus');const ordinaryUri=vscode.Uri.file(${JSON.stringify(join(workspace, 'ordinary.yaml'))});fs.writeFileSync(${JSON.stringify(join(workspace, 'ordinary.yaml'))},'name: ordinary\\n');const ordinary=await vscode.workspace.openTextDocument(ordinaryUri);await vscode.window.showTextDocument(ordinary);const ordinaryStatus=await vscode.commands.executeCommand('scapNg.showYamlStatus');await vscode.window.showTextDocument(doc);const restoredStatus=await vscode.commands.executeCommand('scapNg.showYamlStatus');fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(${packDir ? '{status,ordinaryStatus,restoredStatus}' : 'status'},null,2));await vscode.commands.executeCommand('workbench.action.closeWindow');}catch(error){fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(error),stack:error.stack},null,2));}},3000);`);
const args = ['--no-sandbox', '--disable-gpu', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', '--new-window', '--user-data-dir', join(workspace, 'user-data'), '--extensionDevelopmentPath', helper, ...(useInstalled ? [] : ['--extensionDevelopmentPath', extensionPath]), workspace];
const child = spawn(code, args, { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, VSCODE_IPC_HOOK: undefined, VSCODE_IPC_HOOK_CLI: undefined, VSCODE_PID: undefined } });
const stop = signal => { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } };
const deadline = Date.now() + Number(process.env.SCAP_NG_HOST_TIMEOUT ?? 60000);
const read = () => { try { return JSON.parse(readFileSync(output, 'utf8')); } catch { return undefined; } };
while (Date.now() < deadline && !read()) await new Promise(resolve => setTimeout(resolve, 500));
stop('SIGTERM'); await new Promise(resolve => { const timer = setTimeout(resolve, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); }); stop('SIGKILL');
const receipt = read();
if (!receipt) throw new Error('VS Code host timed out without status receipt');
console.log(JSON.stringify(receipt, null, 2));
if (packDir) {
  if (receipt.status?.state !== 'healthy' || receipt.status?.visible !== true || receipt.status?.associationPresent !== true || receipt.status?.schemaVersion !== '0.4.0' || !receipt.status?.buildId || !receipt.status?.builtAt || !receipt.status?.sourceCommit || !receipt.status?.packPath || !receipt.status?.redhatInstalled || !receipt.status?.redhatActive || receipt.ordinaryStatus !== undefined || receipt.restoredStatus?.state !== 'healthy') process.exit(1);
} else if (receipt.state !== 'error' || receipt.visible !== true || receipt.associationPresent !== false) process.exit(1);
