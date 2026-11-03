import { MetadataPack } from './metadata.js';
import { GuidedCatalog } from './guided.js';

export interface CompletionChoice {
  value: string;
  label: string;
  description?: string;
  kind?: 'value' | 'property';
}

function lineAt(source: string, offset: number) {
  const start = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return { start, text: source.slice(start, offset) };
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
  const inlineParent = delimiter >= 0 ? currentText.slice(0, delimiter + 1).match(/([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{[^{}]*$/) : undefined;
  return [...stack.map(entry => entry.key), ...(inlineParent ? [inlineParent[1]] : []), ...(current ? [current[1]] : [])];
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
function capabilityFields(pack: MetadataPack, capability: string): CompletionChoice[] {
  const uri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!uri) return [];
  const schema: any = pack.resource(uri);
  const properties = schema.$defs?.object?.properties ?? {};
  return Object.entries(properties).map(([value, spec]: [string, any]) => ({
    value,
    label: spec.title ?? value,
    description: spec.description,
    kind: 'property'
  }));
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
  // The selected capability schema is the only source of YAML object member
  // names. This adapter fills the Red Hat gap for dynamic capability objects;
  // it never carries a parallel SCAP-NG vocabulary.
  const delimiter = Math.max(text.lastIndexOf('{'), text.lastIndexOf(','));
  const segment = text.slice(delimiter + 1);
  const looksLikeObjectMemberPosition = path.at(-1) === 'object' &&
    (!segment.trim() || !/^\s*[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(segment));
  if (looksLikeObjectMemberPosition) return capabilityFields(pack, currentCapability(source, offset) ?? '');
  return [];
}
