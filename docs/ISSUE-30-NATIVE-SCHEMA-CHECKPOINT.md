# Issue #30 — native YAML schema association checkpoint

The extension now offers **SCAP-NG: Configure native YAML schemas**. This is an explicit workspace action; it never silently edits settings or downloads a schema.

When a verified `scapNg.schemaPackPath` is configured, the command derives local file URIs from the pack manifest for the pinned Assessment, Rule and Benchmark schemas and merges these into the workspace `yaml.schemas` setting. Existing associations are retained. If Red Hat YAML is installed, its language service consumes the associations; otherwise the command reports that the associations are saved but the language service is unavailable.

On-change syntax/version diagnostics are now re-run for YAML documents through the extension's existing diagnostic collection. Schema-aware completion/hover remains dependent on the installed YAML language service and is intentionally not reimplemented here.

## Explicit limits

- The editor does not bundle Red Hat YAML or a second YAML language server.
- The command does not claim schema completion when Red Hat YAML is absent.
- Capability/graph/scanner semantics remain separate from native YAML language-service diagnostics.
- No source text is rewritten by configuring associations.
