# Assessment Studio acceptance checkpoint

This checkpoint covers the native 0.4.1 editor path after PRs #70 and #76 were
merged into `main`. It is an editor authoring receipt, not scanner execution
qualification.

## Gates

- `npm test`: **202 passed** (including corpus-pin provenance regressions).
- `npm run verify:offline`: **VERIFIED** with the pinned offline pack.
- `npm run test:host:redhat`: **PASS** with Red Hat YAML 2.0.0.
- `npm run test:host:mutation`: **PASS** using the same pinned dependency and a
  deliberately mutated schema pack. The mutation host copies `pcre2-wasm` so
  activation exercises the complete offline VSIX dependency closure.
- `SCAP_NG_OPEN_GRAPHICAL=1 SCAP_NG_GRAPHICAL_EDIT=1 npm run test:host:redhat`:
  **PASS**. The receipt proves Object and Require edits, save/reopen, undo and
  redo on the same YAML document.
- `npm run package:vsix`: **PASS**, `scap-ng-vscode-0.0.1.vsix`.
- Installed VSIX host probe: **PASS** against the packaged extension.
- `npm run test:host:status`: **PASS**; the intentionally incomplete document
  reported `partial`, schema version `0.4.1`, exact pack hash, and active YAML
  service rather than being presented as healthy.

## Corpus boundary

`test:corpus:graphical` opened **153/153** native conformance Assessment files
with zero model failures (7,612 scalar properties; maximum 1,366; 8 Variable,
2 Filter, and 2 Set documents). The corpus manifest is pinned to
`d1ab0283e09369c2c734d3b8f93b65007441cf07`, while this editor pack is pinned to
`cb82e6bd3cbfad2c11bc2ee6e68b87ee6c96944a`. The smoke receipt therefore reports
`schemaPin.verified: false` and `not editor-qualified`; strict mode exits
nonzero. This prevents a schema-valid model smoke run from being misreported as
current-editor qualification. Re-run after an exact 0.4.1 pack/corpus
repinning coordinated with the exporter owner.

The corpus remains read-only parser/model stress evidence. It supplies no
scanner outcomes, and RI execution remains owned by SCAP-NG RI #196.
