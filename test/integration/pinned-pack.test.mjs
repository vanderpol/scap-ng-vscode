import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MetadataPack,SourceBuffer,sha256 } from '../../dist/index.js';
import { modelFor, explainAssessment, assessmentEditorModel } from '../../dist/structured-model.js';
import { completionChoices, predicateOperatorChoices, predicateValueSourceChoices, schemaDefaultValue, selectorOperatorChoices, selectorValueChoices } from '../../dist/completion.js';
import { comparisonOperations, comparisonValueSources, comparisonVariableCompatible, variableExpressionOperations } from '../../dist/structured-model.js';
import { analyzeVariables, expressionContract, variableAnalysisSummary } from '../../dist/expression-contract.js';
import { context } from '../helpers.mjs';

// Explicit paths: no downloads, upstream assets or copied content in this repo.
const directory=process.env.SCAP_NG_METADATA_PACK;
const source=process.env.SCAP_NG_SOURCE_ROOT;
if(!directory||!source)throw new Error('Select SCAP_NG_METADATA_PACK and SCAP_NG_SOURCE_ROOT explicitly');
const pin=JSON.parse(readFileSync(new URL('../../schema-profile.json',import.meta.url)));
const fixtureRoot=fileURLToPath(new URL('../fixtures/',import.meta.url));
const currentSamples=fileURLToPath(new URL('../../.external/scap-ng-editor-sample-data/fixtures/current-v04/',import.meta.url));
const sourceCommit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(sourceCommit!==pin.sourceCommit)throw new Error('Canonical schema checkout differs from the editor profile pin');
const pack=new MetadataPack(directory,pin);
const base='https://scap-ng.dev/schema/v0.4.0/';

test('adopted optional Input guard shape preserves source without inventing bindings or defaults',()=>{
 const raw=readFileSync(join(source,'examples/windows-optional-organizational-input.assessment.yaml'),'utf8');
 assert.equal(raw,readFileSync(join(currentSamples,'windows-optional-organizational-input.assessment.yaml'),'utf8'));
 const buffer=new SourceBuffer(raw);const doc=buffer.json();
 assert.equal(buffer.openOrSave(),raw);
 assert.deepEqual(pack.validate(base+'assessment.schema.json',doc),[]);
 assert.deepEqual(doc.assessment.evaluate.if,{input_provided:'slideshow-value-input'});
 assert.equal(doc.assessment.inputs['slideshow-value-input'].required,false);
 assert.equal(Object.hasOwn(doc.assessment.inputs['slideshow-value-input'],'default'),false);
 const missing=structuredClone(doc);delete missing.assessment.inputs['slideshow-value-input'].required;
 assert.ok(pack.validate(base+'assessment.schema.json',missing).length>0);
 const hidden=structuredClone(doc);hidden.assessment.inputs['slideshow-value-input'].default=1;
 assert.ok(pack.validate(base+'assessment.schema.json',hidden).length>0);
 // The compiler, not the shape adapter, proves transitive use dominance and
 // invocation binding states. No Test evaluation or host UI is claimed here.
});

test('all 100 mappings and every annotated location resolve offline with valid suggestions',()=>{
 assert.equal(Object.keys(pack.manifest.capabilities).length,100);
 const ids=new Set();let count=0;
 for(const resource of pack.manifest.resources.filter(r=>r.kind==='schema')){
  const walk=(node,path='')=>{
   if(!node||typeof node!=='object')return;
   if(node['x-scap-ng-authoring']?.authority?.endsWith('/269')){
    count++;const uri=resource.uri+'#'+path;const help=pack.describe(uri,context);ids.add(help.annotation.control_id);
    assert.ok(help.title&&help.description,uri);
    if(help.annotation.representation==='key')assert.ok(help.choices.includes(help.suggested),'missing key choice '+uri+' '+JSON.stringify(help));
    else assert.deepEqual(pack.validate(uri,help.suggested),[],uri);
   }
   for(const [key,value] of Object.entries(node))if(key!=='x-scap-ng-authoring')walk(value,path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));
  };walk(pack.resource(resource.uri));
 }
 assert.equal(count,264);assert.equal(ids.size,38);
 for(const cap of Object.values(pack.manifest.capabilities))assert.equal(pack.resource(cap.mapping_uri).specification_version,pin.schemaVersion);
 assert.equal(pack.resource(pack.manifest.vocabulary_uri).schema_version,pin.schemaVersion);
});

test('original-backed Linux and Windows source opens byte-identically; minimal edit/undo preserves source',()=>{
 const examples=['linux-home-nosuid.assessment','windows-server-2025-lock-screen.assessment','windows-server-2025-sysvol-permissions.assessment'];
 const order=['item_requirement','field_requirement','fields'];
 // Pack JSON keys are sorted for reproducible hashes; authoring presentation
 // order must be derived from the original pinned schema, never Object.keys
 // on a normalized metadata resource.
 const canonicalLanguage=JSON.parse(readFileSync(join(source,'schema/assessment-language.schema.json'),'utf8'));
 const schemaOrder=Object.keys(canonicalLanguage.$defs.canonical_all_items_requirement.properties).slice(0,3);
 assert.deepEqual(schemaOrder,order);
 for(const name of examples){
  const raw=readFileSync(join(source,'examples',name+'.yaml'),'utf8');
  assert.equal(raw,readFileSync(join(currentSamples,name+'.yaml'),'utf8'),name+' canonical vs current sample');
  const buffer=new SourceBuffer(raw);const document=buffer.json();
  assert.equal(buffer.openOrSave(),raw);assert.deepEqual(pack.validate(base+'assessment.schema.json',document),[]);
  const requirement=Object.values(document.assessment.tests)[0].require;
  assert.deepEqual(Object.keys(requirement).slice(0,3),order,name+' authoring order');
  assert.ok(raw.includes('        field_requirement: {'),name+' compact Field requirement');
  if(name==='windows-server-2025-lock-screen.assessment')assert.ok(raw.includes('fields: {type: {equals: dword}, value: {equals: 1}}'));
  if(name==='linux-home-nosuid.assessment')assert.ok(raw.includes('fields: {mount_options: {equals: nosuid}}'));
  const title=document.assessment.assessment_title;
  const edit=buffer.editScalar(['assessment','assessment_title'],title+' (local edit)',sha256(raw));
  assert.equal(edit.undo().text,raw);assert.equal(edit.document.json().assessment.assessment_title,title+' (local edit)');
  assert.deepEqual(pack.validate(base+'assessment.schema.json',edit.document.json()),[]);
  const before=raw.slice(0,edit.range[0]),after=raw.slice(edit.range[1]);assert.equal(edit.document.text,before+edit.replacement+after);
 }
});

test('Show All / safe / aggressive retain explicit YAML and visible overrides',()=>{
 const req=base+'assessment-language.schema.json#/$defs/canonical_all_items_requirement/properties/item_requirement/properties/items_found';
 const selector=pack.manifest.capabilities['windows.registry'].schema_uri+'#/$defs/object/properties/key';
 const help=pack.describe(selector,context);assert.ok(help.choices.includes('equals'));assert.ok(help.choices.includes('matches_regex'));
 const created=pack.newKeyChoice(selector,'example',context);assert.deepEqual(created,{equals:'example'});
 const arraySeed={equals:['alpha','beta'],datatype:'string'};
 const variableSeed={equals:{variable:'example-variable'},datatype:'string'};
 for(const seed of [arraySeed,variableSeed]){
  const authored=pack.newObjectDefaults(selector,seed,context);assert.equal(authored.value_match,'every');
  const hintUri=base+'assessment-language.schema.json#/$defs/object_selector_predicate/properties/value_match';
  assert.equal(pack.control(hintUri,'every',{...context,parentValue:authored},'hide-defaults').hidden,true);
  assert.equal(pack.control(hintUri,'every',{...context,parentValue:{equals:'literal'}},'hide-defaults').hidden,false);
 }
 assert.deepEqual(pack.newObjectDefaults(selector,{equals:'literal'},context),{equals:'literal'});
 const hidden=pack.control(selector,created,context,'hide-defaults');assert.equal(hidden.hidden,true);assert.equal(hidden.hiddenScope,'choice_only_arguments_remain_visible');
 assert.equal(pack.control(req,'one_or_more',context,'show-all').hidden,false);
 assert.equal(pack.control(req,'one_or_more',context,'hide-defaults').hidden,true);
 assert.equal(pack.control(req,'none',context,'hide-defaults').hidden,false);
 assert.equal(pack.control(req,'one_or_more',{...context,isOverride:true},'aggressive-preview').hidden,false);
 const paired=base+'assessment-language.schema.json#/$defs/canonical_all_items_requirement';
 const comparison={item_requirement:{items_found:'one_or_more',items_satisfying:'every'},field_requirement:{values_found:'one_or_more',values_matching:'every'},fields:{sample:{equals:true}}};
 assert.deepEqual(pack.validate(paired,comparison),[]);
 assert.ok(pack.validate(paired,{items_found:'one_or_more',items_satisfying:'every',field_requirement:comparison.field_requirement,fields:comparison.fields}).length>0);
 assert.ok(pack.validate(paired,{...comparison,item_requirement:{items_found:'one_or_more'}}).length>0);
 const shell=pack.manifest.capabilities['independent.shellcommand'].schema_uri+'#/$defs/object';
 const object=pack.newObjectDefaults(shell,{object_title:'Explicit author action',command:'echo value'},context);
 assert.equal(object.error_if_exit_status_not_0,false);assert.equal(object.error_if_stderr_exists,false);assert.equal(Object.hasOwn(object,'traversal'),false);
 const windows=base+'capability-common.schema.json#/$defs/windows_file_traversal';
 const unix=base+'capability-common.schema.json#/$defs/file_traversal';
 assert.equal(pack.newObjectDefaults(windows,{},context).recurse,'directories');
 assert.equal(pack.newObjectDefaults(unix,{},context).recurse,'symlinks_and_directories');
 assert.equal(pack.newObjectDefaults(windows,{},context).max_depth,'unlimited');
});

// Upstream audit regression: every Object control must expose resolved help.
test('all capability Object controls expose pinned schema descriptions',()=>{
 let count=0;
 for(const cap of Object.values(pack.manifest.capabilities)){
  const properties=pack.resource(cap.schema_uri).$defs?.object?.properties ?? {};
  for(const name of Object.keys(properties)){
   const pointer=name.replace(/~/g,'~0').replace(/\//g,'~1');
   const help=pack.describe(cap.schema_uri+'#/$defs/object/properties/'+pointer,context);
   assert.ok(help.description.trim(),cap.schema_uri+':'+name);count++;
  }
 }
 assert.equal(count,610);
});

test('adopted native Result A schemas reject old wire fields without evaluating supplied outcomes',()=>{
 const folder=fixtureRoot;
 const result=JSON.parse(readFileSync(join(folder,'native.test-result.json'),'utf8'));
 const original=structuredClone(result);
 assert.deepEqual(pack.validate(base+'test-result.schema.json',result),[]);
 assert.deepEqual(result,original);
 for(const uri of ['require-result.schema.json','state-result.schema.json']){
  assert.deepEqual(pack.validate(base+uri,result.per_item_results[0].require_results[0]),[]);
 }
 const leaf=result.per_item_results[0].require_results[0].require_results[1].field_results[0];
 for(const uri of ['field-result.schema.json','entity-result.schema.json'])assert.deepEqual(pack.validate(base+uri,leaf),[]);
 for(const patch of [{state_refs:['test.states[0]']},{check:'all'},{state_operator:'AND'},{outcome:'error'}]){
  assert.ok(pack.validate(base+'test-result.schema.json',{...result,...patch}).length>0);
 }
 const parent=JSON.parse(readFileSync(join(folder,'native.assessment-result.json'),'utf8'));
 assert.deepEqual(pack.validate(base+'assessment-result.schema.json',parent),[]);
 // Schema-only integration: source binding/record correlation stays upstream.
});

test('final selector/API help stays schema-driven for all fifteen capabilities',()=>{
 const catalog=JSON.parse(readFileSync(join(source,'schema/selector-api-contracts.json'),'utf8'));
 const fixture=JSON.parse(readFileSync(join(fixtureRoot,'selector-api.assessment.json'),'utf8'));
 assert.equal(Object.keys(catalog.capabilities).length,15);
 let count=0;
 for(const test of Object.values(fixture.assessment.tests)){
  const uri=pack.manifest.capabilities[test.capability].schema_uri;
  const generated=pack.resource(uri);
  for(const name of Object.keys(catalog.capabilities[test.capability].fields)){
   const description=generated.$defs.object.properties[name].description;
   assert.ok(description.includes('Decision22'));
   assert.ok(description.includes('Collected-value comparisons remain independent.'));
   assert.ok(description.includes('https://learn.microsoft.com/')||description.includes('https://github.com/'));
   count++;
  }
  assert.deepEqual(pack.validate(uri+'#/$defs/object',test.object),[]);
  assert.ok(pack.validate(uri+'#/$defs/object',{...test.object,case_sensitive:false}).length>0);
 }
 assert.equal(count,42);
 // Offline metadata/schema validation only; no provider, API or UI execution.
});



test('Graphical model covers complex canonical Assessments without flattening advanced source',()=>{
 for(const name of ['windows-server-2025-lock-screen.assessment','linux-home-nosuid.assessment','windows-server-2025-sysvol-permissions.assessment']){
  const raw=readFileSync(join(source,'examples',name+'.yaml'),'utf8'); const model=assessmentEditorModel({getText:()=>raw,version:3},pack);
  assert.equal(model.ok,true,name); assert.equal(model.assessment.tests.length,1,name); assert.ok(model.assessment.tests[0].explanation.includes('authoring explanation'),name);
  assert.ok(model.assessment.tests[0].objectControls.length>0,name); assert.ok(model.assessment.tests[0].itemControls.length>0,name);
  assert.equal(new SourceBuffer(raw).openOrSave(),raw,name);
 }
});
test('canonical explanations teach Registry requirements without scanner claims',()=>{
 const raw=readFileSync(join(source,'examples/windows-server-2025-lock-screen.assessment.yaml'),'utf8');
 const value=new SourceBuffer(raw).json(); const explanation=explainAssessment(value,pack);
 assert.match(explanation,/Windows Registry/); assert.match(explanation,/at least one_or_more|at least one or more/); assert.match(explanation,/every selected Item/); assert.match(explanation,/field values must match/); assert.match(explanation,/not a scanner result/);
});
test('schema-driven model exposes canonical Registry enum help and revision',()=>{
 const raw=readFileSync(join(source,'examples/windows-server-2025-lock-screen.assessment.yaml'),'utf8');
 const model=modelFor({getText:()=>raw,version:7},pack);
 assert.equal(model.ok,true); assert.equal(model.revision,sha256(raw));
 const path=['assessment','tests','verifies-prevent-enabling-screen-slide-show-is-set-enabled-test','require','item_requirement','items_found'];
 const field=model.fields.find(item=>JSON.stringify(item.path)===JSON.stringify(path));
 assert.ok(field); assert.equal(field.label,'Items found'); assert.deepEqual(field.choices,['none','exactly_one','one_or_more','zero_or_more']);
});
test('Variable graphical operations come only from the active native expression schema',()=>{
 const operations=variableExpressionOperations(pack).map(option=>option.value);
 assert.deepEqual(operations,['literal','variable','values','concat','regex_capture','unique','merge']);
 assert.equal(operations.includes('count'),false);
 const assessment=pack.resource(base+'assessment.schema.json');
 assert.equal(assessment.properties.assessment.properties.variables.additionalProperties.$ref,'variable-expression.schema.json');
 const inactive=pack.resource(base+'variable-function-expression.schema.json');
 assert.ok(inactive.$defs.function_call.properties.function.properties.name.enum.includes('count'));
 const nativeCount={function:{name:'count',arguments:[{literal:'value'}],options:{}}};
 assert.ok(pack.validate(base+'variable-expression.schema.json',nativeCount).length>0);
});

test('graphical operator controls resolve every Object/Require context from the pinned contract',()=>{
 const objectExpected=['equals','not_equal','case_insensitive_equals','case_insensitive_not_equal','matches_regex'];
 assert.deepEqual(selectorOperatorChoices(pack,'windows.registry','hive',false).map(x=>x.value),['equals']);
 assert.deepEqual(selectorOperatorChoices(pack,'linux.partition','mount_point',false).map(x=>x.value),objectExpected);
 assert.deepEqual(selectorOperatorChoices(pack,'windows.registry','type',true).map(x=>x.value),[
   'equals','not_equal','case_insensitive_equals','case_insensitive_not_equal','greater_than',
   'greater_than_or_equal','less_than','less_than_or_equal','matches_regex']);
 assert.deepEqual(selectorOperatorChoices(pack,'independent.shellcommand','exit_status',true).map(x=>x.value),[
   'equals','not_equal','case_insensitive_equals','case_insensitive_not_equal','greater_than',
   'greater_than_or_equal','less_than','less_than_or_equal','matches_regex']);
 assert.deepEqual(selectorValueChoices(pack,'windows.registry','type','equals',true).map(x=>x.value),
   pack.resource(pack.manifest.capabilities['windows.registry'].mapping_uri).native.state_value_enums.type);
 const forbidden=/^(float|binary|version|ipv4|ipv6|rpm_evr|debian_evr|fileset_revision|ios_version)_/;
 for(const capability of Object.keys(pack.manifest.capabilities)) {
   for(const field of ['type','exit_status','mount_point','value']) {
     const options=selectorOperatorChoices(pack,capability,field,true).map(x=>x.value);
     assert.equal(options.some(value=>forbidden.test(value)),false,capability+'/'+field);
   }
 }
 const variableSample=readFileSync(join(source,'examples/windows-server-2025-sysvol-permissions.assessment.yaml'),'utf8');
 const variableModel=assessmentEditorModel({getText:()=>variableSample,version:3},pack);
 const nested=variableModel.fields.find(field=>field.path.join('.')==='assessment.variables.icacls-and-path-to-sysvol-directory-variable.expression.concat.1.regex_capture.value.values.object.hive.equals');
 assert.ok(nested); assert.deepEqual(nested.operatorChoices,['equals']); assert.equal(nested.operatorCompatible,true);
 const shared={assessment:{id:'shared-assessment',version:1,assessment_title:'Shared',mode:'automated',class:'compliance',shared_objects:{'registry-object':{object_title:'Registry',capability:'windows.registry',hive:{equals:'local_machine'}}},tests:{'registry-test':{test_title:'Registry',capability:'windows.registry',object:{hive:{equals:'local_machine'}},require:{item_requirement:{items_found:'one_or_more',items_satisfying:'every'},fields:{type:{equals:'dword'}}}}}}};
 const sharedRaw=new SourceBuffer(JSON.stringify(shared)).text; const sharedModel=assessmentEditorModel({getText:()=>sharedRaw,version:4},pack);
 const sharedHive=sharedModel.fields.find(field=>field.path.join('.')==='assessment.shared_objects.registry-object.hive.equals');
 assert.ok(sharedHive); assert.deepEqual(sharedHive.operatorChoices,['equals']);
 const typeRequire=sharedModel.fields.find(field=>field.path.join('.')==='assessment.tests.registry-test.require.fields.type.equals');
 assert.ok(typeRequire); assert.ok(typeRequire.operatorDescriptions.equals); assert.equal(typeRequire.operatorCompatible,true);
 const invalid={assessment:{...shared.assessment,tests:{'registry-test':{...shared.assessment.tests['registry-test'],object:{mount_point:{float_equals:'/tmp',datatype:'float'},capability:'linux.partition'}}}}};
 const invalidRaw=new SourceBuffer(JSON.stringify(invalid)).text; const invalidModel=assessmentEditorModel({getText:()=>invalidRaw,version:5},pack);
 const incompatible=invalidModel.fields.find(field=>field.path.join('.')==='assessment.tests.registry-test.object.mount_point.float_equals');
 assert.ok(incompatible); assert.equal(incompatible.operatorCompatible,false); assert.ok(incompatible.operatorChoices.includes('float_equals'));
 assert.deepEqual(comparisonOperations(pack,invalid.assessment,['assessment','tests','registry-test','object','mount_point','float_equals'],true),['equals','not_equal','case_insensitive_equals','case_insensitive_not_equal','matches_regex','float_equals']);
});

test('graphical model keeps incomplete draft YAML inspectable without normalization',()=>{
 const raw=`assessment:
  variables:
    draft-variable:
      kind: local
      datatype: string
      expression:
`;
 const model=modelFor({getText:()=>raw,version:1},pack);
 assert.equal(model.ok,true);assert.equal(model.draft,true);assert.equal(model.fields.some(field=>field.path.join('.')==='assessment.variables.draft-variable.datatype'),true);
 const malformed=`assessment:
  tests:
    draft-test:
      capability: windows.registry
      object: {hive: {equals: `;
 const malformedModel=modelFor({getText:()=>malformed,version:2},pack);
 assert.equal(malformedModel.ok,true);assert.equal(malformedModel.draft,true);assert.ok(malformedModel.parseDiagnostics.length>0);
});

test('canonical generic predicate contracts retain Variable/Input branches and separate Object record sources',()=>{
 for(const definition of ['scalar_field_predicate','record_field_predicate']){
  const operators=predicateOperatorChoices(pack,definition).map(choice=>choice.value);
  assert.deepEqual(operators,['case_insensitive_equals','case_insensitive_not_equal','equals','greater_than','greater_than_or_equal','less_than','less_than_or_equal','matches_regex','not_equal']);
  assert.deepEqual(predicateValueSourceChoices(pack,definition,'equals'),['fixed','variable','input']);
 }
 assert.deepEqual(predicateValueSourceChoices(pack,'object_record_field_predicate','equals'),['fixed','variable']);
 assert.ok(!predicateValueSourceChoices(pack,'object_record_field_predicate','equals').includes('input'));
});

test('nested Require record predicates use canonical record contracts without mixing cardinality',()=>{
 const assessment={tests:{sql:{capability:'independent.sql',require:{fields:{result:{record:{fields:{column:{equals:'name'}}}}}}}}};
 const path=['assessment','tests','sql','require','fields','result','record','fields','column','equals'];
 assert.deepEqual(comparisonOperations(pack,assessment,path),['case_insensitive_equals','case_insensitive_not_equal','equals','greater_than','greater_than_or_equal','less_than','less_than_or_equal','matches_regex','not_equal']);
 assert.deepEqual(comparisonValueSources(pack,assessment,path),['fixed','variable','input']);
 const model=assessmentEditorModel({getText:()=>`assessment:
  tests:
    sql:
      capability: independent.sql
      require:
        fields:
          result:
            record:
              fields:
                column: {equals: name}
`,version:1},pack);
 const field=model.fields.find(item=>item.path.join('.')===path.slice(0,-1).join('.')+'.equals');
 assert.ok(field?.valueSources.includes('variable'));
 assert.ok(field?.valueSources.includes('input'));
 assert.ok(!field?.operatorChoices.includes('binary_equals'));
});

test('current sysvol sample separates scalar comparison, value matching, and existence cardinality',()=>{
 const raw=readFileSync(join(currentSamples,'windows-server-2025-sysvol-permissions.assessment.yaml'),'utf8');
 const value=new SourceBuffer(raw).json();
 assert.deepEqual(pack.validate(base+'assessment.schema.json',value),[]);
 const model=assessmentEditorModel({getText:()=>raw,version:1},pack);
 const stdoutPrefix='assessment.tests.permissions-must-conform-to-minimum-requirements-test.require.fields.stdout_line';
 const stderrPrefix='assessment.tests.permissions-must-conform-to-minimum-requirements-test.require.fields.stderr_line';
 const regexFields=model.fields.filter(field=>field.path.join('.').startsWith(stdoutPrefix+'.matches_regex.'));
 assert.equal(regexFields.length,9);
 assert.ok(regexFields.every(field=>field.operatorCompatible===undefined), 'regex array items must not be scalar operators');
 const valueMatch=model.fields.find(field=>field.path.join('.')===stdoutPrefix+'.value_match');
 const valuesFound=model.fields.find(field=>field.path.join('.')===stderrPrefix+'.values_found');
 assert.equal(valueMatch?.value,'one_or_more');
 assert.deepEqual(valueMatch?.choices,['none','exactly_one','one_or_more','every']);
 assert.equal(valueMatch?.operatorCompatible,undefined);
 assert.equal(valuesFound?.value,'none');
 assert.equal(valuesFound?.operatorCompatible,undefined);
 const wizardField=model.assessment.tests.find(test=>test.id==='permissions-must-conform-to-minimum-requirements-test').requireFieldOptions.find(field=>field.name==='stderr_line');
 assert.ok(wizardField.operations.some(operation=>operation.value==='values_found'));
 assert.deepEqual(wizardField.valueChoices.values_found,['none','exactly_one','one_or_more','every','zero_or_more']);
 assert.equal(model.fields.filter(field=>field.operatorCompatible===false).length,0);
 // A schema-declared scalar operation outside the capability's allowed subset
 // remains explicitly diagnosed rather than being hidden by this distinction.
 const invalid={assessment:{...value.assessment,tests:{...value.assessment.tests,'invalid-test':{capability:'linux.partition',object:{mount_point:{float_equals:'/tmp',datatype:'float'}},require:{fields:{mount_point:{float_equals:'/tmp'}}}}}}};
 const invalidModel=assessmentEditorModel({getText:()=>JSON.stringify(invalid),version:2},pack);
 assert.equal(invalidModel.fields.find(field=>field.path.join('.')==='assessment.tests.invalid-test.object.mount_point.float_equals')?.operatorCompatible,false);
 assert.equal(invalidModel.fields.find(field=>field.path.join('.')==='assessment.tests.invalid-test.require.fields.mount_point.float_equals')?.operatorCompatible,false);
});

test('all current-v04 sample Assessments have no false-invalid graphical operator warnings',()=>{
 const reports=[];
 for(const name of readdirSync(currentSamples).filter(item=>item.endsWith('.assessment.yaml'))){
  const raw=readFileSync(join(currentSamples,name),'utf8');
  const value=new SourceBuffer(raw).json();
  assert.deepEqual(pack.validate(base+'assessment.schema.json',value),[],name);
  const model=assessmentEditorModel({getText:()=>raw,version:1},pack);
  const missingHelp=model.fields.filter(field=>!String(field.description||'').trim()).map(field=>field.path.join('.'));
  assert.deepEqual(missingHelp,[],name+' has a schema/vocabulary help description for every authored scalar');
  const fieldConditions=model.fields.filter(field=>field.path.includes('fields')&&field.path.length>field.path.indexOf('fields')+1);
  assert.ok(fieldConditions.every(field=>/Collected field|comparison|schema|allowed|datatype/i.test(String(field.description))),name+' field conditions retain contextual schema help');
  const warnings=model.fields.filter(field=>field.operatorCompatible===false).map(field=>field.path.join('.'));
  reports.push({name,warnings});
 }
 assert.ok(reports.length>0);
 assert.deepEqual(reports.filter(report=>report.warnings.length),[],JSON.stringify(reports));
});

test('Delivery A contract adapter inventories operands and Variable validation without runtime claims',()=>{
 const object=expressionContract(pack,'windows.registry','hive','object');
 assert.deepEqual(object.operators.map(option=>option.value),['equals']);
 assert.deepEqual(object.operandSources,['fixed','variable']);
 assert.equal(object.operatorSources.equals.includes('input'),false);
 assert.deepEqual(object.datatypes,['string']);
 assert.deepEqual(object.cardinalityControls,['value_match']);
 const require=expressionContract(pack,'windows.registry','type','require');
 assert.ok(require.operandSources.includes('fixed'));assert.ok(require.operandSources.includes('variable'));assert.ok(require.operandSources.includes('input'));
 assert.ok(require.operatorDocumentation.equals);assert.deepEqual(require.datatypes,['string']);
 const assessment={variables:{
   'literal-variable':{kind:'constant',datatype:'string',expression:{literal:'x'}},
   'array-variable':{kind:'constant',datatype:'string',expression:{literal:['x','y']}},
   'cycle-a-variable':{kind:'local',datatype:'string',expression:{variable:'cycle-b-variable'}},
   'cycle-b-variable':{kind:'local',datatype:'string',expression:{variable:'cycle-a-variable'}},
   'wrong-variable':{kind:'local',datatype:'integer',expression:{literal:1}}
  },tests:{
   'sample-test':{capability:'windows.registry',object:{hive:{equals:{variable:'wrong-variable'}}},require:{fields:{type:{equals:{variable:'wrong-variable'}}}}}
  }};
 const analysis=analyzeVariables(pack,assessment,true);
 assert.equal(analysis.runtimeEvaluation,'not_available');
 assert.equal(analysis.declarations.find(item=>item.id==='array-variable')?.potentialCardinality,'many');
 assert.ok(analysis.diagnostics.some(item=>item.code==='variable-cycle'));
 assert.ok(analysis.diagnostics.filter(item=>item.code==='incompatible-variable-datatype').length>=2);
 assert.ok(analysis.diagnostics.some(item=>item.code==='missing-value-match-for-variable'&&item.kind==='cardinality'));
 const missingUsage=analyzeVariables(pack,{tests:{'missing-test':{capability:'windows.registry',object:{hive:{equals:{variable:'missing-variable'}}}}}},false);
 assert.ok(missingUsage.diagnostics.some(item=>item.code==='unresolved-variable-reference'&&item.path.join('.').endsWith('object.hive.equals.variable')));
 const cardinalitySatisfied=structuredClone(assessment);
 cardinalitySatisfied.tests['sample-test'].object.hive.value_match='every';
 cardinalitySatisfied.tests['sample-test'].require.fields.type.value_match='every';
 assert.equal(analyzeVariables(pack,cardinalitySatisfied,false).diagnostics.some(item=>item.code==='missing-value-match-for-variable'),false);
 assert.match(variableAnalysisSummary(analysis),/runtime evaluation not available/);
 const model=assessmentEditorModel({getText:()=>new SourceBuffer(JSON.stringify({assessment})).text,version:1},pack);
 assert.ok(model.variableAnalysis);assert.ok(model.variableDiagnostics.some(item=>item.code==='variable-cycle'));assert.match(model.variableAnalysisSummary,/runtime evaluation not available/);
 const draft=analyzeVariables(pack,{variables:{'draft-variable':{kind:'local'}}},true);
 assert.equal(draft.diagnostics.find(item=>item.code==='incomplete-variable-declaration')?.severity,'info');
 const completed=analyzeVariables(pack,{variables:{'draft-variable':{kind:'local'}}},false);
 assert.equal(completed.diagnostics.find(item=>item.code==='incomplete-variable-declaration')?.severity,'error');
});

test('Object and Require Variable contracts stay schema-backed and datatype-compatible',()=>{
 const raw=`assessment:
  id: variable-contract-assessment
  version: 1
  assessment_title: Variable contract
  mode: automated
  class: compliance
  variables:
    registry-string-variable:
      kind: local
      datatype: string
      expression: {literal: {datatype: string, value: local_machine}}
    registry-integer-variable:
      kind: local
      datatype: integer
      expression: {literal: {datatype: integer, value: 1}}
  tests:
    registry-test:
      test_title: Registry test
      capability: windows.registry
      object:
        hive: {equals: {variable: registry-string-variable}}
        key: {equals: {variable: registry-string-variable}}
      require:
        item_requirement: {items_found: one_or_more, items_satisfying: every}
        fields:
          type: {equals: {variable: registry-string-variable}}
          value: {equals: {variable: registry-integer-variable}}
`;
 const value=new SourceBuffer(raw).json();const assessment=value.assessment;
 assert.deepEqual(comparisonValueSources(pack,assessment,['assessment','tests','registry-test','object','hive','equals']),['fixed','variable']);
 assert.deepEqual(comparisonValueSources(pack,assessment,['assessment','tests','registry-test','require','fields','type','equals']),['fixed','variable','input']);
 assert.equal(comparisonVariableCompatible(pack,assessment,['assessment','tests','registry-test','object','hive','equals'],'registry-string-variable'),true);
 assert.equal(comparisonVariableCompatible(pack,assessment,['assessment','tests','registry-test','require','fields','type','equals'],'registry-integer-variable'),false);
 const model=assessmentEditorModel({getText:()=>raw,version:1},pack);
 const key=model.fields.find(field=>field.path.join('.')==='assessment.tests.registry-test.object.key.equals.variable');
 const type=model.fields.find(field=>field.path.join('.')==='assessment.tests.registry-test.require.fields.type.equals.variable');
 assert.deepEqual(key?.valueSources,['fixed','variable']);assert.deepEqual(type?.valueSources,['fixed','variable','input']);
 assert.deepEqual(key?.variableChoices,['registry-string-variable']);assert.deepEqual(type?.variableChoices,['registry-string-variable']);
});

test('canonical Windows Registry Assessment rejects stale edits without changing source',()=>{
 const raw=readFileSync(join(source,'examples/windows-server-2025-lock-screen.assessment.yaml'),'utf8');
 const buffer=new SourceBuffer(raw); const path=['assessment','tests','verifies-prevent-enabling-screen-slide-show-is-set-enabled-test','require','fields','value','equals'];
 const revision=sha256(raw); const first=buffer.editScalar(path,2,revision);
 assert.equal(first.document.json().assessment.tests['verifies-prevent-enabling-screen-slide-show-is-set-enabled-test'].require.fields.value.equals,2);
 assert.throws(()=>first.document.editScalar(path,3,revision),/Stale/);
 assert.equal(buffer.text,raw);
 assert.equal(first.undo().text,raw);
 assert.deepEqual(pack.validate(base+'assessment.schema.json',first.document.json()),[]);
});

test('existing optional branches and multi-Test evaluation remain visible without execution',()=>{
 const optional=readFileSync(join(source,'examples/windows-optional-organizational-input.assessment.yaml'),'utf8');
 const optionalModel=assessmentEditorModel({getText:()=>optional,version:4},pack);
 assert.match(optionalModel.assessment.tests[0].explanation,/optional Input branch/);
 assert.match(optionalModel.assessment.tests[0].explanation,/not_evaluated/); assert.equal(optionalModel.assessment.inputControls.length,1); assert.equal(optionalModel.assessment.evaluationControl,undefined);
 const multi={assessment:{id:'multi-assessment',version:1,assessment_title:'Multi',mode:'automated',class:'compliance',tests:{one:{test_title:'One',capability:'windows.registry',object:{hive:{equals:'local_machine'}},require:{item_requirement:{items_found:'one_or_more'}}},two:{test_title:'Two',capability:'windows.registry',object:{hive:{equals:'local_machine'}},require:{item_requirement:{items_found:'one_or_more'}}}},evaluate:{xor:[{test:'one'},{test:'two'}]}}};
 const multiYaml=new SourceBuffer(JSON.stringify(multi)).text;
 const multiModel=assessmentEditorModel({getText:()=>multiYaml,version:5},pack);
 assert.equal(multiModel.assessment.tests.length,2);
 assert.match(multiModel.assessment.evaluationExplanation,/XOR/);
 assert.match(multiModel.assessment.evaluationExplanation,/no Test has been executed/); assert.deepEqual(multiModel.assessment.evaluationControl.operations,['and','or','one','xor']); assert.equal(multiModel.assessment.evaluationControl.operation,'xor');
});


test('Graphical controls preserve canonical requirement values and sibling paths',()=>{
 const raw=readFileSync(join(source,'examples/windows-server-2025-lock-screen.assessment.yaml'),'utf8');
 const model=assessmentEditorModel({getText:()=>raw,version:9},pack); const testModel=model.assessment.tests[0];
 assert.deepEqual(testModel.fieldRequirement.map(field=>[field.name,field.value]),[['values_found','one_or_more'],['values_matching','every']]);
 assert.deepEqual(testModel.fieldRequirement.map(field=>[field.name,field.value,field.hidden,field.hasSuggestion,field.suggested]),[
  ['values_found','one_or_more',true,true,'one_or_more'],
  ['values_matching','every',true,true,'every']
 ]);
 assert.deepEqual(testModel.fieldRequirement.map(field=>[field.name,field.value,model.fields.find(candidate=>candidate.path.join('.')===field.path.join('.'))?.hidden]),[['values_found','one_or_more',true],['values_matching','every',true]]);
 const overridden=raw.replace('values_matching: every','values_matching: one_or_more');
 const overriddenModel=assessmentEditorModel({getText:()=>overridden,version:9},pack);
 assert.deepEqual(overriddenModel.fields.filter(field=>field.path.join('.').includes('.require.field_requirement.')).map(field=>field.hidden),[false,false]);
 const invalid=raw.replace('values_matching: every','values_matching: invalid-token');
 const invalidModel=assessmentEditorModel({getText:()=>invalid,version:9},pack);
 assert.equal(invalidModel.schemaValid,false);
 assert.ok(invalidModel.schemaDiagnostics.length>0);
 assert.ok(invalidModel.schemaDiagnostics.some(error=>error.path.join('.').includes('field_requirement.values_matching')));
 assert.deepEqual(invalidModel.fields.filter(field=>field.path.join('.').includes('.require.field_requirement.')).map(field=>field.hidden),[false,false]);
 assert.deepEqual(testModel.itemControls.map(field=>[field.name,field.value]),[['items_found','one_or_more'],['items_satisfying','every']]);
 const id=testModel.id; const foundPath=['assessment','tests',id,'require','field_requirement','values_found'];
 const matchingPath=['assessment','tests',id,'require','field_requirement','values_matching']; const buffer=new SourceBuffer(raw);
 const changed=buffer.editScalar(foundPath,'exactly_one',sha256(raw)); const value=changed.document.json().assessment.tests[id].require;
 assert.equal(value.field_requirement.values_found,'exactly_one'); assert.equal(value.field_requirement.values_matching,'every'); assert.equal(value.item_requirement.items_found,'one_or_more');
 const changedAgain=changed.document.editScalar(matchingPath,'one_or_more',sha256(changed.document.text)).document.json().assessment.tests[id].require;
 assert.equal(changedAgain.field_requirement.values_found,'exactly_one'); assert.equal(changedAgain.field_requirement.values_matching,'one_or_more');
});

test('contextual native YAML completion uses exact schema/cardinality scopes and manifest capabilities',()=>{
 const prefix=(value)=>`assessment:\n  class: ${value}`;
 assert.deepEqual(completionChoices(pack,prefix(''),prefix('').length).map(x=>x.value),['compliance','vulnerability','patch','inventory','miscellaneous']);
 const mode='assessment:\n  mode: '; assert.deepEqual(completionChoices(pack,mode,mode.length).map(x=>x.value),['manual','automated']);
 const reported='assessment:\n  tests:\n    check-test:\n      reported_elements: '; assert.deepEqual(completionChoices(pack,reported,reported.length).map(x=>x.value),['all','compared']);
 const linuxAssessment=readFileSync(join(currentSamples,'linux-home-nosuid.assessment.yaml'),'utf8');
 const linuxEvaluateOffset=linuxAssessment.lastIndexOf('test:')+'test:'.length+1;
 assert.deepEqual(completionChoices(pack,linuxAssessment,linuxEvaluateOffset).map(x=>x.value),Object.keys(new SourceBuffer(linuxAssessment).json().assessment.tests));
 const multiple=readFileSync(join(fixtureRoot,'p0-multiple-tests.assessment.yaml'),'utf8');
 const multipleEvaluateOffset=multiple.lastIndexOf('test:')+'test:'.length+1;
 assert.deepEqual(completionChoices(pack,multiple,multipleEvaluateOffset).map(x=>x.value),Object.keys(new SourceBuffer(multiple).json().assessment.tests));
 const canonical=readFileSync(join(currentSamples,'windows-server-2025-lock-screen.assessment.yaml'),'utf8'); const classOffset=canonical.indexOf('class:')+'class:'.length+1; assert.deepEqual(completionChoices(pack,canonical,classOffset).map(x=>x.value),['compliance','vulnerability','patch','inventory','miscellaneous']); const canonicalCapabilityOffset=canonical.indexOf('capability:')+'capability:'.length+1; assert.deepEqual(completionChoices(pack,canonical,canonicalCapabilityOffset).map(x=>x.value),Object.keys(pack.manifest.capabilities).sort());
 const cap='assessment:\n  tests:\n    check-test:\n      capability: '; const caps=completionChoices(pack,cap,cap.length).map(x=>x.value); assert.deepEqual(caps,Object.keys(pack.manifest.capabilities).sort());
 const found='assessment:\n  tests:\n    check-test:\n      require:\n        field_requirement:\n          values_found: '; assert.deepEqual(completionChoices(pack,found,found.length).map(x=>x.value),['none','exactly_one','one_or_more','every','zero_or_more']);
 const matching='assessment:\n  tests:\n    check-test:\n      require:\n        field_requirement:\n          values_matching: '; assert.deepEqual(completionChoices(pack,matching,matching.length).map(x=>x.value),['none','exactly_one','one_or_more','every']);
 const wrong='assessment:\n  tests:\n    check-test:\n      require:\n        item_requirement:\n          items_found: '; assert.deepEqual(completionChoices(pack,wrong,wrong.length).map(x=>x.value),['none','exactly_one','one_or_more','zero_or_more']);
 const flow='assessment:\n  tests:\n    check-test:\n      require:\n        field_requirement: {values_matching: '; assert.deepEqual(completionChoices(pack,flow,flow.length).map(x=>x.value),['none','exactly_one','one_or_more','every']);
 const registryObject='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {';
 const registryObjectSchema=pack.resource(pack.manifest.capabilities['windows.registry'].schema_uri);
 const registryObjectFields=Object.keys(registryObjectSchema.$defs.object.properties);
 assert.deepEqual(completionChoices(pack,registryObject,registryObject.length).map(x=>x.value),registryObjectFields);
 assert.equal(schemaDefaultValue(pack, registryObjectSchema.$id, { oneOf: [{ default: { first_branch: true } }, { default: { second_branch: true } }] }), undefined);
 assert.deepEqual(schemaDefaultValue(pack, registryObjectSchema.$id, { oneOf: [{ default: { same: true } }, { default: { same: true } }] }), { same: true });
 const unixObjectSchema=pack.resource(pack.manifest.capabilities['unix.file'].schema_uri);
 const scopedCapabilities=`assessment:
  note: "capability: windows.registry"
  tests:
    registry-test:
      capability: windows.registry
      object: {
    unix-test:
      object: {
      # capability: windows.registry
      capability: unix.file
`;
 const registryScopedOffset=scopedCapabilities.indexOf('object: {')+'object: {'.length;
 const unixScopedOffset=scopedCapabilities.lastIndexOf('object: {')+'object: {'.length;
 assert.deepEqual(completionChoices(pack,scopedCapabilities,registryScopedOffset).map(x=>x.value),registryObjectFields);
 assert.deepEqual(completionChoices(pack,scopedCapabilities,unixScopedOffset).map(x=>x.value),Object.keys(unixObjectSchema.$defs.object.properties));
 const missingCapability=`assessment:
  tests:
    registry-test:
      capability: windows.registry
      object: {
    missing-capability-test:
      object: {
`;
 const missingCapabilityOffset=missingCapability.lastIndexOf('object: {')+'object: {'.length;
 assert.deepEqual(completionChoices(pack,missingCapability,missingCapabilityOffset),[]);
 const requirementProperties='assessment:\n  tests:\n    check-test:\n      require: {';
 const requirementChoices=completionChoices(pack,requirementProperties,requirementProperties.length);
 const itemChoice=requirementChoices.find(x=>x.value==='item_requirement');
 const fieldChoice=requirementChoices.find(x=>x.value==='field_requirement');
 const fieldsChoice=requirementChoices.find(x=>x.value==='fields');
 assert.equal(itemChoice?.insertText,'item_requirement: {items_found: one_or_more, items_satisfying: every}');
 assert.equal(fieldChoice?.insertText,'field_requirement: {values_found: one_or_more, values_matching: every}');
 assert.equal(fieldsChoice?.insertText,'fields: {');
 assert.equal(itemChoice?.isDefault,true); assert.equal(itemChoice?.isPlaceholder,false);
 assert.equal(fieldsChoice?.isDefault,false); assert.equal(fieldsChoice?.isPlaceholder,true);
 const hiveOperators='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {hive: {';
 assert.deepEqual(completionChoices(pack,hiveOperators,hiveOperators.length).map(x=>x.value),['equals']);
 const hiveValues='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {hive: {equals: ';
 assert.deepEqual(completionChoices(pack,hiveValues,hiveValues.length).map(x=>x.value),['classes_root','current_config','current_user','current_user_local_settings','local_machine','users']);
 const keyOperators='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {key: {';
 assert.deepEqual(completionChoices(pack,keyOperators,keyOperators.length).map(x=>x.value),['equals','not_equal','case_insensitive_equals','case_insensitive_not_equal','matches_regex']);
 const partitionMountOperators=`assessment:
  tests:
    check-test:
      capability: linux.partition
      object: {mount_point: {`;
 assert.deepEqual(completionChoices(pack,partitionMountOperators,partitionMountOperators.length).map(x=>x.value),['equals','not_equal','case_insensitive_equals','case_insensitive_not_equal','matches_regex']);
 // Reviewed overlay contracts supply only the field-specific operators;
 // broad shared operators must not leak into completion.
 const registryKeyPrefix='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {hive: {equals: local_machine}, k';
 assert.deepEqual(completionChoices(pack,registryKeyPrefix,registryKeyPrefix.length).map(x=>x.value),registryObjectFields.filter(value=>value!=='hive'));
 const registryNamePrefix='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {hive: {equals: local_machine}, key: {equals: value}, n';
 assert.deepEqual(completionChoices(pack,registryNamePrefix,registryNamePrefix.length).map(x=>x.value),registryObjectFields.filter(value=>!['hive','key'].includes(value)));
 const registryFields='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      require:\n        fields: {';
 const registrySchema=pack.resource(pack.manifest.capabilities['windows.registry'].schema_uri);
 const registryStateFields=[...new Set((registrySchema.$defs.state_predicate.oneOf ?? []).flatMap(branch=>branch.required ?? []))];
 assert.deepEqual(completionChoices(pack,registryFields,registryFields.length).map(x=>x.value),registryStateFields);
 const registryFlowFields='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      require: {fields: {';
 assert.deepEqual(completionChoices(pack,registryFlowFields,registryFlowFields.length).map(x=>x.value),registryStateFields);
 const registryTypeValues='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      require:\n        fields: {type: {equals: ';
 const registryMapping=pack.resource(pack.manifest.capabilities['windows.registry'].mapping_uri);
 assert.deepEqual(completionChoices(pack,registryTypeValues,registryTypeValues.length).map(x=>x.value),registryMapping.native.state_value_enums.type);
 const registryHiveStateValues='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      require:\n        fields: {hive: {equals: ';
 assert.deepEqual(completionChoices(pack,registryHiveStateValues,registryHiveStateValues.length).map(x=>x.value),registryMapping.native.state_value_enums.hive);
 const unixObject='assessment:\n  tests:\n    check-test:\n      capability: unix.file\n      object:\n        ';
 const unixSchema=pack.resource(pack.manifest.capabilities['unix.file'].schema_uri);
 assert.deepEqual(completionChoices(pack,unixObject,unixObject.length).map(x=>x.value),Object.keys(unixSchema.$defs.object.properties));
 const registrySet='assessment:\n  tests:\n    check-test:\n      capability: windows.registry\n      object: {set: {';
 const setSchema=registryObjectSchema.$defs.object.properties.set;
 const setProperties=new Set(); const walkSet=(node,base=pack.manifest.capabilities['windows.registry'].schema_uri,seen=new Set())=>{if(!node||typeof node!=='object')return; for(const key of Object.keys(node.properties??{}))setProperties.add(key); if(node.$ref){const uri=new URL(node.$ref,base).href;if(!seen.has(uri)){seen.add(uri);walkSet(pack.node(uri),uri,seen);}} for(const key of ['allOf','oneOf','anyOf'])for(const branch of node[key]??[])walkSet(branch,base,seen);}; walkSet(setSchema);
 assert.deepEqual(completionChoices(pack,registrySet,registrySet.length).map(x=>x.value),[...setProperties]);
});


test('recursive Variable expression completion follows schema oneOf and array item branches',()=>{
 const prefix=`assessment:
  variables:
    example-variable:
      expression:
        `;
 const alternatives=['literal','variable','values','concat','regex_capture','unique','merge'];
 assert.deepEqual(completionChoices(pack,prefix,prefix.length).map(choice=>choice.value),alternatives);
 const concat=`assessment:
  variables:
    example-variable:
      expression:
        concat:
        - `;
 assert.deepEqual(completionChoices(pack,concat,concat.length).map(choice=>choice.value),alternatives);
 const capture=`assessment:
  variables:
    example-variable:
      expression:
        concat:
        - regex_capture:
            `;
 assert.deepEqual(completionChoices(pack,capture,capture.length).map(choice=>choice.value),['pattern','value']);
 const captureValue=`assessment:
  variables:
    example-variable:
      expression:
        concat:
        - regex_capture:
            value:
              `;
 assert.deepEqual(completionChoices(pack,captureValue,captureValue.length).map(choice=>choice.value),alternatives);
 const merge=`assessment:
  variables:
    example-variable:
      expression:
        merge:
          `;
 assert.deepEqual(completionChoices(pack,merge,merge.length).map(choice=>choice.value),['delimiter','order','sort','values']);
 const nestedObject=`assessment:
  variables:
    example-variable:
      expression:
        values:
          object:
            capability: windows.registry
            hive: {equals: `;
 const registry=pack.resource(pack.manifest.capabilities['windows.registry'].schema_uri);
 const hiveEquals=registry.$defs.object.properties.hive.oneOf
   .flatMap(branch=>branch.allOf??[]).map(branch=>branch.properties?.equals).find(Boolean);
 const hiveValues=new Set();
 const collectEnums=(node)=>{if(!node||typeof node!=='object')return;for(const value of node.enum??[])if(typeof value==='string')hiveValues.add(value);for(const key of ['allOf','oneOf','anyOf','items'])for(const branch of (Array.isArray(node[key])?node[key]:node[key]?[node[key]]:[]))collectEnums(branch);};
 collectEnums(hiveEquals);
 assert.deepEqual(completionChoices(pack,nestedObject,nestedObject.length).map(choice=>choice.value),[...hiveValues]);
});

test('generic graphical CRUD metadata exposes schema-authorized collections without a field registry',()=>{
 const raw=readFileSync(join(source,'examples/windows-server-2025-lock-screen.assessment.yaml'),'utf8');
 const document={getText:()=>raw,version:1};
 const model=assessmentEditorModel(document,pack);
 assert.ok(Array.isArray(model.structuralNodes));
 const root=model.structuralNodes.find(node=>JSON.stringify(node.path)===JSON.stringify([]));
 assert.ok(root);
 const assessmentNode=model.structuralNodes.find(node=>JSON.stringify(node.path)===JSON.stringify(['assessment']));
 assert.ok(assessmentNode?.properties.some(property=>property.name==='tests'&&property.object));
 const test=model.structuralNodes.find(node=>node.path.length===3&&node.path[1]==='tests');
 assert.ok(test?.properties.some(property=>property.name==='require'&&property.object));
 const require=model.structuralNodes.find(node=>node.path.at(-1)==='require');
 assert.ok(require?.properties.some(property=>property.name==='item_requirement'&&property.object));
 assert.equal(model.structuralNodes.some(node=>node.properties?.some(property=>property.name==='new-property')),false);
});
