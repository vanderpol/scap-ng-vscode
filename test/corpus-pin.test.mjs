import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareCorpusPin, readCorpusPin } from '../scripts/corpus-pin.mjs';

const expected = { schemaVersion: '0.4.1', sourceCommit: 'a'.repeat(40) };
function fixture() { return mkdtempSync(join(tmpdir(), 'scap-ng-corpus-pin-')); }

test('corpus provenance matches the exact editor pin', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'corpus-manifest.json'), JSON.stringify({ schema_version: '0.4.1', schema_commit: expected.sourceCommit }));
    const status = compareCorpusPin(root, expected);
    assert.equal(status.verified, true);
    assert.equal(status.reason, 'corpus schema pin matches the editor metadata-pack pin');
    assert.equal(readCorpusPin(root).schemaCommit, expected.sourceCommit);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stale corpus pin is not editor-qualified', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ schema_version: '0.4.1', schema_commit: 'b'.repeat(40) }));
    const status = compareCorpusPin(join(root, 'nested'), expected);
    assert.equal(status.verified, false);
    assert.match(status.reason, /differs/);
    assert.equal(status.schemaCommit, 'b'.repeat(40));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unproven corpus pin is explicitly unverified', () => {
  const root = fixture();
  try {
    const status = compareCorpusPin(root, expected);
    assert.equal(status.verified, false);
    assert.match(status.reason, /no schema provenance/);
    assert.equal(readCorpusPin(root), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
