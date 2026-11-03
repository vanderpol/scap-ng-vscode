import { MetadataPack } from './metadata.js';
import { GuidedCatalog } from './guided.js';

export interface CompletionChoice {
  value: string;
  label: string;
  description?: string;
  kind?: 'value' | 'property';
  isDefault?: boolean;
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
function currentCapability(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const matches = [...prefix.matchAll(/(?:^|\n)\s*capability\s*:\s*([^\s#},]+)/g)];
  return matches.at(-1)?.[1];
}
function propertyChoice(pack: MetadataPack, uri: string, path: string, value: string, spec: any): CompletionChoice {
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
  return { value, label: spec?.title ?? value, description, kind: 'property' };
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
    .map(([value, spec]: [string, any]) => propertyChoice(pack, uri, '/$defs/object/properties/' + value.replace(/~/g, '~0').replace(/\//g, '~1'), value, spec));
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
      choices.set(value, propertyChoice(pack, uri, `/$defs/state_predicate/${Array.isArray(schema.$defs.state_predicate.oneOf) ? 'oneOf' : 'anyOf'}/${branchIndex}/properties/${value.replace(/~/g, '~0').replace(/\//g, '~1')}`, value, properties[value] ?? {}));
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
  const objectMemberPosition = path.at(-1) === 'object' && !key;
  const requireFieldPosition = path.at(-1) === 'fields' && path.includes('require') && !key;
  if (objectMemberPosition) return capabilityObjectFields(pack, currentCapability(source, offset) ?? '');
  if (requireFieldPosition) return capabilityRequireFields(pack, currentCapability(source, offset) ?? '');
  return [];
}
