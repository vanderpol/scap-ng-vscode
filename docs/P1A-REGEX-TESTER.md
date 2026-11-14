# P1A: Offline Regex Tester

The **SCAP-NG: Test Regex** command is available in the Command Palette, the native YAML editor title/context menus, and the Authoring sidebar’s **Regex** tab while a native YAML editor is active. From native YAML, put the caret inside a schema-shaped `matches_regex` scalar (including list entries) or `regex_capture.pattern`, then invoke the command.

The Graphical editor keeps its own **Contextual help** pane: focus a regex field to get an inline bounded preview with sample text and an **Open full tester** action. The sidebar’s Schema Help and Regex tabs are intentionally hidden while the Graphical editor is active, avoiding controls that depend on a native YAML caret. Options and Diagnostics remain available.

The tester reads the unsaved `TextDocument` through YAML CST ranges. It decodes single/double quoted, plain, flow, and block scalar values without reserializing the document. Samples stay in the tester and are never written to YAML. Multiple samples can be marked expected positive or negative. Results include match/nonmatch, the matched span, captures, named captures, errors, truncation and cancellation status.

## Qualification boundary

The tester uses the worker-backed `PCRE2-safe-preview` adapter (PCRE2 compiled to WebAssembly). It is deliberately bounded (pattern/input limits, PCRE2 match/depth limits, worker timeout) and offline. It is **not** a scanner, does not execute commands, and does not claim parity with the SCAP-NG runtime regex dialect. PCRE2 syntax is passed through without JavaScript translation; inline modifiers such as `(?i)` are supported. This is still an editor preview and does not qualify the SCAP-NG runtime dialect.

## Apply behavior

`Apply expression to YAML` is explicit. It validates the bounded preview, checks the original SHA-256 document revision, parses the proposed scalar splice, validates the resulting document against the pinned Assessment schema, and applies one native `WorkspaceEdit`. This gives normal VS Code undo/redo and preserves surrounding comments, line endings, mappings and untouched source bytes. Preview and dismissal are no-op operations.

P1A does not evaluate Objects, requirements, Variables, scanner evidence or compliance outcomes. Sample Object selection is the separate P1B increment.

### Multiple `matches_regex` entries

`matches_regex` can be a YAML sequence. Select from the first scalar through the last scalar in the native editor before invoking **SCAP-NG: Test Regex**. The panel then shows each selected alternative separately, runs every alternative against each sample, and applies edits back to the corresponding YAML scalars in one undoable source edit. Selecting only one entry tests/applies only that entry.
