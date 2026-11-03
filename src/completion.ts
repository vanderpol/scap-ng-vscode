import { MetadataPack } from './metadata.js';
import { GuidedCatalog } from './guided.js';

export interface CompletionChoice {
  value: string;
  label: string;
  description?: string;
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
    if (!/[{}\[\]]/.test(raw.slice(match[0].length))) stack.push({ indent, key: match[2] });
  }
  const currentText = lineAt(source, offset).text;
  const delimiter = Math.max(currentText.lastIndexOf('{'), currentText.lastIndexOf(','));
  const segment = currentText.slice(delimiter + 1);
  const current = segment.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
  const inlineParent = delimiter >= 0 ? currentText.slice(0, delimiter + 1).match(/([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{\s*$/) : undefined;
  return [...stack.map(entry => entry.key), ...(inlineParent ? [inlineParent[1]] : []), ...(current ? [current[1]] : [])];
}
/**
 * Return only schema/catalog-backed values for a YAML scalar at the cursor.
 * This intentionally does not suggest arbitrary capability names: capability
 * identifiers come from the verified manifest catalog, while class/mode and
 * requirement cardinalities come from the pinned schema.
 */
export function completionChoices(pack: MetadataPack, source: string, offset: number): CompletionChoice[] {
  const { text } = lineAt(source, offset);
  const delimiter = Math.max(text.lastIndexOf('{'), text.lastIndexOf(','));
  const segment = text.slice(delimiter + 1);
  const keyMatch = segment.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*[^#]*$/);
  if (!keyMatch) return [];
  const key = keyMatch[1];
  const path = pathAt(source, offset);
  const catalog = new GuidedCatalog(pack);
  if (key === 'class' && path.at(-2) === 'assessment') return catalog.classes();
  if (key === 'mode' && path.at(-2) === 'assessment') return catalog.modes();
  if (key === 'capability' && path.includes('tests')) return catalog.capabilities();
  if (key === 'items_found' && path.at(-2) === 'item_requirement') return catalog.itemFound();
  if (key === 'items_satisfying' && path.at(-2) === 'item_requirement') return catalog.itemsSatisfying();
  if (key === 'values_found' && path.at(-2) === 'field_requirement') return catalog.fieldValuesFound();
  if (key === 'values_matching' && path.at(-2) === 'field_requirement') return catalog.fieldValuesMatching();
  return [];
}

