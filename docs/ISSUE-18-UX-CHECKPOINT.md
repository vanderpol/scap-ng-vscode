# Issue #18 UX checkpoint

Updated 2026-11-02. This checkpoint records the bounded follow-on work after the merged desktop three-pane slice.

## Delivered in the current workbench

- A single custom-editor TextDocument is shown in simultaneous Guided context, Graphical controls, and editable YAML Source panes.
- Guided context and the Graphical Test selection share the selected Test and live explanation; source selections are highlighted from graphical controls when a safe scalar range exists.
- Pane splitters are independently draggable and their layout is retained by the webview state. Narrow layouts retain the existing source fallback rather than reflowing an existing document.
- Source edits require parse/schema validation and an explicit apply confirmation. Graphical scalar edits remain range patches, with native VS Code undo/redo and stale-revision protection. Full-document Source apply rechecks the TextDocument hash/version immediately after the approval prompt, preventing TOCTOU lost updates.
- Predicate operation changes are constrained by allowed operation choices and revalidated against the pinned Assessment schema before applying. Dynamic comparison field names can be safely renamed through the same mapping-key patch path.
- Existing optional Input branches expose schema-backed editable controls; multi-Test evaluation trees show their authored structure and allow safe top-level AND/OR/ONE/XOR changes through a minimal mapping-key patch. Variables and complex regex predicates are described without execution. Regex previews use a restricted ECMAScript-safe subset and a cancellable worker with a real time budget; pathological patterns are rejected or terminated and never report Assessment compliance.

## Verification

```sh
npm test
npm run lint
SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SOURCE_ROOT=.external/scap-ng \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:integration
npm run package:vsix && unzip -t scap-ng-vscode-0.0.1.vsix
```

The unit suite covers source-approval conflict/cancel behavior and pathological regex rejection/worker cancellation. The integration suite exercises canonical Registry, Linux, optional Input and SYSVOL content, source-preserving edits, schema validation, multi-Test evaluation modeling and the pinned offline pack.

## Explicit boundaries

The workbench does not execute shell commands, regex-based Assessments or scanners, and does not fabricate PASS/FAIL. Structural additions/removals of Tests and Variables remain Source-mode edits until a reviewed minimal-edit operation is available. A host-level VS Code screenshot/automation capture is still a release-evidence task, not represented by a mock screenshot in this repository.
