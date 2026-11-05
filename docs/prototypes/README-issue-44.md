# Issue 44 — graphical Assessment Editor R&D handoff

**Status:** design spike / disposable prototype, NOT an extension feature, NOT canonical SCAP-NG language source, and NOT runtime evaluation.

## Open and inspect

- [Interactive standalone HTML prototype](issue-44-graphical-editor.html) — Test/Object/Require layout; open locally without an install or internet.
- [Interactive first-class Variables / Filters / Sets prototype](issue-44-variables-filters-sets.html) — separate offline browser UI with editable recursive Variable expressions, include/exclude Object and operand Filters, and nested Set composition. All controls are local-only illustrative design research; NOT an SCAP-NG-compatible evaluator or YAML serializer.
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


## P1 scope amendment — Variables, Filters, nested Sets (owner decision 2026-11-04)

**Required on the initial graphical release, not phase-two or YAML-only.** The first standalone HTML mockup omitted these controls. The implementation must use *current, exact pinned* 0.4 schema and capability metadata, not the illustrative values in HTML.

### Variables — first-class assessment-level editor

- Navigable Variables section alongside Tests and Inputs: list/search, count, add/delete/rename with reference-aware review, source navigation and Used By.
- Edit name, kind (local/constant), datatype, optional title and expression.
- Recursive expression builder for all current schema-approved alternatives in variable-expression.schema.json: literal scalar/list/typed record, reference to Variable, collected values from Object/field, concat with ordered nested components, regex_capture pattern and nested input, unique, merge with delimiter/sort/order/input; only present functions supported by the exact pinned schema.
- Add/remove/reorder recursive operands; preserve type, list ordering, duplicates, expression status and source paths. Constant Variables must obey the schema literal-only constraint. Validate unresolved/cyclic references, type incompatibilities and branch constraints. An unsupported runtime evaluation is not a PASS.
- Organizational Inputs and Variables are separate concepts and source locations; do not merge their editors.

### Filters and Sets — first-class collection editor

- Collection Filters section appears between Object/collection source and Require. Filters include/exclude *collected Items*; Require governs expected Test results; these are not interchangeable.
- Add/edit/remove/reorder each Filter with action include/exclude, a schema-derived field condition (including nested and/or/one/xor, record fields where qualified), comparison operator/value, and schema help.
- Support both inline Object post-collection filters and Filters on each Set Object operand.
- For Set composition, show editable nested Set/operand tree; expose union/intersection/difference, source Object selection/references, nested Set operations and per-operand filters; enforce schema operand bounds (difference maximum two).
- Preserve distinction among selector, Filter, require.item_requirement, require.field_requirement, require.fields and multi-Test evaluate. Never invent old OVAL State registry or implicit semantics.
- Every valid nested structure stays visible and editable, using generic schema-backed tree editor for unsupported specialized widgets; if a *specific edit* is unsafe, offer Reveal in YAML or diff review, not silent document rewrite.

### P1 acceptance gates

- [ ] Open a real pinned Assessment containing a constant and nested derived Variable; edit declarations, references, literal values and nested components in Graphical; verify minimal YAML source diffs and diagnostics.
- [ ] Show a real Object Filter and Set operand Filter, with include/exclude action, nested predicate and operations derived from pinned schema, not hardcoded catalog.
- [ ] Demonstrate Set composition with at least two operands and a nested operand; enforce difference bounds.
- [ ] Validate empty/missing/invalid/duplicate/cyclic Variable references, typing and unsupported expressions; preserve unknown/error status.
- [ ] Opening/switching/closing with no edit leaves YAML bytes unchanged; edits support undo/redo, preserve comments/flow maps/quotes, and synchronize immediately with native YAML.
- [ ] Test in actual VS Code host with canonical Windows and Linux examples, plus one complex approved Set/Variable case from pinned content. Run unit/integration, offline pack, host mutation and VSIX checks.
- [ ] Do not repin or merge candidate PR #21 because of this design task. Escalate true language-contract gaps; never invent semantics.

**Note:** The standalone browser mockup is presentation R&D, not an evaluator, qualified YAML serializer, or compliance tool. The production editor must provide these capabilities even if some branches use a generic schema-driven property tree rather than a specialized card.



## P1 structural authoring amendment — create, duplicate, remove, reorder (owner, 2026-11-05)

The original HTML can switch among pre-populated Tests and add/remove field predicate rows, but it cannot create/delete Tests or Object sources or manage whole requirements. **The initial Graphical implementation must support constructing an entire Assessment, not just editing an existing YAML skeleton.** This is a non-deferable P1 criterion, alongside Variables, Filters, and nested Sets.

### Test lifecycle
- From Assessment/Test outline: Add Test; Duplicate Test; Delete Test; Rename ID; Reorder/Move Test when order is meaningful for presentation and can be changed safely; show all applicable modes and live schema/graph validation.
- Add invokes an editor wizard with capability selection and a schema-valid minimal skeleton; do not invent collectors, selector values or quantifier intent. Duplicating assigns a unique new Test ID, explicitly handles references and preserves original untouched bytes.
- Before deletion or rename, inspect all evaluation branches and references; display the affected evaluate tree and allow an explicit repair/review rather than leaving silently dangling Test IDs or silently changing Boolean truth.
- After an add/rename/delete, native YAML source, Graphical outline, diagnostics and contextual help synchronize; keep native Undo/Redo.

### Object/source lifecycle
- Test editor must offer Add/Replace/Remove Object (where allowed), switch between inline Object and object_ref, choose source from qualified shared_objects, and edit capability-specific selectors, acquisition properties and Filters. Also support variable-as-source for capabilities that allow it.
- Add/Remove shared Object definitions and Set operands, with a Used By/reference check. Removing an Object currently referenced by a Test, Variable or Set must prompt for an explicit resolution; never cascade-delete behind the user's back.
- Distinguish removing an entire Object/source from removing one selector or Filter. Do not permit source-less invalid Tests as if they were ready; show incomplete status if author deliberately leaves a draft.
- Reorder source elements only where semantically safe, preserving inline maps and formatting when possible.

### Requirement lifecycle
- Provide Add/Remove/Replace controls at each valid level: item_requirement, field_requirement, fields, nested and/or/one/xor condition groups, field/record predicates, and branch operands.
- Crucial canonical fact: in the current 0.4 schema, automated Test **requires a require property**. Therefore **do not present unrestricted Delete Require as a valid completed Test operation**. The UI may temporarily show an incomplete Test during authoring, with a diagnostic, or offer Replace/Reset Require with a schema-supported form (existence-only vs comparison) subject to explicit choice. Never invent defaults.
- Removal of individual optional requirement portions and conditions is allowed only if the result is schema-valid (or visibly an incomplete draft). Cardinalities, named branches and dependencies must stay consistent with pinned schemas.
- Provide a clear plus menu at Test, Object, Require and Condition headings, plus contextual Remove/Duplicate actions and keyboard-friendly confirmation. Deletion must have review/undo, no silent mutation of unrelated text.

### Acceptance demonstrations
- [ ] Start an empty automated Assessment; add two Tests with different capabilities; select a capability; create a qualified Object and a requirement branch for each; edit Fields; add an explicit Evaluate grouping as appropriate.
- [ ] Duplicate a Test, rename it, and delete a Test referenced by Evaluate; demonstrate safe reference-impact review, not silent orphaning.
- [ ] Add/remove an inline Object, switch to a referenced shared Object, create/edit/remove a Set operand and its Filters, and demonstrate Used By checks before deleting a shared Object.
- [ ] Change a comparison Test to an existence-only requirement through explicit schema-backed branch selection; add/remove field/record/group predicates; validate removal/replacement of required nodes.
- [ ] Exercise stale documents, malformed/partial YAML, no-op byte identity, minimal source diffs, comments/quotes/flow maps, native Undo/Redo, Red Hat YAML diagnostics, and actual VS Code host tests. No separate YAML truth store.
- [ ] Remain fully offline and avoid runtime PASS/FAIL claims; no merge of candidate PR #21 without separate review.

The standalone HTML remains illustrative UX research. Codex must implement the full P1 lifecycle in the actual pinned schema-driven Graphical editor, not copy fixed demo arrays or pretend an incomplete Assessment is validated.


## UX amendment — compact canvas, right-click context menus (2026-11-05)

The owner specifically prefers the **wide, compact, well-organized original screenshot**. Treat context menus as the **primary structural edit affordance** rather than permanently visible Add/Remove/Duplicate buttons. The HTML prototype's visible buttons are scaffolding to demonstrate operations, NOT the target UI density.

- Outline node single-click selects and displays the node's properties; double-click focuses an edit. Right-click opens a schema- and node-specific menu. Apply this consistently to Tests, Objects, Variables, Inputs, Filters, Sets and their operands, Require, field/record conditions and nested expression/group nodes. Allow right-click on an empty group or section header to add its first child.
- Example Test menu: Add Test, Duplicate, Rename, Move, Delete, Reveal in YAML. Example Require menu: Replace requirement branch, Add Field/Condition, Duplicate/Remove optional branch, Reveal. Example Set menu: Add Object/Nested Set operand, Change operation, Add Filter; an Object operand should expose its own Filter operations. Example Variable menu: Add/Duplicate/Rename/Delete, Find Uses.
- **No permanent action-button rows** on every card or field. Use minimal disclosure affordances: an ellipsis on selected/hovered/focused items, brief one-time "Right-click for actions" help, and a contextual menu triggered from section headers or outline.
- Keyboard parity: Shift+F10/context-menu key for focused node, arrows for outline navigation, Enter for editing, visual focus treatment and screen-reader labels. Menu actions should be available via a small ellipsis or VS Code commands for users who cannot right-click.
- Do not hijack context menus in native YAML or editable text fields (copy/cut/paste still needed). Prevent webview built-in handling only for appropriate non-text structural nodes.
- Menu availability is **schema-driven** and must honor node context, actual capability, required-vs-optional properties, source references, Set cardinality and expression branch. Explain disabled operations. Never treat a required Test 'require' removal as a valid completed state.
- High-risk Remove/Rename must expose affected references and proposed YAML diff before applying. Honor one canonical TextDocument, stale edit/version protection, native Undo/Redo and no-op byte identity.
- Test the interaction in a real Extension Development Host at wide and narrow monitor widths and in high contrast. Verify context menu placement, overflow, keyboard navigation, no redundant permanent buttons, and no right-click regression in native YAML.

The target layout is a clean left Assessment outline, a large central content canvas, optional collapsible right help/diagnostics sidebar, and compact cards in sensible authoring order. Never sacrifice completeness merely for fewer controls.


## Desktop layout correction (owner, 2026-11-05) — master-detail tree is mandatory

Work Codex has produced several unsatisfactory smartphone-like UI attempts where a basic form takes the entire editor. The owner wants the **hierarchical Assessment tree on the left and an editor for ONLY the selected node in the center**, with an optional narrow context-sensitive Help/Diagnostics panel at right. This is the *primary* desired UX. See [Issue #44 desktop master-detail acceptance](https://github.com/vanderpol/scap-ng-vscode/issues/44).

- **Document-local tree always visible at desktop widths in Graphical mode:** Assessment → Overview, Inputs, Variables (with expression child nodes), Shared Objects, Tests (with Object/Filters or Set operands/Filters, Require/item & field requirements/field or grouped conditions, reported elements), Evaluate. This is different from the workspace STIG Library / existing activity sidebar.
- **Center single-selection property inspector:** click Object → only Object selector/acquisition fields; click a Filter → only that filter predicate/action; click Variable → selected declaration/expression; click Test → its title/capability/summary; click a nested Require group → that group. Do not render all Assessment/Test sections on screen at once.
- **Compact desktop density:** fixed/resizeable modest tree width, large working canvas, optional collapsible right help. No giant cards with whitespace or mobile-style wizard stacking; small schema-derived form controls can align in compact grid rows. Preserve tree selection/expansion during editing.
- **Context menus first:** right-click node and empty collection headings for Add/Duplicate/Rename/Move/Remove/Replace/Reveal in YAML, with keyboard Shift+F10 and subtle ellipsis equivalent. No always-visible CRUD buttons on every field; do not intercept native text-field context menus.
- **Actual host screenshot is mandatory:** demonstrate the same 1920×1080 view displaying tree + small selected Object form + help simultaneously, with abundant unused vertical space rather than one form consuming the screen. Also prove selected Test, Variable nested expression, Filter, Set operand, Require group and Evaluate show separate center editors.
- **Blank slate still required:** tree nodes and their context menus must let an author construct complete complex Assessments from nothing; do not trade feature coverage for density. No schema invention, no duplicated TextDocument, no regression of YAML-first.
- **Prototype qualification:** the original HTML spike currently displays multiple cards and is only an illustrative first attempt. Its exact layout is **superseded** by this tree-and-single-property-inspector decision for production design; adapt its aesthetics and controls but NOT its all-cards-visible structure.

## Short Codex launch

Work vanderpol/scap-ng-vscode issue #44. Read docs/prototypes/README-issue-44.md and issue-44-graphical-editor.html from branch design/issue-44-graphical-prototype-20261104. Adapt existing schema-driven Graphical UI; do not replace the YAML editor or merge PR #21. Implement in tested draft PRs.
