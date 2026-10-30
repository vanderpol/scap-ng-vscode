# AGENTS.md — SCAP-NG VS Code Assessment Studio

## Mission and required reading

Build a **standalone, open-source, offline-first VS Code editor** for drafting, inspecting and maintaining SCAP-NG 0.4.0 content. The editor is **not** the compliance scanner, OVAL evaluator, converter, standards authority or source-of-truth for Assessment semantics.

Before coding, read this file, [SCAP-NG primer](docs/SCAP-NG-PRIMER.md), [editor blueprint](docs/EDITOR-BLUEPRINT.md) and the numbered GitHub implementation issues. Use the acceptance criteria in those issues to make incremental working deliveries.

## Canonical contracts and version pinning

- Canonical source: [vanderpol/scap-ng](https://github.com/vanderpol/scap-ng), especially [0.4.0 schema directory](https://github.com/vanderpol/scap-ng/tree/main/schema/v0.4.0), [schema README](https://github.com/vanderpol/scap-ng/blob/main/schema/v0.4.0/README.md), [authoring vocabulary](https://github.com/vanderpol/scap-ng/blob/main/schema/v0.4.0/authoring-vocabulary.en.json), and [release-candidate guide](https://github.com/vanderpol/scap-ng/blob/main/docs/releases/0.4.0-rc.md).
- **Pin the exact upstream Git commit used for each editor build** and expose the version/SHA in About/diagnostics. Do not treat moving `main` as a release version; never mix schema, mappings and vocabulary from different commits. Avoid old 0.3 or historical 0.4-A examples.
- Canonical 0.4 uses Test-local `capability` and `require` (including `items_found`/`items_satisfying`); Field/Record cardinality and matching policies are explicit. Logical `and`, `or`, `one`, `xor` are different: `one` means exactly one, `xor` means odd parity. Do not reintroduce named `states` or `states_match`, `select`/`collect` wrappers, or silent defaults.
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
6. Optional future sample evaluator and configurable AI provider: opt-in and separate from scanner truth.

No telemetry or network by default. Do not upload STIGs, source, credentials, evidence or sample data without explicit consent. Support offline installation, no mandatory login, restrictive webview CSP, safe rendering, user-approved external provider configuration and secrets stored through VS Code secret storage where relevant.

## Third-party reference and licensing policy

- Evaluate Red Hat YAML (MIT), Visual JSON (Apache-2.0), React JSON Schema Form (Apache-2.0), Monokle (MIT), Spectral (Apache-2.0). Pin dependencies; include notices.
- **Kariamos/openapi-visual-editor is source-available under restrictive terms, NOT open-source for code reuse**. Inspiration for UI is fine; do not import/copy its code.
- Avoid bundling redundant YAML language servers; interoperate with Red Hat YAML/schema support if installed, but the editor must remain usable without it.

## Implementation workflow

- Repo license: Apache-2.0. Work on `main` in pre-alpha unless a branch purpose is documented. Make cohesive commits, bounded tests and working checkpoints.
- **Start with a vertical slice**: open one real pinned v0.4 Assessment → Structured view → edit one field → targeted YAML patch → undo/redo → no-op save byte identity → schema revalidation. Expand into workspace tree and Guided mode, rather than building a giant framework before testing.
- Unit and integration tests should cover malformed YAML, schema enums, logical one vs xor, arrays, record field names, unknown capability, duplicate IDs, broken Rule references, unsaved editor changes, external edits, comments, anchors, inline mappings, Windows/Linux paths, offline operation and stale-version handling.
- Add npm scripts for build, test, lint, packaging and VS Code extension-host tests. Keep CI deterministic; no 65-STIG corpus or expensive OVAL semantic proof in this repo.
- Do not change upstream SCAP-NG schemas, converter or scanner within this editor project. File a pinned upstream issue for real contract ambiguity; proceed with unrelated work.
- Do not overwrite another Codex agent's pending edits; inspect branch, current commit and worktree before restructuring.
- Prefer runnable code and screenshots/GIF evidence of real behavior to lengthy planning-only checkpoints. Keep README, docs and issues synchronized.

## MVP definition of done

A user can install an offline VSIX, open a folder containing valid 0.4 content or a standalone Assessment, browse a searchable STIG/Assessment index, switch Source/Structured/Guided, edit all applicable fields, follow Rule→Assessment links, validate accurately, save without unrelated formatting changes and see clear warning/proof boundaries. A sample-data evaluation feature may wait for a real local evaluator, but must never fabricate results.
