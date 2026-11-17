#!/usr/bin/env python3
"""Build the editor pack from the exact 0.4 candidate/tool compatibility pair.

The public tools pin predates the two native selector-contract resources in the
owner-approved 7b9b611 schema candidate.  This adapter never changes an
external checkout: it archives the exact pinned tools commit into a temporary
workspace, applies the reviewed 145-file snapshot/resource-count compatibility
patch, and invokes the pinned exporter there.  The patch is intentionally
fail-closed so it cannot silently apply to a different tools revision.
"""

import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PINS = json.loads((ROOT / 'dependency-pins.json').read_text())
PROFILE = json.loads((ROOT / 'schema-profile.json').read_text())
TOOLS = next(row for row in PINS['dependencies'] if row['name'] == 'scap-ng-tools')

# These are the exact constants in scap-ng-tools@1f4f74d.  Replacements are
# checked below; changing a tools pin without a new reviewed patch must fail.
OLD_SNAPSHOT = {
    "FROZEN_DIGEST = 'ab1933f2d9171ee0af70c0fab855b00f5faf78bf59ad4924fbf24b402ac4072a'":
        "FROZEN_DIGEST = '2adf88f5c1fd950e997579c00064388b5f12e9e29cde38075bf75b76d1f25843'",
    'EXPECTED_JSON = 143': 'EXPECTED_JSON = 145',
    'EXPECTED_SCHEMAS = 34': 'EXPECTED_SCHEMAS = 35',
    'EXPECTED_REFS = 242': 'EXPECTED_REFS = 652',
}
OLD_BUILDER = {
    'len(resources) != 235': 'len(resources) != 236',
    "REVIEWED_RESOURCES_SHA256 = '0297c8367f828123bcec8afe39d8a85712a51d938e3c918081eb9be41d75b562'":
        "REVIEWED_RESOURCES_SHA256 = '5ff81c9774bd6ab4da6159fadd3857283c789d501c9dd01f55f8f5300eeb54a8'",
}


def run(*args, cwd=None, check=True, capture=False):
    return subprocess.run(args, cwd=cwd, check=check, text=True,
                          capture_output=capture)


def git_output(root: Path, *args):
    return run('git', '-C', str(root), *args, capture=True).stdout.strip()


def replace_once(path: Path, replacements):
    text = path.read_text()
    for old, new in replacements.items():
        if text.count(old) != 1:
            raise ValueError(f'compatibility patch no longer applies cleanly: {path.name}: {old}')
        text = text.replace(old, new)
    path.write_text(text)


def archive_checkout(root: Path, destination: Path):
    archive = subprocess.check_output(['git', '-C', str(root), 'archive', '--format=tar', TOOLS['commit']])
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as tar:
        tar.extractall(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tools-root', type=Path, required=True)
    parser.add_argument('--schema-root', type=Path, required=True)
    parser.add_argument('--oval-root', type=Path, required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()

    if args.source_commit != PROFILE['sourceCommit'] or args.source_commit != PINS['dependencies'][0]['commit']:
        raise ValueError('compatibility adapter source commit does not match the editor profile')
    if PROFILE.get('candidateSchemaDigest') != '2adf88f5c1fd950e997579c00064388b5f12e9e29cde38075bf75b76d1f25843':
        raise ValueError('compatibility adapter is only qualified for the pinned 7b9b611 schema digest')
    if git_output(args.tools_root, 'remote', 'get-url', 'origin') != TOOLS['repository']:
        raise ValueError('tools checkout origin differs from dependency-pins.json')
    if git_output(args.tools_root, 'status', '--porcelain'):
        raise ValueError('tools checkout is dirty; refusing compatibility-pack derivation')
    if git_output(args.tools_root, 'rev-parse', 'HEAD') != TOOLS['commit']:
        raise ValueError('tools checkout is not the exact compatibility pin')
    if args.output.exists():
        raise ValueError('refusing to overwrite an existing editor metadata pack')
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix='scapng-v04-tools-compat-') as temp:
        tools = Path(temp) / 'tools'
        tools.mkdir()
        archive_checkout(args.tools_root, tools)
        replace_once(tools / 'src/scap_ng_tools/contracts/schema_snapshot.py', OLD_SNAPSHOT)
        replace_once(tools / 'scripts/build_v04_editor_metadata_pack.py', OLD_BUILDER)
        env = os.environ.copy()
        env['PYTHONPATH'] = os.pathsep.join((str(tools / 'src'), str(tools / 'scripts'), env.get('PYTHONPATH', '')))
        command = [sys.executable, str(tools / 'scripts/build_v04_editor_metadata_pack.py'),
                   '--schema-root', str(args.schema_root), '--oval-root', str(args.oval_root),
                   '--source-commit', args.source_commit, '--output', str(args.output)]
        subprocess.run(command, check=True, env=env)


if __name__ == '__main__':
    try:
        main()
    except (subprocess.CalledProcessError, OSError, ValueError) as error:
        raise SystemExit(f'compatibility pack build failed: {error}') from error
