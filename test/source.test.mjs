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
