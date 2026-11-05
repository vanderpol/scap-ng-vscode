# Draft PR — Issue #44 desktop Assessment tree

**Status:** draft implementation checkpoint for review; no merge performed.

## Delivered

- Replaced the custom Assessment editor's stacked Test form with a compact desktop master-detail surface: persistent meaningful-construct Assessment tree on the left, one selected-construct property inspector in the center, and a collapsible contextual schema help/diagnostics panel on the right.
- Preserved the native YAML editor and one authoritative `vscode.TextDocument`; graphical scalar changes use revision-checked `WorkspaceEdit` patches.
- Added keyboard/context-menu parity (right-click, Shift+F10, and selected-node ellipsis) for Reveal, Add, Duplicate, Rename and Remove. Required Test `require` is protected from silent deletion.
- Added lossless source splices for mapping/sequence structural additions and removals, with YAML parse checks, stale-revision rejection and native Undo/Redo.
- Kept schema controls and defaults driven by the pinned offline metadata pack. Hide Defaults changes presentation only and retains authored overrides.
- Added structural entry points for Tests, Variables, Shared Objects, Filters, Set operands and nested requirement nodes. Unsupported/incomplete branches stay visible and can be revealed in YAML; no scanner PASS/FAIL is produced.

## Evidence

- Host lifecycle receipt: `docs/evidence/issue-44-graphical-host-receipt.json`
- Corpus model smoke receipt: `docs/evidence/issue-44-corpus-smoke.json`
- 1920×1080 revised host screenshot: `docs/evidence/issue-44-revised-host-1920x1080.png`
- Previous host screenshot: `docs/evidence/issue-44-graphical-host-1920x1080.png`
- The Issue #27 corpus was used as an external read-only shape/performance inventory. The VM-local Stage A pin reports 65 streams, 4,524 current automated YAML Assessments, 268 documents with Variables, 598 with Filters and 379 with Sets. The editor model opened all 4,524 without parse/model failures in 60.4s (136,322 scalar properties; maximum 410 in one document).
- Issue #27 corpus schema pin (`7354a24cdbfe18321153ccaef5d772801a10cd71`) differs from this checkout's editor profile pin (`7b9b61108aa30a601828268576308e510477094e`); it is not promoted to the editor's qualified sample library.

## Automated results

- `npm test` — **34 passed**
- `npm run lint` and `git diff --check` — **pass**
- `npm run package:vsix` — **pass**
- `SCAP_NG_METADATA_PACK=.external/editor-pack SCAP_NG_SOURCE_ROOT=.external/scap-ng SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data npm run test:integration` — **18 passed**
- `SCAP_NG_CORPUS_ROOT=.external/full65-current/automated-subset-7354a24cdbfe18321153ccaef5d772801a10cd71-20261105 SCAP_NG_METADATA_PACK=.external/editor-pack npm run test:corpus:graphical` — **4,524/4,524 models opened; 0 failures**
- `SCAP_NG_OPEN_GRAPHICAL=1 SCAP_NG_GRAPHICAL_EDIT=1 ... npm run test:host` — **PASS** in VS Code 1.128.0 Extension Development Host. The receipt verifies graphical surface open, minimal Object selector and Require predicate diffs, save, close/reopen, Undo to the exact baseline, and Redo to the exact edited bytes.

Offline verification was attempted but is blocked by pre-existing ignored checkout dirt in `.external/scap-ng-tools` (`.tmp-issue8-*`, `.worktrees`, `baseline-compare`); the bootstrap script correctly refused to mutate it. Full 65-stream compliance/runtime proof remains out of scope; no scanner result is claimed.
