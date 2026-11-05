/** Range edits for the future TextDocument host; no reserialization (#2/#7). */
import { parseDocument, isScalar, isAlias, isMap, stringify } from 'yaml';
import { sha256, type Json } from './metadata.js';

export function sourceRevisionMatches(text: string, expectedHash: string, version?: number, expectedVersion?: number) {
  return sha256(text) === expectedHash && (expectedVersion === undefined || version === expectedVersion);
}

export class SourceBuffer {
  constructor(readonly text: string) {}
  openOrSave(): string { return this.text; }
  scalarRange(path: (string | number)[]) {
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const node = doc.getIn(path, true);
    if (isAlias(node) || !isScalar(node) || node.tag || node.anchor || !node.range || (node.type && !['PLAIN', 'QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(node.type))) throw new Error('Unsafe scalar edit; use Source mode');
    return [node.range[0], node.range[1]] as [number, number];
  }
  editScalar(path: (string | number)[], value: string | number | boolean | null, expectedHash: string) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite scalar is not JSON data');
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const node = doc.getIn(path, true);
    if (isAlias(node) || !isScalar(node) || node.tag || node.anchor || !node.range || (node.type && !['PLAIN', 'QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(node.type))) throw new Error('Unsafe scalar edit; use Source mode');
    let replacement = JSON.stringify(value);
    if (typeof value === 'string' && node.type === 'QUOTE_SINGLE') replacement = "'" + value.replace(/'/g, "''") + "'";
    if (typeof value === 'string' && node.type === 'PLAIN' && /^[A-Za-z0-9._\/-]+$/.test(value) && !/^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(value)) replacement = value;
    const [start, end] = node.range;
    const next = this.text.slice(0, start) + replacement + this.text.slice(end);
    const parsed = parseDocument(next, { uniqueKeys: true });
    if (parsed.errors.length) throw new Error('Edit would break YAML');
    return { document: new SourceBuffer(next), range: [start, end], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  editMappingKey(path: (string | number)[], oldKey: string, newKey: string, expectedHash: string, allowedKeys?: readonly string[]) {
    if (!/^[A-Za-z0-9._/-]+$/.test(newKey) || /^(?:true|false|null|~)$/i.test(newKey)) throw new Error('Unsafe mapping key; use Source mode');
    if (allowedKeys && !allowedKeys.includes(newKey)) throw new Error(`Operation '${newKey}' is not permitted by the pinned schema; use Source mode`);
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const parent: any = doc.getIn(path, true);
    if (!isMap(parent) || !Array.isArray(parent.items)) throw new Error('Mapping-key edit requires a YAML mapping');
    if (parent.items.some((pair: any) => pair.key && pair.key.value === newKey)) throw new Error('Mapping key already exists');
    const pair: any = parent.items.find((candidate: any) => candidate.key && candidate.key.value === oldKey);
    if (!pair?.key?.range) throw new Error('Mapping key is not a safe scalar');
    const [start, end] = pair.key.range; const next = this.text.slice(0, start) + newKey + this.text.slice(end);
    const parsed = parseDocument(next, { uniqueKeys: true }); if (parsed.errors.length) throw new Error('Edit would break YAML');
    return { document: new SourceBuffer(next), range: [start, end], replacement: newKey,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }
  /**
   * Append a mapping member without reserializing the surrounding YAML. The
   * caller owns schema validation; this helper only performs a lossless,
   * revision-checked source splice and declines malformed/unsupported maps.
   */
  insertMapEntry(path: (string | number)[], key: string, value: Json, expectedHash: string) {
    if (!/^[A-Za-z0-9._/-]+$/.test(key) || /^(?:true|false|null|~)$/i.test(key)) throw new Error('Unsafe mapping key; use Source mode');
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const parent: any = doc.getIn(path, true);
    if (!isMap(parent) || !Array.isArray(parent.items) || parent.items.some((pair: any) => pair.key?.value === key)) throw new Error('Mapping entry cannot be added safely');
    const range = parent.range;
    if (!Array.isArray(range)) throw new Error('Mapping has no safe source range');
    const start = range[0]; const end = range[1];
    const flow = this.text[start] === '{' && this.text[end - 1] === '}';
    const fragment = mapEntryFragment(key, value);
    let editStart = end - (flow ? 1 : 0); let editEnd = editStart; let replacement = fragment;
    if (flow) {
      replacement = `${parent.items.length ? ', ' : ''}${flowMapEntryFragment(key, value)}`;
    } else {
      const childIndent = mapChildIndent(this.text, parent, start);
      const block = indentBlock(fragment, childIndent);
      const before = this.text.slice(0, end);
      const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
      replacement = `${prefix}${block}`;
      editStart = end; editEnd = end;
    }
    const next = this.text.slice(0, editStart) + replacement + this.text.slice(editEnd);
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [editStart, editStart + replacement.length] as [number, number], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  /** Append an item to an authored YAML sequence while keeping its style. */
  insertArrayItem(path: (string | number)[], value: Json, expectedHash: string) {
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const parent: any = doc.getIn(path, true);
    if (!parent || !Array.isArray(parent.items) || !Array.isArray(parent.range)) throw new Error('Sequence cannot be edited safely');
    const start = parent.range[0]; const end = parent.range[1];
    if (this.text[start] === '[' && this.text[end - 1] === ']') {
      const fragment = `${parent.items.length ? ', ' : ''}${yamlScalarOrBlock(value)}`;
      const next = this.text.slice(0, end - 1) + fragment + this.text.slice(end - 1);
      assertYaml(next);
      return { document: new SourceBuffer(next), range: [end - 1, end - 1 + fragment.length] as [number, number], replacement: fragment,
        undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
    }
    const indent = sequenceChildIndent(this.text, parent, start);
    const valueText = value && typeof value === 'object' && !Array.isArray(value) ? `\n${indentBlock(yamlScalarOrBlock(value), 2)}` : ` ${yamlScalarOrBlock(value)}`;
    const fragment = indentBlock(`-${valueText}`, indent);
    const before = this.text.slice(0, end);
    const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
    const replacement = `${prefix}${fragment}`;
    const next = this.text.slice(0, end) + replacement + this.text.slice(end);
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [end, end + replacement.length] as [number, number], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  /** Remove one mapping member or sequence item; required parents are checked by the host. */
  removePath(path: (string | number)[], expectedHash: string) {
    if (!path.length || sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const parentPath = path.slice(0, -1); const last = path[path.length - 1]; const parent: any = doc.getIn(parentPath, true);
    if (isMap(parent)) {
      const pair: any = parent.items.find((candidate: any) => candidate.key?.value === last);
      const pairRange = pair?.range ?? (pair?.key?.range && pair?.value?.range ? [pair.key.range[0], pair.value.range[1]] : undefined);
      if (!pairRange) throw new Error('Mapping member has no safe source range');
      const [start, end] = pairRange; const flow = Array.isArray(parent.range) && this.text[parent.range[0]] === '{';
      const removal = removableRange(this.text, start, end, flow);
      return this.spliceAndValidate(removal[0], removal[1], '');
    }
    if (Array.isArray(parent?.items) && typeof last === 'number') {
      const item: any = parent.items[last]; if (!item?.range) throw new Error('Sequence item has no safe source range');
      const [start, end] = item.range; const flow = Array.isArray(parent.range) && this.text[parent.range[0]] === '[';
      const removal = removableRange(this.text, start, end, flow);
      return this.spliceAndValidate(removal[0], removal[1], '');
    }
    throw new Error('Only mapping members and sequence items can be removed safely');
  }

  private spliceAndValidate(start: number, end: number, replacement: string) {
    const next = this.text.slice(0, start) + replacement + this.text.slice(end);
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [start, end] as [number, number], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  json(): Json {
    const doc = parseDocument(this.text, { uniqueKeys: true });
    if (doc.errors.length) throw new Error('YAML parse error');
    return doc.toJS({ maxAliasCount: 50 }) as Json;
  }
}


function assertYaml(text: string) {
  const parsed = parseDocument(text, { uniqueKeys: true });
  if (parsed.errors.length) throw new Error('Edit would break YAML');
}
function yamlScalarOrBlock(value: Json): string {
  return stringify(value).trim();
}
function mapEntryFragment(key: string, value: Json): string {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as any).length > 0
    ? `${key}:\n${indentBlock(yamlScalarOrBlock(value), 2)}`
    : `${key}: ${yamlScalarOrBlock(value)}`;
}
function flowMapEntryFragment(key: string, value: Json): string {
  return `${key}: ${value && typeof value === 'object' ? yamlInline(value) : yamlScalarOrBlock(value)}`;
}
function yamlInline(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(yamlInline).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, child]) => `${key}: ${yamlInline(child as Json)}`).join(', ')}}`;
  return yamlScalarOrBlock(value);
}
function indentBlock(value: string, indent: number): string { return value.split('\n').map((line, index) => `${' '.repeat(indent)}${index === 0 ? line : line}`).join('\n'); }
function mapChildIndent(text: string, parent: any, start: number): number {
  const first = parent.items?.[0]?.key?.range?.[0];
  if (typeof first === 'number') return lineIndent(text, first);
  return lineIndent(text, start) + 2;
}
function sequenceChildIndent(text: string, parent: any, start: number): number {
  const first = parent.items?.[0]?.range?.[0];
  if (typeof first === 'number') return lineIndent(text, first);
  return lineIndent(text, start) + 2;
}
function lineIndent(text: string, offset: number): number { const line = text.slice(0, offset).split('\n').at(-1) ?? ''; return line.match(/^\s*/)?.[0].length ?? 0; }
function removableRange(text: string, start: number, end: number, flow: boolean): [number, number] {
  if (flow) {
    let right = end; while (/\s/.test(text[right] ?? '')) right++;
    if (text[right] === ',') { right++; while (/\s/.test(text[right] ?? '')) right++; return [start, right]; }
    let left = start - 1; while (/\s/.test(text[left] ?? '')) left--;
    if (text[left] === ',') { left--; while (/\s/.test(text[left] ?? '')) left--; return [left + 1, end]; }
    return [start, end];
  }
  let left = start; while (left > 0 && text[left - 1] !== '\n') left--;
  let right = end; if (text[right] === '\r') right++; if (text[right] === '\n') right++;
  return [left, right];
}
