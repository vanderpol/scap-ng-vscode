import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MetadataPack } from '../dist/metadata.js';
import { assessmentEditorModel } from '../dist/structured-model.js';
import { compareCorpusPin } from './corpus-pin.mjs';

const packPath = process.env.SCAP_NG_METADATA_PACK;
const corpusRoot = process.env.SCAP_NG_CORPUS_ROOT;
if (!packPath || !corpusRoot) throw new Error('Set SCAP_NG_METADATA_PACK and SCAP_NG_CORPUS_ROOT explicitly.');
const profile = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(resolve(packPath), profile);
const corpusPin = compareCorpusPin(corpusRoot, pack.pin);
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const file = join(directory, name); const stat = statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (/assessment\.yaml$/i.test(name)) files.push(file);
  }
}
walk(resolve(corpusRoot));
const started = Date.now(); let ok = 0; let failed = 0; let scalarProperties = 0; let maximumProperties = 0; let variableDocuments = 0; let filterDocuments = 0; let setDocuments = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  try {
    const model = assessmentEditorModel({ getText: () => text, version: 1, uri: { fsPath: file } }, pack);
    if (!model.ok) failed++;
    else { ok++; scalarProperties += model.fields.length; maximumProperties = Math.max(maximumProperties, model.fields.length); }
    if (/^  variables:/m.test(text)) variableDocuments++;
    if (/\bfilters\s*:/m.test(text)) filterDocuments++;
    if (/^\s+set:/m.test(text)) setDocuments++;
  } catch { failed++; }
}
const result = { corpusRoot: resolve(corpusRoot), files: files.length, ok, failed, scalarProperties, maximumProperties, variableDocuments, filterDocuments, setDocuments, elapsedMs: Date.now() - started, schemaProfileSourceCommit: profile.sourceCommit, corpusPin, qualification: corpusPin.verified ? 'external stress inventory; schema-pin matched; not promoted as editor sample data' : 'external stress inventory; schema pin unverified; not editor-qualified' };
console.log(JSON.stringify(result, null, 2));
if (failed || (process.env.SCAP_NG_REQUIRE_CORPUS_PIN === '1' && !corpusPin.verified)) process.exitCode = 1;
