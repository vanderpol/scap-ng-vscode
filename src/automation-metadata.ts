import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseDocument, stringify } from 'yaml';

export type AutomationDisposition = 'manual-only';
export interface AutomationDispositionRecord {
  disposition: AutomationDisposition;
  reason?: string;
  source_hash: string;
  reviewed_by?: string;
  reviewed_at?: string;
}
interface AutomationMetadataDocument {
  version?: number;
  rules?: Record<string, Partial<AutomationDispositionRecord>>;
}

export function automationMetadataPath(packagePath: string): string {
  return join(packagePath, '.scap-ng', 'automation-dispositions.yaml');
}

export function readAutomationDispositions(packagePath: string): Map<string, AutomationDispositionRecord> {
  const path = automationMetadataPath(packagePath);
  if (!existsSync(path)) return new Map();
  try {
    const parsed = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
    if (parsed.errors.length) return new Map();
    const value = parsed.toJS() as AutomationMetadataDocument;
    const result = new Map<string, AutomationDispositionRecord>();
    for (const [ruleId, entry] of Object.entries(value.rules ?? {})) {
      if (!entry || entry.disposition !== 'manual-only' || typeof entry.source_hash !== 'string' || !entry.source_hash) continue;
      result.set(ruleId, {
        disposition: 'manual-only',
        source_hash: entry.source_hash,
        ...(typeof entry.reason === 'string' && entry.reason ? { reason: entry.reason } : {}),
        ...(typeof entry.reviewed_by === 'string' && entry.reviewed_by ? { reviewed_by: entry.reviewed_by } : {}),
        ...(typeof entry.reviewed_at === 'string' && entry.reviewed_at ? { reviewed_at: entry.reviewed_at } : {})
      });
    }
    return result;
  } catch { return new Map(); }
}

export function writeAutomationDispositions(packagePath: string, entries: ReadonlyMap<string, AutomationDispositionRecord>): void {
  const rules = Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const path = automationMetadataPath(packagePath);
  if (!Object.keys(rules).length) {
    try { if (existsSync(path)) writeFileSync(path, '', 'utf8'); } catch { /* best effort; the UI reports the write failure below */ }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify({ version: 1, rules }), 'utf8');
}
