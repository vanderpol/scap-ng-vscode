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

test('offline regex preview is bounded and clearly dialect-scoped',()=>{
 const result=previewRegex('^user=(.+)$','user=alice');
 assert.equal(result.dialect,'ECMAScript-safe-preview'); assert.equal(result.matched,true); assert.deepEqual(result.captures,['alice']);
 assert.equal(previewRegex('(','x').matched,false); assert.ok(previewRegex('(','x').error);
 assert.equal(previewRegex('x','a'.repeat(100001)).limited,true);
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

test('pathological regex preview is rejected or cancelled outside the extension host',async()=>{
 const pathological=previewRegex('(a+)+$','a'.repeat(10000)+'!');
 assert.match(pathological.error,/nested quantifier|backreferences|safety/i);
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

test('P1A regex preview exposes spans and named captures', () => {
 const result = previewRegex('^(?<user>[^:]+):(.+)$', 'alice:secret');
 assert.equal(result.matched, true); assert.deepEqual(result.namedCaptures, { user: 'alice' });
 assert.deepEqual(result.matchSpan, [0, 12]); assert.equal(result.spans[0].text, 'alice:secret');
});
