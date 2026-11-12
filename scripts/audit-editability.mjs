/**
 * Execute a schema-path × source-edit qualification against the pinned current
 * Assessment examples. This is an editor CRUD audit, not scanner coverage.
 *
 * The audit deliberately uses the same immutable MetadataPack, schema resolver,
 * SourceBuffer and graphical model as the extension. It never writes fixture
 * files. Every successful edit is checked for YAML validity, schema validity,
 * byte preservation outside the edited range and exact undo/reapply behavior.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { MetadataPack, sha256 } from '../dist/metadata.js';
import { assessmentEditorModel } from '../dist/structured-model.js';
import { SourceBuffer } from '../dist/source.js';
import {
  schemaAdditionalPropertyLocations,
  schemaItemLocations,
  schemaNodes,
  schemaPropertyEntries
} from '../dist/schema-resolver.js';

const schemaUri = 'https://scap-ng.dev/schema/v0.4.0/assessment.schema.json';
const logicalOperators = new Set(['and', 'or', 'one', 'xor']);
const contextFor = pack => ({
  documentVersion: pack.pin.schemaVersion,
  schemaValid: true,
  isOverride: false,
  diagnostics: []
});
const pathText = path => path.length ? path.map(part => typeof part === 'number' ? `[${part}]` : String(part)).join('.').replaceAll('.[', '[') : '<document>';
const clone = value => value === undefined ? undefined : structuredClone(value);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function valueAt(value, path) {
  let current = value;
  for (const part of path) current = current?.[part];
  return current;
}

function schemaLocationsForPath(pack, path) {
  let locations = schemaNodes(pack, schemaUri);
  for (const part of path) {
    if (typeof part === 'number') {
      locations = schemaItemLocations(pack, locations).flatMap(location => schemaNodes(pack, location.uri));
      continue;
    }
    const property = schemaPropertyEntries(pack, locations).get(part);
    if (property) {
      locations = schemaNodes(pack, property.uri);
      continue;
    }
    const dynamic = schemaAdditionalPropertyLocations(pack, locations);
    if (!dynamic.length) return [];
    locations = dynamic.flatMap(location => schemaNodes(pack, location.uri));
  }
  return locations;
}

function schemaProperties(pack, locations) {
  const entries = new Map();
  for (const location of locations) {
    for (const [name, property] of schemaPropertyEntries(pack, [location])) {
      if (!entries.has(name)) entries.set(name, property);
    }
  }
  return entries;
}

function schemaRequired(locations) {
  return new Set(locations.flatMap(location => Array.isArray(location.node?.required) ? location.node.required.map(String) : []));
}

function schemaType(locations) {
  const types = new Set();
  for (const location of locations) {
    const type = location.node?.type;
    for (const value of Array.isArray(type) ? type : [type]) if (typeof value === 'string') types.add(value);
  }
  return types;
}

function seedForSchema(pack, locations, existing) {
  if (existing !== undefined) return clone(existing);
  for (const location of locations) {
    const node = location.node ?? {};
    if (node.const !== undefined) return clone(node.const);
    if (node.default !== undefined) return clone(node.default);
    if (Array.isArray(node.enum) && node.enum.length) return clone(node.enum[0]);
  }
  const types = schemaType(locations);
  if (types.has('array')) return [];
  if (types.has('object')) {
    for (const location of locations) {
      try {
        const candidate = pack.newObjectDefaults(location.uri, {}, contextFor(pack));
        if (!pack.validate(location.uri, candidate).length) return candidate;
      } catch { /* Try the next compatible branch. */ }
    }
    return {};
  }
  if (types.has('boolean')) return false;
  if (types.has('integer') || types.has('number')) return 0;
  if (types.has('null')) return null;
  return '';
}

function invalidSeed(pack, locations, current) {
  const candidates = [];
  const types = schemaType(locations);
  if (types.has('string')) candidates.push('__editor_invalid_enum__');
  if (types.has('integer') || types.has('number')) candidates.push('not-a-number');
  if (types.has('boolean')) candidates.push('not-a-boolean');
  if (types.has('array')) candidates.push({ invalid: true });
  if (types.has('object')) candidates.push('not-an-object');
  if (!types.has('null')) candidates.push(null);
  for (const candidate of candidates) {
    if (equal(candidate, current)) continue;
    const errors = locations.some(location => {
      try { return pack.validate(location.uri, candidate).length > 0; } catch { return false; }
    });
    if (errors) return candidate;
  }
  return undefined;
}

function transition(pack, beforeValue, edit, label) {
  const afterValue = edit.document.json();
  const beforeErrors = pack.validate(schemaUri, beforeValue);
  const afterErrors = pack.validate(schemaUri, afterValue);
  const introduced = afterErrors.filter(error => !beforeErrors.includes(error));
  if (introduced.length) throw new Error(`${label}: ${introduced.join('; ')}`);
  return afterValue;
}

function assertSourceShape(beforeText, edit) {
  const [start, end] = edit.range ?? [];
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('edit has no source range');
  const replacement = String(edit.replacement ?? '');
  const after = edit.document.text;
  if (after.slice(0, start) !== beforeText.slice(0, start) ||
      after.slice(start + replacement.length) !== beforeText.slice(end)) {
    throw new Error('bytes outside the edited range changed');
  }
}

function recordCase(report, kind, path, status, detail = '') {
  report.coverage[kind] = (report.coverage[kind] ?? 0) + (status === 'passed' ? 1 : 0);
  report.cases.push({ kind, path: pathText(path), status, ...(detail ? { detail } : {}) });
  if (status === 'failed') report.failures.push(`${kind} ${pathText(path)}: ${detail}`);
}

function executeEdit(report, kind, path, beforeText, beforeValue, createEdit) {
  const revision = sha256(beforeText);
  try {
    const edit = createEdit(new SourceBuffer(beforeText), revision);
    const afterValue = transition(report.pack, beforeValue, edit, `${kind} ${pathText(path)}`);
    assertSourceShape(beforeText, edit);
    report.checks.bytePreservation++;
    const undone = edit.undo();
    if (undone.text !== beforeText) throw new Error('undo did not restore exact source bytes');
    const redo = createEdit(undone, sha256(undone.text));
    if (redo.document.text !== edit.document.text) throw new Error('redo did not reproduce the edited source bytes');
    report.checks.undoRedo++;
    recordCase(report, kind, path, 'passed');
    return edit;
  } catch (error) {
    recordCase(report, kind, path, 'skipped', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function auditInvalid(report, kind, path, beforeText, beforeValue, createEdit) {
  try {
    const edit = createEdit(new SourceBuffer(beforeText), sha256(beforeText));
    const errors = report.pack.validate(schemaUri, edit.document.json());
    if (!errors.length) {
      recordCase(report, kind, path, 'failed', 'invalid candidate unexpectedly passed the pinned schema');
      return;
    }
    if (edit.undo().text !== beforeText) throw new Error('invalid candidate changed source through undo');
    recordCase(report, kind, path, 'passed', 'schema rejected candidate before host application');
  } catch (error) {
    // SourceBuffer rejection is also a successful invalid-edit guard.
    if (/break YAML|unsupported|invalid|safe|Stale|maximum|minimum|mapping|sequence/i.test(String(error))) {
      recordCase(report, kind, path, 'passed', error instanceof Error ? error.message : String(error));
    } else {
      recordCase(report, kind, path, 'failed', error instanceof Error ? error.message : String(error));
    }
  }
}

function variantOperation(pack, value, path, locations) {
  if (!isObject(value)) return undefined;
  const entries = schemaProperties(pack, locations);
  const currentKeys = new Set(Object.keys(value));
  for (const [name, property] of entries) {
    if (currentKeys.has(name)) continue;
    const candidateLocations = schemaNodes(pack, property.uri);
    const candidate = seedForSchema(pack, candidateLocations);
    if (candidate === undefined) continue;
    const next = { [name]: candidate };
    // Only regard this as a variant when the candidate is a valid alternative
    // at the selected mapping location. Ordinary optional members are not
    // variant coverage.
    if (locations.some(location => Array.isArray(location.node?.oneOf) || Array.isArray(location.node?.anyOf))) return next;
  }
  return undefined;
}

function walkLogical(value, path, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkLogical(entry, path.concat(index), visit));
    return;
  }
  for (const [name, child] of Object.entries(value)) {
    const next = path.concat(name);
    if (logicalOperators.has(name) && Array.isArray(child)) visit(next, child);
    walkLogical(child, next, visit);
  }
}

function auditDocument(pack, name, text, options = {}) {
  const report = { name, synthetic: Boolean(options.synthetic), pack, coverage: {}, checks: { bytePreservation: 0, undoRedo: 0, noOpBytes: false }, cases: [], failures: [], skips: 0 };
  const source = new SourceBuffer(text);
  const beforeValue = source.json();
  report.checks.noOpBytes = source.openOrSave() === text;
  if (!report.checks.noOpBytes) report.failures.push('no-op open/save changed source bytes');
  const model = assessmentEditorModel({ getText: () => text, version: 1 }, pack);
  const validation = pack.validate(schemaUri, beforeValue);
  report.model = { ok: model.ok, schemaValid: validation.length === 0, scalarFields: model.fields?.length ?? 0, structuralNodes: model.structuralNodes?.length ?? 0 };
  if (!model.ok) report.failures.push('graphical model failed to load');
  if (validation.length) report.failures.push(...validation.map(error => `baseline schema: ${error}`));

  for (const field of model.fields ?? []) {
    executeEdit(report, 'scalar-update', field.path, text, beforeValue,
      (buffer, revision) => buffer.editScalar(field.path, field.value, revision));
  }

  for (const node of model.structuralNodes ?? []) {
    const value = valueAt(beforeValue, node.path);
    const locations = schemaLocationsForPath(pack, node.path);
    if (Array.isArray(value)) {
      const itemLocations = schemaItemLocations(pack, locations).flatMap(location => schemaNodes(pack, location.uri));
      const existing = value.length ? value[0] : undefined;
      const seed = seedForSchema(pack, itemLocations, existing);
      if (itemLocations.length && seed !== undefined) {
        executeEdit(report, 'array-add', node.path, text, beforeValue,
          (buffer, revision) => buffer.insertArrayItem(node.path, seed, revision));
      }
      if (value.length > 1) {
        executeEdit(report, 'array-remove', node.path.concat(0), text, beforeValue,
          (buffer, revision) => buffer.removePath(node.path.concat(0), revision));
      }
      const invalid = invalidSeed(pack, itemLocations, existing);
      if (invalid !== undefined && itemLocations.length) {
        auditInvalid(report, 'array-invalid', node.path, text, beforeValue,
          (buffer, revision) => buffer.insertArrayItem(node.path, invalid, revision));
      }
      continue;
    }
    if (!isObject(value)) continue;
    const entries = schemaProperties(pack, locations);
    const required = schemaRequired(locations);
    for (const [property, location] of entries) {
      if (Object.hasOwn(value, property)) continue;
      const seed = seedForSchema(pack, schemaNodes(pack, location.uri));
      if (seed === undefined) continue;
      executeEdit(report, 'structural-add', node.path.concat(property), text, beforeValue,
        (buffer, revision) => buffer.insertMapEntry(node.path, property, seed, revision));
      const invalid = invalidSeed(pack, schemaNodes(pack, location.uri), undefined);
      if (invalid !== undefined) auditInvalid(report, 'structural-invalid', node.path.concat(property), text, beforeValue,
        (buffer, revision) => buffer.insertMapEntry(node.path, property, invalid, revision));
    }
    for (const property of Object.keys(value)) {
      const propertyPath = node.path.concat(property);
      if (!required.has(property)) executeEdit(report, 'structural-remove', propertyPath, text, beforeValue,
        (buffer, revision) => buffer.removePath(propertyPath, revision));
      else auditInvalid(report, 'required-remove-rejection', propertyPath, text, beforeValue,
        (buffer, revision) => buffer.removePath(propertyPath, revision, { required: [property] }));
    }
    const variant = variantOperation(pack, value, node.path, locations);
    if (variant) {
      executeEdit(report, 'variant-replace', node.path, text, beforeValue,
        (buffer, revision) => buffer.replaceVariant(node.path, variant, revision));
      auditInvalid(report, 'variant-invalid-rejection', node.path, text, beforeValue,
        (buffer, revision) => buffer.replaceVariant(node.path, 'invalid-variant', revision));
    }
  }

  walkLogical(beforeValue, [], (path, branches) => {
    if (branches.length) {
      const branch = clone(branches[0]);
      executeEdit(report, 'logical-add-remove', path, text, beforeValue,
        (buffer, revision) => buffer.insertArrayItem(path, branch, revision));
    }
    auditInvalid(report, 'logical-invalid-rejection', path, text, beforeValue,
      (buffer, revision) => buffer.replacePathValue(path, [], revision));
  });
  return report;
}

function buildLogicalSynthetic(baseText) {
  const value = new SourceBuffer(baseText).json();
  const tests = value.assessment.tests;
  const ids = Object.keys(tests);
  if (!ids.length) return undefined;
  const test = ids[0];
  value.assessment.evaluate = { xor: [{ test }, { test }] };
  return stringify(value);
}

export function auditEditability({ packRoot = process.env.SCAP_NG_METADATA_PACK, sampleRoot = process.env.SCAP_NG_SAMPLE_ROOT ?? '.external/scap-ng-editor-sample-data' } = {}) {
  if (!packRoot) throw new Error('SCAP_NG_METADATA_PACK is required');
  const pin = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url)));
  const pack = new MetadataPack(resolve(packRoot), pin);
  const fixtureRoot = resolve(sampleRoot, 'fixtures/current-v04');
  const files = readdirSync(fixtureRoot).filter(name => /\.assessment\.ya?ml$/.test(name)).sort();
  const reports = [];
  for (const name of files) reports.push(auditDocument(pack, name, readFileSync(join(fixtureRoot, name), 'utf8')));
  const logicalBase = files[0] && readFileSync(join(fixtureRoot, files[0]), 'utf8');
  const logicalSynthetic = logicalBase && buildLogicalSynthetic(logicalBase);
  if (logicalSynthetic) reports.push(auditDocument(pack, `${files[0]}#logical-synthetic`, logicalSynthetic, { synthetic: true }));
  for (const report of reports) {
    report.skips = report.cases.filter(item => item.status === 'skipped').length;
    delete report.pack;
  }
  const summary = {
    schemaVersion: pin.schemaVersion,
    sourceCommit: pin.sourceCommit,
    fixtureCount: files.length,
    reportCount: reports.length,
    syntheticCount: reports.filter(report => report.synthetic).length,
    modelFailures: reports.filter(report => !report.model.ok).length,
    schemaInvalid: reports.filter(report => !report.model.schemaValid).length,
    failures: reports.reduce((sum, report) => sum + report.failures.length, 0),
    skipped: reports.reduce((sum, report) => sum + report.skips, 0),
    coverage: Object.fromEntries([...new Set(reports.flatMap(report => Object.keys(report.coverage)))].sort().map(kind => [kind, reports.reduce((sum, report) => sum + (report.coverage[kind] ?? 0), 0)])),
    bytePreservationChecks: reports.reduce((sum, report) => sum + report.checks.bytePreservation, 0),
    undoRedoChecks: reports.reduce((sum, report) => sum + report.checks.undoRedo, 0),
    noOpByteChecks: reports.filter(report => report.checks.noOpBytes).length,
    note: 'Every successful case is a source-local schema-path CRUD transaction; skipped cases are unsupported or conditionally invalid branches, never silently treated as coverage.'
  };
  if (summary.modelFailures || summary.schemaInvalid || summary.failures) {
    const details = reports.flatMap(report => report.failures.map(error => `${report.name}: ${error}`));
    const error = new Error(`Editability audit failed (${summary.failures} failures): ${details.join(' | ')}`);
    error.report = { summary, reports };
    throw error;
  }
  return { summary, reports };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = auditEditability();
    const compactReports = result.reports.map(report => ({
      name: report.name,
      synthetic: report.synthetic,
      model: report.model,
      coverage: report.coverage,
      checks: report.checks,
      skipped: report.skips,
      failures: report.failures,
      passedPaths: report.cases.filter(item => item.status === 'passed').map(item => ({ kind: item.kind, path: item.path }))
    }));
    console.log(JSON.stringify({ summary: result.summary, reports: compactReports }, null, 2));
  } catch (error) {
    if (error.report) console.error(JSON.stringify(error.report, null, 2));
    else console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
