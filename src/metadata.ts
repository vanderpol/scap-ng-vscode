/** Offline, immutable schema input adapter. No bundled upstream assets (#7). */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = Record<string, any>;
export interface Pin { schemaVersion: string; sourceCommit: string; manifestSha256: string }
export interface Context {
  documentVersion: string;
  /** Supplied by a compatible deterministic validator/host; unknown stays visible. */
  schemaValid: boolean;
  isOverride: boolean;
  diagnostics: readonly string[];
  mode?: 'source' | 'structured' | 'guided';
  parentValue?: Json;
}
export type ViewMode = 'show-all' | 'hide-defaults' | 'aggressive-preview';
export const sha256 = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen); Object.freeze(value);
  }
  return value;
}
function object(value: unknown): value is Schema {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function at(root: any, pointer: string): any {
  let result = root;
  for (const part of pointer.replace(/^\//, '').split('/').filter((_, i) => pointer !== '' || i !== 0)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!object(result) && !Array.isArray(result)) throw new Error('Unresolved schema pointer: ' + pointer);
    if (!Object.hasOwn(result, key)) throw new Error('Unresolved schema pointer: ' + pointer);
    result = (result as any)[key];
  }
  return result;
}

export class MetadataPack {
  readonly pin: Readonly<Pin>;
  readonly manifest: Readonly<Schema>;
  private readonly documents = new Map<string, Schema>();
  private readonly ajv: InstanceType<typeof Ajv2020.default>;

  constructor(directory: string, expected: Pin) {
    if (!/^[a-f0-9]{40}$/.test(expected.sourceCommit) || !/^[a-f0-9]{64}$/.test(expected.manifestSha256))
      throw new Error('An exact source commit and external manifest digest are required');
    const raw = readFileSync(resolve(directory, 'manifest.json'));
    if (sha256(raw) !== expected.manifestSha256) throw new Error('Schema pack manifest hash mismatch');
    const manifest = JSON.parse(raw.toString());
    if (manifest.format !== 'scap-ng/offline-editor-pack/1' || manifest.schema_version !== expected.schemaVersion ||
        manifest.source_commit !== expected.sourceCommit || manifest.authoring_metadata_version !== 1 || manifest.unpublished_worktree === true) throw new Error('Schema pack version/commit mismatch');
    const root = realpathSync(directory);
    this.ajv = new Ajv2020.default({ strict: false, useDefaults: false, coerceTypes: false, allErrors: true, validateFormats: false });
    for (const resource of manifest.resources) {
      if (typeof resource.path !== 'string' || resource.path.includes('\\') || resource.path.split('/').includes('..'))
        throw new Error('Unsafe schema pack path');
      const path = realpathSync(resolve(root, resource.path));
      if (!path.startsWith(root + sep)) throw new Error('Schema pack path escapes root');
      const bytes = readFileSync(path);
      if (bytes.length !== resource.bytes || sha256(bytes) !== resource.sha256) throw new Error('Schema resource hash mismatch: ' + resource.path);
      if (this.documents.has(resource.uri)) throw new Error('Duplicate schema resource identity');
      const doc = JSON.parse(bytes.toString());
      if (resource.kind === 'schema') {
        if (doc.$id !== resource.uri || (doc['x-scap-ng-version'] ?? doc['x-specification-version']) !== expected.schemaVersion)
          throw new Error('Schema identity/version mismatch: ' + resource.uri);
        this.ajv.addSchema(doc, resource.uri);
      }
      if (resource.kind === 'mapping' && doc.specification_version !== expected.schemaVersion) throw new Error('Mapping version mismatch');
      if (resource.kind === 'vocabulary' && doc.schema_version !== expected.schemaVersion) throw new Error('Vocabulary version mismatch');
      if (!['schema', 'mapping', 'vocabulary'].includes(resource.kind)) throw new Error('Unknown resource kind');
      this.documents.set(resource.uri, frozen(doc));
    }
    this.pin = frozen({ ...expected }); this.manifest = frozen(manifest);
  }

  resource(uri: string): Readonly<Schema> {
    const doc = this.documents.get(uri); if (!doc) throw new Error('Unavailable offline resource: ' + uri);
    return doc;
  }
  node(uri: string): Readonly<Schema> {
    const [document, fragment = ''] = uri.split('#');
    const value = at(this.resource(document), decodeURIComponent(fragment));
    if (!object(value)) throw new Error('Schema location is not an object: ' + uri);
    return value;
  }
  private layers(uri: string, seen = new Set<string>()): Readonly<Schema>[] {
    if (seen.has(uri)) return []; seen.add(uri);
    const node = this.node(uri); const rows: Readonly<Schema>[] = [];
    if (node.$ref) rows.push(...this.layers(new URL(node.$ref, uri).href, seen));
    for (let i = 0; i < (node.allOf ?? []).length; i++) rows.push(...this.layers(uri + (uri.includes('#') ? '' : '#') + '/allOf/' + i, seen));
    rows.push(node); return rows;
  }
  describe(uri: string, context: Context) {
    if (context.documentVersion !== this.pin.schemaVersion) throw new Error('Document/profile version mismatch');
    const layers = this.layers(uri); const combined: Schema = {};
    for (const layer of layers) Object.assign(combined, layer);
    const annotation = Object.assign({}, ...layers.map(n => n['x-scap-ng-authoring'] ?? {}));
    if (Object.keys(annotation).length && annotation.version !== 1) throw new Error('Unsupported authoring metadata version');
    const enums = layers.filter(n => Array.isArray(n.enum)).map(n => n.enum as Json[]);
    const choices = enums.length ? enums.reduce((a, b) => a.filter(v => b.some(x => canonical(x) === canonical(v)))) : [];
    return frozen({ uri, title: combined.title ?? '', description: combined.description ?? '',
      examples: combined.examples ?? [], choices: annotation.representation === 'key' ? this.keyChoices(uri, annotation.default_key) : choices, annotation,
      suggested: annotation.representation === 'key' ? annotation.default_key : combined.default,
      hasSuggestion: annotation.representation === 'key' ? Object.hasOwn(annotation, 'default_key') : Object.hasOwn(combined, 'default'),
      pin: this.pin, validationLevel: 'schema-metadata-only', assessmentExecution: 'unavailable' });
  }
  validate(uri: string, value: Json): string[] {
    const validator = this.ajv.compile({ $ref: uri });
    return validator(value) ? [] : (validator.errors ?? []).map(e => `${e.instancePath}: ${e.message}`);
  }
  private keyChoices(uri: string, defaultKey: string): string[] {
    const groups: string[][] = []; const propertyLimits: string[][] = []; const arrayKeys = new Set<string>();
    const walk = (location: string, seen: Set<string>) => {
      if (seen.has(location)) return; seen.add(location);
      const node = this.node(location);
      if (node.$ref) walk(new URL(node.$ref, location).href, seen);
      if (Array.isArray(node.propertyNames?.enum)) propertyLimits.push(node.propertyNames.enum);
      for (const [key, spec] of Object.entries(node.properties ?? {})) if ((spec as Schema).type === 'array') arrayKeys.add(key);
      for (const name of ['oneOf', 'anyOf', 'allOf']) {
        const children = node[name] ?? [];
        if (name !== 'allOf' && children.length) {
          const keys = children.filter((c: Schema) => Array.isArray(c.required) && c.required.length === 1).map((c: Schema) => c.required[0]);
          if (keys.includes(defaultKey)) groups.push(keys);
        }
        children.forEach((_: Schema, i: number) => walk(location + (location.includes('#') ? '' : '#') + '/' + name + '/' + i, seen));
      }
    };
    walk(uri, new Set());
    let keys = [...new Set(groups.flat())];
    for (const limit of propertyLimits) keys = keys.filter(k => limit.includes(k));
    const context = this.layers(uri).map(n => n['x-scap-ng-authoring']?.context).find(Boolean);
    if (context === 'explicit_logical_group') keys = keys.filter(k => arrayKeys.has(k));
    return keys;
  }
  control(uri: string, serializedValue: Json | undefined, context: Context, mode: ViewMode) {
    const help = this.describe(uri, context); const meta = help.annotation;
    let value: Json | undefined = serializedValue;
    if (meta.representation === 'key') {
      const choices = this.keyChoices(uri, meta.default_key);
      const present = object(serializedValue) ? choices.filter(k => Object.hasOwn(serializedValue, k)) : [];
      value = present.length === 1 ? present[0] : undefined;
    }
    const applicable = !meta.condition_schema || (context.parentValue !== undefined && !this.validate(meta.condition_schema, context.parentValue).length);
    const safe = context.schemaValid === true && context.isOverride === false && Array.isArray(context.diagnostics) && context.diagnostics.length === 0 && applicable;
    const isDefault = help.hasSuggestion && value !== undefined && canonical(value) === canonical(help.suggested);
    const eligible = meta.hide_when_default === true || (mode === 'aggressive-preview' && meta.aggressive_preview === true);
    const hidden = mode !== 'show-all' && safe && isDefault && eligible;
    return frozen({ ...help, serializedValue, controlValue: value, hidden, applicable,
      hiddenScope: meta.hide_scope ?? 'value_control_only',
      reason: hidden ? 'Explicit serialized default; reveal is available' : 'Visible value, exception, absent value or diagnostic',
      assessmentExecution: 'unavailable' });
  }
  summarize(controls: readonly ReturnType<MetadataPack['control']>[]) {
    const groups: Record<string, number> = {};
    for (const c of controls) if (c.hidden) groups[c.annotation.group ?? 'other'] = (groups[c.annotation.group ?? 'other'] ?? 0) + 1;
    return frozen({ hidden: controls.filter(c => c.hidden).length, total: controls.length, groups });
  }
  /** Called only for explicit NEW authoring; never by open/save/describe. */
  newObjectDefaults(uri: string, seed: Json, context: Context): Json {
    if (!object(seed)) throw new Error('New object defaults require an explicit object seed');
    const result: Record<string, Json> = structuredClone(seed as Record<string, Json>); const properties: Record<string, string> = {};
    for (const layer of this.layers(uri)) {
      const resource = this.findLayerUri(uri, layer);
      for (const name of Object.keys(layer.properties ?? {})) properties[name] = resource + '/properties/' + name.replace(/~/g, '~0').replace(/\//g, '~1');
    }
    for (const [name, location] of Object.entries(properties)) {
      if (Object.hasOwn(result, name)) continue;
      const help = this.describe(location, { ...context, parentValue: result });
      if (!help.hasSuggestion || help.annotation.representation === 'key') continue;
      if (help.annotation.condition_schema && this.validate(help.annotation.condition_schema, result).length) continue;
      if (this.validate(location, help.suggested as Json).length) throw new Error('Invalid schema suggestion');
      result[name] = structuredClone(help.suggested);
    }
    for (const layer of this.layers(uri)) {
      const base = this.findLayerUri(uri, layer);
      for (const name of ['oneOf', 'anyOf']) {
        if (!Array.isArray(layer[name])) continue;
        const candidates: Json[] = [];
        layer[name].forEach((_: Schema, i: number) => {
          const location = base + '/' + name + '/' + i;
          try {
            const candidate = this.newObjectDefaults(location, result, context);
            if (!this.validate(location, candidate).length) candidates.push(candidate);
          } catch { /* Invalid/nonobject alternative stays unavailable. */ }
        });
        const unique = [...new Map(candidates.map(c => [canonical(c), c])).values()];
        if (unique.length === 1) return unique[0];
        if (unique.length > 1) throw new Error('Ambiguous new-authoring schema branch');
      }
    }
    return result;
  }
  private findLayerUri(uri: string, target: Readonly<Schema>, seen = new Set<string>()): string {
    if (seen.has(uri)) throw new Error('Schema layer not found'); seen.add(uri);
    if (this.node(uri) === target) return uri.includes('#') ? uri : uri + '#';
    const node = this.node(uri);
    const next = [...(node.$ref ? [new URL(node.$ref, uri).href] : []), ...(node.allOf ?? []).map((_: Schema, i: number) => uri + (uri.includes('#') ? '' : '#') + '/allOf/' + i)];
    for (const n of next) { try { return this.findLayerUri(n, target, new Set(seen)); } catch {} }
    throw new Error('Schema layer not found');
  }
  /** An explicitly requested comparison/filter/group, with supplied operands. */
  newKeyChoice(uri: string, operand: Json, context: Context): Json {
    const help = this.describe(uri, context);
    if (help.annotation.representation !== 'key') throw new Error('No schema-backed key choice');
    let result: Json = { [help.annotation.default_key]: structuredClone(operand) };
    result = this.newObjectDefaults(uri, result, context);
    if (this.validate(uri, result).length) throw new Error('New choice requires valid author-supplied operands/context');
    return result;
  }
}
