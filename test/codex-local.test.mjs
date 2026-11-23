import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverCodexModels, runCodexLocal, testCodexLocal } from '../dist/codex-local.js';

async function fakeCodex() {
  const root = await mkdtemp(join(tmpdir(), 'scap-ng-fake-codex-'));
  const file = join(root, 'codex');
  await writeFile(file, `#!/bin/sh
out=""
args="$*"
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '{"models":[{"slug":"gpt-test","visibility":"list","supported_in_api":true},{"slug":"hidden-test","visibility":"hidden"},{"slug":"unsupported-test","visibility":"list","supported_in_api":false}]}'
  exit 0
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then shift; out="$1"; fi
  shift
done
if [ -n "$CODEX_ARGS_FILE" ]; then printf '%s' "$args" > "$CODEX_ARGS_FILE"; fi
printf 'CODEX_SMOKE_OK' > "$out"
`, 'utf8');
  await chmod(file, 0o755);
  return { root, file };
}

test('Codex local bridge uses the host CLI without exposing credentials', async () => {
  const fake = await fakeCodex();
  const previous = process.env.SCAP_NG_CODEX_BIN;
  const previousArgs = process.env.CODEX_ARGS_FILE;
  const argsFile = join(fake.root, 'args.txt');
  process.env.SCAP_NG_CODEX_BIN = fake.file;
  process.env.CODEX_ARGS_FILE = argsFile;
  try {
    const catalog = await discoverCodexModels(fake.root);
    assert.deepEqual(catalog.models, ['gpt-test']);
    assert.match(catalog.message, /1 selectable model/);
    const availability = await testCodexLocal(fake.root, 'gpt-5.6-luna', 'high');
    assert.equal(availability.ok, true);
    assert.match(availability.message, /available/i);
    const args = await (await import('node:fs/promises')).readFile(argsFile, 'utf8');
    assert.match(args, /--model gpt-5\.6-luna/);
    assert.match(args, /-c model_reasoning_effort=\"high\"/);
    assert.equal(await runCodexLocal([{ role: 'user', content: 'bounded prompt' }], { cwd: fake.root, probe: true }), 'CODEX_SMOKE_OK');
    assert.equal(await runCodexLocal([{ role: 'user', content: 'bounded prompt' }], { cwd: fake.root }), 'CODEX_SMOKE_OK');
    const authoringArgs = await (await import('node:fs/promises')).readFile(argsFile, 'utf8');
    assert.match(authoringArgs, /--output-schema/);
  } finally {
    if (previous === undefined) delete process.env.SCAP_NG_CODEX_BIN;
    else process.env.SCAP_NG_CODEX_BIN = previous;
    if (previousArgs === undefined) delete process.env.CODEX_ARGS_FILE;
    else process.env.CODEX_ARGS_FILE = previousArgs;
    await rm(fake.root, { recursive: true, force: true });
  }
});
