# AGENTS.md — SCAP-NG VS Code Assessment Studio

## Mission and required reading

Build a **standalone, open-source, offline-first VS Code editor** for drafting, inspecting and maintaining SCAP-NG 0.4.0 content. The editor is **not** the compliance scanner, OVAL evaluator, converter, standards authority or source-of-truth for Assessment semantics.

Before coding, read this file, [SCAP-NG primer](docs/SCAP-NG-PRIMER.md), [editor blueprint](docs/EDITOR-BLUEPRINT.md), [one-clone workspace setup](docs/WORKSPACE-BOOTSTRAP.md) and the numbered GitHub implementation issues. Use their acceptance criteria for incremental working deliveries.

**Clean-clone setup (Linux):** Clone only this `scap-ng-vscode` repository. `dependency-pins.json` is the source of truth for optional local public checkouts; `schema-profile.json` pins the complete editor pack. `npm run bootstrap:deps` fetches exact public commits into ignored `.external/`; after installing the tools Python dependencies, `npm run bootstrap:pack` builds and byte-verifies the offline pack, and `npm run verify:offline` checks all resources without a network lookup. Never use moving `main`, private research or unavailable paths as hidden prerequisites. A full 65-stream library is **not** part of bootstrap: its historical review ZIP predates the owner-amended grammar and requires a newly qualified pinned artifact.

**Owner direction recorded 2026-10-31 and 2026-11-02:** [Schema-driven authoring help, explicit hideable defaults, and offline regex/sample-data playground](docs/SCHEMA-DRIVEN-HELP-AND-PLAYGROUND.md) is now a required product acceptance contract; track implementation in [issue #7](https://github.com/vanderpol/scap-ng-vscode/issues/7). Persist editor-generated human-readable Test summaries in native `test_title` as specified in [issue #8](https://github.com/vanderpol/scap-ng-vscode/issues/8). Neither feature may fabricate scanner PASS/FAIL. Do not hard-code a competing documentation/default/enum registry.

## Historical corpus exclusion — required safety gate (2026-11-02)

**Do not train the Guided/Structured UI, derive authoring templates, write golden tests, or infer current syntax from the October 30 all-65 DRAFT or normalized review ZIPs.** The owner inspected a Windows Assessment from that archive and found outdated `assessments/local/<opaque-generated-name>/...` structure and noisy per-field `values_found`/`values_matching` rather than current, compact Test-wide requirements. These archives deliberately preserved old YAML and predate the owner-approved November 2 grouped `item_requirement` amendment. Their proofs apply only to their pinned historical snapshots.

The editor's **sole authoring grammar and examples** come from the exact canonical `scap-ng` schema commit and the matching, hash-verified small sample-data commit in `dependency-pins.json`. The historical library may be opened **only as explicitly user-selected legacy data**, labeled *historical / not current-schema qualified*. Never silently auto-import, repair, rewrite, normalize, or promote old corpus Tests to current examples. When a newly regenerated 65-stream library is available, require an explicit updated schema pin, schema-validation report, source/proof provenance, readable path and naming audit, and reviewed dependency change before integrating it into the editor sample library. See [evidence issue #1](https://github.com/vanderpol/scap-ng-evidence/issues/1).

## Canonical contracts and version pinning

- Canonical public source: [vanderpol/scap-ng](https://github.com/vanderpol/scap-ng/tree/7b9b61108aa30a601828268576308e510477094e), especially the **flat** [0.4 schema directory](https://github.com/vanderpol/scap-ng/tree/7b9b61108aa30a601828268576308e510477094e/schema), [schema README](https://github.com/vanderpol/scap-ng/blob/7b9b61108aa30a601828268576308e510477094e/schema/README.md), [authoring vocabulary](https://github.com/vanderpol/scap-ng/blob/7b9b61108aa30a601828268576308e510477094e/schema/authoring-vocabulary.en.json), [current examples](https://github.com/vanderpol/scap-ng/tree/7b9b61108aa30a601828268576308e510477094e/examples) and [generated reference](https://github.com/vanderpol/scap-ng/blob/7b9b61108aa30a601828268576308e510477094e/docs/generated/schema-reference.md).
- Shared offline converter/authoring utilities and the [editor-pack export procedure](https://github.com/vanderpol/scap-ng-tools/blob/1f4f74d215ecb6ac16ded2da9bfe447a9dc45a42/docs/EDITOR-PACK-CUTOVER.md) live in public `vanderpol/scap-ng-tools`. The previous research repository is private and **must not** be required to build, test, or implement this extension.
- **Pin the exact upstream Git commit used for each editor build** and expose the version/SHA in About/diagnostics. Do not treat moving `main` as a release version; never mix schema, mappings and vocabulary from different commits. Avoid old 0.3 or historical 0.4-A examples.
- Canonical **owner-amended pre-release 0.4** uses Test-local `capability` and `require`. A comparison Test serializes `item_requirement: {items_found: one_or_more, items_satisfying: every}` before sibling `field_requirement: {values_found: one_or_more, values_matching: every}`. Presence-only Tests retain only `item_requirement.items_found`; Result wire fields are separate and unchanged. These controls are schema-driven, never hidden runtime defaults. Logical `and`, `or`, `one`, `xor` are different: `one` means exactly one, `xor` means odd parity. Do not reintroduce named `states` or `states_match`, `select`/`collect` wrappers, or old ungrouped Item keys.
- **Presentation order is an editor acceptance contract**, reflected in the pinned schema property declarations and current examples: show `item_requirement`, then `field_requirement`, then `fields`. Prefer a one-line complete `fields` map for short simple predicates (e.g. `fields: {type: {equals: dword}, value: {equals: 1}}`), but keep complex regex/logic readable as a block. Never reorder an existing valid document merely by opening/saving it. Regression tests cover the declared and actual layout.
- **Important exporter boundary:** The 236-resource metadata-pack builder sorts JSON object keys for deterministic hashes, so `Object.keys(pack.resource(...).properties)` does **not** preserve the original JSON Schema declaration/presentation order. Consume the pinned canonical source's order or extend the reviewed exporter with derived order metadata before implementing forms; do not hand-maintain a second hardcoded order registry. The rendered editor must be tested against the canonical examples, not alphabetically ordered pack keys.
- The versioned `authoring-vocabulary.en.json` provides English labels and guided prompts, **not grammar or enum values**. The corresponding JSON Schemas and capability mappings govern serialized tokens.
- The upstream source repository does not necessarily grant a blanket code/content redistribution license. **Do not copy or vendor its code/schema/content without checking permissions**. Support an explicitly selected local toolchain/schema and, when permitted, bundle an offline pinned copy with checksums.

## Non-negotiable product design

- **Assessment Studio** is the extension's main activity view; **STIG Library is a child view/section within it**, not a separate top-level sibling. Design for ~100 STIGs and thousands of Rules, with search, filters and lazy expansion.
- Source / Structured / Guided modes are synchronized views of **one underlying VS Code TextDocument**. Use `CustomTextEditorProvider`, `WorkspaceEdit` and undo/redo where feasible. Never maintain competing truth copies.
- Standalone Assessment authoring is first class (no Benchmark/STIG required). Manual and automated Assessments are different modes. Rules contain policy; Assessments contain checks.
- Guided mode starts with target platform context (Windows/Linux/UNIX initially, extensible), then capability → source/Object → explicit require/Item and Field counts → logical alternatives → optional Variables/multi-Test Evaluate. Choosing a platform does **not** implicitly assert CPE/applicability.
- **Every schema field must be editable**: enums via dropdowns, other values via appropriate control, editable dynamic record-member names and keys, arrays and nested logical trees. Preserve exact native enum tokens when serializing.
- Inline one-line Object/require YAML and readable block YAML must both be supported. Preserve comments, anchors/aliases, quoting, flow style, indentation and untouched bytes whenever possible. No-op open/save must be byte-identical. If a graphical edit cannot be made safely without destroying unrelated material, show a proposed diff/ask approval or decline the edit; **never silently reserialize the entire file**.
- Build an index of document ID → file URI, version, type, current scope and reverse Rule→Assessment usages. Detect duplicate IDs, wrong kind, dangling references and incompatible versions. Don't derive identity from source path or require authors to enter paths in Rule YAML. The current compiler can enforce local/shared scope; do not secretly relax it before a versioned owner decision.
- Display "Used by" references and source locations. Treat a file's physical location separately from actual reuse by Rules/Benchmarks. Shared Assessment normalization is **not** a silent editor save operation.
- Diagnostics must distinguish parse errors, schema errors, graph errors, compiler errors, draft compatibility warnings, independent semantic proof and runtime evaluation. Neither AI nor the editor may invent compliance PASS/FAIL results.

## Working architecture

1. Extension host (TypeScript): local workspace file discovery, ID graph, diagnostics, toolchain invocation, VS Code commands and safe webview messaging.
2. YAML/document layer: source ranges, minimal AST/token edits, lossless no-op roundtrip, external edit reconciliation.
3. Schema adapter: version-pinned JSON Schema validation, capability enums, vocabulary prompts; no hand-maintained duplicate enum registry.
4. UI: searchable Assessment Studio tree + graphical Structured view + Guided wizard + native YAML Source view, all desktop/keyboard/theme accessible.
5. Local validation adapter: call the version-compatible SCAP-NG compiler/verifier when available; report clear unavailable state instead of guessing.
6. Required offline regex tester and staged sample-Item playground: editor regex/value previews must declare their dialect/qualification; full Assessment evaluation is unavailable until a qualified local evaluator exists. Optional configurable AI provider stays opt-in.

No telemetry or network by default. Do not upload STIGs, source, credentials, evidence or sample data without explicit consent. Support offline installation, no mandatory login, restrictive webview CSP, safe rendering, user-approved external provider configuration and secrets stored through VS Code secret storage where relevant.

## Third-party reference and licensing policy

- Evaluate Red Hat YAML (MIT), Visual JSON (Apache-2.0), React JSON Schema Form (Apache-2.0), Monokle (MIT), Spectral (Apache-2.0). Pin dependencies; include notices.
- **Kariamos/openapi-visual-editor is source-available under restrictive terms, NOT open-source for code reuse**. Inspiration for UI is fine; do not import/copy its code.
- Avoid bundling redundant YAML language servers; interoperate with Red Hat YAML/schema support if installed, but the editor must remain usable without it.

## Implementation workflow

- Repo license: Apache-2.0. **Company Codex works on purpose-named branches and submits Pull Requests to `main`; no direct main pushes.** Make cohesive commits, bounded tests and working checkpoints. All task instructions must be self-contained in this GitHub repository (issues, docs and code), without links to ChatGPT or private research. Only this checkout is required; optional exact public inputs are obtained by the bootstrap script and must stay in ignored `.external/`. Do not commit modified external checkouts or corpus artifacts into this repo.
- **Start with a vertical slice**: open one real pinned v0.4 Assessment → Structured view → edit one field → targeted YAML patch → undo/redo → no-op save byte identity → schema revalidation. Expand into workspace tree and Guided mode, rather than building a giant framework before testing.
- Unit and integration tests should cover malformed YAML, schema enums, logical one vs xor, arrays, record field names, unknown capability, duplicate IDs, broken Rule references, unsaved editor changes, external edits, comments, anchors, inline mappings, Windows/Linux paths, offline operation and stale-version handling.
- Add npm scripts for build, test, lint, packaging and VS Code extension-host tests. Keep CI deterministic; no 65-STIG corpus or expensive OVAL semantic proof in this repo.
- Do not change upstream SCAP-NG schemas, converter or scanner within this editor project. File a pinned upstream issue for real contract ambiguity; proceed with unrelated work.
- Do not overwrite another Codex agent's pending edits; inspect branch, current commit and worktree before restructuring.
- Prefer runnable code and screenshots/GIF evidence of real behavior to lengthy planning-only checkpoints. Keep README, docs and issues synchronized.

## MVP definition of done

A user can install an offline VSIX, open a folder containing valid 0.4 content or a standalone Assessment, browse a searchable STIG/Assessment index, switch Source/Structured/Guided, edit all applicable fields, follow Rule→Assessment links, validate accurately, save without unrelated formatting changes and see clear warning/proof boundaries. A practical offline regex tester, schema-driven help and safe sample-data input are MVP requirements; full sample-data Assessment evaluation must wait for a qualified real local evaluator and must never fabricate results.
