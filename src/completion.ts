import { MetadataPack } from './metadata.js';
import { GuidedCatalog } from './guided.js';

export interface CompletionChoice {
  value: string;
  label: string;
  description?: string;
  kind?: 'value' | 'property';
  isDefault?: boolean;
  insertText?: string;
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
  const stack: Array<{ indent: number; key: string }> = [];
  for (const raw of before.slice(0, -1)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const match = raw.match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (!match) continue;
    const indent = match[1].replace(/\t/g, '  ').length;
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const rest = raw.slice(match[0].length).trim();
    // Only blank block-mapping keys establish ancestry. Scalar siblings such
    // as `mode: automated` must not become parents of the next key.
    if (!rest || rest.startsWith('#')) stack.push({ indent, key: match[2] });
  }
  const currentText = lineAt(source, offset).text;
  const currentIndent = currentText.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0;
  while (stack.length && stack.at(-1)!.indent >= currentIndent) stack.pop();
  const delimiter = Math.max(currentText.lastIndexOf('{'), currentText.lastIndexOf(','));
  const segment = currentText.slice(delimiter + 1);
  const current = segment.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  return [...stack.map(entry => entry.key), ...inlineMappingPath(currentText), ...(current ? [current[1]] : [])];
}
function currentKey(source: string, offset: number) {
  const { text } = lineAt(source, offset);
  const delimiter = Math.max(text.lastIndexOf('{'), text.lastIndexOf(','));
  const segment = text.slice(delimiter + 1);
  return segment.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*[^#]*$/)?.[1];
}
function lineValueAfterCurrentKey(text: string, key: string | undefined): string {
  if (!key) return '';
  const match = text.match(new RegExp(`(?:^|[,{}])\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`));
  return match?.[1] ?? '';
}
function currentCapability(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const matches = [...prefix.matchAll(/(?:^|\n)\s*capability\s*:\s*([^\s#},]+)/g)];
  return matches.at(-1)?.[1];
}
function propertyChoice(pack: MetadataPack, uri: string, path: string, value: string, spec: any, insertText?: string): CompletionChoice {
  let description = typeof spec?.description === 'string' ? spec.description : undefined;
  if (!description) {
    try {
      description = pack.describe(`${uri}#${path}`, {
        documentVersion: pack.pin.schemaVersion,
        schemaValid: true,
        isOverride: false,
        diagnostics: []
      }).description || undefined;
    } catch { /* A schema-defined property may intentionally have no description. */ }
  }
  return { value, label: spec?.title ?? value, description, kind: 'property', insertText };
}
function schemaNodes(pack: MetadataPack, baseUri: string, root: any, seen = new Set<string>()): any[] {
  if (!root || typeof root !== 'object') return [];
  const nodes = [root];
  if (typeof root.$ref === 'string') {
    const uri = new URL(root.$ref, baseUri).href;
    if (!seen.has(uri)) {
      seen.add(uri);
      try { nodes.push(...schemaNodes(pack, uri, pack.node(uri), seen)); } catch { /* unresolved optional branch */ }
    }
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) for (const child of root[key] ?? []) nodes.push(...schemaNodes(pack, baseUri, child, seen));
  return nodes;
}
function schemaPropertyMap(pack: MetadataPack, uri: string, spec: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const node of schemaNodes(pack, uri, spec)) Object.assign(result, node.properties ?? {});
  return result;
}
function selectorOperators(pack: MetadataPack, uri: string, spec: any): Array<{ value: string; spec: any }> {
  const nodes = schemaNodes(pack, uri, spec);
  const restricted = nodes.flatMap(node => Array.isArray(node.propertyNames?.enum) ? node.propertyNames.enum : []);
  const names = new Set<string>(restricted);
  if (!restricted.length) {
    for (const node of nodes) {
      const properties = node.properties ?? {};
      for (const alternative of node.allOf ?? []) for (const branch of alternative.oneOf ?? []) {
        for (const name of branch.required ?? []) if (properties[name]?.oneOf) names.add(name);
      }
    }
  }
  const properties = Object.assign({}, ...nodes.map(node => node.properties ?? {}));
  return [...names].map(value => ({ value, spec: properties[value] ?? {} }));
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
    const spec = schema.$defs?.object?.properties?.[field];
    return spec ? { uri, spec } : undefined;
  }
  const branches = predicateBranches(schema.$defs?.state_predicate);
  for (const branch of branches) if (branch?.properties?.[field]) return { uri, spec: branch.properties[field] };
  return undefined;
}
function selectorOperatorChoices(pack: MetadataPack, capability: string, field: string, requireField: boolean): CompletionChoice[] {
  const context = selectorFieldSpec(pack, capability, field, requireField);
  if (!context) return [];
  return selectorOperators(pack, context.uri, context.spec).map(({ value, spec }) => propertyChoice(pack, context.uri, '', value, spec, `${value}: `));
}
function selectorValueChoices(pack: MetadataPack, capability: string, field: string, operator: string, requireField: boolean): CompletionChoice[] {
  const context = selectorFieldSpec(pack, capability, field, requireField);
  if (!context) return [];
  const properties = schemaPropertyMap(pack, context.uri, context.spec);
  return enumValues(pack, context.uri, properties[operator] ?? {}).map(value => ({ value, label: value, kind: 'value' }));
}
function capabilityObjectFields(pack: MetadataPack, capability: string): CompletionChoice[] {
  const uri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!uri) return [];
  const schema: any = pack.resource(uri);
  const properties = schema.$defs?.object?.properties ?? {};
  // Canonical generated capability schemas mark selector members with the
  // versioned authoring context. Generic object controls (set, filters,
  // traversal, and so on) are intentionally not selector-field suggestions.
  return Object.entries(properties)
    .filter(([, spec]: [string, any]) => spec?.['x-scap-ng-authoring']?.context === 'selector_comparison')
    .map(([value, spec]: [string, any]) => propertyChoice(pack, uri, '/$defs/object/properties/' + value.replace(/~/g, '~0').replace(/\//g, '~1'), value, spec, `${value}: {`));
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
  if (key === 'capability' && path.includes('tests')) return catalog.capabilities();
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
  const capability = currentCapability(source, offset) ?? '';
  const objectMemberPosition = path.at(-1) === 'object' && !key;
  const requireFieldPosition = path.at(-1) === 'fields' && path.includes('require') && !key;
  if (objectMemberPosition) return capabilityObjectFields(pack, capability);
  if (requireFieldPosition) return capabilityRequireFields(pack, capability);

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
