import { MetadataPack, sha256, type Json } from './metadata.js';
import { SourceBuffer } from './source.js';

type EditPath = (string | number)[];
function scalarEntries(value: Json, path: EditPath = []): Array<{ path: EditPath; value: Json }> {
  if (Array.isArray(value)) return value.flatMap((entry, index) => scalarEntries(entry, [...path, index]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => scalarEntries(entry, [...path, key]));
  return [{ path, value }];
}
function pathLabel(path: EditPath) { return path.map(part => typeof part === 'number' ? `[${part}]` : part).join('.').replaceAll('.[', '['); }
function schemaRoot(pack?: MetadataPack) {
  return pack?.manifest.resources.find((resource: any) => resource.kind === 'schema' && /\/assessment\.schema\.json$/.test(resource.uri))?.uri as string | undefined;
}
function escapedPart(part: string | number) { return String(part).replace(/~/g, '~0').replace(/\//g, '~1'); }
function dereference(pack: MetadataPack, uri: string, seen = new Set<string>()): { uri: string; node: any } | undefined {
  if (seen.has(uri)) return undefined; seen.add(uri);
  const node = pack.node(uri); if (typeof node.$ref !== 'string') return { uri, node };
  const target = new URL(node.$ref, uri).href; return dereference(pack, target, seen);
}
function schemaForPath(pack: MetadataPack, uri: string, path: EditPath): string | undefined {
  if (!path.length) return uri;
  const resolved = dereference(pack, uri); if (!resolved) return undefined;
  const node = resolved.node;
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    for (let index = 0; index < (node[keyword] ?? []).length; index++) {
      const child = resolved.uri + (resolved.uri.includes('#') ? '' : '#') + `/${keyword}/${index}`;
      const found = schemaForPath(pack, child, path); if (found) return found;
    }
  }
  const [part, ...rest] = path;
  if (typeof part === 'number') return node.items ? schemaForPath(pack, resolved.uri + (resolved.uri.includes('#') ? '' : '#') + '/items', rest) : undefined;
  if (node.properties && Object.hasOwn(node.properties, part)) return schemaForPath(pack, resolved.uri + (resolved.uri.includes('#') ? '' : '#') + '/properties/' + escapedPart(part), rest);
  if (node.additionalProperties && typeof node.additionalProperties === 'object') return schemaForPath(pack, resolved.uri + (resolved.uri.includes('#') ? '' : '#') + '/additionalProperties', rest);
  return undefined;
}
function schemaHelp(pack: MetadataPack | undefined, root: string | undefined, path: EditPath) {
  if (!pack || !root || !path.length) return undefined;
  try {
    const uri = schemaForPath(pack, root, path); if (!uri) return undefined;
    const help = pack.describe(uri, { documentVersion: '0.4.0', schemaValid: true, isOverride: false, diagnostics: [] });
    return { uri, title: help.title, description: help.description, choices: help.choices.filter((choice: Json) => ['string', 'number', 'boolean'].includes(typeof choice)) as Array<string | number | boolean> };
  } catch { return undefined; }
}
export function modelFor(document: any, pack?: MetadataPack) {
  try {
    const value = new SourceBuffer(document.getText()).json(); const root = schemaRoot(pack);
    return { ok: true, revision: sha256(document.getText()), version: document.version, fields: scalarEntries(value).map(field => {
      const help = schemaHelp(pack, root, field.path);
      return { ...field, label: help?.title || pathLabel(field.path), description: help?.description || '', choices: help?.choices || [], kind: field.value === null ? 'null' : typeof field.value };
    }) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error), fields: [] }; }
}
