# P1A: Offline Regex Tester

The native YAML editor exposes **SCAP-NG: Test Regex** in the Command Palette and in the editor context menu for an `*.assessment.yaml` document. Put the caret inside a schema-shaped `matches_regex` scalar (including list entries) or `regex_capture.pattern`, then invoke the command.

The tester reads the unsaved `TextDocument` through YAML CST ranges. It decodes single/double quoted, plain, flow, and block scalar values without reserializing the document. Samples stay in the tester and are never written to YAML. Multiple samples can be marked expected positive or negative. Results include match/nonmatch, the matched span, captures, named captures, errors, truncation and cancellation status.

## Qualification boundary

The tester uses the existing worker-backed `ECMAScript-safe-preview` adapter. It is deliberately bounded (pattern/input limits, timeout, unsafe-backtracking and backreference rejection) and offline. It is **not** a scanner, does not execute commands, and does not claim parity with the SCAP-NG runtime regex dialect. Unsupported syntax is reported rather than translated silently; for example, an inline `(?i)` modifier is not silently converted to a JavaScript flag.

## Apply behavior

`Apply expression to YAML` is explicit. It validates the bounded preview, checks the original SHA-256 document revision, parses the proposed scalar splice, validates the resulting document against the pinned Assessment schema, and applies one native `WorkspaceEdit`. This gives normal VS Code undo/redo and preserves surrounding comments, line endings, mappings and untouched source bytes. Preview and dismissal are no-op operations.

P1A does not evaluate Objects, requirements, Variables, scanner evidence or compliance outcomes. Sample Object selection is the separate P1B increment.
