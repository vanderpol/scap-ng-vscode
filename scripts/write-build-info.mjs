import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
function git(args, fallback) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() || fallback; } catch { return fallback; }
}
const info = {
  buildId: git(['rev-parse', '--short=7', 'HEAD'], 'development'),
  sourceCommit: git(['rev-parse', 'HEAD'], 'development'),
  builtAt: new Date().toISOString()
};
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`SCAP-NG build ${info.buildId} (${info.builtAt})`);
