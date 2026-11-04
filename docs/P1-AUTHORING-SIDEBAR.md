# P1 authoring sidebar

**Status:** planned; not implemented in the P0 checkpoint.

The SCAP-NG editor should provide an optional, dockable **Authoring** view that
stays alongside the native YAML editor. YAML remains authoritative; the view
must never become a second document model or silently rewrite the source.

## Planned panels

### Schema Help

Follow the active YAML cursor and show the same schema-derived title,
description, allowed values, allowed operators, defaults, constraints, and
source location used by hover and Go to Definition.

### Regex Tester

When the cursor is on a regex predicate, provide a bounded offline test area
for sample strings. Show matches and capture groups, identify the supported
regex dialect, and reject/cancel pathological input. This is a preview, not a
scanner result.

### Sample Object Tester

Allow an author to enter or paste representative collected Object data and
preview selector, field-predicate, Variable, and requirement matching. Results
must be labeled as offline sample evaluation and must not claim compliance,
collection, provenance, or runtime status.

### Diagnostics

Show schema and authoring diagnostics with links back to the source range. Quick
Fixes remain explicit, minimal, undoable edits in the native YAML document.

## Architecture and UX constraints

- Reuse the shared schema resolver and verified offline metadata pack.
- Follow the active editor and selection without taking ownership of YAML.
- Use a dockable Activity Bar/Side Bar view with dismissible panels.
- Keep panels optional and avoid activation cost for users who do not open them.
- Do not execute shell commands, collectors, scanners, or authored expressions.
- Keep regex and sample evaluation bounded and clearly dialect/semantic scoped.
- Preserve comments, flow/block style, line endings, and unrelated source text.

## Suggested delivery order

1. Persistent Schema Help panel using the existing hover/definition metadata.
2. Contextual diagnostics and source navigation.
3. Bounded Regex Tester.
4. Sample Object Tester for deterministic selector/requirement previews.
5. Broader logical/status previews only after their contracts are explicit.
