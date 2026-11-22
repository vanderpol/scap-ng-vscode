import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MetadataPack } from '../../dist/index.js';

const root = new URL('../..', import.meta.url);
const repo = decodeURIComponent(root.pathname);
const packPath = process.env.SCAP_NG_METADATA_PACK;
const sourceRoot = process.env.SCAP_NG_SOURCE_ROOT;
if (!packPath || !sourceRoot) throw new Error('Select SCAP_NG_METADATA_PACK and SCAP_NG_SOURCE_ROOT explicitly');
const profile = JSON.parse(readFileSync(join(repo, 'schema-profile.json'), 'utf8'));
const pack = new MetadataPack(packPath, profile);
const active = readdirSync(join(sourceRoot, 'schema', 'capability-mappings', 'supported'))
  .filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
const experimental = readdirSync(join(sourceRoot, 'schema', 'capability-mappings', 'experimental'))
  .filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
const packCapabilities = Object.keys(pack.manifest.capabilities).sort();

// This is an editor-pack reconciliation gate, not scanner qualification.
test('d1ab 0.4.1 pack reconciles active and experimental capability inventories', () => {
  assert.equal(profile.schemaVersion, '0.4.1');
  assert.equal(profile.sourceCommit, 'd1ab0283e09369c2c734d3b8f93b65007441cf07');
  assert.equal(execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), profile.sourceCommit);
  assert.deepEqual(packCapabilities, active);
  assert.equal(packCapabilities.length, 101);
  assert.equal(active.length + experimental.length, 105);
  assert.deepEqual(experimental, ['esx.host_account', 'esx.host_advancedsetting', 'esx.host_service', 'esx.host_vib']);
  assert.equal(experimental.some(id => packCapabilities.includes(id)), false);
  assert.equal(pack.manifest.resources.length, 238);
  assert.equal(pack.manifest.schema_version, '0.4.1');
  assert.equal(pack.manifest.source_commit, profile.sourceCommit);
  for (const resource of pack.manifest.resources) {
    if (resource.kind === 'schema') {
      assert.equal(resource.uri.includes('/v0.4.0/'), false, resource.uri);
      assert.equal(resource.uri.includes('/v0.4.1/'), true, resource.uri);
    }
  }
});

test('reconciliation fails closed for stale or unexpected capability claims', () => {
  const stale = structuredClone(profile);
  stale.schemaVersion = '0.4.0';
  assert.throws(() => new MetadataPack(packPath, stale), /Only canonical SCAP-NG 0\.4\.1/);
  const unexpected = packCapabilities.concat(experimental[0]);
  assert.equal(unexpected.filter(id => !active.includes(id)).length, 1);
  assert.equal(unexpected.includes('esx.host_account'), true);
});
