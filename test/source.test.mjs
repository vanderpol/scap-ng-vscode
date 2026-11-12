import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceBuffer,sha256,sourceRevisionMatches,previewRegex,previewRegexSafe } from '../dist/index.js';

test('byte-identical open/save with Unicode, BOM, CRLF, comments, anchors and flow style',()=>{
 for(const raw of ['# note\na: { b: "old", c: 2 } # end\n','\ufeff# π\r\na: \'old\'\r\n','a: &anchor old\nb: *anchor\n','a: |\n  multiline\n','a: [\n malformed'])assert.equal(new SourceBuffer(raw).openOrSave(),raw);
});
test('target scalar splice preserves surrounding bytes and undo; stale changes rejected',()=>{
 const raw='# note\r\na: { b: "old", c: 2 } # end\r\n';const source=new SourceBuffer(raw);
 const edit=source.editScalar(['a','b'],'new',sha256(raw));assert.equal(edit.document.text,raw.replace('"old"','"new"'));assert.equal(edit.undo().text,raw);assert.equal(edit.document.json().a.b,'new');
 assert.throws(()=>source.editScalar(['a','b'],'new','stale'),/Stale/);
});
test('unsafe aliases, anchored scalars, block scalars, malformed and duplicate YAML decline',()=>{
 for(const [raw,path] of [['a: &anchor old\nb: *anchor\n',['a']],['a: &anchor old\nb: *anchor\n',['b']],['a: |\n  text\n',['a']],['a: [\n',['a']],['a: 1\na: 2\n',['a']]])assert.throws(()=>new SourceBuffer(raw).editScalar(path,'x',sha256(raw)));
});
test('current 0.4 requirement fields edit as minimal source patches',()=>{
 const raw=`version: 0.4.0
assessment:
  tests:
    - capability: registry
      object: {hive: HKLM, key: Software\\Vendor}
      require:
        item_requirement: {items_found: one_or_more, items_satisfying: every}
        field_requirement: {values_found: one_or_more, values_matching: every}
        fields: {type: {equals: dword}, value: {equals: 1}}
  # unrelated comment remains byte-for-byte
`;
 const source=new SourceBuffer(raw);
 const path=['assessment','tests',0,'require','fields','value','equals'];
 const edit=source.editScalar(path,2,sha256(raw));
 assert.equal(edit.document.text,raw.replace('value: {equals: 1}','value: {equals: 2}'));
 assert.equal(edit.document.json().assessment.tests[0].require.fields.value.equals,2);
 assert.deepEqual(source.scalarRange(path),edit.range);
 assert.equal(edit.undo().text,raw);
});
test('plain enum/string edits retain plain style when safe',()=>{
 const raw='status: old-value\n';
 const edit=new SourceBuffer(raw).editScalar(['status'],'new-value',sha256(raw));
 assert.equal(edit.replacement,'new-value');
 assert.equal(edit.document.text,'status: new-value\n');
});
test('native Variable expression replacement preserves YAML and promotes constants to local',()=>{
 const raw=`assessment:
  variables:
    source-variable:
      kind: constant
      datatype: string
      expression:
        literal: hello
`;
 const source=new SourceBuffer(raw);
 const edit=source.replaceExpression(['assessment','variables','source-variable','expression'],{regex_capture:{pattern:'(.*)',value:{literal:''}}},sha256(raw),['assessment','variables','source-variable']);
 const value=edit.document.json().assessment.variables['source-variable'];
 assert.equal(value.kind,'local'); assert.equal(value.expression.regex_capture.pattern,'(.*)');
 assert.match(edit.document.text,/      kind: local/); assert.equal(edit.undo().text,raw);
});

test('block sequence append separates the inserted mapping from the following sibling',()=>{
 const raw=`assessment:
  variables:
    source-variable:
      expression:
        concat:
        - literal: first
        - literal: second
  tests:
    check-test: {}
`;
 const source=new SourceBuffer(raw);
 const path=['assessment','variables','source-variable','expression','concat'];
 const edit=source.insertArrayItem(path,{literal:''},sha256(raw));
 const value=edit.document.json().assessment.variables['source-variable'].expression.concat;
 assert.deepEqual(value,[{literal:'first'},{literal:'second'},{literal:''}]);
 assert.deepEqual(edit.document.json().assessment.tests['check-test'],{});
 assert.match(edit.document.text,/\n  tests:\n/);
 assert.equal(edit.undo().text,raw);
});

test('Evaluate additions preserve source references while wrapping an existing Test',()=>{
 const raw=`assessment:
  tests:
    first-test: {capability: independent.shellcommand, object: {shell: cmd}, require: {item_requirement: {items_found: one_or_more, items_satisfying: every}}}
    second-test: {capability: independent.shellcommand, object: {shell: cmd}, require: {item_requirement: {items_found: one_or_more, items_satisfying: every}}}
  evaluate:
    test: first-test
`;
 const source=new SourceBuffer(raw);
 const edit=source.replacePathValue(['assessment','evaluate'],{or:[{test:'first-test'},{test:'second-test'}]},sha256(raw));
 assert.deepEqual(edit.document.json().assessment.evaluate,{or:[{test:'first-test'},{test:'second-test'}]});
 assert.equal(edit.document.json().assessment.tests['first-test'].capability,'independent.shellcommand');
 assert.equal(edit.document.json().assessment.tests['second-test'].capability,'independent.shellcommand');
 assert.equal(edit.undo().text,raw);
});

test('Require logical condition replacement keeps following Test members on separate YAML lines',()=>{
 const raw=`assessment:
  tests:
    check-test:
      require:
        item_requirement: {items_found: one_or_more, items_satisfying: every}
        field_requirement: {values_found: one_or_more, values_matching: every}
        fields: {stdout_line: {equals: ok}}
      reported_elements: all
`;
 const source=new SourceBuffer(raw);
 const next={item_requirement:{items_found:'one_or_more',items_satisfying:'every'},field_requirement:{values_found:'one_or_more',values_matching:'every'},and:[{fields:{stdout_line:{equals:'ok'}}},{fields:{stderr_line:{values_found:'none'}}}]};
 const edit=source.replacePathValue(['assessment','tests','check-test','require'],next,sha256(raw));
 assert.deepEqual(edit.document.json().assessment.tests['check-test'].require.and[1].fields.stderr_line,{values_found:'none'});
 assert.equal(edit.document.json().assessment.tests['check-test'].reported_elements,'all');
 assert.match(edit.document.text,/\n      reported_elements: all\n/);
});

test('safe mapping-key edit changes only the selected operation and supports undo',()=>{
 const raw='require:\n  fields: {value: {equals: 1}}\n'; const source=new SourceBuffer(raw);
 const edit=source.editMappingKey(['require','fields','value'],'equals','not_equal',sha256(raw));
 assert.equal(edit.document.text,'require:\n  fields: {value: {not_equal: 1}}\n');
 assert.equal(edit.document.json().require.fields.value.not_equal,1); assert.equal(edit.undo().text,raw);
 assert.throws(()=>edit.document.editMappingKey(['require','fields','value'],'not_equal','equals',sha256(raw)),/Stale/);
});

test('mapping-key edits can enforce schema-authorized operations before patching',()=>{
 const raw='require:\n  fields: {value: {equals: 1}}\n'; const source=new SourceBuffer(raw);
 assert.throws(()=>source.editMappingKey(['require','fields','value'],'equals','matches_regex',sha256(raw),['equals']),/not permitted/);
 const edit=source.editMappingKey(['require','fields','value'],'equals','not_equal',sha256(raw),['equals','not_equal']);
 assert.equal(edit.document.json().require.fields.value.not_equal,1);
});

test('offline PCRE2 preview accepts inline modifiers and remains bounded',async()=>{
 const result=await previewRegex('^user=(.+)$','user=alice');
 assert.equal(result.dialect,'PCRE2-safe-preview'); assert.equal(result.matched,true); assert.deepEqual(result.captures,['alice']);
 const windows=await previewRegex('(?i)NT AUTHORITY\\\\SYSTEM:\\(F\\)','NT AUTHORITY\\SYSTEM:(F)');
 assert.equal(windows.matched,true);
 const invalid=await previewRegex('(','x'); assert.equal(invalid.matched,false); assert.ok(invalid.error);
 assert.equal((await previewRegex('x','a'.repeat(100001))).limited,true);
});

test('source apply revision guard rejects edits made while approval is open',async()=>{
 let current='title: old\n'; const draftHash=sha256(current);
 assert.equal(sourceRevisionMatches(current,draftHash,1,1),true);
 // Simulate the approval promise yielding to an external TextDocument edit.
 const approval=Promise.resolve('Apply').then(()=>{current='title: external\n';return 'Apply';});
 assert.equal(await approval,'Apply');
 assert.equal(sourceRevisionMatches(current,draftHash,2,1),false);
 // Cancellation never changes the authoritative source.
 const before=current; const cancelled=await Promise.resolve('Cancel'); assert.equal(cancelled,'Cancel'); assert.equal(current,before);
});

test('pathological regex preview is bounded or cancelled outside the extension host',async()=>{
 const pathological=await previewRegex('(a+)+$','a'.repeat(10000)+'!');
 assert.ok(pathological.error || pathological.timedOut);
 const safe=await previewRegexSafe(['^user=(.+)$'],'user=alice','',100);
 assert.equal(safe[0].matched,true); assert.deepEqual(safe[0].captures,['alice']);
 const cancelled=await previewRegexSafe(['^(a|aa)+$'],'a'.repeat(50000)+'!', '', 25);
 assert.ok(cancelled[0].timedOut || cancelled[0].error,JSON.stringify(cancelled[0]));
});

test('P1A extracts regex scalars from schema-shaped selectors and variable regex_capture', async () => {
 const { findRegexContext, replaceRegexScalar } = await import('../dist/regex-tester.js');
 const linux = `assessment:\n  tests:\n    t:\n      capability: linux.partition\n      object:\n        mount_point: {matches_regex: '.*\\\\/home'}\n`;
 const selected = findRegexContext(linux, linux.indexOf('.*'), linux.indexOf('.*') + 2);
 assert.equal(selected?.kind, 'matches_regex'); assert.equal(selected?.pattern, '.*\\\\/home');
 const changed = replaceRegexScalar(linux, selected, '^/tmp$');
 assert.match(changed.nextText, /mount_point: \{matches_regex: '\^\/tmp\$'\}/);
 const variable = `assessment:\n  variables:\n    v:\n      expression:\n        concat:\n        - regex_capture:\n            pattern: '(^[A-Z]+)$'\n            value: {literal: x}\n`;
 const capture = findRegexContext(variable, variable.indexOf('^[A-Z]'));
 assert.equal(capture?.kind, 'regex_capture'); assert.equal(capture?.pattern, '(^[A-Z]+)$');
});

test('P1A regex preview exposes spans and named captures', async () => {
 const result = await previewRegex('^(?<user>[^:]+):(.+)$', 'alice:secret');
 assert.equal(result.matched, true); assert.deepEqual(result.namedCaptures, { user: 'alice' });
 assert.deepEqual(result.matchSpan, [0, 12]); assert.equal(result.spans[0].text, 'alice:secret');
});

test('P1A can open the first schema regex from a graphical editor without a caret', async () => {
 const { findFirstRegexContext } = await import('../dist/regex-tester.js');
 const raw = `assessment:\n  tests:\n    t:\n      capability: independent.shellcommand\n      require:\n        fields:\n          stdout_line:\n            matches_regex: '^first$'\n`;
 const context = findFirstRegexContext(raw);
 assert.equal(context?.kind, 'matches_regex'); assert.equal(context?.pattern, '^first$');
});

test('P1A treats a selected matches_regex sequence as one editable expression set', async () => {
 const { findRegexContext, replaceRegexScalars } = await import('../dist/regex-tester.js');
 const raw = `assessment:\n  tests:\n    t:\n      capability: independent.shellcommand\n      require:\n        fields:\n          stdout_line:\n            matches_regex:\n              - 'first'\n              - 'second'\n              - 'third'\n`;
 const start = raw.indexOf("'first'"); const end = raw.indexOf("'third'") + "'third'".length;
 const context = findRegexContext(raw, start, end);
 assert.deepEqual(context?.patterns, ['first', 'second', 'third']);
 assert.equal(context?.sourceRanges.length, 3);
 const edit = replaceRegexScalars(raw, context, ['one', 'two', 'three']);
 assert.match(edit.nextText, /- 'one'\n\s+- 'two'\n\s+- 'three'/);
});


test('P1B resolves only the enclosing Object capability and explains sample selector traces', async () => {
 const { findObjectContext, evaluateObjectSamples } = await import('../dist/sample-object.js');
 const yaml = `assessment:\n  tests:\n    linux-test:\n      capability: linux.partition\n      object:\n        mount_point: {matches_regex: '^/tmp'}\n`;
 const context = findObjectContext(yaml, yaml.indexOf('mount_point') + 2);
 assert.equal(context?.capability, 'linux.partition'); assert.equal(context?.testId, 'linux-test');
 const keyContext = findObjectContext(yaml, yaml.indexOf('object:') + 2);
 assert.equal(keyContext?.capability, 'linux.partition'); assert.equal(keyContext?.testId, 'linux-test');
 const samples = `- id: one\n  capability: linux.partition\n  status: exists\n  fields:\n    mount_point: {datatype: string, value: /tmp}\n  provenance: {}\n- id: two\n  capability: linux.partition\n  status: exists\n  fields: {}\n  provenance: {}\n`;
 const result = await evaluateObjectSamples(context.object, context.capability, samples);
 assert.deepEqual(result.selectedItemIndices, [0]); assert.equal(result.items[0].status, 'matched'); assert.equal(result.items[1].items?.length, undefined);
 assert.equal(result.items[1].selectors[0].status, 'missing'); assert.ok(result.warnings.some(x => /offline sample/i.test(x)));
});

test('P1B makes Variable-backed starter samples explicit instead of inventing field values', async () => {
 const { objectTesterGuidance, starterSampleItems } = await import('../dist/sample-object.js');
 const object = { shell: 'cmd', command: { variable: 'command-variable' }, pattern: ':', error_if_exit_status_not_0: false };
 const starter = JSON.parse(starterSampleItems(object, 'independent.shellcommand'));
 assert.deepEqual(starter[0].fields, {});
 const guidance = objectTesterGuidance(object);
 assert.equal(guidance.canPreview, false);
 assert.deepEqual(guidance.unresolvedFields, ['command']);
 assert.match(guidance.message, /no sample replacement|execute commands/i);
});

test('P1B keeps malformed, unresolved and unsupported selector states explicit', async () => {
 const { evaluateObjectSamples } = await import('../dist/sample-object.js');
 const object = { value: { variable: 'expected-value' }, other: { made_up_operator: 1 } };
 const result = await evaluateObjectSamples(object, 'unknown.capability', '{bad: [');
 assert.ok(result.inputDiagnostics.length);
 const result2 = await evaluateObjectSamples(object, 'unknown.capability', JSON.stringify({id:'i',capability:'unknown.capability',status:'exists',fields:{value:{datatype:'string',value:'x'},other:{datatype:'string',value:'y'}},provenance:{}}));
 assert.equal(result2.items[0].selectors[0].status, 'indeterminate'); assert.equal(result2.items[0].selectors[1].status, 'indeterminate');
});

test('schema-qualified mapping additions preserve block and flow YAML styles',()=>{
 const block='require:\n  item_requirement: {items_found: one_or_more}\n  sibling: value\n';
 const blockEdit=new SourceBuffer(block).insertMapEntries(['require'],[['field_requirement',{values_found:'one_or_more',values_matching:'every'}],['fields',{value:{equals:1}}]],sha256(block));
 assert.deepEqual(blockEdit.document.json().require.fields,{value:{equals:1}});
 assert.match(blockEdit.document.text,/\n  sibling: value\n/); assert.equal(blockEdit.undo().text,block);
 const single=new SourceBuffer(block).insertMapEntry(['require'],'fields',{value:{equals:1}},sha256(block));
 assert.deepEqual(single.document.json().require.fields,{value:{equals:1}}); assert.match(single.document.text,/\n  sibling: value\n/);
 const flow='require: {item_requirement: {items_found: one_or_more}}\n';
 const flowEdit=new SourceBuffer(flow).insertMapEntries(['require'],[['field_requirement',{values_found:'one_or_more',values_matching:'every'}],['fields',{value:{equals:1}}]],sha256(flow));
 assert.deepEqual(flowEdit.document.json().require.fields,{value:{equals:1}}); assert.equal(flowEdit.undo().text,flow);
});

test('graphical structural map edits append, duplicate and remove with native undo source', () => {
 const raw = `assessment:\n  # keep this comment\n  tests:\n    first-test:\n      test_title: First\n      capability: unix.file\n      object: {filepath: {equals: /etc/passwd}}\n`;
 const source = new SourceBuffer(raw);
 const add = source.insertMapEntry(['assessment', 'tests'], 'second-test', {test_title: 'Second', capability: 'unix.file', object: {}}, sha256(raw));
 assert.match(add.document.text, /# keep this comment/); assert.deepEqual(Object.keys(add.document.json().assessment.tests), ['first-test', 'second-test']); assert.equal(add.undo().text, raw);
 const duplicate = add.document.insertMapEntry(['assessment', 'tests'], 'third-test', add.document.json().assessment.tests['first-test'], sha256(add.document.text));
 assert.equal(duplicate.document.json().assessment.tests['third-test'].test_title, 'First');
 const remove = duplicate.document.removePath(['assessment', 'tests', 'second-test'], sha256(duplicate.document.text));
 assert.equal(remove.document.json().assessment.tests['second-test'], undefined); assert.equal(remove.undo().text, duplicate.document.text);
 assert.throws(() => source.insertMapEntry(['assessment', 'tests'], 'second-test', {}, 'stale'), /Stale/);
});

test('graphical structural flow-map removal preserves valid YAML', () => {
 const raw = 'assessment: {id: demo-assessment, mode: automated, tests: {one-test: {test_title: One}}}\n';
 const source = new SourceBuffer(raw); const edit = source.removePath(['assessment', 'tests', 'one-test'], sha256(raw));
 assert.deepEqual(edit.document.json(), {assessment: {id: 'demo-assessment', mode: 'automated', tests: {}}}); assert.equal(edit.undo().text, raw);
});

test('Object selector source can change Variable to fixed string and back without rewriting siblings',()=>{
 const raw='# preserved\nassessment:\n  tests:\n    sample-test:\n      object: {command: {variable: build-command-variable}, pattern: {equals: ":"}} # keep\n';
 const source=new SourceBuffer(raw), path=['assessment','tests','sample-test','object','command'];
 const fixed=source.replaceSelectorSource(path,'equals','icacls C:\\Windows\\SYSVOL',sha256(raw));
 assert.equal(fixed.document.json().assessment.tests['sample-test'].object.command.equals,'icacls C:\\Windows\\SYSVOL');
 assert.ok(fixed.document.text.includes('pattern: {equals: ":"}'));
 assert.ok(fixed.document.text.includes('# preserved'));
 assert.equal(fixed.undo().text,raw);
 const variable=fixed.document.replaceSelectorSource(path,'variable','build-command-variable',sha256(fixed.document.text));
 assert.equal(variable.document.json().assessment.tests['sample-test'].object.command.variable,'build-command-variable');
 assert.ok(variable.document.text.includes('# keep'));
 assert.throws(()=>source.replaceSelectorSource(path,'equals','cmd','stale'),/Stale/);
});
test('Require comparison fixed and Variable sources round-trip with atomic undo',()=>{
 const raw='# keep\nassessment:\n  tests:\n    sample-test:\n      require:\n        fields: {type: {equals: dword}, value: {equals: 1}} # sibling\n';
 const path=['assessment','tests','sample-test','require','fields','type'];
 const source=new SourceBuffer(raw);
 const variable=source.replaceComparison(path,'equals',{variable:'registry-type-variable'},sha256(raw));
 assert.deepEqual(variable.document.json().assessment.tests['sample-test'].require.fields.type.equals,{variable:'registry-type-variable'});
 assert.match(variable.document.text,/# keep/);assert.match(variable.document.text,/value: \{equals: 1\}/);assert.equal(variable.undo().text,raw);
 const fixed=variable.document.replaceComparison(path,'equals','dword',sha256(variable.document.text));
 assert.equal(fixed.document.json().assessment.tests['sample-test'].require.fields.type.equals,'dword');assert.equal(fixed.undo().text,variable.document.text);
 assert.throws(()=>source.replaceComparison(path,'equals',{variable:'x',input:'y'},sha256(raw)),/Unsupported/);
});
test('Object source replacement refuses ambiguous mappings, anchors and empty literals',()=>{
 const path=['object','command'];
 for(const raw of ['object: {command: {variable: id, equals: x}}',
                   'object: {command: {matches_regex: x}}',
                   'object: {command: &special {variable: id}}'])
  assert.throws(()=>new SourceBuffer(raw).replaceSelectorSource(path,'equals','cmd',sha256(raw)));
 const raw='object: {command: {variable: id}}';
 assert.throws(()=>new SourceBuffer(raw).replaceSelectorSource(path,'equals','',sha256(raw)),/non-empty/);
});

test('Require regex list supports append and indexed removal with source-local edits',()=>{
 const raw='# preserved\nassessment:\n  tests:\n    regex-test:\n      require:\n        fields:\n          stdout_line:\n            matches_regex: ["^one$", "^two$"] # untouched\n';
 const path=['assessment','tests','regex-test','require','fields','stdout_line','matches_regex'];
 const source=new SourceBuffer(raw);
 const added=source.editRegexList(path,'add',sha256(raw),'^three$');
 assert.deepEqual(added.document.json().assessment.tests['regex-test'].require.fields.stdout_line.matches_regex,['^one$','^two$','^three$']);
 assert.ok(added.document.text.startsWith('# preserved'));
 assert.ok(added.document.text.includes('# untouched'));
 assert.equal(added.undo().text,raw);
 const removed=added.document.editRegexList(path,'remove',sha256(added.document.text),undefined,1);
 assert.deepEqual(removed.document.json().assessment.tests['regex-test'].require.fields.stdout_line.matches_regex,['^one$','^three$']);
 assert.throws(()=>source.editRegexList(path,'add','stale','new'),/Stale/);
});
test('Require regex list declines removal of last pattern, comments, non-regex paths and empty additions',()=>{
 const raw='assessment: {tests: {regex-test: {require: {fields: {stdout_line: {matches_regex: ["only"]}}}}}}';
 const path=['assessment','tests','regex-test','require','fields','stdout_line','matches_regex'];
 const source=new SourceBuffer(raw);
 assert.throws(()=>source.editRegexList(path,'remove',sha256(raw),undefined,0),/final/);
 assert.throws(()=>source.editRegexList(path,'add',sha256(raw),' '),/non-empty/);
 assert.throws(()=>source.editRegexList(['foo'],'add',sha256(raw),'valid'),/Only authored/);
});

test('shared comparison replacement preserves source bytes and changes operation/value atomically',()=>{
 const raw='# preamble\nassessment:\n  tests:\n    a-test:\n      object: {mount_point: {matches_regex: "^/home$"}, another: {equals: "/data"}} # sibling\n';
 const path=['assessment','tests','a-test','object','mount_point'];
 const source=new SourceBuffer(raw);
 const edited=source.replaceComparison(path,'equals','/home',sha256(raw));
 assert.equal(edited.document.json().assessment.tests['a-test'].object.mount_point.equals,'/home');
 assert.equal(edited.document.json().assessment.tests['a-test'].object.another.equals,'/data');
 assert.ok(edited.document.text.includes('# sibling'));
 assert.equal(edited.undo().text,raw);
 const varied=edited.document.replaceComparison(path,'variable','mount-variable',sha256(edited.document.text));
 assert.equal(varied.document.json().assessment.tests['a-test'].object.mount_point.variable,'mount-variable');
 assert.throws(()=>source.replaceComparison(path,'equals','x','stale'),/Stale/);
});
test('shared comparison replacement supports regex arrays and refuses unsafe mappings',()=>{
 const raw='require: {fields: {value: {equals: "x"}}}';
 const path=['require','fields','value'];
 const source=new SourceBuffer(raw);
 const change=source.replaceComparison(path,'matches_regex',['^x$'],sha256(raw));
 assert.deepEqual(change.document.json().require.fields.value.matches_regex,['^x$']);
 for(const invalid of ['require: {fields: {value: {equals: x, not_equal: y}}}',
   'require: {fields: {value: &a {equals: x}}}']){
  assert.throws(()=>new SourceBuffer(invalid).replaceComparison(path,'equals','x',sha256(invalid)));
 }
 assert.throws(()=>source.replaceComparison(path,'bad-op!', 'x',sha256(raw)),/Invalid comparison/);
});

test('source transactions apply disjoint edits atomically and restore exact bytes',()=>{
 const raw='# keep\nassessment:\n  id: demo\n  title: Old\n';
 const source=new SourceBuffer(raw);
 const id=source.scalarRange(['assessment','id']);
 const title=source.scalarRange(['assessment','title']);
 const edit=source.applyEdits([
   {start:id[0],end:id[1],replacement:'changed'},
   {start:title[0],end:title[1],replacement:'New'}
 ],sha256(raw));
 assert.deepEqual(edit.document.json(),{assessment:{id:'changed',title:'New'}});
 assert.match(edit.document.text,/^# keep\n/);
 assert.equal(edit.undo().text,raw);
 assert.throws(()=>source.applyEdits([{start:id[0],end:title[1],replacement:'bad'},{start:title[0],end:title[1],replacement:'bad'}],sha256(raw)),/overlap/);
 assert.throws(()=>source.applyEdits([{start:0,end:raw.length,replacement:'assessment: ['}],sha256(raw)),/break YAML/);
 assert.throws(()=>source.applyEdits([{start:id[0],end:id[1],replacement:'stale'}],'0'.repeat(64)),/Stale/);
});

test('schema structural cardinality guards reject unsafe graphical CRUD',()=>{
 const map='assessment: {id: demo, title: old}\n';
 const source=new SourceBuffer(map);
 assert.throws(()=>source.insertMapEntry(['assessment'],'mode','manual',sha256(map),{maxProperties:2}),/maximum/);
 assert.throws(()=>source.removePath(['assessment','id'],sha256(map),{required:['id']}),/Required/);
 assert.throws(()=>source.removePath(['assessment','id'],sha256(map),{minProperties:2}),/minimum/);
 const seq='values: [one]\n';
 const sequence=new SourceBuffer(seq);
 assert.throws(()=>sequence.insertArrayItem(['values'],'two',sha256(seq),{maxItems:1}),/maximum/);
 assert.throws(()=>sequence.removePath(['values',0],sha256(seq),{minItems:1}),/minimum/);
});

test('oneOf branch replacement remains localized and supports explicit branch guards',()=>{
 const raw='# before\nvalue: {equals: old} # after\nsibling: untouched\n';
 const source=new SourceBuffer(raw);
 const edit=source.replaceVariant(['value'],{matches_regex:['^new$']},sha256(raw));
 assert.deepEqual(edit.document.json(),{value:{matches_regex:['^new$']},sibling:'untouched'});
 assert.match(edit.document.text,/^# before\n/); assert.match(edit.document.text,/# after/);
 assert.equal(edit.undo().text,raw);
 assert.throws(()=>source.replaceVariant(['value'],'not-a-mapping',sha256(raw)),/mapping/);
});
