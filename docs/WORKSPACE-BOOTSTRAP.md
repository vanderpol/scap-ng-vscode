# One-clone Linux development and offline resource contract

Company Codex should be opened **only in `vanderpol/scap-ng-vscode`**. Do not
require an adjacent checkout of any repository, private research access, or
links to ChatGPT. All current development instructions, version pins and test
commands must live in this public repository.

## From a clean clone (first online setup)

```sh
git clone https://github.com/vanderpol/scap-ng-vscode.git
cd scap-ng-vscode
npm ci
npm run bootstrap:deps
python3 -m pip install -e .external/scap-ng-tools
npm run bootstrap:pack
npm run verify:offline
python3 scripts/audit_repository.py
npm run lint
npm test
SCAP_NG_METADATA_PACK=.external/editor-pack SCAP_NG_SOURCE_ROOT=.external/scap-ng npm run test:integration
```

`git`, Python 3.12+, Node 24 and npm are needed for development. Use a
version-compatible offline wheel/npm cache when setting up in a network-isolated
environment. An ordinary installed VSIX must **never** require these source
repositories or network downloads at runtime.

The script reads `dependency-pins.json` and `schema-profile.json`, then fetches
only the exact, public Git commits listed there. It creates ignored resources:

| Local ignored path | Contents | Use |
| --- | --- | --- |
| `.external/scap-ng/` | Canonical flat `schema/`, vocabulary, examples | Read-only specification reference |
| `.external/scap-ng-tools/` | Converter, metadata exporter and shared normalizers | Development reference; not editor implementation target |
| `.external/scap-ng-editor-sample-data/` | Small current fixture library | Source/Structured/YAML edge cases |
| `.external/oval-v5.12.3/` | Official, sparse OVAL XSDs | Build-time pack generation only |
| `.external/editor-pack/` | SHA-verified 235-resource pack | Offline metadata/validation integration |

The first three checkouts are obtained by `bootstrap:deps`; OVAL and the pack
are added by `bootstrap:pack`. All checkouts stay at detached exact commit
pins. A stale, dirty or foreign checkout is **rejected**, not reset or
overwritten. To move versions, deliberately archive the old `.external`
resources first and use reviewed replacement pins. No script silently selects
the latest `main`.

`npm run verify:offline` performs no fetch. It checks all checkout commits,
origin URLs, manifest identity and each individual pack resource checksum.
It fails when a required cached resource is absent. It is valid to prepare
`.external/` on a connected machine and transfer that checked cache into a
restricted machine; preserve Git metadata and the exact files or verify the
content hashes before accepting it. Runtime remains offline-first.

## Development boundaries and PR flow

- Use purpose-named branches and GitHub Pull Requests to change this editor.
- Treat pinned sibling checkouts as **reference-only**. Work modifying schema
  or converter belongs in separately reviewed source/tools PRs, not in an
  editor branch or an auto-written cache.
- The current 0.4 owner amendment groups Item quantifiers under
  `require.item_requirement` while keeping the `field_requirement` sibling;
  see the pinned canonical `examples/` and [primer](SCAP-NG-PRIMER.md).
- Treat authoring property order as a separate **schema-derived presentation**
  contract: the pack exporter alphabetizes JSON keys when generating hashes,
  so its object iteration order is **not** the original schema declaration
  order. The original pinned `schema/assessment-language.schema.json` and
  matching canonical/sample fixtures demonstrate `item_requirement`, then
  `field_requirement`, then `fields`; simple predicates may use compact flow
  YAML. Before runtime UI packaging, preserve that ordering through reviewed,
  generated metadata, never a competing hardcoded list.
- The canonical JSON `$id` prefix includes `v0.4.0` **by design** even though
  file paths are physically flat under `schema/`. Do not change `$id` URIs to
  match filesystem locations.
- This repository still contains a TypeScript metadata/source-buffer
  foundation plus the initial VS Code extension host, source-backed Structured editor and VSIX packaging.

## Full converted library (optional, not a bootstrap dependency)

The historical [65-stream normalized review library](https://github.com/vanderpol/scap-ng-evidence/tree/main/runs/v04-library/2026-10-30-all65-normalized-review-ff69d46b3)
contains 60 editable native Benchmarks, 6,817 native Assessments and 13,754
YAML files; five streams have source-only records. It predates the approved
2026-11-02 Item grammar amendment. **Do not use it as current-schema-valid
content or silently rewrite its historical proof/corpus files.**

When a freshly regenerated, checksum-verified full 0.4 library is published in
`vanderpol/scap-ng-evidence`, record its exact release URL, archive SHA-256,
manifest and source/schema pins in `dependency-pins.json` via review. Only then
may an optional explicit download/install helper be enabled. Keep the extracted
library outside Git and outside automatic editor test/package operations.
The VS Code extension should open it as an ordinary user-selected local folder.

## Fresh-clone handoff gate

Before work-company Codex is tasked, CI must prove the same workflow:

1. Fresh editor checkout → bootstrap only public, pinned resources.
2. Generate the expected metadata pack, verify every checksum, then run
   `--offline` with no network commands.
3. Build/lint/test the editor foundation; validate current Linux/Windows
   examples, selector/API contracts and synthetic native Result A fixtures.
4. Audit **every tracked file and link** for missing paths, private-research
   dependencies and obsolete `schema/v0.4.0/` filesystem assumptions, using
   `python3 scripts/audit_repository.py`; CI checks its exact local/pinned
   upstream links and all three fixture hashes on every PR.
5. Confirm only current, public GitHub issues are necessary for the company
   Codex workflow; no external conversation links or undocumented manual steps.

Until these gates and the coordinated canonical/tools/sample-data PRs pass,
the editor repository is **not yet ready for external Codex tasking**.
