import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Locate the provenance manifest shipped beside an externally supplied corpus.
 * The conformance repository uses conformance/manifest.json; published corpus
 * archives may put corpus-manifest.json at their root.
 */
export function readCorpusPin(corpusRoot) {
  const root = resolve(corpusRoot);
  const candidates = [
    join(root, 'corpus-manifest.json'),
    join(root, 'manifest.json'),
    join(dirname(root), 'manifest.json'),
    join(dirname(dirname(root)), 'manifest.json')
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof value?.schema_version === 'string' && typeof value?.schema_commit === 'string') {
        return { path, schemaVersion: value.schema_version, schemaCommit: value.schema_commit };
      }
    } catch { /* Ignore unrelated or incomplete manifests. */ }
  }
  return undefined;
}

export function compareCorpusPin(corpusRoot, expected) {
  const found = readCorpusPin(corpusRoot);
  const expectedVersion = expected?.schemaVersion ?? expected?.schema_version;
  const expectedCommit = expected?.sourceCommit ?? expected?.schema_commit;
  if (!found) return {
    verified: false,
    reason: 'no schema provenance manifest was found beside the corpus',
    expectedVersion,
    expectedCommit
  };
  if (found.schemaVersion !== expectedVersion || found.schemaCommit !== expectedCommit) return {
    verified: false,
    reason: 'corpus schema pin differs from the editor metadata-pack pin',
    ...found,
    expectedVersion,
    expectedCommit
  };
  return { verified: true, reason: 'corpus schema pin matches the editor metadata-pack pin', ...found, expectedVersion, expectedCommit };
}
