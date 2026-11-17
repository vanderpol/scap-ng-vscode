import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, context, uri, hint } from './helpers.mjs';

test('one offline source drives help/enums and explicit hiding across modes',()=>{
 const f=fixture({type:'string',enum:['first','second'],default:'first',title:'Local label',description:'Local definition','x-scap-ng-authoring':hint()});
 try {const p=f.open();
  for(const mode of ['source','structured','guided'])assert.deepEqual(p.describe(uri,{...context,mode}).choices,['first','second']);
  assert.equal(p.control(uri,'first',context,'show-all').hidden,false);
  assert.equal(p.control(uri,'first',context,'hide-defaults').hidden,true);
  assert.equal(p.control(uri,'second',context,'aggressive-preview').hidden,false);
  for(const c of [{...context,isOverride:true},{...context,schemaValid:false},{...context,diagnostics:['error']},{...context,isOverride:undefined}])assert.equal(p.control(uri,'first',c,'hide-defaults').hidden,false);
  for(const v of [undefined,null,'unknown'])assert.equal(p.control(uri,v,context,'hide-defaults').hidden,false);
  assert.deepEqual(p.summarize([p.control(uri,'first',context,'hide-defaults')]),{hidden:1,total:1,groups:{comparison:1}});
  assert.equal(p.describe(uri,context).assessmentExecution,'unavailable');
  assert.throws(()=>p.describe(uri,{...context,documentVersion:'0.3.0'}),/version/);
  assert.throws(()=>p.resource('https://network.invalid/missing'),/Unavailable offline/);
 } finally {f.close();}
});

test('object defaults hide as one control and reveal the paired group on override',()=>{
 const f=fixture({type:'object',properties:{field_requirement:{type:'object',default:{values_found:'one_or_more',values_matching:'every'},'x-scap-ng-authoring':hint({control_id:'field_requirement'}),properties:{values_found:{type:'string'},values_matching:{type:'string'}}}}});
 try {const p=f.open();const parent=uri+'#/properties/field_requirement';const child=parent+'/properties/values_found';const exact={values_found:'one_or_more',values_matching:'every'};
  const hidden=p.control(child,'one_or_more',{...context,parentValue:exact,parentSchemaUri:parent},'hide-defaults');
  assert.equal(hidden.hidden,true);assert.equal(hidden.suggested,'one_or_more');assert.equal(hidden.hiddenScope,'value_control_only');
  const siblingOverride={...exact,values_matching:'one_or_more'};
  assert.equal(p.control(child,'one_or_more',{...context,parentValue:siblingOverride,parentSchemaUri:parent},'hide-defaults').hidden,false);
  assert.equal(p.control(parent,exact,{...context,parentValue:exact},'hide-defaults').hidden,true);
 } finally {f.close();}
});

test('new authoring only, required serialization, optional structures absent',()=>{
 const f=fixture({type:'object',required:['flag'],properties:{flag:{type:'boolean',default:false,'x-scap-ng-authoring':hint()},optional:{type:'object',properties:{depth:{default:9,type:'integer'}}}},additionalProperties:false});
 try {const p=f.open();const existing={};assert.ok(p.validate(uri,existing).length);assert.deepEqual(existing,{});
  assert.deepEqual(p.newObjectDefaults(uri,{},context),{flag:false});
  assert.deepEqual(p.newObjectDefaults(uri,{flag:true},context),{flag:true});
 } finally{f.close();}
});

test('key choices come from alternatives; operands remain visible; aggressive separate',()=>{
 const f=fixture({type:'object',oneOf:[{required:['merge']},{required:['split']}],properties:{merge:{type:'array'},split:{type:'array'}},additionalProperties:false,
  'x-scap-ng-authoring':hint({representation:'key',default_key:'merge',hide_when_default:false,aggressive_preview:true,hide_scope:'choice_only_arguments_remain_visible'})});
 try {const p=f.open(); assert.deepEqual(p.describe(uri,context).choices,['merge','split']);
  assert.deepEqual(p.newKeyChoice(uri,['operand'],context),{merge:['operand']});
  assert.equal(p.control(uri,{merge:['operand']},context,'hide-defaults').hidden,false);
  const hidden=p.control(uri,{merge:['operand']},context,'aggressive-preview');assert.equal(hidden.hidden,true);assert.deepEqual(hidden.serializedValue,{merge:['operand']});
  assert.equal(p.control(uri,{split:[]},context,'aggressive-preview').hidden,false);
 }finally{f.close();}
});

test('pack rejects hash drift, unpublished trees, version drift and path escapes',()=>{
 for(const mutate of [m=>m.unpublished_worktree=true,m=>m.schema_version='0.3.0',m=>m.resources[0].path='../escape',m=>m.resources[0].sha256='0'.repeat(64),m=>m.authoring_metadata_version=2]){
  const f=fixture({type:'string'},mutate);try{assert.throws(f.open);}finally{f.close();}
 }
 const f=fixture({type:'string'});try{writeFileSync(join(f.dir,'schema.json'),'{}');assert.throws(f.open,/hash/);}finally{f.close();}
});

test('a deliberately repinned compatible pack updates help and enums without code changes',()=>{
 for(const [choices,title] of [[['alpha','beta'],'Old help'],[['gamma','delta'],'New help']]){
  const f=fixture({type:'string',enum:choices,title});try{assert.deepEqual(f.open().describe(uri,context).choices,choices);assert.equal(f.open().describe(uri,context).title,title);}finally{f.close();}
 }
});

test('patternProperties are schema-resolved for dynamic Assessment members', async () => {
 const { resolveSchemaPath, schemaPatternPropertyLocations } = await import('../dist/schema-resolver.js');
 const root = 'https://example.invalid/root.json';
 const nodes = new Map([[root, {type:'object', patternProperties:{'^a-': {$ref: 'member.json'}}}],
   ['https://example.invalid/member.json', {type:'string'}]]);
 const pack = { node: uri => uri.includes('/patternProperties/') ? nodes.get(root).patternProperties['^a-'] : nodes.get(uri) };
 const locations = schemaPatternPropertyLocations(pack, [{uri: root, node: nodes.get(root)}], 'a-name');
 assert.equal(locations.length, 1);
 assert.equal(locations[0].pattern, '^a-');
 assert.equal(resolveSchemaPath(pack, root, ['a-name']).at(-1).node.type, 'string');
 assert.deepEqual(resolveSchemaPath(pack, root, ['b-name']), []);
});
