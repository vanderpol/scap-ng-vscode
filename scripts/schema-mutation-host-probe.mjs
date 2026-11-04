import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const pin = JSON.parse(readFileSync(join(root, 'schema-profile.json'), 'utf8'));
const base = mkdtempSync(join(tmpdir(), 'scap-ng-schema-mutation-'));
const pack = join(base, 'pack');
const extension = join(base, 'extension');
cpSync(resolve(process.env.SCAP_NG_METADATA_PACK ?? '.external/editor-pack'), pack, { recursive: true });
mkdirSync(extension, { recursive: true });
for (const file of ['package.json', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'schema-profile.json']) cpSync(join(root, file), join(extension, file));
cpSync(join(root, 'dist'), join(extension, 'dist'), { recursive: true });
for (const dependency of ['yaml', 'ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string']) cpSync(join(root, 'node_modules', dependency), join(extension, 'node_modules', dependency), { recursive: true });

const manifestPath = join(pack, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const assessmentResource = manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/assessment.schema.json'));
const assessmentPath = join(pack, assessmentResource.path);
const assessment = JSON.parse(readFileSync(assessmentPath, 'utf8'));
const classSchema = assessment.properties.assessment.properties.class;
classSchema.enum.push('fixture-class');
classSchema.description = 'Fixture class description from the mutated canonical schema.';
classSchema.default = 'inventory';
writeFileSync(assessmentPath, JSON.stringify(assessment, null, 2) + '\n');
const resourceBytes = readFileSync(assessmentPath);
assessmentResource.bytes = resourceBytes.length;
assessmentResource.sha256 = createHash('sha256').update(resourceBytes).digest('hex');
const overlayResource = manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/native-selector.schema.json'));
const overlayPath = join(pack, overlayResource.path);
const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
overlay.$defs.windows_registry_hive_selector.allOf[2].properties.equals.oneOf[0].enum.push('fixture-hive');
writeFileSync(overlayPath, JSON.stringify(overlay, null, 2) + '\n');
const overlayBytes = readFileSync(overlayPath);
overlayResource.bytes = overlayBytes.length;
overlayResource.sha256 = createHash('sha256').update(overlayBytes).digest('hex');
const capabilityResource = manifest.resources.find(resource => resource.kind === 'schema' && resource.uri.endsWith('/capabilities/windows.registry.schema.json'));
const capabilityPath = join(pack, capabilityResource.path);
const capability = JSON.parse(readFileSync(capabilityPath, 'utf8'));
capability.$defs.object.properties.hive.oneOf[0].allOf[2].properties.equals.oneOf[0].enum.push('fixture-hive');
capability.$defs.object.properties.fixture_selector = {
  description: 'Fixture selector description from the mutated capability schema.',
  type: 'object',
  'x-scap-ng-authoring': { version: 1, context: 'selector_comparison' }
};
capability.$defs.state_predicate.oneOf.push({
  required: ['fixture_state'],
  properties: { fixture_state: { type: 'object', description: 'Fixture state description from the mutated capability schema.' } }
});
writeFileSync(capabilityPath, JSON.stringify(capability, null, 2) + '\n');
const capabilityBytes = readFileSync(capabilityPath);
capabilityResource.bytes = capabilityBytes.length;
capabilityResource.sha256 = createHash('sha256').update(capabilityBytes).digest('hex');
manifest.capabilities['fixture.capability'] = { ...manifest.capabilities['windows.registry'] };
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(manifestPath, manifestBytes);
const mutatedPin = { ...pin, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex') };
writeFileSync(join(extension, 'schema-profile.json'), JSON.stringify(mutatedPin, null, 2) + '\n');

const env = {
  ...process.env,
  SCAP_NG_METADATA_PACK: pack,
  SCAP_NG_SAMPLE_ROOT: process.env.SCAP_NG_SAMPLE_ROOT ?? '.external/scap-ng-editor-sample-data',
  SCAP_NG_EXTENSION_PATH: extension,
  SCAP_NG_PROFILE_PATH: join(extension, 'schema-profile.json'),
  SCAP_NG_EXTENSIONS_DIR: process.env.SCAP_NG_EXTENSIONS_DIR ?? '/tmp/scap-ng-redhat-extensions',
  SCAP_NG_EXPECT_HOVER_TEXT: 'Fixture class description',
  SCAP_NG_EXPECT_CLASS_DEFAULT: 'inventory',
  SCAP_NG_HOST_TIMEOUT: process.env.SCAP_NG_HOST_TIMEOUT ?? '90000'
};
try {
  execFileSync(process.execPath, [join(root, 'scripts/host-acceptance-probe.mjs')], { env, stdio: 'inherit' });
} finally {
  if (process.env.SCAP_NG_KEEP_HOST !== '1') rmSync(base, { recursive: true, force: true });
}
