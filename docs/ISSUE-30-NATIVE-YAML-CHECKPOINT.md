# Issue #30 — native YAML checkpoint

The custom Assessment editor uses Graphical controls for existing documents and opens the authoritative source in the native VS Code YAML editor with **Open native YAML editor beside workbench**. It no longer embeds a read-only YAML preview or a source textarea.

- Both surfaces share one `TextDocument`.
- Graphical controls reveal their native YAML ranges; native YAML selection focuses the corresponding Graphical control.
- Native YAML save, diagnostics, IntelliSense (when the optional YAML language service is installed), undo and redo remain native workbench behavior.
- Guided authoring is not part of the existing-document editor; it is deferred to the New Assessment Wizard.

See [the Issue #35 checkpoint](ISSUE-35-GRAPHICAL-YAML-CHECKPOINT.md) for source-value synchronization, contextual completion, and acceptance verification.
