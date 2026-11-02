# P1 Source ↔ Structured vertical slice

The custom editor provider is source-backed: the VS Code `TextDocument` remains the only authority, while the webview receives a scalar-field view model. It is intentionally a generic fallback rather than a second YAML serializer.

## Safe edit behavior

1. The host reparses the current document with `yaml` concrete source ranges.
2. A webview scalar edit includes its YAML path; the host verifies the current SHA-256 and only accepts plain, single-quoted, or double-quoted unanchored scalar nodes.
3. The host creates a one-range `WorkspaceEdit`, allowing VS Code to provide native dirty state, undo and redo.
4. External document changes trigger a fresh model; a stale or unsafe edit is rejected and the original source stays untouched.
5. Malformed YAML, duplicate keys, aliases, anchors, block scalars and tagged scalars remain Source-mode-only until a safe patch strategy exists.

No-op open/save continues to return the original bytes. Safe plain string enum edits retain plain style; quoted strings retain their quote style. Complex objects, arrays and nested paths are represented by their scalar leaves, so inline flow mappings and comments outside the edited scalar are not reserialized.

## Activation

Files named `*.assessment.yaml` or `*.assessment.yml` expose **SCAP-NG Assessment** through VS Code's native **Reopen Editor With…** menu. The custom editor is optional (`priority: option`); users can always keep the native Source editor. The provider never invokes a scanner or claims compliance results.

Schema-backed dropdowns and capability-aware controls will be layered onto this generic fallback once the selected verified metadata pack is connected to the form model. Until then, values are edited as source-backed scalar fields rather than from a competing hardcoded enum registry.
