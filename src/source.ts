/** Range edits for the future TextDocument host; no reserialization (#2/#7). */
import { parseDocument, isScalar, isAlias } from 'yaml';
import { sha256, type Json } from './metadata.js';

export class SourceBuffer {
  constructor(readonly text: string) {}
  openOrSave(): string { return this.text; }
  editScalar(path: (string | number)[], value: string | number | boolean | null, expectedHash: string) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite scalar is not JSON data');
    if (sha256(this.text) !== expectedHash) throw new Error('Stale document revision');
    const doc = parseDocument(this.text, { keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw new Error('Malformed YAML stays editable in Source; no graphical rewrite');
    const node = doc.getIn(path, true);
    if (isAlias(node) || !isScalar(node) || node.tag || node.anchor || !node.range || (node.type && !['PLAIN', 'QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(node.type))) throw new Error('Unsafe scalar edit; use Source mode');
    let replacement = JSON.stringify(value);
    if (typeof value === 'string' && node.type === 'QUOTE_SINGLE') replacement = "'" + value.replace(/'/g, "''") + "'";
    const [start, end] = node.range;
    const next = this.text.slice(0, start) + replacement + this.text.slice(end);
    const parsed = parseDocument(next, { uniqueKeys: true });
    if (parsed.errors.length) throw new Error('Edit would break YAML');
    return { document: new SourceBuffer(next), range: [start, end], replacement,
      undo: () => new SourceBuffer(this.text), assessmentExecution: 'unavailable' as const };
  }
  json(): Json {
    const doc = parseDocument(this.text, { uniqueKeys: true });
    if (doc.errors.length) throw new Error('YAML parse error');
    return doc.toJS({ maxAliasCount: 50 }) as Json;
  }
}
