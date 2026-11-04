import { MetadataPack } from './metadata.js';

type SchemaNode = Record<string, any>;
export interface SchemaLocation { uri: string; node: SchemaNode; }

const nodeCache = new WeakMap<MetadataPack, Map<string, SchemaLocation[]>>();

export function escapeSchemaPointer(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function schemaChildUri(uri: string, keyword: string, key: string | number) {
  const suffix = String(key) === '' ? `/${keyword}` : `/${keyword}/${escapeSchemaPointer(String(key))}`;
  return `${uri}${uri.includes('#') ? '' : '#'}${suffix}`;
}

/**
 * Expand a schema node without selecting an arbitrary oneOf branch.  Callers
 * use the returned alternatives as a union: validation remains responsible
 * for deciding which branch an authored value selects.
 */
export function schemaNodes(pack: MetadataPack, uri: string, seen = new Set<string>()): SchemaLocation[] {
  if (seen.size === 0) {
    const cache = nodeCache.get(pack) ?? new Map<string, SchemaLocation[]>();
    nodeCache.set(pack, cache);
    const cached = cache.get(uri);
    if (cached) return cached;
    const result = schemaNodesUncached(pack, uri, seen);
    cache.set(uri, result);
    return result;
  }
  return schemaNodesUncached(pack, uri, seen);
}

function schemaNodesUncached(pack: MetadataPack, uri: string, seen: Set<string>): SchemaLocation[] {
  if (seen.has(uri)) return [];
  seen.add(uri);
  let node: SchemaNode;
  try { node = pack.node(uri); } catch { return []; }
  const result: SchemaLocation[] = [{ uri, node }];
  if (typeof node.$ref === 'string') result.push(...schemaNodesUncached(pack, new URL(node.$ref, uri).href, seen));
  for (const keyword of ['allOf', 'oneOf', 'anyOf', 'if', 'then', 'else']) {
    const branches = Array.isArray(node[keyword]) ? node[keyword] : node[keyword] ? [node[keyword]] : [];
    for (let index = 0; index < branches.length; index++) result.push(...schemaNodesUncached(pack, schemaChildUri(uri, keyword, index), seen));
  }
  return result;
}

export function schemaPropertyEntries(pack: MetadataPack, locations: readonly SchemaLocation[]) {
  const result = new Map<string, SchemaLocation>();
  for (const location of locations) {
    for (const [name, node] of Object.entries(location.node.properties ?? {})) {
      if (!result.has(name)) result.set(name, { uri: schemaChildUri(location.uri, 'properties', name), node: node as SchemaNode });
    }
  }
  return result;
}

export function schemaAdditionalPropertyLocations(pack: MetadataPack, locations: readonly SchemaLocation[]) {
  return locations.flatMap(location => {
    const node = location.node.additionalProperties;
    return node && typeof node === 'object' && !Array.isArray(node)
      ? [{ uri: schemaChildUri(location.uri, 'additionalProperties', ''), node: node as SchemaNode }]
      : [];
  });
}

export function schemaItemLocations(pack: MetadataPack, locations: readonly SchemaLocation[]) {
  return locations.flatMap(location => {
    const node = location.node.items;
    return node && typeof node === 'object' && !Array.isArray(node)
      ? [{ uri: schemaChildUri(location.uri, 'items', ''), node: node as SchemaNode }]
      : [];
  });
}

/** Resolve a YAML mapping/sequence path against all compatible schema branches. */
export function resolveSchemaPath(pack: MetadataPack, rootUri: string, path: readonly string[]) {
  let locations = schemaNodes(pack, rootUri);
  let index = 0;
  while (index < path.length) {
    const segment = path[index];
    const properties = schemaPropertyEntries(pack, locations);
    const property = properties.get(segment);
    if (property) { locations = schemaNodes(pack, property.uri); index++; continue; }
    const dynamic = schemaAdditionalPropertyLocations(pack, locations);
    if (dynamic.length) { locations = dynamic.flatMap(location => schemaNodes(pack, location.uri)); index++; continue; }
    const items = schemaItemLocations(pack, locations);
    if (items.length) { locations = items.flatMap(location => schemaNodes(pack, location.uri)); continue; }
    return [];
  }
  return locations;
}

export function schemaPropertiesAtPath(pack: MetadataPack, rootUri: string, path: readonly string[]) {
  const locations = resolveSchemaPath(pack, rootUri, path);
  const entries = schemaPropertyEntries(pack, locations);
  if (entries.size) return entries;
  // A cursor after a sequence dash is logically inside the array item schema,
  // even though the YAML path ends at the array property (for example
  // `expression.concat` before `- literal:`).
  return schemaPropertyEntries(pack, schemaItemLocations(pack, locations).flatMap(location => schemaNodes(pack, location.uri)));
}

export function schemaObjectLike(pack: MetadataPack, locations: readonly SchemaLocation[], seen = new Set<string>()): boolean {
  for (const location of locations) {
    if (location.node.type === 'object' || location.node.properties || location.node.additionalProperties !== undefined) return true;
    if (location.node.type === 'array') continue;
    if (!seen.has(location.uri)) {
      seen.add(location.uri);
      if (schemaObjectLike(pack, schemaNodes(pack, location.uri), seen)) return true;
    }
  }
  return false;
}

export function schemaEnumValues(pack: MetadataPack, locations: readonly SchemaLocation[]) {
  const values = new Set<string>();
  for (const location of locations) for (const value of location.node.enum ?? []) if (typeof value === 'string') values.add(value);
  return [...values];
}
