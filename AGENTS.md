## MANDATORY ALL-TASK CODEX SELF-AUDIT — OWNER POLICY 2026-11-21

Before claiming ANY SCAP-NG engineering task complete, perform an adversarial semantic self-review and correct defects: verify normative sources and actual inputs/outputs, challenge expectations independently of generators, use negative and mutation/metamorphic tests, reconcile source pins and current-head CI, and report explicit unqualified holds. A green test suite alone is not sufficient. Read and follow the shared [standing quality gates](https://github.com/vanderpol/scap-ng/blob/main/docs/engineering/CODEX-QUALITY-GATES.md). Human independent review still follows. This adds a mandatory step without superseding existing security, single-version, or prompt-mainline merge policies.

---

# P0 OWNER DIRECTIVE — EDITOR MUST USE CURRENT SINGLE SCAP-NG 0.4.1 (2026-11-19)

**Active, mandatory authoring specification: canonical `vanderpol/scap-ng` flat `schema/`, version `0.4.1` only.** The editor is now repinned to canonical `d1ab0283e09369c2c734d3b8f93b65007441cf07`; the previous `f51ab2c5` pack was a historical migration checkpoint and is not an active authoring contract. The active editor pack is 238 resources with 101 reviewed capabilities; four canonical ESX mappings remain explicitly experimental/proposed and are not silently promoted.

**Immediate task:** complete current source-preserving Graphical Rule changes in [PR #67](https://github.com/vanderpol/scap-ng-vscode/pull/67) without rewriting them, then give [Editor Issue #65](https://github.com/vanderpol/scap-ng-vscode/issues/65) highest priority **before additional substantial GUI/CRUD/wizard features**. Do not interrupt an in-flight installer/test; preserve the current 0.4.0 VSIX only as historical rollback, never current authoring. Merge reviewable completed increments per mainline policy.

**The official 0.4.1 pack must be generated, not requested as a separate mystery artifact.** Use exact current canonical `vanderpol/scap-ng/main` commit and its full `schema/` JSON Schemas, capability mappings, vocabulary, native selector metadata and current reviewed examples. Use the public Tools editor-pack exporter or repair it to reproduce current canonical 0.4.1 resources. Verify the pack's manifest/commit/digests, offline dependency closure, resource identities, schemas/URIs, validators, enum/field help and examples. **No manual change of the version label**, no reuse of the obsolete 0.4.0 pack with a 0.4.1 string, no private research dependency, no moving-`main` pin, no silent dual-version fallback.

1. First audit `schema-profile.json`, `dependency-pins.json`, generated metadata, VSIX contents and displayed About/diagnostics against the canonical `0.4.1` main SHA. Detect every stale `0.4.0`, obsolete `v0.4.0` schema URI, and old variable declaration datatype assumption.
2. Produce one reproducible 0.4.1 pack from exact canonical commit; record SHA-256 and all resource counts. Repin atomically in `schema-profile.json`, `dependency-pins.json`, pack manifest and editor runtime. Any genuine exporter incompatibility is a bounded Tools fix, not reason to continue developing against 0.4.0 indefinitely.
3. Qualify current `0.4.1` native Benchmarks, Rules, Assessments, applicability, organizational Inputs, Variables without declaration datatype, Evaluate/Require/Objects, results, and compact Graphical edits with both positive/negative JSON/YAML tests, comment/ordering/undo roundtrip, offline bootstrap, extension-host and real installed VSIX. Old 0.4.0 documents fail gracefully with a clear actionable migration diagnosis; never silently reinterpret or rewrite them.
4. Prevent recurrence: CI compares the **exact canonical version and pinned schema family** to the offline pack, fails on stale 0.4.0 runtime profiles/examples, and reports source commit and schema version at runtime. Schema-valid output **is not** RI execution proof.
5. Coordinate with [schema-first normative language audit #80](https://github.com/vanderpol/scap-ng/issues/80); the editor is a consumer of the canonical SCAP-NG language, **not** the authority that decides what OVAL features exist. Prioritize normative schema-driven editor behavior and current qualified converted content over historical sample ZIPs.
6. Every future Codex session MUST read this directive before continuing any older editor PR task. An older instruction that calls the 0.4.0 pack “correct”, or that advises developing more editor features on 0.4.0, is superseded. Report exact canonical SHA, source pack SHA, tests, installed VSIX build and unresolved blockers in the PR.

---

## OWNER-DIRECTED MAINLINE INTEGRATION POLICY — 2026-11-17 (takes precedence over older PR workflow)

The owner prioritizes **preserving implemented pre-alpha work in `main`** over accumulating open draft PRs. `main` is the active **development** baseline, not a claim of product readiness. This overrides older instructions to keep all development draft-only; security, source/provenance checks, test honesty, canonical version coordination, and release gates still apply.

- **Default: commit tested, reviewable increments promptly to `main`**, or open a short-lived PR targeting `main` and merge it at the end of the bounded task. Do not leave an implementation PR indefinitely unmerged just because broader runtime qualification is outstanding; document those known holds separately.
- **Maximum one dependent PR above a main-targeted integration PR** (stack depth two). Exception only with an explicit owner-approved dependency and a named consolidation date. Never start another stacked implementation when current stacked work could be integrated.
- **Check existing work before coding:** inspect `main`, open PR bases/SHAs and previous implementation before implementing a feature. Reconcile rather than duplicate. Every implementation must have a pushed commit, visible PR/merge receipt, tests/results, and disposition of related older PRs.
- **Merge promptly; review debt every working session:** inventory open PRs; for any older than 3 days, decide merge, repair, or explicit supersession. Treat more than five unmerged implementation PRs in one repo as an integration stop signal, not permission to begin more work.
- **Preserve ancestry when consolidating:** prefer merge commits over squash for long preexisting stacks, so Git commit reachability demonstrates what is in `main`. Never close or delete a branch merely because a newer PR exists; first verify the exact work is reachable or consciously superseded, record the evidence in PR comments, and retain divergent fixes.
- **No false green:** failing CI, pinned schema mismatches, external equivalence holds, and missing real-execution receipts remain visible open defects. A pre-alpha merge can be owner-authorized with such holds; a release qualification cannot. Do not disable tests/checks or fabricate evidence to get the merge through.
- **No silent cross-repo drift:** after changing canonical language, propagate exact schema digests to converter, RI and VS Code as a separate tracked integration issue. Avoid ad hoc pinned snapshots or parallel active versions.

Current integration checkpoint: **Editor still has active draft stacks; integrate in bounded slices**. Read live GitHub state before acting; all older PR-specific SHA instructions are historical.

---

## Integrated 0.4.1 baseline and development hold

PRs #67 and #68 are being consolidated on this mainline baseline. The active editor contract is exactly SCAP-NG 0.4.1 from
`scap-ng@d1ab0283e09369c2c734d3b8f93b65007441cf07`, with the reviewed editor-pack
exporter at `scap-ng-tools@12fdbad376a83a8a691bdb8509de36ede1480088`. The verified
offline pack manifest SHA-256 is
`9a531bcaaf6555b50689f4ceee06fb604c7013b3ee0b544b3af9e6b9dc7ac6e1`.

Substantial new editor features are paused pending schema-first converter work
in `scap-ng-tools#83` and normative language work in `scap-ng#80`. Preserve
existing editor work, run regression/pack/VSIX gates, and document gaps rather
than inventing converter or schema semantics.

---

# AGENTS.md — SCAP-NG VS Code Assessment Studio

## Current owner handoff — 2026-11-14 (overrides old 0.4.0 assumptions)

- Active authoring language is **one 0.4.1 flat canonical schema**, not the historical 0.4.0 pack. The verified current pin is `d1ab0283e09369c2c734d3b8f93b65007441cf07`, family digest `1755c893712ef30334dc7ecadc88e5abf387c2d60a75211bc2445b7cefa2e7d4`, and pack manifest `9a531bcaaf6555b50689f4ceee06fb604c7013b3ee0b544b3af9e6b9dc7ac6e1`. The pack contains 101 active capabilities; four ESX mappings remain explicit experimental/proposed content. Do not update only a label: regenerate/verify the complete offline schema/semantic/vocabulary/editor pack and reject incompatible old content.
- Owner priority is **real scanner core capabilities + Sets/Filters + 20–30 native gatherers**, executed in `scap-ng-ri`, not more UI documentation reports. VS Code continues its own bounded [Issue #61](https://github.com/vanderpol/scap-ng-vscode/issues/61) and PR #59 work **independently** without blocking scanner progress. Work Codex may proceed autonomously through self-contained GitHub tasks and draft PR increments, except genuine owner semantic/security/release/merge decisions.
- **Source YAML is authoritative.** Graphical Structured and Guided wizard use the same schema-driven transaction engine, targeted mutations and undo/redo; no full-file formatting, no silent new grammar. Preserve comments, multiline/inline Object+Require, anchors/quoting and no-op byte identity. Display Evaluate at top with Tests nested; Variables and shared References are visible in purposeful order, less-common Organizational Input lower; detailed tree placement is an editor UI decision, **serialization must remain correct**. Support complete schema-driven CRUD (dynamic keys, arrays, nested objects, references), guarded literal/Variable/Input controls, field-specific operators and Item/Field cardinality, contextual help, Variable dereference, renamed/referenced node integrity.
- Schema/OVAL parity: `scap-ng` owns normative documentation and all native field/operator enum constraints; `scap-ng-tools` owns converted YAML and native applicability/shared Assessment outputs. Read-only qualified conversion corpus in editor only after explicit pin and provenance; never use stale 65-benchmark archives as current examples or invent PASS/FAIL.
- The pinned `OVAL-Community/SCAP-Self-Assertion` source corpus at `e3538595c5083b9c34d937a81d319234df9bbfaa` is a broad, cursory inventory of native features. Its tests/Definitions must be cross-referenced in schema-native help **where relevant**, not treated as mandatory OVAL reading for authors or as scanner parity. A source-witness or schema-valid YAML is not a runtime-evaluated true/false. Preserve distinct original source ID, conversion, native schema and RI qualification statuses.
- Do not overwrite an existing branch, commit an untracked debug Assessment, merge, or release without explicit authorization. Once CI/build works, implement/edit/install/test the VSIX on the approved VM and publish concise source-linked receipts; don't pause after every mundane change.


## Mission and required reading

Build a **standalone, open-source, offline-first VS Code editor** for drafting, inspecting and maintaining **current SCAP-NG 0.4.1** content. Historical 0.4.0 is readable only under an explicitly diagnosed legacy/migration boundary and is not a supported authoring target. The editor is **not** the compliance scanner, OVAL evaluator, converter, standards authority or source-of-truth for Assessment semantics.

Before coding, read this file, [SCAP-NG primer](docs/SCAP-NG-PRIMER.md), [editor blueprint](docs/EDITOR-BLUEPRINT.md), [one-clone workspace setup](docs/WORKSPACE-BOOTSTRAP.md) and the numbered GitHub implementation issues. Use their acceptance criteria for incremental working deliveries.

**Clean-clone setup (Linux):** Clone only this `scap-ng-vscode` repository. `dependency-pins.json` is the source of truth for optional local public checkouts; `schema-profile.json` pins the complete editor pack. `npm run bootstrap:deps` fetches exact public commits into ignored `.external/`; after installing the tools Python dependencies, `npm run bootstrap:pack` builds and byte-verifies the offline pack, and `npm run verify:offline` checks all resources without a network lookup. Never use moving `main`, private research or unavailable paths as hidden prerequisites. A full 65-stream library is **not** part of bootstrap: its historical review ZIP predates the owner-amended grammar and requires a newly qualified pinned artifact.

**Owner direction recorded 2026-10-31 and 2026-11-02:** [Schema-driven authoring help, explicit hideable defaults, and offline regex/sample-data playground](docs/SCHEMA-DRIVEN-HELP-AND-PLAYGROUND.md) is now a required product acceptance contract; track implementation in [issue #7](https://github.com/vanderpol/scap-ng-vscode/issues/7). Persist editor-generated human-readable Test summaries in native `test_title` as specified in [issue #8](https://github.com/vanderpol/scap-ng-vscode/issues/8). Neither feature may fabricate scanner PASS/FAIL. Do not hard-code a competing documentation/default/enum registry.

## Historical corpus exclusion — required safety gate (2026-11-02)

**Do not train the Guided/Structured UI, derive authoring templates, write golden tests, or infer current syntax from the October 30 all-65 DRAFT or normalized review ZIPs.** The owner inspected a Windows Assessment from that archive and found outdated `assessments/local/<opaque-generated-name>/...` structure and noisy per-field `values_found`/`values_matching` rather than current, compact Test-wide requirements. These archives deliberately preserved old YAML and predate the owner-approved November 2 grouped `item_requirement` amendment. Their proofs apply only to their pinned historical snapshots.

The editor's **sole authoring grammar and examples** come from the exact canonical `scap-ng` schema commit and the matching, hash-verified small sample-data commit in `dependency-pins.json`. The historical library may be opened **only as explicitly user-selected legacy data**, labeled *historical / not current-schema qualified*. Never silently auto-import, repair, rewrite, normalize, or promote old corpus Tests to current examples. When a newly regenerated 65-stream library is available, require an explicit updated schema pin, schema-validation report, source/proof provenance, readable path and naming audit, and reviewed dependency change before integrating it into the editor sample library. See [evidence issue #1](https://github.com/vanderpol/scap-ng-evidence/issues/1).

## Canonical contracts and version pinning

- Canonical public source: [vanderpol/scap-ng](https://github.com/vanderpol/scap-ng/tree/d1ab0283e09369c2c734d3b8f93b65007441cf07), especially the **flat** [0.4 schema directory](https://github.com/vanderpol/scap-ng/tree/d1ab0283e09369c2c734d3b8f93b65007441cf07/schema), [schema README](https://github.com/vanderpol/scap-ng/blob/d1ab0283e09369c2c734d3b8f93b65007441cf07/schema/README.md), [authoring vocabulary](https://github.com/vanderpol/scap-ng/blob/d1ab0283e09369c2c734d3b8f93b65007441cf07/schema/authoring-vocabulary.en.json), [current examples](https://github.com/vanderpol/scap-ng/tree/d1ab0283e09369c2c734d3b8f93b65007441cf07/examples) and [generated reference](https://github.com/vanderpol/scap-ng/blob/d1ab0283e09369c2c734d3b8f93b65007441cf07/docs/generated/schema-reference.md).
- Shared offline converter/authoring utilities and the [editor-pack export procedure](https://github.com/vanderpol/scap-ng-tools/blob/12fdbad376a83a8a691bdb8509de36ede1480088/docs/EDITOR-PACK-CUTOVER.md) live in public `vanderpol/scap-ng-tools`. The previous research repository is private and **must not** be required to build, test, or implement this extension.
- **Pin the exact upstream Git commit used for each editor build** and expose the version/SHA in About/diagnostics. Do not treat moving `main` as a release version; never mix schema, mappings and vocabulary from different commits. Avoid old 0.3 or historical 0.4-A examples.
- Canonical **owner-amended pre-release 0.4** uses Test-local `capability` and `require`. A comparison Test serializes `item_requirement: {items_found: one_or_more, items_satisfying: every}` before sibling `field_requirement: {values_found: one_or_more, values_matching: every}`. Presence-only Tests retain only `item_requirement.items_found`; Result wire fields are separate and unchanged. These controls are schema-driven, never hidden runtime defaults. Logical `and`, `or`, `one`, `xor` are different: `one` means exactly one, `xor` means odd parity. Do not reintroduce named `states` or `states_match`, `select`/`collect` wrappers, or old ungrouped Item keys.
- **Presentation order is an editor acceptance contract**, reflected in the pinned schema property declarations and current examples: show `item_requirement`, then `field_requirement`, then `fields`. Prefer a one-line complete `fields` map for short simple predicates (e.g. `fields: {type: {equals: dword}, value: {equals: 1}}`), but keep complex regex/logic readable as a block. Never reorder an existing valid document merely by opening/saving it. Regression tests cover the declared and actual layout.
- **Important exporter boundary:** The 238-resource metadata-pack builder sorts JSON object keys for deterministic hashes, so `Object.keys(pack.resource(...).properties)` does **not** preserve the original JSON Schema declaration/presentation order. Consume the pinned canonical source's order or extend the reviewed exporter with derived order metadata before implementing forms; do not hand-maintain a second hardcoded order registry. The rendered editor must be tested against the canonical examples, not alphabetically ordered pack keys.
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
