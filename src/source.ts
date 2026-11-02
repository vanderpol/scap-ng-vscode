/** Range edits for the future TextDocument host; no reserialization (#2/#7). */
import { parseDocument, isScalar, isAlias, isMap } from 'yaml';
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
  json(): Json {
    const doc = parseDocument(this.text, { uniqueKeys: true });
    if (doc.errors.length) throw new Error('YAML parse error');
    return doc.toJS({ maxAliasCount: 50 }) as Json;
  }
}
