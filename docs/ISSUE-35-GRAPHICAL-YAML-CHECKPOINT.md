# Issue #35 — Graphical + native YAML checkpoint

Updated 2026-11-03.

## Existing Assessment workflow

- Existing `*.assessment.yaml` and `*.assessment.yml` documents open in the Graphical custom editor.
- The Graphical editor and the native VS Code YAML editor use the same authoritative `TextDocument`.
- The custom editor has no read-only YAML preview and no existing-document Guided pane. **Open native YAML editor beside workbench** makes the source surface explicit; native YAML save, IntelliSense/diagnostics (when a YAML language service is installed), selection, undo and redo remain authoritative.
- Guided authoring remains available only through **SCAP-NG: Create Guided Assessment**, the New Assessment Wizard path.
- `SCAP-NG: Open Graphical Assessment editor` and the editor title/context actions make the Graphical entry discoverable without changing the native YAML default (`priority: option`).

## Source/value correctness

- Graphical requirement controls are sourced from the pinned schema and retain `values_found`, `values_matching`, `items_found`, and `items_satisfying` values from YAML.
- Selection rendering handles serialized choice values without comparing option strings to boolean selection flags.
- Windows Registry controls use capability-specific labels (`Registry hive`, `Registry key`, `Value name`). Optional Input controls are shown in Graphical view.
- Edits remain scalar/range patches with revision checks; no whole-document normalization or scanner/evaluator execution is performed.

## Native completion scope

The extension contributes a bounded YAML completion provider when a verified pack is configured:

- `assessment.class`: the five schema-canonical values `compliance`, `vulnerability`, `patch`, `inventory`, `miscellaneous`.
- `assessment.mode`: `manual`, `automated`.
- `tests.*.capability`: the exact pinned manifest capability catalog (not an invented schema enum).
- `items_found`, `items_satisfying`, `values_found`, and `values_matching`: their distinct schema-derived cardinality sets, selected from the correct field path.

The provider supplements, rather than replaces, the optional Red Hat YAML language service. No Red Hat extension is bundled or claimed as installed.

## Verification

```sh
npm test
npm run lint
SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SOURCE_ROOT=.external/scap-ng \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:integration
npm run verify:offline
python3 scripts/audit_repository.py
npm run package:vsix
unzip -t scap-ng-vscode-0.0.1.vsix
```
