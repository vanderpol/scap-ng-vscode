#!/usr/bin/env node
/**
 * Import only current-schema SCAP-NG authoring YAML into an external workspace.
 * This is deliberately fail-closed: no output is written when one YAML file
 * fails the pinned schema or the workspace reference graph.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { MetadataPack } from '../dist/metadata.js';
import { WorkspaceIndex } from '../dist/indexer.js';

const source = resolve(process.argv[2] ?? '');
const destination = resolve(process.argv[3] ?? '');
if (!source || !destination || source === resolve('.') || !existsSync(source)) {
  console.error('Usage: node scripts/materialize-authoring-workspace.mjs <conversion-root> <empty-output-root>');
  process.exit(2);
}
if (existsSync(destination) && readdirSync(destination).length) {
  console.error(`Refusing to write non-empty output directory: ${destination}`);
  process.exit(2);
}

const profile = JSON.parse(readFileSync(new URL('../schema-profile.json', import.meta.url), 'utf8'));
const pack = new MetadataPack(resolve(process.env.SCAP_NG_METADATA_PACK ?? '.external/editor-pack'), profile);
const schemas = {
  assessment: 'https://scap-ng.dev/schema/v0.4.0/assessment.schema.json',
  rule: 'https://scap-ng.dev/schema/v0.4.0/rule.schema.json',
  benchmark: 'https://scap-ng.dev/schema/v0.4.0/benchmark.schema.json',
  applicability: 'https://scap-ng.dev/schema/v0.4.0/applicability.schema.json'
};

function files(root) {
  const result = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) result.push(...files(path));
    else if (/\.ya?ml$/i.test(name)) result.push(path);
  }
  return result;
}
function streamRoots(root) {
  const direct = join(root, 'benchmark.yaml');
  if (existsSync(direct)) return [{ name: basename(root), root }];
  const discovered = [];
  for (const name of readdirSync(root)) {
    const stream = join(root, name);
    const directSlice = join(stream, 'authoring', 'direct-slice');
    if (statSync(stream).isDirectory() && existsSync(directSlice)) discovered.push({ name, root: directSlice });
  }
  return discovered;
}
function kindOf(value) {
  const kinds = Object.keys(schemas).filter(kind => value && Object.hasOwn(value, kind));
  return kinds.length === 1 ? kinds[0] : undefined;
}

const streams = streamRoots(source);
const entries = [];
for (const stream of streams) for (const path of files(stream.root)) {
  const text = readFileSync(path, 'utf8');
  let value; let parseError;
  try {
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) parseError = document.errors.map(error => error.message).join('; ');
    else value = document.toJS();
  } catch (error) { parseError = String(error); }
  const kind = value && kindOf(value);
  const diagnostics = parseError ? [`YAML parse error: ${parseError}`] : !kind ? ['Expected exactly one SCAP-NG root: assessment, rule, benchmark or applicability'] : pack.validate(schemas[kind], value);
  entries.push({ sourcePath: path, relativePath: join(stream.name, relative(stream.root, path)), kind, text, diagnostics });
}

const bad = entries.filter(entry => entry.diagnostics.length);
const index = new WorkspaceIndex();
if (!bad.length) index.updateMany(entries.map(entry => ({ uri: `file://${entry.relativePath.replaceAll('\\', '/')}`, path: entry.relativePath, text: entry.text })));
const graphDiagnostics = index.diagnostics();
const report = {
  format: 'scap-ng-vscode/clean-authoring-materialization/1',
  source,
  destination,
  schemaSourceCommit: profile.sourceCommit,
  streamCount: streams.length,
  yamlCount: entries.length,
  counts: entries.reduce((out, entry) => { const key = entry.kind ?? 'invalid'; out[key] = (out[key] ?? 0) + 1; return out; }, {}),
  schemaFailures: bad.length,
  graphFailures: graphDiagnostics.length,
  examples: bad.slice(0, 20).map(entry => ({ path: entry.sourcePath, kind: entry.kind, diagnostics: entry.diagnostics.slice(0, 8) })),
  graphExamples: graphDiagnostics.slice(0, 20)
};
console.log(JSON.stringify(report, null, 2));
if (bad.length || graphDiagnostics.length) {
  process.exitCode = 1;
} else {
  mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    const output = join(destination, entry.relativePath);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, entry.text);
  }
  writeFileSync(join(destination, 'MATERIALIZATION-MANIFEST.json'), JSON.stringify(report, null, 2) + '\n');
}
