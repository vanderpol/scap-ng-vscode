import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MetadataPack,SourceBuffer,sha256 } from '../../dist/index.js';
import { context } from '../helpers.mjs';

// Explicit paths: no downloads, upstream assets or copied content in this repo.
const directory=process.env.SCAP_NG_METADATA_PACK;
const source=process.env.SCAP_NG_SOURCE_ROOT;
if(!directory||!source)throw new Error('Select SCAP_NG_METADATA_PACK and SCAP_NG_SOURCE_ROOT explicitly');
const pin=JSON.parse(readFileSync(new URL('../../schema-profile.json',import.meta.url)));
const fixtureRoot=fileURLToPath(new URL('../fixtures/',import.meta.url));
const sourceCommit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(sourceCommit!==pin.sourceCommit)throw new Error('Canonical schema checkout differs from the editor profile pin');
const pack=new MetadataPack(directory,pin);
const base='https://scap-ng.dev/schema/v0.4.0/';

test('adopted optional Input guard shape preserves source without inventing bindings or defaults',()=>{
 const raw=readFileSync(join(source,'examples/windows-optional-organizational-input.assessment.yaml'),'utf8');
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
 for(const name of examples){
  const raw=readFileSync(join(source,'examples',name+'.yaml'),'utf8');
  const buffer=new SourceBuffer(raw);const document=buffer.json();
  assert.equal(buffer.openOrSave(),raw);assert.deepEqual(pack.validate(base+'assessment.schema.json',document),[]);
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
