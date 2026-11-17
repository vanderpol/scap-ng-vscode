import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const pack = resolve(process.env.SCAP_NG_METADATA_PACK ?? '.external/editor-pack');
const redhat = resolve(process.env.SCAP_NG_REDHAT_YAML_DIR ?? '/tmp/scap-ng-redhat-extensions/redhat.vscode-yaml-2.0.0');
const output = resolve(process.env.SCAP_NG_OFFLINE_BUNDLE ?? 'scap-ng-vscode-p0-offline-bundle.tgz');
if (!existsSync(pack)) throw new Error(`Metadata pack not found: ${pack}`);
const redhatManifest = JSON.parse(readFileSync(join(redhat, 'package.json'), 'utf8'));
if (`${redhatManifest.publisher}.${redhatManifest.name}` !== 'redhat.vscode-yaml' || redhatManifest.version !== '2.0.0') throw new Error('Expected Red Hat YAML v2.0.0');
const stage = mkdtempSync(join(tmpdir(), 'scap-ng-p0-bundle-'));
try {
  cpSync(join(root, 'scap-ng-vscode-0.0.1.vsix'), join(stage, 'scap-ng-vscode-0.0.1.vsix'));
  cpSync(pack, join(stage, 'editor-pack'), { recursive: true });
  cpSync(redhat, join(stage, 'extensions', 'redhat.vscode-yaml-2.0.0'), { recursive: true });
  cpSync(join(root, 'schema-profile.json'), join(stage, 'schema-profile.json'));
  cpSync(join(root, 'test-dependency-pins.json'), join(stage, 'test-dependency-pins.json'));
  cpSync(join(root, 'THIRD-PARTY-NOTICES.md'), join(stage, 'THIRD-PARTY-NOTICES.md'));
  writeFileSync(join(stage, 'INSTALL-OFFLINE.txt'), `SCAP-NG P0 offline bundle\n\n1. Install scap-ng-vscode-0.0.1.vsix with VS Code:\n   code --install-extension scap-ng-vscode-0.0.1.vsix --force\n2. Install the unpacked Red Hat YAML extension by copying extensions/redhat.vscode-yaml-2.0.0 into the target VS Code extensions directory, or package it locally as a VSIX.\n3. Open a workspace containing editor-pack and set scapNg.schemaPackPath to its absolute path.\n4. Run the native YAML editor with no network access.\n\nThe bundle contains the exact pinned schemas, capability catalog and runtime notices. No npm install, account, scanner or network access is required.\n`);
  execFileSync('tar', ['-czf', output, '-C', stage, '.'], { stdio: 'inherit' });
  console.log(output);
} finally { rmSync(stage, { recursive: true, force: true }); }
