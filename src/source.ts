/** Range edits for the future TextDocument host; no reserialization (#2/#7). */
import { parseDocument, isScalar, isAlias, isMap, isSeq, stringify } from 'yaml';
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
    if (parsed.errors.length) throw new Error('Edit would break YAML: ' + (parsed.errors[0]?.message ?? 'unknown parse error'));
    return { document: new SourceBuffer(next), range: [start, end], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  /** Replace an authored selector variant mapping with a literal or Variable reference.
   * The surrounding YAML, including other fields and comments, is left untouched.
   * Caller must validate the result against the pinned assessment schema.
   */
  replaceSelectorSource(path: (string | number)[], variant: 'equals' | 'variable', value: string, expectedHash: string) {
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    if (typeof value !== 'string' || !value.length) throw new Error('A non-empty source value is required');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const node: any = doc.getIn(path, true);
    if (!isMap(node) || node.anchor || node.tag || !Array.isArray(node.range))
      throw new Error('Selector is not a safely replaceable YAML mapping');
    if (node.items.length !== 1 || !['equals', 'variable'].includes(String((node.items[0] as any)?.key?.value)) ||
        isAlias((node.items[0] as any)?.value) || (node.items[0] as any)?.value?.anchor || (node.items[0] as any)?.value?.tag)
      throw new Error('Selector contains additional operations or anchors; use YAML to change its source');
    const [start, end] = node.range;
    const replacement = '{' + variant + ': ' + JSON.stringify(value) + '}';
    const next = this.text.slice(0, start) + replacement + this.text.slice(end);
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [start, end] as [number, number], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  /** Edit an authored regex array with a single source-local splice. A sequence with
   * comments, anchors or non-string Items is declined to prevent silent loss.
   * The host must additionally validate the resulting document against the pinned schema.
   */
  editRegexList(path: (string | number)[], action: 'add' | 'remove', expectedHash: string, value?: string, index?: number) {
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    if (path.at(-1) !== 'matches_regex' || !path.includes('require') || !path.includes('fields'))
      throw new Error('Only authored Require regex lists are supported.');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source.');
    const sequence: any = doc.getIn(path, true);
    if (!isSeq(sequence) || !Array.isArray(sequence.range) || sequence.anchor || sequence.tag ||
        sequence.items.some((item: any) => !isScalar(item) || item.anchor || item.tag || typeof item.value !== 'string'))
      throw new Error('Regex list contains unsupported YAML features; use native YAML.');
    const [start, end] = sequence.range;
    const sourceFragment = this.text.slice(start, end);
    if (sourceFragment.includes('#') && /(?:^|[\\r\\n])[ \\t]*#/.test(sourceFragment))
      throw new Error('Regex list contains comments; edit in native YAML to preserve them.');
    const originals: string[] = sequence.items.map((item: any) => item.value);
    if (action === 'add') {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a non-empty regex pattern.');
      originals.push(value);
    } else if (action === 'remove') {
      if (!Number.isInteger(index) || index! < 0 || index! >= originals.length)
        throw new Error('Regex pattern index is invalid.');
      if (originals.length <= 1) throw new Error('Cannot remove the final regex pattern.');
      originals.splice(index!, 1);
    } else throw new Error('Invalid regex-list action.');
    const replacement = JSON.stringify(originals);
    const next = this.text.slice(0, start) + replacement + this.text.slice(end);
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [start, end] as [number, number], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  /** A single, explicit structural edit for an Object/Require comparison.
   * Only one-operation mappings are supported. Every proposed value is checked by
   * the host's pinned schema before a native WorkspaceEdit is applied.
   */
  replaceComparison(path: (string | number)[], operation: string, value: Json, expectedHash: string) {
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    if (!/^[a-z][a-z0-9_]*$/.test(operation)) throw new Error('Invalid comparison operator');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML remains editable in Source.');
    const node: any = doc.getIn(path, true);
    if (!isMap(node) || node.tag || node.anchor || !Array.isArray(node.range) ||
        node.items.length !== 1 || !isScalar(node.items[0]?.key) ||
        node.items[0]?.key?.anchor || node.items[0]?.key?.tag)
      throw new Error('Only simple one-operation mappings can be changed safely.');
    const variableOrInput = !!(value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      ((Object.hasOwn(value, 'variable') && typeof (value as any).variable === 'string') ||
       (Object.hasOwn(value, 'input') && typeof (value as any).input === 'string')));
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' &&
        !(Array.isArray(value) && value.every(v => typeof v === 'string')) && !variableOrInput)
      throw new Error('Unsupported comparison value; use native YAML.');
    const [start, end] = node.range;
    const content = this.text.slice(start, end);
    if (content.includes('#')) throw new Error('Comparison has a YAML comment; edit in Source to preserve it.');
    const replacement = JSON.stringify({[operation]: value});
    const next = this.text.slice(0, start) + replacement + this.text.slice(end);
    assertYaml(next);
    return {document: new SourceBuffer(next), range: [start, end] as [number, number],
      replacement, undo: () => new SourceBuffer(this.text),
      assessmentExecution: 'unavailable' as const};
  }

  /** Replace one native Variable expression branch without reserializing its parent.
   * Expression branches may be nested in concat/regex_capture/unique/merge.
   * Comments, anchors and tagged nodes are declined rather than discarded.
   */
  replaceExpression(path: (string | number)[], expression: Json, expectedHash: string, forceLocalVariablePath?: (string | number)[]) {
    if (!path.length || sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML remains editable in Source.');
    const node: any = doc.getIn(path, true);
    if (!isMap(node) || node.anchor || node.tag || !Array.isArray(node.range) || node.items.length !== 1)
      throw new Error('Expression is not a simple YAML mapping; use native YAML.');
    if (node.items.some((pair: any) => pair.key?.anchor || pair.key?.tag || pair.value?.anchor || pair.value?.tag))
      throw new Error('Expression contains an anchor or tag; use native YAML.');
    const sourceFragment = this.text.slice(node.range[0], node.range[1]);
    if (/(?:^|[\r\n])[ \t]*#/.test(sourceFragment))
      throw new Error('Expression contains comments; edit it in native YAML to preserve them.');
    const rawReplacement = stringify(expression).trim();
    const flow = this.text[node.range[0]] === '{';
    const lineStart = this.text.lastIndexOf('\n', node.range[0] - 1) + 1;
    const beforeNode = this.text.slice(lineStart, node.range[0]);
    const indentation = beforeNode.match(/^[ \t]*/)?.[0] ?? '';
    // A block mapping is inserted at the existing key's column. Indent only
    // continuation lines; flow mappings stay inline so a parent flow map is
    // never silently changed into invalid YAML.
    const replacement = flow ? yamlInline(expression) : rawReplacement.split('\n').map((line, index) => index ? indentation + line : line).join('\n');
    const replacements: Array<{ start: number; end: number; replacement: string }> =
      [{ start: node.range[0], end: node.range[1], replacement }];
    if (forceLocalVariablePath) {
      const kindNode: any = doc.getIn([...forceLocalVariablePath, 'kind'], true);
      if (kindNode?.value === 'constant') {
        if (!isScalar(kindNode) || kindNode.anchor || kindNode.tag || !Array.isArray(kindNode.range))
          throw new Error('Variable kind is not a safely editable scalar; set it to local in native YAML.');
        replacements.push({ start: kindNode.range[0], end: kindNode.range[1], replacement: 'local' });
      }
    }
    const ordered = replacements.slice().sort((left, right) => right.start - left.start);
    let next = this.text;
    for (const item of ordered) next = next.slice(0, item.start) + item.replacement + next.slice(item.end);
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [node.range[0], node.range[1]] as [number, number], replacement,
      replacements, undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
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
    const parsed = parseDocument(next, { uniqueKeys: true }); if (parsed.errors.length) throw new Error('Edit would break YAML: ' + (parsed.errors[0]?.message ?? 'unknown parse error'));
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
      const following = this.text.slice(end);
      const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
      const suffix = following.length > 0 && !/^[ \t]*(?:\r?\n)/.test(following) ? '\n' : '';
      replacement = `${prefix}${block}${suffix}`;
      editStart = end; editEnd = end;
    }
    const next = this.text.slice(0, editStart) + replacement + this.text.slice(editEnd);
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [editStart, editStart + replacement.length] as [number, number], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  /** Insert several mapping members in one source-local splice. This is
   * useful when a schema-qualified addition needs a companion member, such as
   * Require.fields with its required field_requirement sibling.
   */
  insertMapEntries(path: (string | number)[], entries: readonly (readonly [string, Json])[], expectedHash: string) {
    if (!entries.length) throw new Error('No mapping entries to add');
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const parent: any = doc.getIn(path, true);
    if (!isMap(parent) || !Array.isArray(parent.items) || !Array.isArray(parent.range)) throw new Error('Mapping cannot be edited safely');
    const keys = new Set(parent.items.map((pair: any) => String(pair.key?.value)));
    if (entries.some(([key]) => !/^[A-Za-z0-9._/-]+$/.test(key) || /^(?:true|false|null|~)$/i.test(key) || keys.has(key)))
      throw new Error('Mapping entry cannot be added safely');
    const [start, end] = parent.range;
    const flow = this.text[start] === '{' && this.text[end - 1] === '}';
    const before = this.text.slice(0, end);
    const following = this.text.slice(end);
    let replacement: string;
    let editStart = end;
    if (flow) {
      replacement = `${parent.items.length ? ', ' : ''}${entries.map(([key, value]) => flowMapEntryFragment(key, value)).join(', ')}`;
      editStart = end - 1;
    } else {
      const childIndent = mapChildIndent(this.text, parent, start);
      const block = entries.map(([key, value]) => indentBlock(mapEntryFragment(key, value), childIndent)).join('\n');
      const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
      const suffix = following.length > 0 && !/^[ \t]*(?:\r?\n)/.test(following) ? '\n' : '';
      replacement = `${prefix}${block}${suffix}`;
    }
    const next = this.text.slice(0, editStart) + replacement + (flow ? this.text.slice(editStart) : following);
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
    const following = this.text.slice(end);
    const prefix = before.endsWith('\n') || before.length === 0 ? '' : '\n';
    // yaml's block-sequence range can include the final newline of the last
    // item. In that shape, the next mapping starts immediately after `end`;
    // terminate the inserted item before it or the new nested mapping is
    // parsed as a continuation of the following compact mapping.
    const suffix = following.length > 0 && !/^[ \t]*(?:\r?\n)/.test(following) ? '\n' : '';
    const replacement = `${prefix}${fragment}${suffix}`;
    const next = this.text.slice(0, end) + replacement + following;
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [end, end + replacement.length] as [number, number], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }

  /** Replace one explicitly selected mapping/sequence value without reserializing the document. */
  replacePathValue(path: (string | number)[], value: Json, expectedHash: string) {
    if (!path.length || sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const node: any = doc.getIn(path, true);
    if (!node || isAlias(node) || node.anchor || node.tag || !Array.isArray(node.range))
      throw new Error('The selected YAML value cannot be replaced safely; use native YAML.');
    const sourceFragment = this.text.slice(node.range[0], node.range[1]);
    if (/(?:^|[\r\n])[ \t]*#/.test(sourceFragment))
      throw new Error('The selected YAML value contains comments; use native YAML to preserve them.');
    const [start, end] = node.range;
    const flow = this.text[start] === '{' || this.text[start] === '[';
    const raw = flow ? yamlInline(value) : yamlScalarOrBlock(value);
    const lineStart = this.text.lastIndexOf('\n', start - 1) + 1;
    const indentation = this.text.slice(lineStart, start).match(/^[ \t]*/)?.[0] ?? '';
    const replacement = flow ? raw : raw.split('\n').map((line, index) => index ? indentation + line : line).join('\n');
    const following = this.text.slice(end);
    const suffix = following.length > 0 && !/^[ \t]*(?:\r?\n)/.test(following)
      ? (this.text.includes('\r\n') ? '\r\n' : '\n') : '';
    const next = this.text.slice(0, start) + replacement + suffix + following;
    assertYaml(next);
    return { document: new SourceBuffer(next), range: [start, end] as [number, number], replacement: replacement + suffix,
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
  if (parsed.errors.length) throw new Error('Edit would break YAML: ' + (parsed.errors[0]?.message ?? 'unknown parse error'));
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
