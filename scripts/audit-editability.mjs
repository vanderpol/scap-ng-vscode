/**
 * Inventory pinned current-schema Assessments against the editor's source/model
 * coverage. This is a qualification report, not a claim of scanner coverage.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MetadataPack } from '../dist/metadata.js';
import { assessmentEditorModel } from '../dist/structured-model.js';
import { SourceBuffer } from '../dist/source.js';

const packRoot = process.env.SCAP_NG_METADATA_PACK;
const sampleRoot = process.env.SCAP_NG_SAMPLE_ROOT ?? '.external/scap-ng-editor-sample-data';
if (!packRoot) throw new Error('SCAP_NG_METADATA_PACK is required');
const pin = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url)));
const pack = new MetadataPack(resolve(packRoot), pin);
const schemaUri = 'https://scap-ng.dev/schema/v0.4.0/assessment.schema.json';
const fixtureRoot = resolve(sampleRoot, 'fixtures/current-v04');
const files = readdirSync(fixtureRoot).filter(name => /\.assessment\.ya?ml$/.test(name)).sort();
const reports = [];
for (const name of files) {
  const file = join(fixtureRoot, name), text = readFileSync(file, 'utf8');
  let value, model;
  try { value = new SourceBuffer(text).json(); model = assessmentEditorModel({ getText: () => text, version: 1 }, pack); }
  catch (error) { reports.push({ name, ok: false, error: String(error) }); continue; }
  const validation = pack.validate(schemaUri, value);
  const scalarPaths = model.fields.filter(field => Array.isArray(field.path));
  const sections = new Set(scalarPaths.map(field => field.path[1] === 'tests' ? String(field.path[3] ?? field.path[1]) : String(field.path[1])));
  reports.push({
    name, ok: model.ok, schemaValid: validation.length === 0, schemaErrors: validation,
    scalarFields: scalarPaths.length, hiddenFields: scalarPaths.filter(field => field.hidden).length,
    tests: model.assessment?.tests?.length ?? 0, sections: [...sections].sort(),
    diagnostics: model.diagnostics?.length ?? 0,
    requireLogicalOperations: model.requireLogicalOperations ?? []
  });
}
const summary = {
  schemaVersion: pin.schemaVersion, sourceCommit: pin.sourceCommit,
  fixtureCount: reports.length, modelFailures: reports.filter(report => !report.ok).length,
  schemaInvalid: reports.filter(report => !report.schemaValid).length,
  totalScalarFields: reports.reduce((sum, report) => sum + (report.scalarFields ?? 0), 0),
  totalTests: reports.reduce((sum, report) => sum + (report.tests ?? 0), 0),
  note: 'Every reported scalar is source-editable. Structural GUI CRUD coverage is audited separately and must not be inferred from this count.'
};
console.log(JSON.stringify({ summary, reports }, null, 2));
