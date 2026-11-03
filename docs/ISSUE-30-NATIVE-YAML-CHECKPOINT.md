# Issue #30 — native YAML editor checkpoint

The Source pane is now a read-only synchronized preview with an explicit **Open native YAML editor beside workbench** action. The authoritative source surface is VS Code's own YAML TextEditor, not an HTML textarea.

## Source/Graphical relationship

- Both editors address the same `vscode.TextDocument`.
- Native source edits trigger the existing custom-editor model refresh through `onDidChangeTextDocument`.
- Graphical scalar edits continue to use minimal `WorkspaceEdit` ranges, so the native editor shows the exact patch and supplies undo/redo.
- Selecting a Graphical control reveals/selects its concrete range in the native editor.
- Selecting a scalar in the native editor focuses and highlights the corresponding Graphical/Guided control where the path is represented.
- The native editor can be maximized or moved to a separate group; the workbench remains independently resizable.
- Existing source-preservation and stale-revision checks remain authoritative. No second YAML document or serializer was introduced.

## Host receipt

A real VS Code 1.128.0 host run opened the canonical Windows Registry Assessment in the custom workbench and the native YAML editor in a neighboring group. Extension-host activation completed without missing runtime dependencies. The captured receipt is [the Issue #30 demo image](evidence/issue-30-vsix-native-source-1920x968.png).

The current increment intentionally does not claim schema IntelliSense, Red Hat YAML interoperability, or live schema diagnostics. Those are the next native-source productivity increment. The extension remains usable without Red Hat YAML, and no network/schema download is required.
