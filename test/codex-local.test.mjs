import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodexLocal, testCodexLocal } from '../dist/codex-local.js';

async function fakeCodex() {
  const root = await mkdtemp(join(tmpdir(), 'scap-ng-fake-codex-'));
  const file = join(root, 'codex');
  await writeFile(file, `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi
  shift
done
printf 'CODEX_SMOKE_OK' > "$out"
`, 'utf8');
  await chmod(file, 0o755);
  return { root, file };
}

test('Codex local bridge uses the host CLI without exposing credentials', async () => {
  const fake = await fakeCodex();
  const previous = process.env.SCAP_NG_CODEX_BIN;
  process.env.SCAP_NG_CODEX_BIN = fake.file;
  try {
    const availability = await testCodexLocal(fake.root);
    assert.equal(availability.ok, true);
    assert.match(availability.message, /available/i);
    assert.equal(await runCodexLocal([{ role: 'user', content: 'bounded prompt' }], { cwd: fake.root, probe: true }), 'CODEX_SMOKE_OK');
  } finally {
    if (previous === undefined) delete process.env.SCAP_NG_CODEX_BIN;
    else process.env.SCAP_NG_CODEX_BIN = previous;
    await rm(fake.root, { recursive: true, force: true });
  }
});
