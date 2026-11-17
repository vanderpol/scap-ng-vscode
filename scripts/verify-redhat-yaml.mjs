import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = process.env.SCAP_NG_EXTENSIONS_DIR;
if (!directory) throw new Error('SCAP_NG_EXTENSIONS_DIR must point to the isolated VS Code extensions directory');
const root = resolve(directory);
const expected = JSON.parse(readFileSync(new URL('../test-dependency-pins.json', import.meta.url))).dependencies.find(value => value.id === 'redhat.vscode-yaml');
const candidates = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('redhat.vscode-yaml-'));
for (const candidate of candidates) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, candidate.name, 'package.json')));
    if (`${manifest.publisher}.${manifest.name}` === expected.id && manifest.version === expected.version) {
      console.log(JSON.stringify({ id: expected.id, version: manifest.version, extensionsDir: root }, null, 2));
      process.exit(0);
    }
  } catch { /* ignore unrelated or incomplete extension folders */ }
}
throw new Error(`${expected.id} v${expected.version} was not found in isolated SCAP_NG_EXTENSIONS_DIR=${root}`);
