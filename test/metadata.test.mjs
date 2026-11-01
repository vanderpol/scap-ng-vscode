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
