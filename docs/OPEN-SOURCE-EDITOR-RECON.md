# Open-source editor pattern reconnaissance (#18)

Reviewed 2026-11-02 from shallow exact checkouts. No source code was copied into this repository.

| Project | Source reviewed | License | Useful pattern | Decision |
|---|---|---|---|---|
| [redhat-developer/vscode-yaml](https://github.com/redhat-developer/vscode-yaml) | `src/schema-extension-api.ts`, `docs/extension-api.md`, `src/json-schema-cache.ts` | MIT | A third-party extension can register a schema contributor and content provider by URI; schema association remains in the YAML language server, with cache/diagnostic integration. | Interoperate where installed rather than duplicate YAML completion/hover. Our pinned pack remains the offline authority and the extension must work without Red Hat YAML. Do not add its large language-server dependency to the core VSIX. |
| [rjsf-team/react-jsonschema-form](https://github.com/rjsf-team/react-jsonschema-form) | `packages/core/src/components/Form.tsx`, `ObjectField.tsx`, `LayoutMultiSchemaField.tsx`, `FallbackField.tsx` | Apache-2.0 | `schema` + `uiSchema`, custom fields, conditional `oneOf`/`anyOf` layout, error-schema propagation and fallback fields are useful form concepts. | Adapt the concepts in a small native webview first. Do not adopt React/RJSF until dependency size, CSP, offline packaging and source-range editing are proven; a normal RJSF submit would reserialize an existing YAML document and violate the one-TextDocument contract. |
| [microsoft/vscode-extension-samples/custom-editor-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/custom-editor-sample) | `src/catScratchEditor.ts`, `src/extension.ts`, `src/util.ts`, sample `package.json` | MIT | `CustomTextEditorProvider` lifecycle, `onDidChangeTextDocument` synchronization, disposal, webview CSP nonce, and message-to-edit flow. | Reuse the official API pattern. The sample deliberately replaces the entire JSON document in `updateTextDocument`; SCAP-NG instead uses `WorkspaceEdit` range splices and rejects unsafe edits. |

## Resulting implementation choices

- Use VS Code's native Custom Text Editor and `WorkspaceEdit` as the document lifecycle, not a private form snapshot.
- Keep `yaml` + concrete source ranges as the minimal patch layer; no whole-file serializer for existing documents.
- Resolve labels, enums, descriptions, capability fields and logical operator explanations from the pinned metadata pack and vocabulary.
- Keep the current native webview small and accessible with labels, status regions, keyboard-focusable controls and a Source/Structured escape hatch.
- Treat generic schema fallback as a safety net. Specialized Windows Registry/Linux controls are the next path for novice usability; dynamic records and advanced variables remain explicit unsupported/source fallback until safe patches exist.

The external projects informed interoperability and lifecycle decisions; they did not change SCAP-NG grammar, semantics, schema pins or scanner boundaries.
