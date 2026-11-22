import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MetadataPack } from '../dist/metadata.js';

const packPath = process.env.SCAP_NG_METADATA_PACK ?? '.external/editor-pack';
const sourceRoot = resolve(process.env.SCAP_NG_SOURCE_ROOT ?? '.external/scap-ng');
const profilePath = process.env.SCAP_NG_PROFILE_PATH ?? new URL('../schema-profile.json', import.meta.url);
const profile = JSON.parse(readFileSync(profilePath));
const pack = new MetadataPack(resolve(packPath), profile);
const mappingRoot = join(sourceRoot, 'schema', 'capability-mappings');
function mappingIds(directory) {
  return readdirSync(join(mappingRoot, directory)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
}
const active = mappingIds('supported');
const experimental = mappingIds('experimental');
const packIds = Object.keys(pack.manifest.capabilities).sort();
const missingActive = active.filter(id => !packIds.includes(id));
const unexpected = packIds.filter(id => !active.includes(id));
const result = {
  schemaVersion: profile.schemaVersion,
  sourceCommit: profile.sourceCommit,
  packManifestSha256: profile.manifestSha256,
  activeCanonicalCapabilities: active.length,
  experimentalCanonicalCapabilities: experimental.length,
  canonicalCapabilityCount: active.length + experimental.length,
  packCapabilityCount: packIds.length,
  activePackCapabilities: packIds.filter(id => active.includes(id)).length,
  excludedExperimental: experimental.filter(id => !packIds.includes(id)),
  missingActive,
  unexpected,
  qualification: missingActive.length === 0 && unexpected.length === 0
    ? 'active-editor-qualified; experimental capabilities remain explicitly excluded'
    : 'failed'
};
console.log(JSON.stringify(result, null, 2));
if (missingActive.length || unexpected.length || profile.sourceCommit !== 'd1ab0283e09369c2c734d3b8f93b65007441cf07') process.exitCode = 1;
