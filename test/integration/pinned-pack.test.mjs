import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MetadataPack,SourceBuffer,sha256 } from '../../dist/index.js';
import { context } from '../helpers.mjs';

// Explicit paths: no downloads, upstream assets or copied content in this repo.
const directory=process.env.SCAP_NG_METADATA_PACK;
const source=process.env.SCAP_NG_SOURCE_ROOT;
if(!directory||!source)throw new Error('Select SCAP_NG_METADATA_PACK and SCAP_NG_SOURCE_ROOT explicitly');
const pin=JSON.parse(readFileSync(new URL('../../schema-profile.json',import.meta.url)));
const pack=new MetadataPack(directory,pin);
const base='https://scap-ng.dev/schema/v0.4.0/';

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
 const examples=['linux-home-mount-nosuid-assessment','windows-server-2025-shows-on-lock-screen-sv-278080-assessment','windows-server-2025-control-permissions-sv-278139-assessment'];
 for(const name of examples){
  const raw=readFileSync(join(source,'docs/examples/owner-contract-20261031',name+'.yaml'),'utf8');
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
 const req=base+'assessment-language.schema.json#/$defs/canonical_all_items_requirement/properties/items_found';
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
