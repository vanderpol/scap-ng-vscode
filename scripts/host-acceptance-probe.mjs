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
const hostDelay = Number(process.env.SCAP_NG_HOST_DELAY ?? 5000);
const languageServerDelay = Number(process.env.SCAP_NG_LANGUAGE_SERVER_DELAY ?? 10000);
if (!packDir || !sampleRoot) throw new Error('SCAP_NG_METADATA_PACK and SCAP_NG_SAMPLE_ROOT are required');
const pin = JSON.parse(readFileSync(process.env.SCAP_NG_PROFILE_PATH ?? new URL('../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(packDir, pin);
const catalog = new GuidedCatalog(pack);
const sample = resolve(sampleRoot, 'fixtures/current-v04/windows-server-2025-lock-screen.assessment.yaml');
const source = readFileSync(sample, 'utf8');
const fixtureRoot = resolve(process.env.SCAP_NG_P0_FIXTURE_ROOT ?? 'test/fixtures');
const canonicalInputs = {
  windowsRegistry: sample,
  unixFile: join(fixtureRoot, 'p0-unix-file.assessment.yaml'),
  multipleTests: join(fixtureRoot, 'p0-multiple-tests.assessment.yaml')
};
const schema = pack.manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/assessment.schema.json'));
if (!schema) throw new Error('Pinned assessment schema is not present in the metadata pack');

const expected = {
  class: catalog.classes().map(option => option.value),
  mode: catalog.modes().map(option => option.value),
  capability: catalog.capabilities().map(option => option.value),
  items_found: catalog.itemFound().map(option => option.value),
  items_satisfying: catalog.itemsSatisfying().map(option => option.value),
  values_found: catalog.fieldValuesFound().map(option => option.value),
  values_matching: catalog.fieldValuesMatching().map(option => option.value)
};
const capabilitySchema = pack.resource(pack.manifest.capabilities['windows.registry'].schema_uri);
const expectedObjectFields = Object.keys(capabilitySchema.$defs?.object?.properties ?? {});

function check(text, key, occurrence = 0) {
  const lines = text.split(/\r?\n/);
  const matches = lines.flatMap((line, lineNumber) => {
    const index = line.indexOf(`${key}:`);
    return index < 0 ? [] : [{ key, line: lineNumber, character: index + key.length + 2 }];
  });
  if (!matches[occurrence]) throw new Error(`Probe key not found: ${key} #${occurrence}`);
  if (matches[occurrence]) matches[occurrence].character = Math.min(matches[occurrence].character, lines[matches[occurrence].line].length);
  return matches[occurrence];
}
function checks(text) {
  return ['class', 'mode', 'capability', 'items_found', 'items_satisfying', 'values_found', 'values_matching'].map(key => check(text, key));
}

const workspace = mkdtempSync(join(tmpdir(), 'scap-ng-host-'));
const helper = join(workspace, 'probe-extension'); mkdirSync(helper);
const output = join(workspace, 'receipt.json');
const validDocument = join(workspace, 'windows-server-2025-lock-screen.assessment.yaml');
const blockDocument = join(workspace, 'incomplete-block.assessment.yaml');
const flowDocument = join(workspace, 'incomplete-flow.assessment.yaml');
const objectDocument = join(workspace, 'incomplete-object.assessment.yaml');
const invalidDocument = join(workspace, 'invalid.assessment.yaml');
const typingDocument = join(workspace, 'typing.assessment.yaml');
const unique = (text, suffix) => text.replace('windows-server-2025-shows-on-lock-screen-sv-278080-assessment', `host-probe-${suffix}-assessment`);
const incomplete = source
  .replace('mode: automated', 'mode: ')
  .replace('class: compliance', 'class: ')
  .replace('capability: windows.registry', 'capability: ')
  .replaceAll('items_found: one_or_more', 'items_found: ')
  .replaceAll('items_satisfying: every', 'items_satisfying: ')
  .replaceAll('values_found: one_or_more', 'values_found: ')
  .replaceAll('values_matching: every', 'values_matching: ');
const blockIncomplete = incomplete
  .replace('item_requirement: {items_found: , items_satisfying: }', 'item_requirement:\n          items_found:\n          items_satisfying:')
  .replace('field_requirement: {values_found: , values_matching: }', 'field_requirement:\n          values_found:\n          values_matching:');
const flowIncomplete = incomplete;
const objectIncomplete = unique(source.replace(/object: \{hive:.*?NoLockScreenSlideshow\}\}/, 'object: {'), 'object');
const invalid = unique(source.replace('class: compliance', 'class: definitely-not-a-schema-value'), 'invalid');
writeFileSync(validDocument, source);
writeFileSync(blockDocument, unique(blockIncomplete, 'block'));
writeFileSync(flowDocument, unique(flowIncomplete, 'flow'));
writeFileSync(objectDocument, objectIncomplete);
writeFileSync(invalidDocument, invalid);
const canonicalDocuments = Object.fromEntries(Object.entries(canonicalInputs).map(([name, input]) => { if (name === 'windowsRegistry') return [name, validDocument]; const target = join(workspace, `${name}.assessment.yaml`); writeFileSync(target, readFileSync(input, 'utf8')); return [name, target]; }));
writeFileSync(typingDocument, unique(blockIncomplete.replace('class: ', 'class: c'), 'typing'));
const settings = {
  // Supported Red Hat YAML extension integration; no schema server is bundled
  // or reached over the network by this probe.
  'scapNg.schemaPackPath': resolve(packDir),
  'yaml.schemas': { [pathToFileURL(resolve(pack.resourcePath(schema.uri))).toString()]: ['**/*.assessment.yaml', '**/*.assessment.yml'] },
  '[yaml]': { 'editor.wordBasedSuggestions': 'off' },
  'yaml.trace.server': 'verbose'
};
mkdirSync(join(workspace, '.vscode')); writeFileSync(join(workspace, '.vscode', 'settings.json'), JSON.stringify(settings));
writeFileSync(join(helper, 'package.json'), JSON.stringify({ name: 'scap-ng-host-probe', version: '0.0.1', publisher: 'probe', engines: { vscode: '^1.90.0' }, main: './extension.js', activationEvents: ['*'] }));
const allChecks = { block: checks(blockIncomplete), flow: checks(flowIncomplete) };
const helperSource = `const vscode=require('vscode'); const fs=require('fs');
const files=${JSON.stringify({ validDocument, blockDocument, flowDocument, objectDocument, invalidDocument, typingDocument, canonicalDocuments })};
const checks=${JSON.stringify(allChecks)};
const expectedClass=${JSON.stringify(expected.class[0])};
const expectedSource=${JSON.stringify(source)};
function itemText(item){return typeof item.insertText==='string'?item.insertText:item.insertText?.value||item.textEdit?.newText||item.additionalTextEdits?.[0]?.newText||'';}
function itemLabel(item){return typeof item.label==='string'?item.label:item.label?.label;}
async function completion(uri, point){const list=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',uri,new vscode.Position(point.line,point.character));return (list?.items||[]).map(item=>({label:itemLabel(item),insertText:itemText(item),detail:item.detail||'',kind:item.kind}));}
async function insert(uri, point, label){const list=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',uri,new vscode.Position(point.line,point.character));const item=(list?.items||[]).find(value=>itemLabel(value)===label);if(!item) return {found:false};const edit=new vscode.WorkspaceEdit();const range=item.textEdit?.range||item.range||new vscode.Range(point.line,point.character,point.line,point.character);edit.replace(uri,range,itemText(item));const applied=await vscode.workspace.applyEdit(edit);const document=await vscode.workspace.openTextDocument(uri);return {found:true,applied,text:itemText(item),line:document.lineAt(point.line).text};}
function hoverText(values){return (values||[]).flatMap(value=>Array.isArray(value.contents)?value.contents:[value.contents]).map(value=>typeof value==='string'?value:value?.value||'').join('\\n');}
function diagnostic(value){return {message:value.message,severity:value.severity,source:value.source||''};}
exports.activate=()=>setTimeout(async()=>{try{
 const valid=vscode.Uri.file(files.validDocument), block=vscode.Uri.file(files.blockDocument), flow=vscode.Uri.file(files.flowDocument), object=vscode.Uri.file(files.objectDocument), invalid=vscode.Uri.file(files.invalidDocument), typing=vscode.Uri.file(files.typingDocument);
 const validDoc=await vscode.workspace.openTextDocument(valid); await vscode.window.showTextDocument(valid,vscode.ViewColumn.One);
 await new Promise(resolve=>setTimeout(resolve,${languageServerDelay}));
 const blockDoc=await vscode.workspace.openTextDocument(block), flowDoc=await vscode.workspace.openTextDocument(flow), objectDoc=await vscode.workspace.openTextDocument(object), invalidDoc=await vscode.workspace.openTextDocument(invalid), typingDoc=await vscode.workspace.openTextDocument(typing);
 await vscode.window.showTextDocument(blockDoc,vscode.ViewColumn.Two);
 const blockCompletions={},flowCompletions={};for(const point of checks.block)blockCompletions[point.key]=await completion(block,point);for(const point of checks.flow)flowCompletions[point.key]=await completion(flow,point);
 const objectPoint={line:objectDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('object: {')),character:objectDoc.getText().split(/\\r?\\n/).find(line=>line.includes('object: {')).length};
 const objectCompletions=await completion(object,objectPoint);
 const typingLine=typingDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('class: c'));
 const typingPoint={line:typingLine,character:typingDoc.lineAt(typingLine).text.length};
 const naturalTyping=await completion(typing,typingPoint);
 const insertion=await insert(block,checks.block.find(point=>point.key==='class'),expectedClass);
 await new Promise(resolve=>setTimeout(resolve,1000));
 const hover=await vscode.commands.executeCommand('vscode.executeHoverProvider',valid,new vscode.Position(${checks(source).find(point=>point.key==='class').line},${checks(source).find(point=>point.key==='class').character}));
 const canonicalReceipts={};for(const [name,file] of Object.entries(files.canonicalDocuments)){const uri=vscode.Uri.file(file),doc=await vscode.workspace.openTextDocument(uri);canonicalReceipts[name]={languageId:doc.languageId,testCount:(doc.getText().match(/^    [^ ]+-test:/gm)||[]).length,capabilities:[...doc.getText().matchAll(/^\\s+capability:\\s*([^\\s#},]+)/gm)].map(match=>match[1]),diagnostics:vscode.languages.getDiagnostics(uri).map(diagnostic)};}
 const validDiagnostics=vscode.languages.getDiagnostics(valid).map(diagnostic),invalidDiagnostics=vscode.languages.getDiagnostics(invalid).map(diagnostic);
 const schemas=vscode.workspace.getConfiguration('yaml').get('schemas');
 fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({languageId:validDoc.languageId,sourcePreserved:validDoc.getText()===expectedSource,redhatYaml:Boolean(vscode.extensions.getExtension('redhat.vscode-yaml')),blockCompletions,flowCompletions,objectCompletions,naturalTyping,canonicalReceipts,insertion,hoverCount:hover?.length||0,hoverText:hoverText(hover),validDiagnostics,invalidDiagnostics,schemaAssociations:schemas},null,2));
 await vscode.commands.executeCommand('workbench.action.closeWindow');
 }catch(error){fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(error),stack:error.stack},null,2));}},${hostDelay});`;
writeFileSync(join(helper, 'extension.js'), helperSource);
const args = ['--no-sandbox', '--disable-gpu', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', '--new-window', '--user-data-dir', join(workspace, 'user-data'), ...(process.env.SCAP_NG_EXTENSIONS_DIR ? ['--extensions-dir', resolve(process.env.SCAP_NG_EXTENSIONS_DIR)] : []), '--extensionDevelopmentPath', helper, ...(process.env.SCAP_NG_SKIP_SCAP_EXTENSION === '1' ? [] : ['--extensionDevelopmentPath', extensionPath]), workspace];
const child = spawn(code, args, { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, VSCODE_IPC_HOOK: undefined, VSCODE_IPC_HOOK_CLI: undefined, VSCODE_PID: undefined } });
const deadline = Date.now() + Number(process.env.SCAP_NG_HOST_TIMEOUT ?? 90000);
while (Date.now() < deadline && !readFileSyncSafe(output)) await new Promise(resolve => setTimeout(resolve, 500));
child.kill('SIGTERM');
await new Promise(resolve => { const timer = setTimeout(resolve, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
const receipt = readFileSyncSafe(output) ?? { error: 'VS Code host timed out' };
const failures = [];
if (receipt.error) failures.push(receipt.error);
if (!receipt.redhatYaml) failures.push('redhat.vscode-yaml is not installed; Red Hat language-service acceptance is unavailable');
function assertSet(actual, wanted, name) {
  const labels = (actual || []).map(item => item.label).filter(Boolean);
  if (new Set(labels).size !== labels.length) failures.push(`${name}: duplicate completion labels`);
  if (JSON.stringify([...new Set(labels)].sort()) !== JSON.stringify([...wanted].sort())) failures.push(`${name}: completion set mismatch`);
  for (const item of actual || []) if (item.label && item.insertText && item.insertText !== item.label && !item.insertText.trimEnd().endsWith(':')) failures.push(`${name}: ${item.label} insertion mismatch (${item.insertText})`);
}
for (const key of ['class','mode','capability','items_found','items_satisfying','values_found','values_matching']) assertSet(receipt.blockCompletions?.[key], expected[key], `block ${key}`);
for (const key of ['items_satisfying','values_matching']) assertSet(receipt.flowCompletions?.[key], expected[key], `flow ${key}`);
assertSet(receipt.objectCompletions, expectedObjectFields, 'capability object fields');
assertSet(receipt.naturalTyping, expected.class, 'natural typing class prefix');
const canonicalExpectations={windowsRegistry:{tests:1,capabilities:['windows.registry']},unixFile:{tests:1,capabilities:['unix.file']},multipleTests:{tests:2,capabilities:['windows.registry','unix.file']}};
for(const [name,wanted] of Object.entries(canonicalExpectations)){const actual=receipt.canonicalReceipts?.[name];if(!actual||actual.languageId!=='yaml'||actual.testCount!==wanted.tests||wanted.capabilities.some(value=>!actual.capabilities.includes(value))||(actual.diagnostics||[]).length) failures.push(`canonical ${name}: host verification mismatch`);}
if (!receipt.sourcePreserved) failures.push('opening the canonical Assessment changed its YAML source');
if (!receipt.insertion?.found || !receipt.insertion?.applied || receipt.insertion?.text !== expected.class[0] || !/class:\s+compliance/.test(receipt.insertion?.line || '')) failures.push('completion insertion did not produce the selected SCAP-NG value');
if (!receipt.hoverCount || !receipt.hoverText || !receipt.hoverText.includes('compliance')) failures.push('schema hover did not return canonical enum documentation');
if (process.env.SCAP_NG_EXPECT_HOVER_TEXT && !receipt.hoverText?.includes(process.env.SCAP_NG_EXPECT_HOVER_TEXT)) failures.push('schema hover did not reflect the mutated canonical description/enum');
if (process.env.SCAP_NG_EXPECT_CLASS_DEFAULT && !(receipt.blockCompletions?.class || []).some(item => item.label === process.env.SCAP_NG_EXPECT_CLASS_DEFAULT && /default/i.test(item.detail))) failures.push('schema completion did not reflect the mutated default');
if ((receipt.validDiagnostics || []).length) failures.push('valid canonical document produced schema diagnostics');
if (!(receipt.invalidDiagnostics || []).some(value => value.severity === 0)) failures.push('invalid enum edit produced no schema error diagnostic');
console.log(JSON.stringify({expected,expectedObjectFields,actual:receipt,failures},null,2));
if (failures.length) process.exitCode=1;
if (process.env.SCAP_NG_KEEP_HOST !== '1') { try { rmSync(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:250}); } catch(error) { console.error('Host probe cleanup deferred: '+error.message); } } else console.error('Host probe workspace retained: '+workspace);
function readFileSyncSafe(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } }
