#!/usr/bin/env python3
"""Audit every tracked editor source/doc and its pinned local/public references.

No network requests or private-research checkout. The optional .external/
checkouts make pinned GitHub blob/tree paths verifiable during integration CI.
"""

from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
PIN = json.loads((ROOT / 'dependency-pins.json').read_text())
PROFILE = json.loads((ROOT / 'schema-profile.json').read_text())
DEPENDENCIES = {r['name']: r for r in PIN['dependencies']}
# Markdown links are meaningful only in Markdown. Parsing source regexes as links
# would mistake character classes such as [A-Za-z]\(...\) for paths.
LINK = re.compile(r'!?\[[^\]\n]+\]\((<?[^)\s]+>?)\)')
GITHUB_SOURCE = re.compile(r'^/vanderpol/(scap-ng|scap-ng-tools|scap-ng-editor-sample-data)/(blob|tree)/([a-f0-9]{40})(?:/(.*))?$')
HASH_ROW = re.compile(r'^\| `([^`]+\.json)` \| .+ \| `([a-f0-9]{64})` \|$')
TEXT_SUFFIXES = {'.md', '.json', '.yaml', '.yml', '.py', '.ts', '.mjs', '.toml'}


def paths():
    tracked = subprocess.check_output(['git', 'ls-files', '--cached', '--others',
                                       '--exclude-standard', '-z'], cwd=ROOT)
    return sorted({ROOT / name.decode('utf-8') for name in tracked.split(b'\0') if name})


def audit():
    problems = []
    pins = {name: row['commit'] for name, row in DEPENDENCIES.items()}
    if pins.get('scap-ng') != PROFILE['sourceCommit']:
        problems.append('dependency-pins/scap-ng and schema-profile sourceCommit differ')
    if not re.fullmatch(r'[a-f0-9]{64}', PROFILE.get('manifestSha256', '')):
        problems.append('schema-profile is missing an exact manifest checksum')
    checked = paths()
    local_links = pinned_links = fixture_hashes = 0
    for path in checked:
        if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
            continue
        rel = path.relative_to(ROOT)
        body = path.read_text(encoding='utf-8')
        # This script contains the deliberately forbidden strings as patterns.
        if path.resolve() != Path(__file__).resolve() and 'scap-ng-staging' in body:
            problems.append(f'{rel}: obsolete renamed repository reference')
        if path.resolve() != Path(__file__).resolve() and 'github.com/vanderpol/scap-ng-research/' in body:
            problems.append(f'{rel}: private research URL is not a public Codex input')
        if path.resolve() != Path(__file__).resolve() and re.search(r'github\.com/vanderpol/scap-ng/(?:blob|tree)/[^\s)]+/schema/v0\.4\.0/', body):
            problems.append(f'{rel}: obsolete physical schema/v0.4.0 path')
        for link in LINK.finditer(body if path.suffix == '.md' else ''):
            target = link.group(1).strip('<>')
            parsed = urlsplit(target)
            if parsed.scheme in ('http', 'https'):
                if parsed.netloc != 'github.com':
                    continue
                source = GITHUB_SOURCE.match(parsed.path)
                if not source:
                    continue
                name, _kind, commit, member = source.groups()
                pinned_links += 1
                if commit != pins[name]:
                    problems.append(f'{rel}: GitHub {name} URL does not use approved commit: {commit}')
                checkout = ROOT / '.external' / name
                if checkout.exists() and member and not (checkout / unquote(member)).exists():
                    problems.append(f'{rel}: missing pinned {name} path: {member}')
            elif not parsed.scheme and not target.startswith(('mailto:', '#')):
                local_links += 1
                absolute = (path.parent / unquote(parsed.path)).resolve()
                if not absolute.is_relative_to(ROOT) or not absolute.exists():
                    problems.append(f'{rel}: broken local link {target}')
        if rel.as_posix() == 'test/fixtures/README.md':
            for line in body.splitlines():
                match = HASH_ROW.match(line)
                if not match:
                    continue
                fixture_hashes += 1
                fixture = path.parent / match[1]
                if not fixture.is_file() or sha256(fixture.read_bytes()).hexdigest() != match[2]:
                    problems.append(f'{rel}: fixture hash mismatch: {match[1]}')
    if fixture_hashes != 3:
        problems.append(f'test/fixtures/README.md: expected three independently pinned fixture hashes, saw {fixture_hashes}')
    if problems:
        raise SystemExit('Repository audit FAILED:\n- ' + '\n- '.join(problems))
    print(f'PASS: {len(checked)} repository files, {local_links} local links, '
          f'{pinned_links} exact GitHub source links and {fixture_hashes} fixture hashes audited')


if __name__ == '__main__':
    audit()
