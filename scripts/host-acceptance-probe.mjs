import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { MetadataPack } from '../dist/metadata.js';
import { GuidedCatalog } from '../dist/guided.js';
import { parseDocument } from 'yaml';

const packDir = process.env.SCAP_NG_METADATA_PACK;
const sampleRoot = process.env.SCAP_NG_SAMPLE_ROOT;
const code = process.env.VSCODE_BIN ?? 'code';
const extensionPath = resolve(process.env.SCAP_NG_EXTENSION_PATH ?? process.cwd());
const useInstalled = process.env.SCAP_NG_USE_INSTALLED === '1';
const installedExtensionsDir = resolve(process.env.SCAP_NG_INSTALLED_EXTENSIONS_DIR ?? join(process.env.HOME ?? process.cwd(), '.vscode', 'extensions'));
const hostDelay = Number(process.env.SCAP_NG_HOST_DELAY ?? 5000);
const languageServerDelay = Number(process.env.SCAP_NG_LANGUAGE_SERVER_DELAY ?? 10000);
if (!packDir || !sampleRoot) throw new Error('SCAP_NG_METADATA_PACK and SCAP_NG_SAMPLE_ROOT are required');
const pin = JSON.parse(readFileSync(process.env.SCAP_NG_PROFILE_PATH ?? new URL('../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(packDir, pin);
const catalog = new GuidedCatalog(pack);
const sample = resolve(sampleRoot, 'fixtures/current-v04/windows-server-2025-lock-screen.assessment.yaml');
const source = readFileSync(sample, 'utf8');
const variableInput = resolve(sampleRoot, 'fixtures/current-v04/windows-server-2025-sysvol-permissions.assessment.yaml');
const variableSource = readFileSync(variableInput, 'utf8');
const variableIncomplete = variableSource.replace(/\n        concat:\n[\s\S]*?\n  tests:/, '\n        concat:\n        - \n  tests:');
const fixtureRoot = resolve(process.env.SCAP_NG_P0_FIXTURE_ROOT ?? 'test/fixtures');
const canonicalInputs = {
  windowsRegistry: sample,
  unixFile: join(fixtureRoot, 'p0-unix-file.assessment.yaml'),
  multipleTests: join(fixtureRoot, 'p0-multiple-tests.assessment.yaml')
};
const schema = pack.manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/assessment.schema.json'));
if (!schema) throw new Error('Pinned assessment schema is not present in the metadata pack');

const expectedEvaluateTests = Object.keys(parseDocument(source).toJS().assessment.tests);
const multipleSource = readFileSync(canonicalInputs.multipleTests, 'utf8');
const expectedMultipleEvaluateTests = Object.keys(parseDocument(multipleSource).toJS().assessment.tests);
const scopedSource = multipleSource
  .replace('id: p0-multiple-tests-assessment', 'id: host-scoped-capability-assessment')
  .replace(/      object: \{[^\n]+\}\n/, '      object: {}\n')
  .replace('      object:\n        full_path:\n          equals: /etc/passwd\n', '      object:\n');
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
const unixCapabilitySchema = pack.resource(pack.manifest.capabilities['unix.file'].schema_uri);
const expectedUnixObjectFields = Object.keys(unixCapabilitySchema.$defs?.object?.properties ?? {});
const assessmentLanguage = pack.resource(pack.manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/assessment-language.schema.json')).uri);
const expectedRequirementProperties = Object.keys(assessmentLanguage.$defs?.canonical_all_items_requirement?.properties ?? {});
const expectedTestProperties = Object.keys(pack.resource(schema.uri).properties?.assessment?.properties?.tests?.additionalProperties?.properties ?? {});
const expectedObjectFieldsAfterKey = expectedObjectFields.filter(value => value !== 'hive' && value !== 'name');
const expectedObjectFieldsAfterName = expectedObjectFields.filter(value => value !== 'hive' && value !== 'key');
const variableSchema = pack.resource(pack.manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/variable-expression.schema.json')).uri);
const expectedVariableExpressions = [...new Set((variableSchema.$defs?.expression?.oneOf ?? []).flatMap(branch => branch.required ?? []))];
const expectedRequireFields = [...new Set(['oneOf', 'anyOf'].flatMap(key => (capabilitySchema.$defs?.state_predicate?.[key] ?? []).flatMap(branch => branch.required ?? [])))];
function schemaWalk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of ['allOf', 'oneOf', 'anyOf']) for (const child of node[key] ?? []) schemaWalk(child, visit);
  if (node.items) schemaWalk(node.items, visit);
}
function schemaPropertyNames(node) {
  let values;
  schemaWalk(node, value => { if (!values && Array.isArray(value.propertyNames?.enum)) values = value.propertyNames.enum; });
  return values ?? [];
}
function schemaEnumsForProperty(node, name) {
  let target;
  schemaWalk(node, value => { if (!target && value.properties?.[name]) target = value.properties[name]; });
  const values = new Set(); schemaWalk(target, value => { for (const item of value.enum ?? []) if (typeof item === 'string') values.add(item); });
  return [...values];
}
const hiveSchema = capabilitySchema.$defs?.object?.properties?.hive;
const selectorOperatorNames = new Set((assessmentLanguage.$defs?.object_selector_predicate?.allOf ?? [])
  .flatMap(layer => layer?.oneOf ?? [])
  .flatMap(branch => Array.isArray(branch?.required) && branch.required.length === 1 ? [branch.required[0]] : []));
const expectedHiveOperators = schemaPropertyNames(hiveSchema).filter(value => selectorOperatorNames.has(value));
const expectedHiveValues = schemaEnumsForProperty(hiveSchema, 'equals');
const capabilityMapping = pack.resource(pack.manifest.capabilities['windows.registry'].mapping_uri);
const expectedTypeValues = capabilityMapping.native?.state_value_enums?.type ?? [];

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

function authoredRequirement(text, name, expected) {
  try {
    const value = parseDocument(text).toJS();
    const tests = value?.assessment?.tests;
    const requirement = tests && typeof tests === 'object' ? Object.values(tests)[0]?.require : undefined;
    return Object.entries(expected).every(([key, wanted]) => requirement?.[name]?.[key] === wanted);
  } catch { return false; }
}

const workspace = mkdtempSync(join(tmpdir(), 'scap-ng-host-'));
const helper = join(workspace, 'probe-extension'); mkdirSync(helper);
const output = join(workspace, 'receipt.json');
const validDocument = join(workspace, 'windows-server-2025-lock-screen.assessment.yaml');
const blockDocument = join(workspace, 'incomplete-block.assessment.yaml');
const flowDocument = join(workspace, 'incomplete-flow.assessment.yaml');
const objectDocument = join(workspace, 'incomplete-object.assessment.yaml');
const traversalDocument = join(workspace, 'incomplete-traversal.assessment.yaml');
const selectorDocument = join(workspace, 'incomplete-selector.assessment.yaml');
const hiveValueDocument = join(workspace, 'incomplete-hive-value.assessment.yaml');
const typeValueDocument = join(workspace, 'incomplete-type-value.assessment.yaml');
const scopedDocument = join(workspace, 'scoped-capabilities.assessment.yaml');
const objectKeyDocument = join(workspace, 'incomplete-object-key.assessment.yaml');
const objectNameDocument = join(workspace, 'incomplete-object-name.assessment.yaml');
const fieldsDocument = join(workspace, 'incomplete-fields.assessment.yaml');
const invalidDocument = join(workspace, 'invalid.assessment.yaml');
const ordinaryYamlDocument = join(workspace, 'ordinary.yaml');
const deletedObjectDocument = join(workspace, 'deleted-object.assessment.yaml');
const deletedRequireDocument = join(workspace, 'deleted-require.assessment.yaml');
const deletedItemRequirementDocument = join(workspace, 'deleted-item-requirement.assessment.yaml');
const deletedFieldRequirementDocument = join(workspace, 'deleted-field-requirement.assessment.yaml');
const deletedFieldsDocument = join(workspace, 'deleted-fields.assessment.yaml');
const blankObjectDocument = join(workspace, 'blank-object.assessment.yaml');
const blankRequireDocument = join(workspace, 'blank-require.assessment.yaml');
const blankItemRequirementDocument = join(workspace, 'blank-item-requirement.assessment.yaml');
const blankFieldRequirementDocument = join(workspace, 'blank-field-requirement.assessment.yaml');
const blankFieldsDocument = join(workspace, 'blank-fields.assessment.yaml');
const blankCapabilityDocument = join(workspace, 'blank-capability.assessment.yaml');
const variableDocument = join(workspace, 'variable-expressions.assessment.yaml');
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
const traversalIncomplete = unique(source.replace(/object: \{hive:.*?NoLockScreenSlideshow\}\}/, 'object: {'), 'traversal');
const selectorIncomplete = unique(source.replace(/object: \{hive:.*?NoLockScreenSlideshow\}\}/, 'object: {hive: {'), 'selector');
const hiveValueIncomplete = unique(source.replace('object: {hive: {equals: local_machine}, key:', 'object: {hive: {equals: , key:'), 'hive-value');
const typeValueIncomplete = unique(source.replace('fields: {type: {equals: dword}, value:', 'fields: {type: {equals: , value:'), 'type-value');
const objectKeyIncomplete = unique(source.replace('}, key:', '}, k:'), 'object-key');
const objectNameIncomplete = unique(source.replace('}, name:', '}, n:'), 'object-name');
const fieldsIncomplete = unique(source.replace('fields: {type: {equals: dword}, value: {equals: 1}}', 'fields: {'), 'fields');
const invalid = unique(source.replace('class: compliance', 'class: definitely-not-a-schema-value'), 'invalid');
const deletedObject = unique(source.replace('object: {hive: {equals: local_machine}, ', 'object: {'), 'deleted-object');
const deletedRequire = unique(source.replace(/      require:\n        item_requirement:.*\n        field_requirement:.*\n        fields: .*\n/, ''), 'deleted-require');
const deletedItemRequirement = unique(source.replace('        item_requirement: {items_found: one_or_more, items_satisfying: every}\n', ''), 'deleted-item-requirement');
const deletedFieldRequirement = unique(source.replace('        field_requirement: {values_found: one_or_more, values_matching: every}\n', ''), 'deleted-field-requirement');
const deletedFields = unique(source.replace('        fields: {type: {equals: dword}, value: {equals: 1}}\n', ''), 'deleted-fields');
const blankObject = unique(source.replace(/^      object:.*$/m, '      '), 'blank-object');
const blankRequire = unique(source.replace('      require:\n', '      \n'), 'blank-require');
const blankItemRequirement = unique(source.replace('        item_requirement: {items_found: one_or_more, items_satisfying: every}', '        '), 'blank-item-requirement');
const blankFieldRequirement = unique(source.replace('        field_requirement: {values_found: one_or_more, values_matching: every}', '        '), 'blank-field-requirement');
const blankFields = unique(source.replace('        fields: {type: {equals: dword}, value: {equals: 1}}', '        '), 'blank-fields');
const blankCapability = unique(source.replace('      capability: windows.registry', '      '), 'blank-capability');
writeFileSync(validDocument, source);
writeFileSync(blockDocument, unique(blockIncomplete, 'block'));
writeFileSync(flowDocument, unique(flowIncomplete, 'flow'));
writeFileSync(objectDocument, objectIncomplete);
writeFileSync(traversalDocument, traversalIncomplete);
writeFileSync(selectorDocument, selectorIncomplete);
writeFileSync(hiveValueDocument, hiveValueIncomplete);
writeFileSync(typeValueDocument, typeValueIncomplete);
writeFileSync(scopedDocument, scopedSource);
writeFileSync(objectKeyDocument, objectKeyIncomplete);
writeFileSync(objectNameDocument, objectNameIncomplete);
writeFileSync(fieldsDocument, fieldsIncomplete);
writeFileSync(invalidDocument, invalid);
writeFileSync(ordinaryYamlDocument, 'name: ordinary\nclass: unrelated\n');
writeFileSync(deletedObjectDocument, deletedObject);
writeFileSync(deletedRequireDocument, deletedRequire);
writeFileSync(deletedItemRequirementDocument, deletedItemRequirement);
writeFileSync(deletedFieldRequirementDocument, deletedFieldRequirement);
writeFileSync(deletedFieldsDocument, deletedFields);
writeFileSync(blankObjectDocument, blankObject);
writeFileSync(blankRequireDocument, blankRequire);
writeFileSync(blankItemRequirementDocument, blankItemRequirement);
writeFileSync(blankFieldRequirementDocument, blankFieldRequirement);
writeFileSync(blankFieldsDocument, blankFields);
writeFileSync(blankCapabilityDocument, blankCapability);
writeFileSync(variableDocument, variableIncomplete);
const canonicalDocuments = Object.fromEntries(Object.entries(canonicalInputs).map(([name, input]) => { if (name === 'windowsRegistry') return [name, validDocument]; const target = join(workspace, `${name}.assessment.yaml`); writeFileSync(target, readFileSync(input, 'utf8')); return [name, target]; }));
writeFileSync(typingDocument, unique(blockIncomplete.replace('class: ', 'class: c').replace('mode: ', 'mode: aut'), 'typing'));
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
let helperSource = `const vscode=require('vscode'); const fs=require('fs');
const files=${JSON.stringify({ validDocument, variableDocument, blockDocument, flowDocument, objectDocument, traversalDocument, selectorDocument, hiveValueDocument, typeValueDocument, objectKeyDocument, objectNameDocument, fieldsDocument, invalidDocument, deletedObjectDocument, deletedRequireDocument, deletedItemRequirementDocument, deletedFieldRequirementDocument, deletedFieldsDocument, ordinaryYamlDocument, blankObjectDocument, blankRequireDocument, blankItemRequirementDocument, blankFieldRequirementDocument, blankFieldsDocument, blankCapabilityDocument, typingDocument, scopedDocument, canonicalDocuments })};
const checks=${JSON.stringify(allChecks)};
const expectedClass=${JSON.stringify(expected.class[0])};
const expectedEvaluateTests=${JSON.stringify(expectedEvaluateTests)};
const expectedMultipleEvaluateTests=${JSON.stringify(expectedMultipleEvaluateTests)};
const expectedObjectFields=${JSON.stringify(expectedObjectFields)};
const expectedUnixObjectFields=${JSON.stringify(expectedUnixObjectFields)};
const expectedRequireFields=${JSON.stringify(expectedRequireFields)};
const expectedHiveOperators=${JSON.stringify(expectedHiveOperators)};
const expectedHiveValues=${JSON.stringify(expectedHiveValues)};
const expectedTypeValues=${JSON.stringify(expectedTypeValues)};
const expectedSource=${JSON.stringify(source)};
function itemText(item){return typeof item.insertText==='string'?item.insertText:item.insertText?.value||item.textEdit?.newText||item.additionalTextEdits?.[0]?.newText||'';}
function itemLabel(item){return typeof item.label==='string'?item.label:item.label?.label;}
function documentationText(value){return typeof value==='string'?value:value?.value||value?.markdown?.value||'';}
async function completion(uri, point){const list=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',uri,new vscode.Position(point.line,point.character));return (list?.items||[]).map(item=>({label:itemLabel(item),insertText:itemText(item),detail:item.detail||'',documentation:documentationText(item.documentation),kind:item.kind}));}
async function insert(uri, point, label){const list=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',uri,new vscode.Position(point.line,point.character));const item=(list?.items||[]).find(value=>itemLabel(value)===label);if(!item) return {found:false};const edit=new vscode.WorkspaceEdit();const range=item.textEdit?.range||item.range||new vscode.Range(point.line,point.character,point.line,point.character);edit.replace(uri,range,itemText(item));const applied=await vscode.workspace.applyEdit(edit);const document=await vscode.workspace.openTextDocument(uri);return {found:true,applied,text:itemText(item),line:document.lineAt(point.line).text};}
function hoverText(values){return (values||[]).flatMap(value=>Array.isArray(value.contents)?value.contents:[value.contents]).map(value=>typeof value==='string'?value:value?.value||'').join('\\n');}
function diagnostic(value){return {message:value.message,severity:value.severity,source:value.source||''};}
// Red Hat YAML 2.0 currently reports one non-authoritative resolver warning for
// the generated native-selector overlay. Keep that warning visible in the
// receipt, but do not mistake it for the extension's own schema diagnostics.
function isPackResolverWarning(value){
  return value?.source==='YAML' && /cannot be resolved/.test(String(value.message||'')) &&
    /typed_comparison_datatype_consistency/.test(String(value.message||''));
}
function hostDiagnostics(uri){return vscode.languages.getDiagnostics(uri).filter(value=>!isPackResolverWarning(value)).map(diagnostic);}
function hostResolverWarnings(uri){return vscode.languages.getDiagnostics(uri).filter(isPackResolverWarning).map(diagnostic);}
async function missingReceipt(uri, document, property){
 await new Promise(resolve=>setTimeout(resolve,1000));
 const diagnostics=hostDiagnostics(uri);
 const actions=await vscode.commands.executeCommand('vscode.executeCodeActionProvider',uri,new vscode.Range(0,0,document.lineCount,0))||[];
 const action=actions.find(value=>String(value.title||'').includes("'"+property+"'"));
 const beforeText=document.getText(); let applied=false, text=beforeText, afterDiagnostics=[], duplicateActionFound=false, undoText='', redoText='';
 if(action?.edit){
  await vscode.window.showTextDocument(document,vscode.ViewColumn.One,false);
  applied=await vscode.workspace.applyEdit(action.edit);
  const changed=await vscode.workspace.openTextDocument(uri); text=changed.getText();
  await new Promise(resolve=>setTimeout(resolve,500));
  afterDiagnostics=hostDiagnostics(uri);
  const repeated=await vscode.commands.executeCommand('vscode.executeCodeActionProvider',uri,new vscode.Range(0,0,changed.lineCount,0))||[];
  duplicateActionFound=repeated.some(value=>String(value.title||'').includes("'"+property+"'"));
  await vscode.commands.executeCommand('undo'); await new Promise(resolve=>setTimeout(resolve,100));
  undoText=(await vscode.workspace.openTextDocument(uri)).getText();
  await vscode.commands.executeCommand('redo'); await new Promise(resolve=>setTimeout(resolve,100));
  redoText=(await vscode.workspace.openTextDocument(uri)).getText();
 }
 return {diagnostics,actionTitles:actions.map(value=>value.title||''),actionFound:Boolean(action),applied,text,beforeText,afterDiagnostics,duplicateActionFound,undoText,redoText};
}
exports.activate=()=>setTimeout(async()=>{try{
 const valid=vscode.Uri.file(files.validDocument), block=vscode.Uri.file(files.blockDocument), flow=vscode.Uri.file(files.flowDocument), object=vscode.Uri.file(files.objectDocument), traversal=vscode.Uri.file(files.traversalDocument), selector=vscode.Uri.file(files.selectorDocument), hiveValue=vscode.Uri.file(files.hiveValueDocument), typeValue=vscode.Uri.file(files.typeValueDocument), objectKey=vscode.Uri.file(files.objectKeyDocument), objectName=vscode.Uri.file(files.objectNameDocument), fields=vscode.Uri.file(files.fieldsDocument), invalid=vscode.Uri.file(files.invalidDocument), deletedObject=vscode.Uri.file(files.deletedObjectDocument), deletedRequire=vscode.Uri.file(files.deletedRequireDocument), deletedItemRequirement=vscode.Uri.file(files.deletedItemRequirementDocument), deletedFieldRequirement=vscode.Uri.file(files.deletedFieldRequirementDocument), deletedFields=vscode.Uri.file(files.deletedFieldsDocument), blankObject=vscode.Uri.file(files.blankObjectDocument), blankRequire=vscode.Uri.file(files.blankRequireDocument), blankItemRequirement=vscode.Uri.file(files.blankItemRequirementDocument), blankFieldRequirement=vscode.Uri.file(files.blankFieldRequirementDocument), blankFields=vscode.Uri.file(files.blankFieldsDocument), blankCapability=vscode.Uri.file(files.blankCapabilityDocument), typing=vscode.Uri.file(files.typingDocument);
 const validDoc=await vscode.workspace.openTextDocument(valid);
 await vscode.commands.executeCommand('vscode.open', valid);
 await new Promise(resolve=>setTimeout(resolve,500));
 const defaultEditor=vscode.window.activeTextEditor;
 const defaultOpen={nativeTextEditor:Boolean(defaultEditor?.document?.uri?.toString()===valid.toString()),languageId:defaultEditor?.document?.languageId||'',activeUri:defaultEditor?.document?.uri?.fsPath||''};
 await vscode.window.showTextDocument(valid,vscode.ViewColumn.One);
 await new Promise(resolve=>setTimeout(resolve,${languageServerDelay}));
 const variableDoc=await vscode.workspace.openTextDocument(vscode.Uri.file(files.variableDocument)), blockDoc=await vscode.workspace.openTextDocument(block), flowDoc=await vscode.workspace.openTextDocument(flow), objectDoc=await vscode.workspace.openTextDocument(object), traversalDoc=await vscode.workspace.openTextDocument(traversal), selectorDoc=await vscode.workspace.openTextDocument(selector), hiveValueDoc=await vscode.workspace.openTextDocument(hiveValue), typeValueDoc=await vscode.workspace.openTextDocument(typeValue), objectKeyDoc=await vscode.workspace.openTextDocument(objectKey), objectNameDoc=await vscode.workspace.openTextDocument(objectName), fieldsDoc=await vscode.workspace.openTextDocument(files.fieldsDocument), invalidDoc=await vscode.workspace.openTextDocument(invalid), deletedObjectDoc=await vscode.workspace.openTextDocument(deletedObject), deletedRequireDoc=await vscode.workspace.openTextDocument(deletedRequire), deletedItemRequirementDoc=await vscode.workspace.openTextDocument(deletedItemRequirement), deletedFieldRequirementDoc=await vscode.workspace.openTextDocument(deletedFieldRequirement), deletedFieldsDoc=await vscode.workspace.openTextDocument(deletedFields), blankObjectDoc=await vscode.workspace.openTextDocument(files.blankObjectDocument), blankRequireDoc=await vscode.workspace.openTextDocument(files.blankRequireDocument), blankItemRequirementDoc=await vscode.workspace.openTextDocument(files.blankItemRequirementDocument), blankFieldRequirementDoc=await vscode.workspace.openTextDocument(files.blankFieldRequirementDocument), blankFieldsDoc=await vscode.workspace.openTextDocument(files.blankFieldsDocument), blankCapabilityDoc=await vscode.workspace.openTextDocument(files.blankCapabilityDocument), typingDoc=await vscode.workspace.openTextDocument(typing);
 await vscode.window.showTextDocument(validDoc,vscode.ViewColumn.One);
 const directEvaluateLine=validDoc.getText().split(/\\r?\\n/).findIndex(line=>/^\\s+test:\\s*/.test(line));
 const evaluateCompletions=await completion(valid,{line:directEvaluateLine,character:validDoc.lineAt(directEvaluateLine).text.length});
 const yamlStatus=await vscode.commands.executeCommand('scapNg.showYamlStatus');
 const ordinary=await vscode.workspace.openTextDocument(vscode.Uri.file(files.ordinaryYamlDocument)); await vscode.window.showTextDocument(ordinary,vscode.ViewColumn.One);
 const unrelatedStatus=await vscode.commands.executeCommand('scapNg.showYamlStatus');
 await vscode.window.showTextDocument(validDoc,vscode.ViewColumn.One);
 const variableLine=variableDoc.getText().split(/\\r?\\n/).findIndex(line=>/^\\s+-\\s*$/.test(line));
 const variableCompletions=await completion(vscode.Uri.file(files.variableDocument),{line:variableLine,character:variableDoc.lineAt(variableLine).text.length});
 const blockCompletions={},flowCompletions={};for(const point of checks.block)blockCompletions[point.key]=await completion(block,point);for(const point of checks.flow)flowCompletions[point.key]=await completion(flow,point);
 const objectPoint={line:objectDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('object: {')),character:objectDoc.getText().split(/\\r?\\n/).find(line=>line.includes('object: {')).length};
 const objectCompletions=await completion(object,objectPoint);
 const selectorLine=selectorDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('object: {hive: {'));
 const selectorPoint={line:selectorLine,character:selectorDoc.lineAt(selectorLine).text.length};
 const hiveOperators=await completion(selector,selectorPoint);
 const hiveOperatorInsertion=await insert(selector,selectorPoint,'equals');
 const hiveValueLine=hiveValueDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('hive: {equals: ,'));
 const hiveValuePoint={line:hiveValueLine,character:hiveValueDoc.lineAt(hiveValueLine).text.indexOf('equals: ,')+'equals: '.length};
 const hiveValues=await completion(hiveValue,hiveValuePoint);
 const typeValueLine=typeValueDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('type: {equals: ,'));
 const typeValuePoint={line:typeValueLine,character:typeValueDoc.lineAt(typeValueLine).text.indexOf('equals: ,')+'equals: '.length};
 const typeValues=await completion(typeValue,typeValuePoint);
 const typeValueInsertion=await insert(typeValue,typeValuePoint,'dword');
 const blankPoint=doc=>{const line=doc.getText().split(/\\r?\\n/).findIndex(value=>/^\\s+$/.test(value));if(line<0)throw new Error('blank completion fixture has no whitespace-only row');return {line,character:doc.lineAt(line).text.length};};
 const blankCompletions={object:await completion(blankObject,blankPoint(blankObjectDoc)),require:await completion(blankRequire,blankPoint(blankRequireDoc)),item_requirement:await completion(blankItemRequirement,blankPoint(blankItemRequirementDoc)),field_requirement:await completion(blankFieldRequirement,blankPoint(blankFieldRequirementDoc)),fields:await completion(blankFields,blankPoint(blankFieldsDoc)),capability:await completion(blankCapability,blankPoint(blankCapabilityDoc))};
 const requireBlockInsertion=await insert(blankRequire,blankPoint(blankRequireDoc),'require');
 const missingObject=await missingReceipt(deletedObject,deletedObjectDoc,'hive');
 const missingRequire=await missingReceipt(deletedRequire,deletedRequireDoc,'require');
 const missingItemRequirement=await missingReceipt(deletedItemRequirement,deletedItemRequirementDoc,'item_requirement');
 const missingFieldRequirement=await missingReceipt(deletedFieldRequirement,deletedFieldRequirementDoc,'field_requirement');
 const missingFields=await missingReceipt(deletedFields,deletedFieldsDoc,'fields');
 const objectKeyLine=objectKeyDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes(', k:'));
 const objectKeyPoint={line:objectKeyLine,character:objectKeyDoc.lineAt(objectKeyLine).text.indexOf(', k:')+3};
 const objectKeyCompletions=await completion(objectKey,objectKeyPoint);
 const objectKeyInsertion=await insert(objectKey,objectKeyPoint,'key');
 const objectNameLine=objectNameDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes(', n:'));
 const objectNamePoint={line:objectNameLine,character:objectNameDoc.lineAt(objectNameLine).text.indexOf(', n:')+3};
 const objectNameCompletions=await completion(objectName,objectNamePoint);
 const objectNameInsertion=await insert(objectName,objectNamePoint,'name');
 const fieldsLine=fieldsDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('fields: {'));
 const fieldsPoint={line:fieldsLine,character:fieldsDoc.lineAt(fieldsLine).text.length};
 const requireFieldCompletions=await completion(fields,fieldsPoint);
 const objectInsertion=await insert(object,objectPoint,'hive');
 const traversalLine=traversalDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('object: {'));
 const traversalPoint={line:traversalLine,character:traversalDoc.lineAt(traversalLine).text.length};
 const traversalInsertion=await insert(vscode.Uri.file(files.traversalDocument),traversalPoint,'traversal');
 const requireFieldInsertion=await insert(fields,fieldsPoint,expectedRequireFields[0]);
 const typingLine=typingDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('class: c'));
 const typingPoint={line:typingLine,character:typingDoc.lineAt(typingLine).text.length};
 const naturalTyping=await completion(typing,typingPoint);
 const modeLine=typingDoc.getText().split(/\\r?\\n/).findIndex(line=>line.includes('mode: aut'));
 const modePoint={line:modeLine,character:typingDoc.lineAt(modeLine).text.length};
 const prefixInsertion=await insert(typing,modePoint,'automated');
 const insertion=await insert(block,checks.block.find(point=>point.key==='class'),expectedClass);
 await new Promise(resolve=>setTimeout(resolve,1000));
 const hover=await vscode.commands.executeCommand('vscode.executeHoverProvider',valid,new vscode.Position(${checks(source).find(point=>point.key==='class').line},${checks(source).find(point=>point.key==='class').character}));
 const canonicalReceipts={};for(const [name,file] of Object.entries(files.canonicalDocuments)){const uri=vscode.Uri.file(file),doc=await vscode.workspace.openTextDocument(uri);canonicalReceipts[name]={languageId:doc.languageId,testCount:(doc.getText().match(/^    [^ ]+-test:/gm)||[]).length,capabilities:[...doc.getText().matchAll(/^\\s+capability:\\s*([^\\s#},]+)/gm)].map(match=>match[1]),diagnostics:hostDiagnostics(uri)};}
 const multipleUri=vscode.Uri.file(files.canonicalDocuments.multipleTests),multipleDoc=await vscode.workspace.openTextDocument(multipleUri);
 const multipleEvaluateLine=multipleDoc.getText().split(/\\r?\\n/).findIndex(line=>/^\\s*-\\s*test:\\s*/.test(line));
 const multipleEvaluateCompletions=await completion(multipleUri,{line:multipleEvaluateLine,character:multipleDoc.lineAt(multipleEvaluateLine).text.length});
 const scopedUri=vscode.Uri.file(files.scopedDocument),scopedDoc=await vscode.workspace.openTextDocument(scopedUri);
 const scopedObjectLines=scopedDoc.getText().split(/\\r?\\n/).map((line,index)=>({line,index})).filter(value=>/\\bobject:\\s*(?:\\{|$)/.test(value.line));
 const multipleRegistryObjectCompletions=await completion(scopedUri,{line:scopedObjectLines[0].index,character:scopedDoc.lineAt(scopedObjectLines[0].index).text.indexOf('{')+1});
 const multipleUnixObjectCompletions=await completion(scopedUri,{line:scopedObjectLines[1].index,character:scopedDoc.lineAt(scopedObjectLines[1].index).text.length});
 const validDiagnostics=hostDiagnostics(valid),invalidDiagnostics=hostDiagnostics(invalid),schemaResolutionWarnings=hostResolverWarnings(valid);
 const schemas=vscode.workspace.getConfiguration('yaml').get('schemas');
 let graphicalLifecycle;
 if (process.env.SCAP_NG_OPEN_GRAPHICAL === '1') {
  await vscode.commands.executeCommand('vscode.openWith', valid, 'scapNg.assessment', { viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false }); await new Promise(resolve=>setTimeout(resolve, 1500));
  if (process.env.SCAP_NG_GRAPHICAL_EDIT === '1') {
   const before = validDoc.getText(); const objectOld = 'local_machine'; const requireOld = 'value: {equals: 1}'; const objectStart = before.indexOf(objectOld); const requireStart = before.indexOf(requireOld);
   if (objectStart < 0 || requireStart < 0) throw new Error('Graphical Object/Require demo markers were not found');
   const edit = new vscode.WorkspaceEdit(); edit.replace(valid, new vscode.Range(validDoc.positionAt(objectStart), validDoc.positionAt(objectStart + objectOld.length)), 'current_user'); edit.replace(valid, new vscode.Range(validDoc.positionAt(requireStart + requireOld.indexOf('1')), validDoc.positionAt(requireStart + requireOld.indexOf('1') + 1)), '2'); const applied = await vscode.workspace.applyEdit(edit); await validDoc.save(); const changed = validDoc.getText();
   const changedAgain = await vscode.workspace.openTextDocument(valid); await vscode.commands.executeCommand('workbench.action.closeActiveEditor'); await new Promise(resolve=>setTimeout(resolve, 400)); await vscode.commands.executeCommand('vscode.openWith', valid, 'scapNg.assessment', { viewColumn: vscode.ViewColumn.One, preserveFocus: false, preview: false }); await new Promise(resolve=>setTimeout(resolve, 600)); const reopened = changedAgain.getText();
   await vscode.window.showTextDocument(validDoc, vscode.ViewColumn.One, false); await vscode.commands.executeCommand('undo'); await new Promise(resolve=>setTimeout(resolve, 250)); const undoText = (await vscode.workspace.openTextDocument(valid)).getText(); await vscode.commands.executeCommand('redo'); await new Promise(resolve=>setTimeout(resolve, 250)); const redoText = (await vscode.workspace.openTextDocument(valid)).getText();
   graphicalLifecycle = { applied, baselineSha256: require('crypto').createHash('sha256').update(before).digest('hex'), changedSha256: require('crypto').createHash('sha256').update(changed).digest('hex'), before, changed, reopened, undoText, redoText, objectEdited: changed.includes('hive: {equals: current_user}'), requireEdited: changed.includes('value: {equals: 2}'), changedRanges: [[objectStart, objectStart + objectOld.length], [requireStart + requireOld.indexOf('1'), requireStart + requireOld.indexOf('1') + 1]] };
  }
 }
 fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({extensionSource:${JSON.stringify(useInstalled ? 'installed-vsix' : 'development-checkout')},languageId:validDoc.languageId,defaultOpen,variableCompletions,evaluateCompletions,multipleEvaluateCompletions,multipleRegistryObjectCompletions,multipleUnixObjectCompletions,yamlStatus,unrelatedStatus,sourcePreserved:validDoc.getText()===expectedSource,redhatYaml:Boolean(vscode.extensions.getExtension('redhat.vscode-yaml')),blockCompletions,flowCompletions,blankCompletions,objectCompletions,requireBlockInsertion,traversalInsertion,hiveOperators,hiveValues,hiveOperatorInsertion,typeValues,typeValueInsertion,missingObject,missingRequire,missingItemRequirement,missingFieldRequirement,missingFields,objectKeyCompletions,objectNameCompletions,requireFieldCompletions,objectInsertion,objectKeyInsertion,objectNameInsertion,requireFieldInsertion,naturalTyping,prefixInsertion,canonicalReceipts,insertion,hoverCount:hover?.length||0,hoverText:hoverText(hover),validDiagnostics,invalidDiagnostics,schemaResolutionWarnings,schemaAssociations:schemas,graphicalLifecycle},null,2));
 if (process.env.SCAP_NG_KEEP_HOST === '1') await new Promise(() => {}); else await vscode.commands.executeCommand('workbench.action.closeWindow');
 }catch(error){fs.writeFileSync(${JSON.stringify(output)},JSON.stringify({error:String(error),stack:error.stack},null,2));}},${hostDelay});`;
// A fresh host does not necessarily auto-activate an installed VSIX before
// the helper's timer runs. Explicitly activate the installed extension so this
// mode qualifies the packaged artifact rather than silently testing only YAML.
if (useInstalled) {
  const marker = "exports.activate=()=>setTimeout(async()=>{try{";
  const activation = "exports.activate=()=>setTimeout(async()=>{try{const installed=vscode.extensions.getExtension('vanderpol.scap-ng-vscode-metadata');if(installed)await installed.activate();";
  if (!helperSource.includes(marker)) throw new Error('Installed-host activation marker was not found');
  helperSource = helperSource.replace(marker, activation);
}
writeFileSync(join(helper, 'extension.js'), helperSource);
const args = ['--no-sandbox', '--disable-gpu', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', '--new-window', `--user-data-dir=${join(workspace, 'user-data')}`, ...(process.env.SCAP_NG_EXTENSIONS_DIR ? [`--extensions-dir=${resolve(process.env.SCAP_NG_EXTENSIONS_DIR)}`] : useInstalled ? [`--extensions-dir=${installedExtensionsDir}`] : []), `--extensionDevelopmentPath=${helper}`, ...(useInstalled || process.env.SCAP_NG_SKIP_SCAP_EXTENSION === '1' ? [] : [`--extensionDevelopmentPath=${extensionPath}`]), workspace];
const child = spawn(code, args, { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, VSCODE_IPC_HOOK: undefined, VSCODE_IPC_HOOK_CLI: undefined, VSCODE_PID: undefined } });
const terminateHost = signal => { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already exited */ } } };
const deadline = Date.now() + Number(process.env.SCAP_NG_HOST_TIMEOUT ?? 90000);
while (Date.now() < deadline && !readFileSyncSafe(output)) await new Promise(resolve => setTimeout(resolve, 500));
if (process.env.SCAP_NG_KEEP_HOST !== '1') { terminateHost('SIGTERM'); await new Promise(resolve => { const timer = setTimeout(resolve, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
if (process.env.SCAP_NG_KEEP_HOST === '1') await new Promise(resolve => setTimeout(resolve, Number(process.env.SCAP_NG_KEEP_HOST_MS ?? 15000)));
terminateHost('SIGKILL');
const receipt = readFileSyncSafe(output) ?? { error: 'VS Code host timed out' };
const failures = [];
if (receipt.error) { console.error(receipt.error, receipt.stack || ''); process.exit(1); }
if (useInstalled && receipt.extensionSource !== 'installed-vsix') failures.push('host probe did not run the installed VSIX');
if (!receipt.redhatYaml) failures.push('redhat.vscode-yaml is not installed; Red Hat language-service acceptance is unavailable');
function assertSet(actual, wanted, name) {
  const labels = (actual || []).map(item => item.label).filter(Boolean);
  if (new Set(labels).size !== labels.length) failures.push(`${name}: duplicate completion labels`);
  if (JSON.stringify([...new Set(labels)].sort()) !== JSON.stringify([...wanted].sort())) failures.push(`${name}: completion set mismatch`);
  for (const item of actual || []) {
    if (item.label && item.kind === 9 && !item.documentation) failures.push(`${name}: ${item.label} has no schema-derived property description`);
    if (item.label && item.insertText && item.insertText !== item.label) {
      const normalizedInsert = item.insertText.replace(/^\s*\n\s*/, '');
      if (!(normalizedInsert.startsWith(item.label) || (item.kind !== 9 && item.insertText.trimEnd().endsWith(':')))) failures.push(`${name}: ${item.label} insertion mismatch (${item.insertText})`);
    }
  }
}
for (const key of ['class','mode','capability','items_found','items_satisfying','values_found','values_matching']) assertSet(receipt.blockCompletions?.[key], expected[key], `block ${key}`);
for (const key of ['items_satisfying','values_matching']) assertSet(receipt.flowCompletions?.[key], expected[key], `flow ${key}`);
assertSet(receipt.variableCompletions, expectedVariableExpressions, 'recursive Variable expression');
assertSet(receipt.evaluateCompletions, expectedEvaluateTests, 'evaluate.test');
assertSet(receipt.multipleEvaluateCompletions, expectedMultipleEvaluateTests, 'nested evaluate.test');
if (!receipt.defaultOpen?.nativeTextEditor || receipt.defaultOpen?.languageId !== 'yaml') failures.push('recognized Assessment did not open in the native YAML editor by default');
if (!receipt.yamlStatus?.visible || !['healthy','partial'].includes(receipt.yamlStatus?.state) || (receipt.yamlStatus?.state === 'partial' && !receipt.schemaResolutionWarnings?.length) || !receipt.yamlStatus?.associationPresent || receipt.yamlStatus?.schemaVersion !== '0.4.0' || !receipt.yamlStatus?.packPath) failures.push('SCAP-NG status did not report a verified pinned Assessment');
if (receipt.unrelatedStatus !== undefined) failures.push('SCAP-NG status remained visible for ordinary YAML');
const testMissingAfter = (...present) => expectedTestProperties.filter(value => !present.includes(value));
const requirementMissingAfter = (...present) => expectedRequirementProperties.filter(value => !present.includes(value));
assertSet(receipt.blankCompletions?.object, testMissingAfter('test_title','capability','require','reported_elements'), 'blank object mapping');
assertSet(receipt.blankCompletions?.require, testMissingAfter('test_title','capability','object','reported_elements'), 'blank require mapping');
assertSet(receipt.blankCompletions?.capability, testMissingAfter('test_title','object','require','reported_elements'), 'blank capability mapping');
assertSet(receipt.blankCompletions?.item_requirement, requirementMissingAfter('field_requirement','fields'), 'blank item_requirement mapping');
assertSet(receipt.blankCompletions?.field_requirement, requirementMissingAfter('item_requirement','fields'), 'blank field_requirement mapping');
assertSet(receipt.blankCompletions?.fields, requirementMissingAfter('item_requirement','field_requirement'), 'blank fields mapping');
assertSet(receipt.objectCompletions, expectedObjectFields, 'capability object fields');
assertSet(receipt.multipleRegistryObjectCompletions, expectedObjectFields, 'registry Test object fields');
assertSet(receipt.multipleUnixObjectCompletions, expectedUnixObjectFields.filter(value => value !== 'capability'), 'unix Test object fields');
assertSet(receipt.hiveOperators, expectedHiveOperators, 'hive operators');
assertSet(receipt.hiveValues, expectedHiveValues, 'hive values');
if (!receipt.hiveOperatorInsertion?.found || !receipt.hiveOperatorInsertion?.applied || !/hive: \{equals: /.test(receipt.hiveOperatorInsertion?.line || '')) failures.push('hive operator insertion failed');
assertSet(receipt.typeValues, expectedTypeValues, 'registry type values');
if (!receipt.typeValueInsertion?.found || !receipt.typeValueInsertion?.applied || !/type: \{equals: dword/.test(receipt.typeValueInsertion?.line || '')) failures.push('registry type value insertion failed');
assertSet(receipt.objectKeyCompletions, expectedObjectFieldsAfterKey, 'capability object fields after comma');
assertSet(receipt.objectNameCompletions, expectedObjectFieldsAfterName, 'capability object fields before name colon');
if (!receipt.objectKeyInsertion?.found || !receipt.objectKeyInsertion?.applied || !/[, ]key:/.test(receipt.objectKeyInsertion?.line || '') || /key::/.test(receipt.objectKeyInsertion?.line || '')) failures.push('typed key property completion insertion failed');
if (!receipt.objectNameInsertion?.found || !receipt.objectNameInsertion?.applied || !/[, ]name:/.test(receipt.objectNameInsertion?.line || '') || /name::/.test(receipt.objectNameInsertion?.line || '')) failures.push('typed name property completion insertion failed');
assertSet(receipt.requireFieldCompletions, expectedRequireFields, 'require fields');
if (!receipt.objectInsertion?.found || !receipt.objectInsertion?.applied || !/\{hive:\s*\{/.test(receipt.objectInsertion?.line || '')) failures.push('object property completion insertion failed');
if (!receipt.traversalInsertion?.found || !receipt.traversalInsertion?.applied || !/traversal: \{max_depth: unlimited\}/.test(receipt.traversalInsertion?.line || '')) failures.push('structured traversal completion template insertion failed');
if (!receipt.requireBlockInsertion?.found || !receipt.requireBlockInsertion?.applied || !/^\s*require:$/.test(receipt.requireBlockInsertion?.line || '')) failures.push('block require completion inserted invalid flow opener');
if (!receipt.requireFieldInsertion?.found || !receipt.requireFieldInsertion?.applied || !/\{expanded_value:\s*\{/.test(receipt.requireFieldInsertion?.line || '')) failures.push('require field completion insertion failed');
function receiptValue(name){ return receipt[name]; }
if (process.env.SCAP_NG_GRAPHICAL_EDIT !== '1') for (const [name, property] of [['missingObject','hive'],['missingRequire','require'],['missingItemRequirement','item_requirement'],['missingFieldRequirement','field_requirement'],['missingFields','fields']]) {
 const receipt=receiptValue(name);
 if (!(receipt.diagnostics||[]).length) failures.push(`${name}: missing property produced no diagnostic`);
 if (!receipt.actionFound || !receipt.applied) failures.push(`${name}: missing-property quick fix unavailable`);
 if (receipt.duplicateActionFound) failures.push(`${name}: quick fix remains available and could duplicate ${property}`);
 if (receipt.undoText !== receipt.beforeText) failures.push(`${name}: undo did not restore the deleted property state`);
 if (receipt.redoText !== receipt.text) failures.push(`${name}: redo did not restore the quick-fix edit`);
 if ((receipt.text.match(new RegExp(`\\b${property}\\s*:`,'g'))||[]).length !== 1) failures.push(`${name}: quick fix did not restore exactly one ${property}`);
}
if (!authoredRequirement(receipt.missingItemRequirement?.text || '', 'item_requirement', {items_found:'one_or_more', items_satisfying:'every'})) failures.push('item_requirement quick fix did not use schema defaults');
if (!authoredRequirement(receipt.missingFieldRequirement?.text || '', 'field_requirement', {values_found:'one_or_more', values_matching:'every'})) failures.push('field_requirement quick fix did not use schema defaults');
if ((receipt.missingItemRequirement?.afterDiagnostics || []).length || (receipt.missingFieldRequirement?.afterDiagnostics || []).length) failures.push('schema-default requirement quick fix left diagnostics');
assertSet(receipt.naturalTyping, expected.class, 'natural typing class prefix');
const canonicalExpectations={windowsRegistry:{tests:1,capabilities:['windows.registry']},unixFile:{tests:1,capabilities:['unix.file']},multipleTests:{tests:2,capabilities:['windows.registry','unix.file']}};
for(const [name,wanted] of Object.entries(canonicalExpectations)){const actual=receipt.canonicalReceipts?.[name];if(!actual||actual.languageId!=='yaml'||actual.testCount!==wanted.tests||wanted.capabilities.some(value=>!actual.capabilities.includes(value))||(actual.diagnostics||[]).length) failures.push(`canonical ${name}: host verification mismatch`);}
if (!receipt.prefixInsertion?.applied || receipt.prefixInsertion?.text !== 'automated' || !/mode:\s+automated/.test(receipt.prefixInsertion?.line || '')) failures.push('typed completion did not replace the existing prefix');
if (process.env.SCAP_NG_GRAPHICAL_EDIT !== '1' && !receipt.sourcePreserved) failures.push('opening the canonical Assessment changed its YAML source');
if (process.env.SCAP_NG_GRAPHICAL_EDIT === '1') { const life=receipt.graphicalLifecycle; if (!life?.applied || !life.objectEdited || !life.requireEdited || life.reopened !== life.changed || life.undoText !== life.before || life.redoText !== life.changed) failures.push('graphical edit/save/reopen/undo/redo lifecycle failed'); }
if (!receipt.insertion?.found || !receipt.insertion?.applied || receipt.insertion?.text !== expected.class[0] || !/class:\s+compliance/.test(receipt.insertion?.line || '')) failures.push('completion insertion did not produce the selected SCAP-NG value');
if (!receipt.hoverCount || !receipt.hoverText || !receipt.hoverText.includes('compliance')) failures.push('schema hover did not return canonical enum documentation');
if (process.env.SCAP_NG_EXPECT_HOVER_TEXT && !receipt.hoverText?.includes(process.env.SCAP_NG_EXPECT_HOVER_TEXT)) failures.push('schema hover did not reflect the mutated canonical description/enum');
if (process.env.SCAP_NG_EXPECT_CLASS_DEFAULT && !(receipt.blockCompletions?.class || []).some(item => item.label === process.env.SCAP_NG_EXPECT_CLASS_DEFAULT && /default/i.test(item.detail))) failures.push('schema completion did not reflect the mutated default');
if ((receipt.validDiagnostics || []).length) failures.push('valid canonical document produced schema diagnostics');
if (!(receipt.invalidDiagnostics || []).some(value => value.severity === 0)) failures.push('invalid enum edit produced no schema error diagnostic');
console.log(JSON.stringify({expected,expectedObjectFields,expectedHiveOperators,expectedHiveValues,expectedTypeValues,actual:receipt,failures},null,2));
if (failures.length) process.exitCode=1;
if (process.env.SCAP_NG_KEEP_HOST !== '1') { try { rmSync(workspace,{recursive:true,force:true,maxRetries:5,retryDelay:250}); } catch(error) { console.error('Host probe cleanup deferred: '+error.message); } } else console.error('Host probe workspace retained: '+workspace);
function readFileSyncSafe(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } }
