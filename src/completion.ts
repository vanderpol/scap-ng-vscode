import { parseDocument } from 'yaml';
import { MetadataPack } from './metadata.js';
import { GuidedCatalog } from './guided.js';
import { schemaCapabilityObjectProperties, schemaNodes as resolveSchemaNodes, schemaPropertiesAtPath, schemaPropertyEntries } from './schema-resolver.js';

const schemaBase = 'https://scap-ng.dev/schema/v0.4.0/';

export interface CompletionChoice {
  value: string;
  label: string;
  description?: string;
  kind?: 'value' | 'property';
  isDefault?: boolean;
  insertText?: string;
  defaultValue?: unknown;
  isPlaceholder?: boolean;
}

function lineAt(source: string, offset: number) {
  const start = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return { start, text: source.slice(start, offset) };
}
function inlineMappingPath(text: string): string[] {
  // Track the flow mappings that are still open at the cursor. This matters
  // after a comma: `object: {hive: {...}, k` is still inside `object`, but a
  // simple last-brace/last-comma heuristic loses that parent context.
  const stack: string[] = [];
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === '{') {
      const before = text.slice(0, index);
      const key = before.match(/(?:^|[,{}])\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/)?.[1];
      if (key) stack.push(key);
    } else if (character === '}') {
      stack.pop();
    }
  }
  return stack;
}
function pathAt(source: string, offset: number): string[] {
  const before = source.slice(0, offset).split(/\r?\n/);
  const stack: Array<{ indent: number; key: string; sequence: boolean }> = [];
  for (const raw of before.slice(0, -1)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const match = raw.match(/^(\s*)(-\s*)?([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (!match) continue;
    const sequence = Boolean(match[2]);
    const indent = match[1].replace(/\t/g, '  ').length;
    while (stack.length && (stack.at(-1)!.indent > indent ||
      (!sequence && stack.at(-1)!.indent >= indent) ||
      (sequence && stack.at(-1)!.indent === indent && stack.at(-1)!.sequence))) stack.pop();
    const rest = raw.slice(match[0].length).trim();
    if (!rest || rest.startsWith('#')) stack.push({ indent, key: match[3], sequence });
  }
  const currentText = lineAt(source, offset).text;
  const currentIndent = currentText.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
  const currentMatch = currentText.match(/^(\s*)(-\s*)?([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  const currentSequence = Boolean(currentMatch?.[2]) || /^\s*-\s*/.test(currentText);
  while (stack.length && (stack.at(-1)!.indent > currentIndent ||
    (!currentSequence && stack.at(-1)!.indent >= currentIndent) ||
    (currentSequence && stack.at(-1)!.indent === currentIndent && stack.at(-1)!.sequence))) stack.pop();
  const delimiter = Math.max(currentText.lastIndexOf('{'), currentText.lastIndexOf(','));
  const segment = currentText.slice(delimiter + 1);
  const current = segment.match(/^\s*(?:-\s*)?([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  return [...stack.map(entry => entry.key), ...inlineMappingPath(currentText), ...(current ? [current[1]] : [])];
}

function currentKey(source: string, offset: number) {
  const { text } = lineAt(source, offset);
  const delimiter = Math.max(text.lastIndexOf('{'), text.lastIndexOf(','));
  const segment = text.slice(delimiter + 1);
  return segment.match(/^\s*(?:-\s*)?([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*[^#]*$/)?.[1];
}
function lineValueAfterCurrentKey(text: string, key: string | undefined): string {
  if (!key) return '';
  const match = text.match(new RegExp(`(?:^|[,{}])\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`));
  return match?.[1] ?? '';
}
function mappingPair(node: any, key: string): any | undefined {
  if (!node?.items) return undefined;
  return node.items.find((pair: any) => pair?.key?.value === key);
}

/**
 * Resolve capability from the enclosing Assessment Test, never from the last
 * textual `capability:` token in the document. YAML node ranges keep sibling
 * Tests and quoted/commented text separate; an invalid/incomplete document
 * deliberately falls back to no capability rather than borrowing a sibling.
 */
function currentCapability(source: string, offset: number): string | undefined {
  try {
    const document = parseDocument(source, { keepSourceTokens: true, uniqueKeys: false });
    const assessment = mappingPair(document.contents, 'assessment')?.value;
    const tests = mappingPair(assessment, 'tests');
    const testItems = tests?.value?.items;
    if (!tests?.value?.range || !Array.isArray(testItems) || offset < tests.value.range[0]) return undefined;
    if (offset > tests.value.range[1]) {
      // YAML omits trailing indentation from a node range. Permit a cursor
      // after an incomplete child only while the remainder is whitespace or a
      // comment at a deeper indentation; never bleed into evaluate/siblings.
      const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
      const testsLineStart = source.lastIndexOf('\n', Math.max(0, (tests.key?.range?.[0] ?? 0) - 1)) + 1;
      const currentIndent = source.slice(lineStart, offset).match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
      const testsIndent = source.slice(testsLineStart, tests.key?.range?.[0] ?? 0).match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
      if (currentIndent <= testsIndent || !/^[\s#]*$/.test(source.slice(tests.value.range[1], offset))) return undefined;
    }
    const active = testItems.filter((pair: any) => pair?.key?.range?.[0] <= offset).at(-1);
    if (!active?.value?.items) return undefined;
    const capability = mappingPair(active.value, 'capability')?.value;
    return typeof capability?.value === 'string' ? capability.value : undefined;
  } catch {
    // Parsing is intentionally authoritative. Heuristics are not safe here:
    // a malformed Test must not inherit selectors from a neighboring Test.
    return undefined;
  }
}
function capabilityAtPath(source: string, path: string[]): string | undefined {
  try {
    const value = parseDocument(source, { uniqueKeys: false }).toJS({ maxAliasCount: 50 }) as any;
    const objectIndex = path.lastIndexOf('object');
    if (objectIndex >= 0) {
      let current = value;
      for (const segment of path.slice(0, objectIndex + 1)) {
        if (Array.isArray(current)) current = current[0];
        current = current?.[segment];
      }
      return typeof current?.capability === 'string' ? current.capability : undefined;
    }
  } catch { /* Incomplete YAML intentionally has no guessed capability. */ }
  return undefined;
}

function authoredTestChoices(source: string): CompletionChoice[] {
  let tests: Record<string, any> | undefined;
  try {
    const value = parseDocument(source, { uniqueKeys: false }).toJS({ maxAliasCount: 50 }) as any;
    tests = value?.assessment?.tests;
  } catch { /* Incomplete YAML may not be parseable yet; return no invented values. */ }
  if (!tests || typeof tests !== 'object' || Array.isArray(tests)) return [];
  return Object.entries(tests).map(([id, test]: [string, any]) => ({
    value: id,
    label: id,
    description: typeof test?.test_title === 'string' ? test.test_title : 'Test defined in this Assessment',
    kind: 'value'
  }));
}
function validSchemaSuggestion(pack: MetadataPack, uri: string, spec: any, value: unknown): unknown {
  try {
    // Validate only concrete pack locations. Synthetic schema fragments used
    // by callers/tests remain usable as deterministic probes.
    if (pack.node(uri) !== spec) return value;
    return pack.validate(uri, value as any).length === 0 ? value : undefined;
  } catch { return value; }
}

export function schemaDefaultValue(pack: MetadataPack, uri: string, spec: any, seen = new Set<string>()): unknown {
  if (!spec || typeof spec !== 'object') return undefined;
  if (Object.hasOwn(spec, 'default')) return validSchemaSuggestion(pack, uri, spec, spec.default);
  // A oneOf/anyOf default is usable only when every alternative yields the
  // same complete value. A constructible first branch is not evidence of
  // author intent, so ambiguous alternatives remain an editable skeleton.
  for (const key of ['oneOf', 'anyOf']) {
    const branches = Array.isArray(spec[key]) ? spec[key] : [];
    if (!branches.length) continue;
    const values = branches.map((branch: any) => schemaDefaultValue(pack, uri, branch, seen));
    if (values.every(value => value !== undefined)) {
      const serialized = new Set(values.map(value => JSON.stringify(value)));
      if (serialized.size === 1) return values[0];
    }
    // An explicit union with no unanimous complete value is ambiguous. Do
    // not continue into schemaNodes(), which would otherwise rediscover the
    // first branch's required defaults and silently pick a meaning.
    return undefined;
  }
  const nodes = schemaNodes(pack, uri, spec);
  for (const node of nodes) {
    if (node === spec && typeof spec.$ref === 'string') continue;
    const required = Array.isArray(node.required) ? node.required : [];
    const properties = node.properties ?? {};
    if (!required.length) continue;
    const values: Record<string, unknown> = {};
    let complete = true;
    for (const name of required) {
      const child = properties[name];
      const childKey = `${uri}#${name}`;
      if (seen.has(childKey)) { complete = false; break; }
      seen.add(childKey);
      const value = schemaDefaultValue(pack, uri, child, seen);
      seen.delete(childKey);
      if (value === undefined) { complete = false; break; }
      values[name] = value;
    }
    if (complete) {
      const alternatives = [...(node.oneOf ?? []), ...(node.anyOf ?? [])];
      if (alternatives.length && !alternatives.some((branch: any) =>
        (Array.isArray(branch.required) ? branch.required : []).every((name: string) => Object.hasOwn(values, name)))) continue;
      const suggestion = validSchemaSuggestion(pack, uri, node, values);
      if (suggestion !== undefined) return suggestion;
    }
  }
  return undefined;
}
function yamlTemplateValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(yamlTemplateValue).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${key}: ${yamlTemplateValue(item)}`).join(', ')}}`;
  if (typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) return value;
  return JSON.stringify(value);
}
function propertyChoice(pack: MetadataPack, uri: string, path: string, value: string, spec: any, insertText?: string): CompletionChoice {
  const location = path ? `${uri}#${path}` : uri;
  let description = typeof spec?.description === 'string' ? spec.description : undefined;
  if (!description) {
    try {
      description = pack.describe(location, {
        documentVersion: pack.pin.schemaVersion,
        schemaValid: true,
        isOverride: false,
        diagnostics: []
      }).description || undefined;
    } catch { /* A schema-defined property may intentionally have no description. */ }
  }
  if (!description) {
    try {
      const parentPath = path.replace(/\/properties\/[^/]+$/, '');
      const parentDescription = parentPath ? pack.describe(`${uri}#${parentPath}`, {
        documentVersion: pack.pin.schemaVersion,
        schemaValid: true,
        isOverride: false,
        diagnostics: []
      }).description : undefined;
      description = parentDescription ? `Schema property '${value}'. ${parentDescription}` : `Schema-defined property '${value}'.`;
    } catch { description = `Schema-defined property '${value}'.`; }
  }
  const defaultValue = schemaDefaultValue(pack, location, spec);
  const template = defaultValue !== undefined && insertText?.endsWith('{')
    ? `${value}: ${yamlTemplateValue(defaultValue)}`
    : insertText;
  return { value, label: spec?.title ?? value, description, kind: 'property', insertText: template, defaultValue, isDefault: defaultValue !== undefined, isPlaceholder: defaultValue === undefined && Boolean(insertText?.endsWith('{') || insertText?.endsWith('[')) };
}
function schemaNodes(pack: MetadataPack, baseUri: string, root: any, seen = new Set<string>()): any[] {
  if (!root || typeof root !== 'object') return [];
  // The shared resolver owns reference/union expansion. This wrapper keeps
  // the completion code's existing raw-node call sites small while ensuring
  // hover, definitions, defaults and completion see the same branches.
  let isRoot = typeof root.$id === 'string';
  if (!isRoot) { try { isRoot = root === pack.resource(baseUri.split('#')[0]); } catch { /* inline schema fragment */ } }
  if (isRoot) return resolveSchemaNodes(pack, baseUri, seen).map(location => location.node);
  const nodes = [root];
  if (typeof root.$ref === 'string') {
    const uri = new URL(root.$ref, baseUri).href;
    if (!seen.has(uri)) { try { nodes.push(...resolveSchemaNodes(pack, uri, new Set(seen)).map(location => location.node)); } catch { /* unresolved optional branch */ } }
  }
  for (const key of ['allOf', 'oneOf', 'anyOf', 'if', 'then', 'else']) {
    const branches = Array.isArray(root[key]) ? root[key] : root[key] ? [root[key]] : [];
    for (const child of branches) nodes.push(...schemaNodes(pack, baseUri, child, seen));
  }
  return nodes;
}
function schemaPropertyMap(pack: MetadataPack, uri: string, spec: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const node of schemaNodes(pack, uri, spec)) Object.assign(result, node.properties ?? {});
  return result;
}
function declaredSelectorOperators(pack: MetadataPack, uri: string, spec: any): string[] {
  const declared = new Set<string>();
  const genericOperators = new Set<string>();
  const visit = (node: any, nodeUri: string, seen: Set<string>) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const target = new URL(node.$ref, nodeUri).href;
      if (!seen.has(target)) {
        seen.add(target);
        try { visit(pack.node(target), target, seen); } catch { /* unresolved optional branch */ }
      }
    }
    for (const value of node.propertyNames?.enum ?? []) if (typeof value === 'string') declared.add(value);
    for (const branch of node.oneOf ?? []) {
      const required = Array.isArray(branch?.required) ? branch.required : [];
      if (required.length === 1 && typeof required[0] === 'string') genericOperators.add(required[0]);
    }
    for (const key of ['allOf', 'oneOf', 'anyOf', 'if', 'then', 'else']) {
      const branches = Array.isArray(node[key]) ? node[key] : node[key] ? [node[key]] : [];
      for (let index = 0; index < branches.length; index++) {
        visit(branches[index], `${nodeUri}${nodeUri.includes('#') ? '' : '#'}${nodeUri.includes('#') ? '' : '/'}${key}/${index}`, seen);
      }
    }
  };
  visit(spec, uri, new Set<string>());
  // propertyNames also contains schema metadata keys. Keep only names that
  // the resolved shared selector predicate declares as comparison operators;
  // this prevents metadata and the broad generic vocabulary from leaking into
  // a field-specific operator completion list.
  return [...declared].filter(value => genericOperators.has(value));
}

function selectorOperators(pack: MetadataPack, uri: string, spec: any): Array<{ value: string; spec: any }> {
  // Do not inherit the broad shared scalar operator vocabulary for a
  // capability Object field. A field-specific native subset must be declared
  // by the capability schema itself; otherwise an empty list is safer than
  // offering syntactically possible but semantically unsupported operators.
  const names = declaredSelectorOperators(pack, uri, spec);
  const properties = schemaPropertyMap(pack, uri, spec);
  return names.map(value => ({ value, spec: properties[value] ?? {} }));
}

function canonicalScalarOperationNames(pack: MetadataPack): Set<string> {
  try {
    const vocabulary: any = pack.resource(pack.manifest.vocabulary_uri);
    return new Set(Object.keys(vocabulary.operations ?? {}));
  } catch { return new Set(); }
}

function operationDatatypeConstraints(pack: MetadataPack, uri: string, spec: any): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    for (const [operation, constraint] of Object.entries(node.dependentSchemas ?? {})) {
      const datatypes = new Set<string>();
      const walk = (value: any) => {
        if (!value || typeof value !== 'object') return;
        const constant = value.properties?.datatype?.const;
        if (typeof constant === 'string') datatypes.add(constant);
        for (const child of Object.values(value)) walk(child);
      };
      walk(constraint);
      if (datatypes.size) result.set(operation, datatypes);
    }
  };
  for (const node of schemaNodes(pack, uri, spec)) visit(node);
  return result;
}

function requireOperators(pack: MetadataPack, uri: string, spec: any, datatype?: string, fieldDatatypes: string[] = []): Array<{ value: string; spec: any }> {
  const properties = schemaPropertyMap(pack, uri, spec);
  const ordered = new Set<string>();
  // The shared scalar predicate's oneOf declaration is the canonical ordering
  // for Require operators. It is deliberately separate from Object selector
  // propertyNames: cardinalities and scalar comparisons are different scopes.
  for (const node of schemaNodes(pack, uri, spec)) {
    for (const value of node.required ?? []) if (typeof value === 'string' && properties[value]) ordered.add(value);
  }
  const generic = canonicalScalarOperationNames(pack);
  const typed = operationDatatypeConstraints(pack, uri, spec);
  return [...ordered]
    .filter(value => {
      const constraints = typed.get(value);
      if (!constraints) return generic.has(value) || value === 'case_insensitive_not_equal';
      // Typed operation spellings are offered only after the authored datatype
      // selects the matching canonical domain. With no explicit datatype, do
      // not flood the editor with binary/float/package/version operators.
      return typeof datatype === 'string' && (!fieldDatatypes.length || fieldDatatypes.includes(datatype)) && constraints.has(datatype);
    })
    .map(value => ({ value, spec: properties[value] ?? {} }));
}

function enumValues(pack: MetadataPack, uri: string, root: any): string[] {
  const values = new Set<string>();
  const visit = (node: any, baseUri: string, seen: Set<string>) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.enum)) for (const value of node.enum) if (typeof value === 'string') values.add(value);
    if (typeof node.$ref === 'string') {
      const refUri = new URL(node.$ref, baseUri).href;
      if (!seen.has(refUri)) {
        seen.add(refUri);
        try { visit(pack.node(refUri), refUri, seen); } catch { /* unresolved optional branch */ }
      }
    }
    for (const key of ['allOf', 'oneOf', 'anyOf', 'items']) {
      const children = Array.isArray(node[key]) ? node[key] : node[key] ? [node[key]] : [];
      for (const child of children) visit(child, baseUri, seen);
    }
  };
  visit(root, uri, new Set<string>());
  return [...values];
}
function selectorFieldSpec(pack: MetadataPack, capability: string, field: string, requireField: boolean) {
  const uri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!uri) return undefined;
  const schema: any = pack.resource(uri);
  if (!requireField) {
    // PR #21 supplies reviewed selector contracts as conditional overlays in
    // assessment-language.schema.json. Prefer that resolved schema location
    // when present; generated capability schemas remain the compatibility
    // fallback for capabilities without an overlay.
    const overlay = schemaCapabilityObjectProperties(pack, capability).get(field);
    if (overlay) return { uri: overlay.uri, spec: overlay.node };
    const spec = schema.$defs?.object?.properties?.[field];
    return spec ? { uri, spec } : undefined;
  }
  const branches = predicateBranches(schema.$defs?.state_predicate);
  for (const branch of branches) if (branch?.properties?.[field]) return { uri, spec: branch.properties[field] };
  return undefined;
}
export function selectorFieldDatatypes(pack: MetadataPack, capability: string, field: string, requireField: boolean): string[] {
  const mappingUri = pack.manifest.capabilities[capability]?.mapping_uri;
  if (!mappingUri) return [];
  try {
    const mapping: any = pack.resource(mappingUri);
    const source = requireField ? mapping.native?.state_field_datatypes : mapping.native?.field_datatypes;
    const values = source?.[field] ?? mapping.native?.field_datatypes?.[field];
    return Array.isArray(values) ? values.filter((value: unknown): value is string => typeof value === 'string') : [];
  } catch { return []; }
}
export function selectorOperatorChoices(pack: MetadataPack, capability: string, field: string, requireField: boolean, datatype?: string): CompletionChoice[] {
  const context = selectorFieldSpec(pack, capability, field, requireField);
  if (!context) return [];
  const fieldDatatypes = requireField ? selectorFieldDatatypes(pack, capability, field, true) : [];
  const operators = requireField ? requireOperators(pack, context.uri, context.spec, datatype, fieldDatatypes) : selectorOperators(pack, context.uri, context.spec);
  return operators.map(({ value, spec }) => propertyChoice(pack, context.uri, '', value, spec, `${value}: `));
}
function mappingEnumValues(pack: MetadataPack, capability: string, field: string, requireField: boolean): string[] {
  const mappingUri = pack.manifest.capabilities[capability]?.mapping_uri;
  if (!mappingUri) return [];
  const mapping: any = pack.resource(mappingUri);
  const values = requireField ? mapping.native?.state_value_enums?.[field] : mapping.native?.selector_value_enums?.[field];
  return Array.isArray(values) ? values.filter((value: unknown): value is string => typeof value === 'string') : [];
}
export function selectorValueChoices(pack: MetadataPack, capability: string, field: string, operator: string, requireField: boolean): CompletionChoice[] {
  const context = selectorFieldSpec(pack, capability, field, requireField);
  if (!context) return [];
  const properties = schemaPropertyMap(pack, context.uri, context.spec);
  const schemaValues = enumValues(pack, context.uri, properties[operator] ?? {});
  const values = schemaValues.length ? schemaValues : mappingEnumValues(pack, capability, field, requireField);
  return values.map(value => ({ value, label: value, kind: 'value' }));
}
function schemaObjectLike(pack: MetadataPack, uri: string, spec: any, seen = new Set<string>()): boolean {
  if (!spec || typeof spec !== 'object') return false;
  if (spec.type === 'object' || spec.properties || spec.additionalProperties !== undefined) return true;
  if (typeof spec.$ref === 'string') {
    const target = new URL(spec.$ref, uri).href;
    if (!seen.has(target)) { seen.add(target); try { if (schemaObjectLike(pack, target, pack.node(target), seen)) return true; } catch { /* unresolved branch */ } }
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) for (const child of spec[key] ?? []) if (schemaObjectLike(pack, uri, child, seen)) return true;
  return false;
}
function schemaMappingChoices(pack: MetadataPack, uri: string, spec: any, pointer: string): CompletionChoice[] {
  // Union branches can expose the same property with different shapes.
  // Without an authored discriminator, do not pretend one branch is more
  // applicable because its JSON happens to be longer. Keep the first
  // declaration in canonical traversal order as a conservative presentation
  // fallback; branch-specific validation remains authoritative.
  const properties: Record<string, any> = {};
  for (const node of schemaNodes(pack, uri, spec)) for (const [name, property] of Object.entries(node.properties ?? {})) {
    if (!Object.hasOwn(properties, name)) properties[name] = property;
  }
  return Object.entries(properties).map(([value, property]: [string, any]) => propertyChoice(
    pack,
    uri,
    `${pointer}/${value.replace(/~/g, '~0').replace(/\\/g, '~1')}`,
    value,
    property,
    schemaObjectLike(pack, uri, property) ? `${value}: {` : `${value}: `
  ));
}
function assessmentSchema(pack: MetadataPack) {
  return pack.manifest.resources.find((resource: any) => resource.kind === 'schema' && resource.uri.endsWith('/assessment.schema.json'))?.uri;
}
function variableMappingChoices(pack: MetadataPack, path: string[], current: string | undefined): CompletionChoice[] | undefined {
  const root = assessmentSchema(pack);
  if (!root || !path.includes('variables')) return undefined;
  const variablesIndex = path.indexOf('variables');
  if (variablesIndex < 1) return undefined;
  // A variable name is a schema additionalProperties key. It is intentionally
  // not offered as a fabricated completion; everything below it resolves
  // through variable-expression.schema.json and its recursive expression $ref.
  if (path.length === variablesIndex + 2) return [];
  // Resolve the authored variable key through additionalProperties, then use
  // the path below it to expose all oneOf expression alternatives.
  const parentPath = current ? path.slice(0, -1) : path;
  const properties = schemaPropertiesAtPath(pack, root, parentPath);
  if (!properties.size) return undefined;
  return [...properties.entries()].map(([value, location]) => propertyChoice(
    pack,
    location.uri,
    '',
    value,
    location.node,
    insertTextForSchema(pack, location.uri, location.node, value)
  ));
}
function insertTextForSchema(pack: MetadataPack, uri: string, spec: any, value: string): string {
  const defaultValue = schemaDefaultValue(pack, uri, spec);
  if (defaultValue !== undefined) return `${value}: ${yamlTemplateValue(defaultValue)}`;
  if (spec?.type === 'array') return `${value}: [`;
  const branches = [...(spec?.oneOf ?? []), ...(spec?.anyOf ?? [])];
  if (branches.length && branches.some(branch => branch?.type !== 'object' && !branch?.properties && !branch?.$ref)) return `${value}: `;
  return schemaObjectLike(pack, uri, spec) ? `${value}: {` : `${value}: `;
}
function genericMappingChoices(pack: MetadataPack, path: string[], capability: string, current?: string): CompletionChoice[] | undefined {
  const uri = assessmentSchema(pack);
  if (!uri) return undefined;
  const variableIndex = path.indexOf('variables');
  if (variableIndex >= 1) {
    const objectIndex = path.lastIndexOf('object');
    const firstObjectMember = objectIndex >= 0 ? path[objectIndex + 1] : undefined;
    if (objectIndex >= variableIndex && capability && firstObjectMember && firstObjectMember !== 'capability') {
      const capabilitySchema = pack.manifest.capabilities[capability]?.schema_uri
        ? pack.resource(pack.manifest.capabilities[capability].schema_uri) as any : undefined;
      const firstSpec = capabilitySchema?.$defs?.object?.properties?.[firstObjectMember];
      // Leave the scalar operand to the shared selector-value path below;
      // returning an empty mapping here would suppress enum completion.
      if (path.length > objectIndex + 2 && firstSpec?.['x-scap-ng-authoring']?.context === 'selector_comparison') return undefined;
      return capabilityObjectMappingChoices(pack, capability, path.slice(objectIndex + 1));
    }
    if (objectIndex >= variableIndex && capability && path.length === objectIndex + 1) return capabilityObjectFields(pack, capability);
    return variableMappingChoices(pack, path, current);
  }
  const schema: any = pack.resource(uri);
  const assessment = schema.properties?.assessment;
  if (path.at(-1) === 'assessment') return schemaMappingChoices(pack, uri, assessment, '#/properties/assessment/properties');
  if (path.at(-1) === 'tests') return [];
  const test = assessment?.properties?.tests?.additionalProperties;
  const testIndex = path.indexOf('tests');
  if (testIndex >= 0 && path.length === testIndex + 2) return schemaMappingChoices(pack, uri, test, '#/properties/assessment/properties/tests/additionalProperties/properties');
  const last = path.at(-1);
  if (last === 'require') {
    const requireUri = schemaBase + 'assessment-language.schema.json#/$defs/test/properties/require';
    return schemaMappingChoices(pack, requireUri, pack.node(requireUri), '#/$defs/canonical_all_items_requirement/properties');
  }
  if (last === 'item_requirement') {
    const itemUri = schemaBase + 'assessment-language.schema.json#/$defs/canonical_all_items_requirement/properties/item_requirement';
    return schemaMappingChoices(pack, itemUri, pack.node(itemUri), '#/$defs/item_requirement/properties');
  }
  if (last === 'field_requirement') {
    const fieldUri = schemaBase + 'assessment-language.schema.json#/$defs/paired_requirement';
    return schemaMappingChoices(pack, fieldUri, pack.node(fieldUri), '#/$defs/paired_requirement/properties');
  }
  if (last === 'object') return capabilityObjectFields(pack, capability);
  if (last === 'fields') return capabilityRequireFields(pack, capability);
  const objectIndex = path.lastIndexOf('object');
  if (objectIndex >= 0 && path.length > objectIndex + 1) {
    const firstObjectMember = path[objectIndex + 1];
    const capabilitySchema: any = pack.manifest.capabilities[capability]?.schema_uri
      ? pack.resource(pack.manifest.capabilities[capability].schema_uri)
      : undefined;
    const firstSpec = capabilitySchema?.$defs?.object?.properties?.[firstObjectMember];
    const selectorValue = path.length > objectIndex + 2 && firstSpec?.['x-scap-ng-authoring']?.context === 'selector_comparison';
    if (!selectorValue) {
      const nested = capabilityObjectMappingChoices(pack, capability, path.slice(objectIndex + 1));
      if (nested.length) return nested;
    }
  }
  return undefined;
}
function mappingMemberPosition(source: string, offset: number, path: string[], key: string | undefined) {
  const last = path.at(-1);
  if (!last || (key && key !== last)) return false;
  if (!key) return true;
  const value = lineValueAfterCurrentKey(lineAt(source, offset).text, key).trim();
  return !value || value.startsWith('{');
}
function flowKeysBefore(source: string, offset: number): Set<string> | undefined {
  const maps: Set<string>[] = [];
  let quote: string | undefined;
  let escaped = false;
  const lineEnd = source.indexOf('\n', offset) >= 0 ? source.indexOf('\n', offset) : source.length;
  const scanEnd = lineEnd;
  let atCursor: Set<string> | undefined;
  for (let index = 0; index < scanEnd; index++) {
    if (index === offset) atCursor = maps.at(-1);
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === '{') { maps.push(new Set()); continue; }
    if (character === '}') { maps.pop(); continue; }
    if (!maps.length || !/[A-Za-z_]/.test(character)) continue;
    const match = source.slice(index, scanEnd).match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (match) { maps.at(-1)!.add(match[1]); index += match[1].length - 1; }
  }
  if (offset === scanEnd) atCursor = maps.at(-1);
  return atCursor;
}

function mappingKeysBefore(source: string, offset: number): Set<string> {
  const flow = flowKeysBefore(source, offset);
  if (flow) return flow;
  const lines = source.split(/\r?\n/);
  const currentIndex = source.slice(0, offset).split(/\r?\n/).length - 1;
  const current = lines[currentIndex] ?? '';
  const indent = current.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
  const keys = new Set<string>();
  const collectBlockSiblings = (index: number, step: -1 | 1) => {
    for (let cursor = index; cursor >= 0 && cursor < lines.length; cursor += step) {
      const line = lines[cursor];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const lineIndent = line.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
      if (lineIndent < indent) break;
      if (lineIndent !== indent) continue;
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
      if (match) keys.add(match[1]);
    }
  };
  collectBlockSiblings(currentIndex - 1, -1);
  collectBlockSiblings(currentIndex + 1, 1);
  const currentKey = current.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/)?.[1];
  if (currentKey) keys.delete(currentKey);
  return keys;
}
function missingMappingChoices(source: string, offset: number, key: string | undefined, choices: CompletionChoice[]): CompletionChoice[] {
  if (!choices.length) return choices;
  // A sequence item is a new mapping instance. Its parent array key (for
  // example `concat`) must not be removed from the expression oneOf choices.
  if (/^\s*-\s*/.test(lineAt(source, offset).text)) return choices;
  const existing = mappingKeysBefore(source, offset);
  if (key) existing.delete(key);
  return choices.filter(choice => !existing.has(choice.value));
}
function capabilityObjectMappingChoices(pack: MetadataPack, capability: string, segments: string[] = []): CompletionChoice[] {
  const uri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!uri) return [];
  const schema: any = pack.resource(uri);
  let spec: any = schema.$defs?.object;
  let pointer = '/$defs/object/properties';
  for (const segment of segments) {
    const properties = schemaPropertyMap(pack, uri, spec);
    spec = properties[segment];
    if (!spec) return [];
    pointer += `/${segment.replace(/~/g, '~0').replace(/\\/g, '~1')}/properties`;
    if (segments.length === 1 && spec?.['x-scap-ng-authoring']?.context === 'selector_comparison') {
      return selectorOperatorChoices(pack, capability, segment, false);
    }
  }
  return schemaMappingChoices(pack, uri, spec, pointer);
}
function capabilityObjectFields(pack: MetadataPack, capability: string): CompletionChoice[] {
  // Every member comes from the selected capability Object schema. This
  // includes advanced controls so a deleted property can be rediscovered.
  return capabilityObjectMappingChoices(pack, capability);
}

function predicateBranches(predicate: any): any[] {
  return ['oneOf', 'anyOf'].flatMap(key => Array.isArray(predicate?.[key]) ? predicate[key] : []);
}
function capabilityRequireFields(pack: MetadataPack, capability: string): CompletionChoice[] {
  const uri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!uri) return [];
  const schema: any = pack.resource(uri);
  const branches = predicateBranches(schema.$defs?.state_predicate);
  const choices = new Map<string, CompletionChoice>();
  branches.forEach((branch, branchIndex) => {
    const properties = branch?.properties ?? {};
    for (const value of branch?.required ?? []) {
      if (choices.has(value)) continue;
      choices.set(value, propertyChoice(pack, uri, `/$defs/state_predicate/${Array.isArray(schema.$defs.state_predicate.oneOf) ? 'oneOf' : 'anyOf'}/${branchIndex}/properties/${value.replace(/~/g, '~0').replace(/\//g, '~1')}`, value, properties[value] ?? {}, `${value}: {`));
    }
  });
  return [...choices.values()];
}

export function propertyChoicesForPath(pack: MetadataPack, path: string[], capability = ''): CompletionChoice[] {
  return genericMappingChoices(pack, path, capability) ?? [];
}

/**
 * Return only schema/catalog-backed values for a YAML scalar at the cursor.
 *
 * With Red Hat YAML present, this adapter intentionally returns only the
 * manifest capability catalog and the two flow-map gaps observed in the host
 * evaluation. Red Hat owns schema enums, hover, and schema diagnostics. The
 * optional fallback keeps the extension usable when the language service is
 * not installed, but is never combined with it.
 */
export function completionChoices(pack: MetadataPack, source: string, offset: number, redhatYaml = false): CompletionChoice[] {
  const { text } = lineAt(source, offset);
  const catalog = new GuidedCatalog(pack);
  const path = pathAt(source, offset);
  const key = currentKey(source, offset);
  const flowMapping = Math.max(text.lastIndexOf('{'), text.lastIndexOf(',')) >= 0;
  const adapterCardinality = (values: CompletionChoice[]) => redhatYaml && flowMapping ? [] : values;
  // Test references are instance-defined vocabulary: offer only keys authored
  // under assessment.tests, including nested expression branches.
  if (key === 'test' && path.includes('evaluate')) return authoredTestChoices(source);
  if (key === 'capability' && (path.includes('tests') || path.includes('variables'))) return catalog.capabilities();
  if (key === 'reported_elements' && path.includes('tests')) return catalog.reportedElements();
  if (key === 'items_satisfying' && path.at(-2) === 'item_requirement') return adapterCardinality(catalog.itemsSatisfying());
  if (key === 'values_matching' && path.at(-2) === 'field_requirement') return adapterCardinality(catalog.fieldValuesMatching());
  if (redhatYaml && !flowMapping) {
    if (key === 'items_found' && path.at(-2) === 'item_requirement') return catalog.itemFound();
    if (key === 'values_found' && path.at(-2) === 'field_requirement') return catalog.fieldValuesFound();
  }
  if (!redhatYaml) {
    if (key === 'class' && path.at(-2) === 'assessment') return catalog.classes();
    if (key === 'mode' && path.at(-2) === 'assessment') return catalog.modes();
    if (key === 'items_found' && path.at(-2) === 'item_requirement') return catalog.itemFound();
    if (key === 'values_found' && path.at(-2) === 'field_requirement') return catalog.fieldValuesFound();
  }
  const capability = currentCapability(source, offset) ?? capabilityAtPath(source, path) ?? '';
  if (mappingMemberPosition(source, offset, path, key)) {
    const mapped = genericMappingChoices(pack, path, capability, key);
    if (mapped) return missingMappingChoices(source, offset, key, mapped);
    // A partially typed key (`k:`/`field_require:`) is not an AST property
    // yet. Resolve the parent mapping so completion can replace the prefix
    // instead of attempting to descend into an unknown schema member. Exact
    // selector operators remain on the value-completion path below.
    if (key && path.length > 1) {
      const parent = genericMappingChoices(pack, path.slice(0, -1), capability);
      if (parent && !parent.some(choice => choice.value === key)) return missingMappingChoices(source, offset, key, parent);
    }
  }

  const objectIndex = path.lastIndexOf('object');
  const fieldsIndex = path.lastIndexOf('fields');
  const requireField = fieldsIndex >= 0 && path.includes('require') && fieldsIndex < path.length - 1;
  const parentIndex = requireField ? fieldsIndex : objectIndex;
  const field = parentIndex >= 0 ? path[parentIndex + 1] : undefined;
  if (field && parentIndex >= 0 && path.length === parentIndex + 2 && (!key || key === field)) {
    const value = lineValueAfterCurrentKey(text, key);
    if (!value || value.trim().startsWith('{')) return selectorOperatorChoices(pack, capability, field, requireField);
  }
  if (field && parentIndex >= 0 && path.length === parentIndex + 3 && key === path.at(-1)) {
    const operator = path.at(-1)!;
    const value = lineValueAfterCurrentKey(text, key);
    if (!value.trim().startsWith('{')) return selectorValueChoices(pack, capability, field, operator, requireField);
  }
  return [];
}
