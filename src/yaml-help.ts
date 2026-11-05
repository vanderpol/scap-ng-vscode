import { parseDocument } from 'yaml';
import { readFileSync } from 'node:fs';
import { MetadataPack, type Context } from './metadata.js';
import { schemaNodes as sharedSchemaNodes, schemaEnumValues as sharedSchemaEnumValues, schemaChildUri } from './schema-resolver.js';

type Api = any;
type SchemaTarget = { uri: string; key: string; path: string[]; capability?: string };
type DocumentSnapshot = { text: string; parsed: any; value?: any };

const helpCache = new WeakMap<MetadataPack, Map<string, { title: string; markdown: string } | undefined>>();
const context: Context = { documentVersion: '', schemaValid: true, isOverride: false, diagnostics: [] };

function resourceUri(pack: MetadataPack, suffix: string) {
  return pack.manifest.resources.find((resource: any) => resource.kind === 'schema' && resource.uri.endsWith(suffix))?.uri;
}
function expand(pack: MetadataPack, uri: string, seen = new Set<string>()): Array<{ uri: string; node: any }> {
  return sharedSchemaNodes(pack, uri, seen);
}

function propertyTarget(pack: MetadataPack, candidates: string[], key: string, visited = new Set<string>()): string | undefined {
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    const expanded = expand(pack, candidate);
    for (const { uri, node } of expanded) {
      if (node.properties?.[key]) return schemaChildUri(uri, 'properties', key);
      if (node.patternProperties) {
        const pattern = Object.keys(node.patternProperties).find(value => new RegExp(value).test(key));
        if (pattern) return schemaChildUri(uri, 'patternProperties', pattern);
      }
    }
    for (const { uri, node } of expanded) if (node.items && typeof node.items === 'object') {
      const itemUri = schemaChildUri(uri, 'items', '');
      const nested = propertyTarget(pack, [itemUri], key, visited);
      if (nested) return nested;
      return itemUri;
    }
    for (const { uri, node } of expanded) if (node.additionalProperties && typeof node.additionalProperties === 'object') return schemaChildUri(uri, 'additionalProperties', '');
  }
  return undefined;
}
function nodePathAt(document: any, position: any, parsed = parseDocument(document.getText(), { keepSourceTokens: true, uniqueKeys: false })): string[] | undefined {
  const offset = typeof document.offsetAt === 'function' ? document.offsetAt(position) : 0;
  try {
    const visit = (node: any, path: string[]): string[] | undefined => {
      if (!node || !Array.isArray(node.range) || offset < node.range[0] || offset > node.range[1]) return undefined;
      if (Array.isArray(node.items)) {
        for (const item of node.items) {
          const key = typeof item?.key?.value === 'string' ? item.key.value : undefined;
          if (key !== undefined && item.key?.range && offset >= item.key.range[0] && offset <= item.key.range[1]) return [...path, key];
          const child = visit(key === undefined ? item : item?.value, key === undefined ? path : [...path, key]);
          if (child) return child;
          // A scalar value has no child mapping to recurse into, but its key is
          // still the schema property being inspected.
          if (key !== undefined && item.value?.range && offset >= item.value.range[0] && offset <= item.value.range[1]) return [...path, key];
        }
      }
      return undefined;
    };
    return visit(parsed.contents, []);
  } catch {
    return undefined;
  }
}
function valueAtPath(value: any, path: string[]) {
  let current = value;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const item = current.find(value => value !== null && typeof value === 'object' && Object.hasOwn(value, segment));
      current = item?.[segment];
    } else current = current[segment];
  }
  return current;
}
function capabilityForPath(path: string[], snapshot: DocumentSnapshot) {
  try {
    snapshot.value ??= snapshot.parsed.toJS({ maxAliasCount: 50 });
    const objectIndex = path.lastIndexOf('object');
    if (objectIndex >= 0) {
      const object = valueAtPath(snapshot.value, path.slice(0, objectIndex + 1));
      if (typeof object?.capability === 'string') return object.capability;
    }
    const tests = path.indexOf('tests');
    if (tests >= 0 && path[tests + 1]) return snapshot.value?.assessment?.tests?.[path[tests + 1]]?.capability;
  } catch {
    return undefined;
  }
  return undefined;
}
function capabilityCandidates(pack: MetadataPack, capability: string | undefined, definition: 'object' | 'state_predicate') {
  const uri = capability && pack.manifest.capabilities?.[capability]?.schema_uri;
  return uri ? [`${uri}#/$defs/${definition}`] : [];
}
function schemaTargetForPath(pack: MetadataPack, path: string[], snapshot: DocumentSnapshot): SchemaTarget | undefined {
  const root = resourceUri(pack, '/assessment.schema.json');
  if (!root || path.length === 0) return undefined;
  let candidates = [root];
  const capability = capabilityForPath(path, snapshot);
  const objectIndex = path.lastIndexOf('object');
  const fieldsIndex = path.lastIndexOf('fields');
  for (let index = 0; index < path.length; index++) {
    const key = path[index];
    if (objectIndex >= 0 && index > objectIndex) {
      const selected = capabilityCandidates(pack, capability, 'object');
      if (selected.length) candidates = selected;
    } else if (fieldsIndex >= 0 && index > fieldsIndex && path[fieldsIndex - 1] === 'require') {
      const selected = capabilityCandidates(pack, capability, 'state_predicate');
      if (selected.length) candidates = selected;
    }
    const target = propertyTarget(pack, candidates, key);
    if (!target) return undefined;
    candidates = [target];
  }
  const target = candidates[0];
  return target ? { uri: target, key: path.at(-1)!, path, capability } : undefined;
}
function explicitSchemaOperators(pack: MetadataPack, uri: string, seen = new Set<string>()): string[] {
  if (seen.has(uri)) return [];
  seen.add(uri);
  let node: any;
  try { node = pack.node(uri); } catch { return []; }
  const values = Array.isArray(node.propertyNames?.enum) ? node.propertyNames.enum.filter((value: unknown): value is string => typeof value === 'string') : [];
  if (values.length) return values;
  const nested = new Set<string>();
  for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
    for (let index = 0; index < (node[keyword] ?? []).length; index++) {
      const childUri = schemaChildUri(uri, keyword, index);
      for (const value of explicitSchemaOperators(pack, childUri, new Set(seen))) nested.add(value);
    }
  }
  return [...nested];
}
function schemaOperators(pack: MetadataPack, uri: string): string[] {
  const nodes = expand(pack, uri);
  const restricted = nodes.flatMap(({ node }) => Array.isArray(node.propertyNames?.enum) ? node.propertyNames.enum : []);
  const names = new Set<string>(restricted);
  if (!restricted.length) {
    for (const { node } of nodes) {
      const properties = node.properties ?? {};
      for (const alternative of node.allOf ?? []) for (const branch of alternative.oneOf ?? []) {
        for (const name of branch.required ?? []) if (properties[name]?.oneOf) names.add(name);
      }
    }
  }
  return [...names];
}
function capabilityVocabularyEntry(pack: MetadataPack, target: SchemaTarget): any | undefined {
  if (!target.capability) return undefined;
  const resource: any = pack.manifest.resources.find((candidate: any) => candidate.kind === 'vocabulary');
  const vocabulary: any = resource ? pack.resource(resource.uri) : undefined;
  const capability = vocabulary?.capabilities?.[target.capability];
  const objectIndex = target.path.indexOf('object');
  const fieldsIndex = target.path.indexOf('fields');
  if (objectIndex >= 0 && target.path.length === objectIndex + 2) {
    const selector = capability?.selectors?.[target.key];
    let schemaNode: any;
    try { schemaNode = pack.node(target.uri); } catch { schemaNode = undefined; }
    const isSelector = schemaNode?.['x-scap-ng-authoring']?.context === 'selector_comparison';
    if (selector || isSelector) {
      const capabilityLabel = capability?.label || target.capability;
      const label = selector?.label || target.key.replaceAll('_', ' ').replace(/^./, (value: string) => value.toUpperCase());
      const description = selector?.description || (selector?.prompt ? `Selects the ${label.toLowerCase()} used by ${capabilityLabel}. ${selector.prompt}` : undefined);
      const mappingUri = pack.manifest.capabilities?.[target.capability]?.mapping_uri;
      const mapping: any = mappingUri ? pack.resource(mappingUri) : undefined;
      const nativeOperators = mapping?.native?.selector_operators?.[target.key] ?? mapping?.native?.selector_operator_enums?.[target.key];
      const sourceOperators = mapping?.native?.selector_source_operations?.[target.key];
      const semantics = mapping?.native?.selector_case_semantics?.[target.key];
      const semanticText = semantics?.description ? ` ${semantics.description}` : '';
      const schemaOperatorsForField = explicitSchemaOperators(pack, target.uri);
      const hasSpecificMapping = Array.isArray(sourceOperators) || semantics;
      const operatorNote = !Array.isArray(nativeOperators) && (hasSpecificMapping || !schemaOperatorsForField.length)
        ? `${Array.isArray(sourceOperators) ? `The pinned mapping lists source operations (${sourceOperators.join(', ')}), but ` : semantics ? 'The pinned mapping describes this selector, but ' : 'The capability schema marks this as a selector, but '}does not declare native serialized operator tokens.${semanticText} Shared generic schema operators are not treated as field-specific. No native subset is inferred.`
        : undefined;
      return { label, description, choices: mapping?.native?.selector_value_enums?.[target.key] ?? [], operators: Array.isArray(nativeOperators) ? nativeOperators : (hasSpecificMapping ? [] : schemaOperatorsForField), operatorNote };
    }
  }
  if (fieldsIndex >= 0 && target.path.length === fieldsIndex + 2) {
    const field = capability?.state_fields?.[target.key];
    if (field) {
      const mappingUri = pack.manifest.capabilities?.[target.capability]?.mapping_uri;
      const mapping: any = mappingUri ? pack.resource(mappingUri) : undefined;
      return { label: field.label, description: field.description || field.prompt, choices: mapping?.native?.state_value_enums?.[target.key] ?? [] };
    }
  }
  return undefined;
}
function vocabularyEntry(pack: MetadataPack, path: string[], key: string): any | undefined {
  const resource: any = pack.manifest.resources.find((candidate: any) => candidate.kind === 'vocabulary');
  if (!resource) return undefined;
  const vocabulary: any = pack.resource(resource.uri);
  const scopes = vocabulary.term_scopes ?? {};
  const tests = path.indexOf('tests');
  const rest = tests >= 0 ? path.slice(tests + 2) : [];
  const candidates: string[] = [];
  if (rest[0] === 'require') {
    if (rest[1] === 'item_requirement' && rest[2]) candidates.push(`test.require.item_requirement.${rest[2]}`);
    if (rest[1] === 'field_requirement') {
      candidates.push('test.require.field_requirement');
      if (rest[2]) candidates.push(`field.${rest[2]}`);
    }
    if (rest[1] === 'fields') {
      if (rest.length === 2) candidates.push('test.require.fields');
      if (rest[2]) candidates.push(`field.${rest[2]}`);
    }
    if (rest[1]) candidates.push(`test.require.${rest[1]}`);
  } else if (rest.length === 1 && rest[0]) candidates.push(`test.${rest[0]}`);
  return candidates.map(candidate => scopes[candidate]).find(Boolean);
}
function schemaEnumValues(pack: MetadataPack, uri: string): string[] {
  return sharedSchemaEnumValues(pack, sharedSchemaNodes(pack, uri));
}

function schemaHelp(pack: MetadataPack, target: SchemaTarget) {
  const cache = helpCache.get(pack) ?? new Map<string, { title: string; markdown: string } | undefined>();
  helpCache.set(pack, cache);
  const cacheKey = `${target.uri}\0${target.path.join('.')}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const help = pack.describe(target.uri, { ...context, documentVersion: pack.pin.schemaVersion });
  let exact: any;
  try { exact = pack.node(target.uri); } catch { exact = undefined; }
  const vocabulary = capabilityVocabularyEntry(pack, target) || vocabularyEntry(pack, target.path, target.key);
  const fallbackTitle = target.key.replaceAll('_', ' ').replace(/^./, (value: string) => value.toUpperCase());
  const title = vocabulary?.label || exact?.title || help.title || fallbackTitle;
  const description = vocabulary?.description || exact?.description || help.description || 'The pinned schema does not declare a human-readable description for this element.';
  const schemaChoices = help.choices.length ? help.choices : schemaEnumValues(pack, target.uri);
  const choices = vocabulary && Object.hasOwn(vocabulary, 'choices') ? vocabulary.choices : schemaChoices;
  const allowed = choices.length ? `\n\n**Allowed values:** ${choices.map((value: unknown) => `\`${String(value)}\``).join(', ')}` : '';
  const operators = vocabulary?.operators?.length ? `\n\n**Allowed operators:** ${vocabulary.operators.map((value: string) => `\`${value}\``).join(', ')}` : '';
  const operatorNote = vocabulary?.operatorNote ? `\n\n**Allowed operators:** ${vocabulary.operatorNote}` : '';
  const result = { title, markdown: `**${title}**\n\n${description || 'Schema-defined SCAP-NG element.'}${allowed}${operators}${operatorNote}` };
  cache.set(cacheKey, result);
  return result;
}
function wordRange(document: any, position: any, api: Api) {
  const line = document.lineAt(position.line).text;
  let start = position.character;
  while (start > 0 && /[A-Za-z0-9_.-]/.test(line[start - 1])) start--;
  let end = position.character;
  while (end < line.length && /[A-Za-z0-9_.-]/.test(line[end])) end++;
  return new api.Range(position.line, start, position.line, end);
}
function definitionRange(pack: MetadataPack, target: SchemaTarget, api: Api) {
  const resourceUriValue = target.uri.split('#')[0];
  let raw: string;
  try { raw = readFileSync(pack.resourcePath(resourceUriValue), 'utf8'); } catch { return undefined; }
  const property = target.key;
  const offset = raw.indexOf(`"${property}"`);
  if (offset < 0) return undefined;
  const before = raw.slice(0, offset);
  const line = before.split('\n').length - 1;
  const character = offset - (before.lastIndexOf('\n') + 1);
  return { uri: api.Uri.file(pack.resourcePath(resourceUriValue)), range: new api.Range(line, character, line, character + property.length + 2) };
}
export function registerYamlHoverProvider(context: any, getPack: () => MetadataPack | undefined, api: Api) {
  if (!api.languages?.registerHoverProvider) return;
  const snapshots = new Map<string, { version: number; snapshot: DocumentSnapshot }>();
  const provider = { provideHover(document: any, position: any) {
    if (!/\.assessment\.ya?ml$/i.test(document.uri?.fsPath ?? document.fileName ?? '')) return undefined;
    const pack = getPack(); if (!pack) return undefined;
    const key = document.uri?.toString?.() ?? document.fileName ?? '';
    const version = typeof document.version === 'number' ? document.version : -1;
    let entry = snapshots.get(key);
    if (!entry || entry.version !== version || entry.snapshot.text !== document.getText()) {
      try { entry = { version, snapshot: { text: document.getText(), parsed: parseDocument(document.getText(), { keepSourceTokens: true, uniqueKeys: false }) } }; } catch { return undefined; }
      snapshots.set(key, entry);
      if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value!);
    }
    const path = nodePathAt(document, position, entry.snapshot.parsed); if (!path) return undefined;
    const target = schemaTargetForPath(pack, path, entry.snapshot); if (!target) return undefined;
    const help = schemaHelp(pack, target); if (!help) return undefined;
    return { contents: [help.markdown], range: wordRange(document, position, api) };
  }};
  context.subscriptions.push(api.languages.registerHoverProvider({ language: 'yaml', scheme: 'file' }, provider));
}
export function registerYamlDefinitionProvider(context: any, getPack: () => MetadataPack | undefined, api: Api) {
  if (!api.languages?.registerDefinitionProvider) return;
  const snapshots = new Map<string, { version: number; snapshot: DocumentSnapshot }>();
  const provider = { provideDefinition(document: any, position: any) {
    if (!/\.assessment\.ya?ml$/i.test(document.uri?.fsPath ?? document.fileName ?? '')) return undefined;
    const pack = getPack(); if (!pack) return undefined;
    const key = document.uri?.toString?.() ?? document.fileName ?? '';
    const version = typeof document.version === 'number' ? document.version : -1;
    let entry = snapshots.get(key);
    if (!entry || entry.version !== version || entry.snapshot.text !== document.getText()) {
      try { entry = { version, snapshot: { text: document.getText(), parsed: parseDocument(document.getText(), { keepSourceTokens: true, uniqueKeys: false }) } }; } catch { return undefined; }
      snapshots.set(key, entry);
      if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value!);
    }
    const path = nodePathAt(document, position, entry.snapshot.parsed); if (!path) return undefined;
    const target = schemaTargetForPath(pack, path, entry.snapshot); if (!target) return undefined;
    const location = definitionRange(pack, target, api); if (!location) return undefined;
    return [{ targetUri: location.uri, targetRange: location.range, targetSelectionRange: location.range }];
  }};
  context.subscriptions.push(api.languages.registerDefinitionProvider({ language: 'yaml', scheme: 'file' }, provider));
}

/** Return the same pinned schema/vocabulary help used by native YAML hover. */
export function contextualHelp(pack: MetadataPack, document: any, position: any): { title: string; markdown: string; path: string[]; capability?: string; schemaUri: string } | undefined {
  try {
    const parsed = parseDocument(document.getText(), { keepSourceTokens: true, uniqueKeys: false });
    const snapshot: DocumentSnapshot = { text: document.getText(), parsed };
    const path = nodePathAt(document, position, parsed);
    if (!path) return undefined;
    const target = schemaTargetForPath(pack, path, snapshot);
    if (!target) return undefined;
    const help = schemaHelp(pack, target);
    return help ? { ...help, path, capability: target.capability, schemaUri: target.uri } : undefined;
  } catch { return undefined; }
}
