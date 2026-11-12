#!/usr/bin/env python3
"""Fetch or verify exact public SCAP-NG development inputs from one clone.

The dependency manifest is committed. Generated checkouts and packs live under
ignored .external/; this program never fetches on --offline and never resets,
deletes or overwrites a dirty checkout. Full corpus data is NOT downloaded.
"""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.external'
PIN = json.loads((ROOT / 'dependency-pins.json').read_text())
PROFILE = json.loads((ROOT / 'schema-profile.json').read_text())


def git(*args, allow_lazy_fetch=False):
    # A blob-filtered checkout can ask a promisor remote for missing objects
    # even during `git status`. Verification must work with NO network at all.
    env = os.environ.copy()
    if allow_lazy_fetch:
        env.pop('GIT_NO_LAZY_FETCH', None)
    else:
        env['GIT_NO_LAZY_FETCH'] = '1'
    return subprocess.run(['git', *map(str, args)], capture_output=True,
                          text=True, check=True, env=env).stdout.strip()


def materialize(row, *, offline):
    name, repository, commit = row['name'], row['repository'], row['commit']
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError(f'{name}: invalid exact Git commit')
    if not repository.startswith('https://github.com/') or not repository.endswith('.git'):
        raise ValueError(f'{name}: only declared public GitHub repositories are supported')
    dest = CACHE / name
    if not dest.exists():
        if offline:
            raise ValueError(f'{name}: missing offline resource at {dest}; bootstrap online first')
        git('clone', '--filter=blob:none', '--no-checkout', repository, dest)
        if row.get('sparse_checkout'):
            git('-C', dest, 'sparse-checkout', 'set', '--no-cone', *row['sparse_checkout'])
        git('-C', dest, 'fetch', '--depth=1', 'origin', commit)
        # Online materialization must download filtered blobs on checkout;
        # only subsequent verification (and all --offline runs) forbid it.
        git('-C', dest, 'checkout', '--detach', commit, allow_lazy_fetch=True)
    else:
        if not (dest / '.git').exists():
            raise ValueError(f'{name}: existing non-repository path; refusing overwrite')
        if git('-C', dest, 'remote', 'get-url', 'origin') != repository:
            raise ValueError(f'{name}: repository URL differs from approved pin')
        if git('-C', dest, 'status', '--porcelain'):
            raise ValueError(f'{name}: checkout is dirty; refusing an automated change')
        if git('-C', dest, 'rev-parse', 'HEAD') != commit:
            raise ValueError(f'{name}: checkout SHA is stale; move it aside before rebootstrap')
    if git('-C', dest, 'rev-parse', 'HEAD') != commit:
        raise ValueError(f'{name}: pinned commit mismatch')
    return dest


def verify_pack(directory):
    raw = (directory / 'manifest.json').read_bytes()
    if sha256(raw).hexdigest() != PROFILE['manifestSha256']:
        raise ValueError('editor pack manifest digest differs from profile pin')
    manifest = json.loads(raw)
    if manifest['source_commit'] != PROFILE['sourceCommit'] or manifest['schema_version'] != PROFILE['schemaVersion']:
        raise ValueError('editor pack version/source commit mismatch')
    expected_resources = int(PROFILE.get('packResourceCount', 235))
    if len(manifest['resources']) != expected_resources or len(manifest['capabilities']) != 100:
        raise ValueError(f'incomplete editor pack: expected {expected_resources} resources')
    for item in manifest['resources']:
        path = Path(item['path'])
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('unsafe pack path')
        data = (directory / path).read_bytes()
        if len(data) != item['bytes'] or sha256(data).hexdigest() != item['sha256']:
            raise ValueError(f'pack resource hash mismatch: {path}')


def bootstrap(*, offline=False, with_pack=False):
    if PIN['format'] != 'scap-ng/vscode-dependency-pins/1':
        raise ValueError('unsupported dependency-pins format')
    CACHE.mkdir(exist_ok=True)
    inputs = {}
    for row in PIN['dependencies']:
        if row['required'] or with_pack:
            inputs[row['name']] = materialize(row, offline=offline)
    if PIN['dependencies'][0]['commit'] != PROFILE['sourceCommit']:
        raise ValueError('schema-profile and public checkout pins disagree')
    if with_pack:
        output = CACHE / 'editor-pack'
        if not output.exists():
            tools = inputs['scap-ng-tools']
            command = [sys.executable, str(ROOT / 'scripts/build_v04_editor_metadata_pack_compat.py'),
                       '--tools-root', str(tools),
                       '--schema-root', str(inputs['scap-ng']),
                       '--oval-root', str(inputs['oval-v5.12.3']),
                       '--source-commit', PROFILE['sourceCommit'], '--output', str(output)]
            try:
                subprocess.run(command, check=True, env=env)
            except subprocess.CalledProcessError as error:
                raise ValueError('metadata export failed; install tools Python dependencies first') from error
        verify_pack(output)
    return {name: str(path) for name, path in inputs.items()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='never fetch; verify cached inputs only')
    parser.add_argument('--with-pack', action='store_true', help='also obtain OVAL and generate/verify the editor pack')
    args = parser.parse_args()
    try:
        data = bootstrap(offline=args.offline, with_pack=args.with_pack)
        print(json.dumps({'result': 'VERIFIED', 'offline': args.offline,
                          'metadata_pack': str(CACHE / 'editor-pack') if args.with_pack else None,
                          'inputs': data}, indent=2))
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or '').strip()
        parser.exit(1, f'bootstrap verification failed: {error}\n{detail}\n')
    except (ValueError, OSError) as error:
        parser.exit(1, f'bootstrap verification failed: {error}\n')
