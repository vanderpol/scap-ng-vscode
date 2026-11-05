# P1 authoring sidebar

**Status:** Phase 1 implemented as an optional Assessment Studio Authoring view; deeper sample-data playgrounds remain postponed.

The SCAP-NG editor should provide an optional, dockable **Authoring** view that
stays alongside the native YAML editor. YAML remains authoritative; the view
must never become a second document model or silently rewrite the source. The
Authoring view is placed in VS Code’s Secondary Side Bar so it can use the full
height independently of the Assessment Studio content tree.

## Phase 1 panels

The dockable **Authoring** view is a full-height view in the Secondary Side Bar. The Assessment Studio activity container remains dedicated to the searchable content tree (STIGs, Assessments, Rules, directory folders, and Diagnostics). VS Code can collapse, resize, move, or hide either surface. The view is opened only when the user explicitly selects it; opening an Assessment never changes the workbench layout. The view follows the active YAML editor and cursor without becoming a second document model.


### Schema Help

Implemented in Phase 1. Follow the active YAML cursor and show the same pinned schema/vocabulary title, description, allowed values/operators, and source path used by hover. Help remains safe text rendering and disappears when no current schema target is available.

### Regex Tester

Implemented in Phase 1 as a contextual tab. When the cursor is on a regex predicate, it provides a bounded PCRE2-safe-preview sample area, reports match/error/cancellation status, and links to the full Regex Tester for multi-sample editing and source application. When no caret is available (for example, Graphical mode), the tab offers the full tester and opens the first schema-recognized expression. This is a preview, not a scanner result.

### Sample Object Tester

Direct-selector Item preview remains available through the existing command. Shellcommand result prototyping is deliberately postponed until its input, pattern, and requirement semantics have a separately reviewed design.

### Options and Diagnostics

The Options tab shows the current verified offline pack and pinned schema state, identifies native YAML as the source editing surface, and lets the user save or clear the workspace schema-pack path directly in the sidebar. It also provides an action for opening the YAML editor beside the view. The Diagnostics tab shows local YAML parse status, pinned schema status, document-version mismatch, and the explicit “Assessment execution unavailable” boundary. Detailed build, pin, pack, document, and cursor information stays behind a collapsed disclosure. These tabs do not execute commands or send telemetry.

### Diagnostics

The Diagnostics tab is the first contextual diagnostics surface. Full source-linked schema/authoring diagnostic navigation remains a subsequent increment; quick fixes remain explicit, minimal, undoable edits in the native YAML document.

## Architecture and UX constraints

- Reuse the shared schema resolver and verified offline metadata pack.
- Follow the active editor and selection without taking ownership of YAML.
- Use a dockable Activity Bar/Side Bar view with dismissible panels.
- Keep panels optional and avoid activation cost for users who do not open them.
- Do not execute shell commands, collectors, scanners, or authored expressions.
- Keep regex and sample evaluation bounded and clearly dialect/semantic scoped.
- Preserve comments, flow/block style, line endings, and unrelated source text.

## Remaining delivery order

1. Add source-range navigation and richer diagnostics to the Diagnostics tab.
2. Expand the Regex tab with saved sanitized cases while retaining the full tester as the source-edit surface.
3. Revisit Sample Object and shellcommand result playgrounds only after their contracts are explicit.
4. Add broader logical/status previews only after their truth boundaries are reviewed.
