import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MetadataPack, SourceBuffer, sha256 } from '../dist/index.js';
import { assessmentEditorModel } from '../dist/structured-model.js';
import { parseDocument } from 'yaml';
import { compareCorpusPin } from './corpus-pin.mjs';

const packPath = process.env.SCAP_NG_METADATA_PACK;
const corpusRoot = process.env.SCAP_NG_CORPUS_ROOT;
if (!packPath || !corpusRoot) throw new Error('Set SCAP_NG_METADATA_PACK and SCAP_NG_CORPUS_ROOT explicitly.');
const profile = JSON.parse(readFileSync(process.env.SCAP_NG_PROFILE_PATH ?? new URL('../schema-profile.json', import.meta.url)));
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
const started = Date.now(); let ok = 0; let failed = 0; let scalarProperties = 0; let maximumProperties = 0; let variableDocuments = 0; let filterDocuments = 0; let setDocuments = 0; let noOpRoundTrips = 0; let editRoundTrips = 0; let undoRoundTrips = 0; const roundTripFailures = []; const unsupportedFiles = []; const unsupportedCapabilities = new Set();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  try {
    const model = assessmentEditorModel({ getText: () => text, version: 1, uri: { fsPath: file } }, pack);
    if (!model.ok) failed++;
    else {
      ok++; scalarProperties += model.fields.length; maximumProperties = Math.max(maximumProperties, model.fields.length);
      try {
        const source = new SourceBuffer(text);
        if (source.openOrSave() !== text) throw new Error('no-op open/save changed source bytes');
        noOpRoundTrips++;
        const scalar = model.fields.find(field => Array.isArray(field.path) && field.path.length && (field.value === null || ['string', 'number', 'boolean'].includes(typeof field.value)));
        if (scalar) {
          const edited = source.editScalar(scalar.path, scalar.value, sha256(text));
          const reopened = assessmentEditorModel({ getText: () => edited.document.openOrSave(), version: 2, uri: { fsPath: file } }, pack);
          if (!reopened.ok) throw new Error('reopen after source edit failed');
          if (edited.undo().openOrSave() !== text) throw new Error('undo did not restore exact source bytes');
          editRoundTrips++; undoRoundTrips++;
        }
      } catch (error) { roundTripFailures.push({ file, reason: String(error?.message ?? error) }); }
    }
    if (/^  variables:/m.test(text)) variableDocuments++;
    if (/\bfilters\s*:/m.test(text)) filterDocuments++;
    if (/^\s+set:/m.test(text)) setDocuments++;
    try {
      const document = parseDocument(text).toJS();
      const capabilities = [...new Set(Object.values(document?.assessment?.tests ?? {}).map(test => test?.capability).filter(Boolean))];
      const unsupported = capabilities.filter(capability => !Object.hasOwn(pack.manifest.capabilities, capability));
      unsupported.forEach(capability => unsupportedCapabilities.add(capability));
      if (unsupported.length) unsupportedFiles.push({ file, capabilities: unsupported });
    } catch { /* model validation already accounts for malformed YAML */ }
  } catch { failed++; }
}
const editorQualifiedFiles = files.length - unsupportedFiles.length;
const result = { corpusRoot: resolve(corpusRoot), files: files.length, ok, failed, scalarProperties, maximumProperties, variableDocuments, filterDocuments, setDocuments, noOpRoundTrips, editRoundTrips, undoRoundTrips, roundTripFailures, editorQualifiedFiles, excludedExperimentalFiles: unsupportedFiles.length, unsupportedCapabilities: [...unsupportedCapabilities].sort(), unsupportedFiles, elapsedMs: Date.now() - started, schemaProfileSourceCommit: profile.sourceCommit, corpusPin, qualification: corpusPin.verified && !unsupportedFiles.length ? 'active-editor-qualified' : corpusPin.verified ? 'active-editor-qualified-subset; experimental capabilities explicitly excluded' : 'external stress inventory; schema pin unverified; not editor-qualified' };
console.log(JSON.stringify(result, null, 2));
if (failed || roundTripFailures.length || (process.env.SCAP_NG_REQUIRE_CORPUS_PIN === '1' && !corpusPin.verified) || (process.env.SCAP_NG_REQUIRE_ACTIVE_CORPUS === '1' && unsupportedFiles.length)) process.exitCode = 1;
