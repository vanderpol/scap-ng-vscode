# Issue 44 — graphical Assessment Editor R&D handoff

**Status:** design spike / disposable prototype, NOT an extension feature, NOT canonical SCAP-NG language source, and NOT runtime evaluation.

## Open and inspect

- [Interactive standalone HTML prototype](issue-44-graphical-editor.html) — open locally in a browser; no installation, server, internet, or external dependencies.
- [Issue #44](https://github.com/vanderpol/scap-ng-vscode/issues/44) specifies the design and owner acceptance requirements.
- This HTML is the durable, machine-readable substitute for the image mockup. Codex does NOT need image-capable model support.

The prototype shows an expansive editor, optional navigation/help panels, Test navigation, editable Test ID/title, Object selectors, grouped Item/Field requirements, Field/Operator/Expected Value rows, expandable cards, and a human-readable description. **All edits remain in browser memory.** It does not parse/write YAML, validate SCAP-NG schemas, scan hosts, or generate compliance evidence. Counts and fixture content are illustrative.

## Production integration: ADAPT, DO NOT REPLACE

Use the existing native YAML-first editor and active Codex changes. This separate branch is research only. Do not overwrite Codex worktrees/branches.

1. src/extension.ts: Refine the existing optional Graphical webview rather than building another editor extension. Keep one authoritative vscode.TextDocument. Production webview needs per-view nonce, restrictive CSP, appropriate VS Code theme colors, local assets, and keyboard-accessible controls. Standalone HTML's inline style/script is **only** for running it as one file; do not copy this CSP arrangement into VS Code.
2. src/structured-model.ts: Map the canonical document into visual sections — Test Header, Object (target), Require (condition), Fields, and conditional/multi-Test Evaluate **only if present** in actual document/schema. Use existing view model types if possible.
3. Normative data comes ONLY from pinned schema-profile.json, dependency-pins.json, offline metadata pack, schema description/vocabulary, and capability metadata. The prototype's JavaScript arrays named vals, ops, and demoTests are illustrative **NOT canonical operator/enumeration catalogs**. In production, remove them and use schema-derived choices, titles, types, descriptions, and version-locally qualified branches.
4. Host-to-webview example message shape: render with documentVersion, revisionHash, selectedTestId, qualifiedModel, diagnostics, and exact pack pin. Webview-to-host example edit: requestEdit with documentVersion, revisionHash, canonicalPath, editOperation, newValue. **These are conceptual**, not imposed protocol names. Extension host owns parsing, validation, selected-Test ancestry, permitted operations, safe source-range edits and authorization; never trust webview messages as schema authority.
5. Check revision before every edit. Apply the smallest safe vscode.WorkspaceEdit. Preserve untouched YAML bytes, comments, flow maps, quotes, order, line endings, anchors and Undo/Redo. On external TextDocument edits, refresh view state. No-op open/save must remain byte-identical. For unsafe edits, present a diff or source fallback.
6. Determine capability from the enclosing Test, never the preceding sibling. When selector context is incomplete or invalid, show recovery/diagnostics, not incorrect choices. Object chooses candidates to collect; Require evaluates their fields; these concepts must remain visibly distinct.
7. Show item_requirement, then field_requirement, then fields per canonical authoring presentation. Conditional branches, default insertion, existence-only tests and cardinalities must respect pinned schema. Evaluate describes separate Test-level composition: the prototype's linear flow graphic is a teaching aid and **not a native evaluate expression nor runtime PASS/FAIL**.
8. For nested groups, record fields, arrays, optional Inputs/variables and unsupported constructs, offer schema-driven generic editing or lossless Reveal in YAML. Never hide or discard data.

## Suggested view model (product sketch, not normative schema)

GraphicalAssessmentView:
- documentVersion, revisionHash, assessmentTitle, selectedTestId
- testOutline[], sections[], schemaPin, diagnostics[]

GraphicalSection:
- id, label, description, defaultExpanded
- fields[]:
  - canonicalPath, sourceRange, title, description
  - widget (select/text/number/boolean/predicate/group/readOnly)
  - currentValue, schemaDerivedChoices, required, displayOrder
  - editability (safe/needs-review/source-only)

Adapt existing model types rather than requiring this exact DTO.

## Implementation & acceptance sequence

- [ ] Inventory current Graphical UI and pending VS Code PRs. Read AGENTS.md and issues #18, #35, #38, #39, #40, #41. Do not merge PR #21 or change native language semantics to match the mockup.
- [ ] First PR: opt-in Graphical on-demand display with clear Header/Object/Require hierarchy, context-sensitive help, good responsiveness, no forced three-pane layout.
- [ ] Second increment: one Registry DWORD scalar edit, revision-safe smallest-source-span WorkspaceEdit; prove single-value diff, Undo/Redo and byte-identical no-op.
- [ ] Extend schema-driven capability-aware selectors/operators, missing-field Add/Remove/Restore controls, and optional/conditional/nested requirements using actual canonical content.
- [ ] Validate with Windows Registry DWORD, Linux mount nosuid, and one complex optional-Input/group fixture from the CURRENT pinned examples, not historical Oct 30 conversion archives.
- [ ] Add host tests for wrong-Test capability, incomplete YAML, field deletion/insertion, nested/flow maps, CRLF, quotation, stale revisions, schema-derived enum drift, and navigation.
- [ ] Run unit/integration, offline pack, host/mutation and VSIX gates; demonstrate a real VS Code host screenshot and source diffs. Keep changes in draft PR(s), no automatic merge.
- [ ] Make clear UI distinctions: parse/schema validity vs source qualification vs scanner compliance. Do not show green compliance badges without runtime evidence.

## UX design principle

The primary wide canvas is the visual authoring surface. Left is Assessment/Test outline; center has editable cards (Header, Object, Require/fields, optional Evaluate); right is contextual schema Help/Diagnostics/Preview that can collapse. The working native YAML editor remains the default and stays synchronized from one TextDocument. The demo's fixture values are illustrative, not a source of SCAP-NG truth.

## Short Codex launch

Work vanderpol/scap-ng-vscode issue #44. Read docs/prototypes/README-issue-44.md and issue-44-graphical-editor.html from branch design/issue-44-graphical-prototype-20261104. Adapt existing schema-driven Graphical UI; do not replace the YAML editor or merge PR #21. Implement in tested draft PRs.
