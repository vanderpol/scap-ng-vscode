# SCAP-NG Assessment Studio — VS Code editor blueprint

**Status:** implementation guidance for an open-source pre-alpha extension. This document describes product design decisions and a staged delivery strategy; it **does not** change SCAP-NG 0.4 normative grammar or prescribe a future OVAL Board outcome.

See [AGENTS.md](../AGENTS.md) for operating rules and [the SCAP-NG primer](SCAP-NG-PRIMER.md) for domain terminology. Canonical schema and behavior remain in [vanderpol/scap-ng](https://github.com/vanderpol/scap-ng/tree/main/schema/v0.4.0) at an explicitly pinned source SHA.

## Product goal and audience

Enable security-content authors to create, review and maintain native SCAP-NG automated/manual Assessments and Rules in an **offline** VS Code workspace, using either direct YAML editing, complete graphical editing, or a conversational-style guided wizard. Beginners should not need to memorize YAML structure. Experts must be able to edit every permitted field and retain precise source control.

The VS Code extension is a **separate repository** and may be built in parallel with the upstream converter. Do not edit converter/schema repositories or rely on their ongoing uncommitted state. Compatibility moves through version-pinned artifacts and documented updates.

## Information architecture

Primary activity container: **SCAP-NG Assessment Studio**.

Child sections/views:

- **STIG Library:** Search/browse Benchmarks (RHEL 8/9, Oracle Linux, Windows, UNIX, applications and future platforms), their Rules, Profiles and selected Assessments. Designed for ~100 STIGs; lazy expand, filter and quick search instead of a single expanded hierarchy.
- **Assessment Library:** All automated/manual and standalone Assessments; filter by platform authoring context, capability, class/purpose, schema version, references and diagnostics.
- **Shared/Used By:** Reverse reference view; show exact Rule and Benchmark consumers, duplicate IDs and candidate exact-duplicate fingerprints. Do not silently merge source content.
- **Problems/Validation:** Group parse/schema/reference/compile issues and draft warnings, each linking to exact source location.
- **Authoring:** Open document editor has tabs/toggles **Source / Structured / Guided**, retaining a single canonical TextDocument.
- **Sample Data/Evaluation (later):** Input fixtures, invoke real local evaluation adapter, show decisive evidence and result status. Without evaluator, explain unavailable rather than guessing.

A standalone Assessment can be created/opened before choosing a STIG; the STIG Library must not be a prerequisite.

## Modes and their boundaries

### Source mode

Use the native YAML editor, linked pinned JSON Schema where possible. Offer syntax highlighting, completion, hover, precise errors and command to "Open Structured". If Red Hat YAML is installed, interoperate rather than duplicate its language server. Include "Reveal in Source" from graphical nodes.

### Structured mode

Schema-driven full editing of all fields, with stable property ordering for presentation (not semantics). Use friendly labels from versioned vocabulary and exact values/enums from schema/capability contracts. Required enumerations → dropdown; free text → text/multiline; numeric/Boolean/optional/null controls; dynamic map key editing; lists and nested objects.

Specialized controls are needed for:

- Named Tests and dynamically typed Objects, Sources, Variables.
- Record/member field names and typed predicates.
- Arrays, one-or-many values, explicit Items/Field/Record cardinality and comparison operators.
- Local inline Object and referenced `shared_objects`.
- `and`/`or`/`one`/`xor` nested alternatives with visible operator labels and drag/reorder only when semantics-preserving.
- Test `require` and multi-Test `evaluate` must be distinct editors.
- Source/evidence, inputs and provenance without dropping unfamiliar schema-permitted metadata.

Every accepted native field must be editable. If specialized widget support is missing, fall back to a schema-checked generic property editor rather than hiding the field.

### Guided mode

Step 1 — Platform authoring context (Windows/Linux/UNIX initially, extensible, not implicit CPE applicability).

Step 2 — Standalone Assessment or attach/reference from an existing Rule/Benchmark.

Step 3 — Title, class/purpose, manual vs automated.

Step 4 — For each automated Test, choose capability; show available acquisition/Source/Object prompts dynamically from pinned capability contract.

Step 5 — Choose collected-Item requirement; show explicit `items_found` and `items_satisfying` counts. Prompt for field and record existence **separately** from matching. Use the versioned authoring vocabulary; no hidden quantifier defaults.

Step 6 — Configure typed comparisons, regex, and/or alternatives. Show `one` = exactly one and `xor` = odd parity as distinct choices.

Step 7 — Support additional Tests, Variables/Set/Filter/dependent sources and explicit Evaluate tree. An author may switch to Structured/Source instead of being blocked by wizard complexity.

Step 8 — Review full generated YAML + schema diagnostics; never call it a compliance PASS.

Manual Assessment branch: instructions, checks, human inputs and provenance instead of automated Test commands.

Do not call logical group nodes "Item 1/Item 2"; show capability, selected fields and meaning.

## Document model and safe roundtrip

**Highest engineering risk is source rewriting.** A graphical editor that destroys comments/formatting is unacceptable in Git workflows.

- Editor host owns the open `vscode.TextDocument`; webview receives a serializable view model and source-range mapping, not raw filesystem authority.
- Parse YAML preserving concrete source spans, comments, anchors/aliases, node style (flow/block), quotes and order. Keep parsing/formatting and graph indexing separately testable.
- Graphical edit → minimal, atomic `WorkspaceEdit` against the original TextDocument range. Let VS Code provide undo/redo and dirty-state/save semantics.
- External editor changes/other extensions trigger reparse and refresh, with debounce/cancellation and stale-edit conflict handling.
- No-op open → save must be byte identical. Single scalar edit should change only relevant lines/bytes, leaving unrelated comments and inline mappings untouched. Do not "prettify" entire documents on save.
- If operation requires potentially destructive rewriting, preview a diff and ask approval; if no safe edit is possible, open Source mode with a clear explanation.
- Test YAML anchors, aliases, multiline blocks, unusual quotes/escapes, Unicode, comments, duplicate YAML keys, empty/null values and newline styles. Treat a parse error as recoverable; never overwrite the original file.
- Keep XML/JSON support as later import/review modes if justified. Native editor targets versioned YAML first.

**Thin-slice acceptance:** Open a real 0.4 Assessment → edit an enum or string in Structured mode → Source updates immediately → undo/redo works → only that source range changed → schema validation reruns → no-op save is byte identical.

## Workspace discovery, indexing and scaling

Index each document with `{id, kind, version, uri, currentScope, sourceHash, diagnostics}` and all outgoing references. Build reverse Rule/Benchmark "Used by" graph; cache/incrementally update on file changes. Report duplicate IDs and unresolved/ambiguous references rather than guessing. Use indexed IDs, not filesystem paths, in YAML references.

Current authoring validators may enforce per-Benchmark/local/shared scope. Respect them. Proposed future path-independent authoring is a separate upstream decision, not something editor can silently impose. Likewise exact-equivalence normalization can **suggest** reuse but requires review before changing IDs or references.

Design for 100 STIGs, many thousands of Rules/Assessments, lazy child expansion, indexed search and cancellation; don't parse/re-render entire corpus on every keystroke. Support multi-root workspaces, Windows/Linux paths, symlinks safely, folder exclusion and offline storage. File rename/move refactoring must be explicit and graph-validated.

## Validation and source trust

Show independent status channels:

1. YAML syntax and duplicate-key errors.
2. Version-pinned JSON Schema validation.
3. Capability/enum and cross-file reference graph.
4. Optional local compiler/package consumer verification.
5. Original conversion provenance `CONVERTED_VERIFIED`/`CONVERTED_UNVERIFIED`/`BLOCKED`.
6. Runtime scanner results **only when executed by an actual compatible evaluator**.

Don't infer semantic proof from schema-valid YAML. No fabricated non-existing Items. `all_exist` draft normalizations and catalog `ds:uri` compatibility retain warnings and source attribution. Unknown/incomplete/error evidence is distinct from passing.

VS Code diagnostics should link to exact source range and support quick fixes only when safe; avoid changing semantic logic behind the author's back. A warning is not a hard parsing error, and a successful compile is not a scan.

## Architecture recommendation

- **TypeScript VS Code extension host:** activation, file watchers, TreeDataProvider, workspace index, diagnostics, commands, ToolchainAdapter.
- **CustomTextEditorProvider:** Webview UI anchored to VS Code TextDocument with WorkspaceEdit and message protocol; no private auto-save.
- **React webview:** Assessment Studio navigation panel, reusable tree/form, guided steps, Test/require/evaluate visualizations, diff preview. Respect VS Code theme/high contrast and keyboard accessibility.
- **Schemas/CapabilityAdapter:** pinned SHA, JSON Schema validator, capability mapping and human vocabulary loaded consistently; check hash/version on startup. Prefer local approved toolchain path for unbundled contracts.
- **YAML SourcePatch module:** AST/CST source ranges, atomic minimally scoped text patches, format-preserving regression corpus.
- **Local ToolchainAdapter:** invoke version-compatible approved CLI in explicit opt-in actions with exit codes/structured diagnostics; safe timeouts/cancellation; never invoke arbitrary shellcode from YAML.
- **Optional AI adapter (later):** provider-configurable, defaults off, local model support, explicit review of proposed edits; no secrets/source sent remotely without affirmative consent.
- **Optional evaluator (later):** no pretend execution; invoke scanner only when a real verified evaluator is available.

Prefer a small number of well-understood modules and straightforward tests to a large abstraction framework.

## Open-source components worth evaluating

| Project | Useful capability | License/constraint |
| --- | --- | --- |
| [Red Hat YAML](https://github.com/redhat-developer/vscode-yaml) / [language server](https://github.com/redhat-developer/yaml-language-server) | VS Code YAML syntax, schema completion, hover/diagnostics | MIT; prefer interoperability |
| [Visual JSON](https://github.com/vercel-labs/visual-json) | Tree/Form/Diff React components, schema-driven YAML visual editing | Apache-2.0; evaluate lossless roundtrip and package quality first |
| [React JSON Schema Form](https://github.com/rjsf-team/react-jsonschema-form) | Generic fallback form fields generated from JSON Schema | Apache-2.0; guided logic still custom |
| [Monokle](https://github.com/kubeshop/vscode-monokle) | Resource/reference navigation and grouped policy diagnostics | MIT; UX inspiration |
| [Spectral](https://github.com/stoplightio/spectral) | Custom YAML/JSON style/structural lint rules | Apache-2.0; evaluate dependency weight |
| [VS Code Custom Editors](https://code.visualstudio.com/api/extension-guides/custom-editors) | Native text-document/webview lifecycle, WorkspaceEdit | Official API; preferred integration |

**Important:** [Kariamos/openapi-visual-editor](https://github.com/Kariamos/openapi-visual-editor) has a restrictive source-available license. Its documented "Reveal in YAML" and minimal-diff UX are ideas worth considering; **do not copy code**.

Before adopting any dependency, verify exact current license, dependency tree, packaging size, maintenance and offline redistributability; record in acknowledgements/NOTICE as required. Code from the upstream SCAP-NG repo also needs a separate license/permission review.

## Product safety, quality and accessibility

- No internet, telemetry, account or AI requirement; all core workflows work without network.
- No automatic downloads/updates of schema or content; user chooses local toolchain and pinned contracts. Optional external links are not data uploads.
- Treat YAML and generated descriptions as untrusted data; sanitize webview rendering and use CSP. No arbitrary commands from authored shellcommand content.
- VS Code light/dark/high contrast, screen readers, focus/keyboard navigation, usable undo/redo and save indicators.
- Unit tests for parsing/indexing and source patches; VS Code extension-host integration tests for Custom Editor lifecycle and file changes; snapshot/golden tests on real pinned 0.4 fixture shapes.
- Build/lint/test/pack VSIX in CI. Check cold offline installation, no unexpected network requests and no schema mismatch.
- Supply README screenshots/demo with **real schema-valid** 0.4 content; avoid outdated examples, null `object_title` in showcase when a descriptive title is available, and other poor demo defaults.

## Ordered delivery phases

**P0 — Bootstrap and contract pinning:** installable VSIX skeleton, TypeScript tests/CI, canonical schema selection and version display, one known-good 0.4 fixture, validation adapter. No scanner.

**P1 — Reliable Source ↔ Structured thin slice:** CustomTextEditorProvider; parse/format-preserving source-range edits; full generic schema field editing; one Test `require`; undo/redo; byte-for-byte no-op.

**P2 — Assessment Studio workspace index:** child STIG Library, Assessment Library, ID/reference index, Used By, search, duplicate/missing ref diagnostics and performance fixture.

**P3 — Guided authoring:** platform → standalone/tied Assessment → capability/Object → explicit existence/matching → AND/OR/XOR/ONE alternatives → multi-Test Evaluate; manual mode and dynamic fields. Source/Structured access always available.

**P4 — Compiler/evidence integration:** optional local compiler/verifier, warning/status separation, sample-data UI scaffold with no fabricated evaluation, diagnostics/provenance navigation.

**P5 — Offline release quality:** pinned offline packaging, permissions/license notices, accessibility, user docs, VSIX smoke and multi-platform host checks. AI integration is an optional subsequent increment.

Implement these as small independently verifiable commits. **Never make the first runnable UI wait for all six phases.**

## MVP acceptance checklist

- [ ] Load a standalone v0.4.0 Assessment from local workspace without a Benchmark.
- [ ] Source, Structured and Guided modes edit the same file.
- [ ] At least one complex multi-Test/`require` sample works, plus a manual Assessment.
- [ ] Every schema-permitted field has an editable generic or specialized control; record-member names included.
- [ ] Generated logic and serialized enums match exact pinned 0.4 schema.
- [ ] No-op save preserves every byte; small edits do not change unrelated YAML comments or formatting; undo/redo works.
- [ ] STIG Library is inside Assessment Studio, searchable, lazy and scales to an indexed fixture of many documents.
- [ ] References resolve by logical ID with duplicates/dangling links visible; no silent directory-based guesses.
- [ ] Errors, warnings, proofs and runtime results are distinctly labeled.
- [ ] Fresh offline installation from VSIX works without credentials, network, AI or a scanner.
- [ ] No unlicensed upstream material or non-permissively licensed third-party code is copied.
