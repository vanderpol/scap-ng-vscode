import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceBuffer,sha256 } from '../dist/index.js';

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
