# SCAP-NG VS Code: schema-driven help, explicit editor defaults, and assessment playground

**Status:** Owner-approved editor product direction (2026-10-31); engineering and scanner parity **not yet implemented or qualified**. This is a design/acceptance contract, **not** a change to the normative SCAP-NG 0.4.0 grammar, a completed feature, or approval to merge/release the upstream schema.

**Audience:** `scap-ng-vscode` implementers, SCAP-NG schema authors, testers, and content authors. Keep this document linked from the editor issues and upstream metadata work.

**Sources and boundaries:**

- Upstream [SCAP-NG 0.4.0 owner decisions 1–29](https://github.com/vanderpol/scap-ng/blob/05fbd7a4e49aea4f49e223552d18c9951531322d/docs/audit/v04-owner-final-decisions-20261031.md), [PR #268](https://github.com/vanderpol/scap-ng/pull/268) (draft at review), [schema language/vocabulary issue #244](https://github.com/vanderpol/scap-ng/issues/244), [editor default audit](https://github.com/vanderpol/scap-ng/blob/05fbd7a4e49aea4f49e223552d18c9951531322d/docs/audit/v04-editor-default-review-20261031.md) and [OVAL crosswalk](https://github.com/vanderpol/scap-ng/blob/05fbd7a4e49aea4f49e223552d18c9951531322d/docs/audit/v04-editor-defaults-oval-crosswalk-20261031.md).
- The editor's existing [AGENTS.md](../AGENTS.md), [blueprint](EDITOR-BLUEPRINT.md) and implementation [#1](https://github.com/vanderpol/scap-ng-vscode/issues/1)–[#6](https://github.com/vanderpol/scap-ng-vscode/issues/6) remain in force except where this newer **editor product priority** explicitly supersedes the older idea that sample-data work was optional/later. The no-fabricated-scanner-result boundary remains absolute.
- An editor build must pin an exact upstream schema/mapping/vocabulary commit and supported version; offline operation cannot depend on a moving remote branch. A later installed/pinned schema may update forms/help automatically, but never silently reinterpret existing 0.4.0 documents as another version.

## 1. Desired author experience

An author knowledgeable about STIGs but unfamiliar with OVAL or SCAP-NG should be able to create a basic Windows registry or Linux file check without learning the full YAML grammar, while an expert can expose and edit every field. Do not substitute pretty formatting for guided authoring. Keep a single canonical VS Code `TextDocument` synchronized across **Source (YAML), Structured (complete graphical forms), Guided (task prompts)**, and a **Test/Playground panel**; no independent semantic copies or whole-file rewrites.

Progressively disclose acquisition, expected values, cardinality, variables and multi-Test logic. Show plain language first (e.g. *Registry value `NoLockScreenSlideshow` must be DWORD `1`*), with explicit advanced controls for Item/Field matching, collection exceptions, and result handling. An advanced author must always be able to inspect the exact SCAP-NG mapping and YAML.

## 2. One authoritative source for descriptions and controls

**Normative requirement for the editor:** Do not maintain independent lists of enum tokens, allowed types, default values, or field definitions. Resolve these from the selected **version-local JSON Schemas and capability mappings**. Use standard schema metadata `title`, `description`, `examples`, `default` and an explicitly versioned `x-scap-ng-authoring` metadata contract for editor display/hiding. Keep contextual prose, localization-ready labels, and wizard question wording in the pinned `authoring-vocabulary.en.json` **only where not suitable for the JSON Schema itself**; entries must reference canonical schema paths/terms, never redefine their options or normative meanings. This refines, rather than discards, upstream #244.

For every author-visible field, logical operator, and enum option provide:

1. A short accurate human label and a one-sentence meaning.
2. A more detailed explanation of scope and evaluation effect: acquisition vs comparison, Item vs Field vs Record presence, conditions, unknown/error/absence where defined.
3. Valid values and **plain-English explanations of each**, resolved without duplicating enum lists.
4. Whether required, optional, inferred, explicitly saved, or context-dependent; show editor suggestion and source OVAL default separately when different.
5. Minimal positive/negative examples and a link to the version-matched author guide or OVAL crosswalk where relevant.

Present the same content through YAML hover/help, a keyboard-accessible information button in forms, and an expanded **More information** panel. Do not make hover the only accessible route. The editor must follow `oneOf`/`$ref`/capability context correctly: irrelevant alternatives must not leak into a field's help. Treat metadata as untrusted text when rendering it.

**CI/acceptance:** A version-pinned metadata completeness check inventories each author-facing property and enum member and flags missing/stale descriptions, invalid source paths, inappropriate defaults, and UI/schema mismatch. Schema/mapping enum changes refresh choices and validation when a compatible pin is installed; a stale/mismatched pin fails visibly. Descriptions are substantive, not boilerplate, and no silent coercion or runtime behavior is inferred from JSON Schema `default`.

## 3. Explicit saved defaults and hide/show experiments

**Owner-approved direction:** Materialize every applicable editor selection into the saved YAML; provision **as many helpful defaults as evidence supports**, then evaluate the actual editor with defaults visible, approved defaults hidden, and a more aggressive preview. Remove hiding rules that obscure meaning. UI presentation experiments must never change scanner semantics or silently normalize converted source. There is no requirement for the owner to vote independently on hundreds of mechanically equivalent OVAL defaults; escalate genuine ambiguous/different semantics.

Already approved hideable controls from the audit (five controls/six scalar values):

| Control | Initial editor choice | Notes |
| --- | --- | --- |
| `items_found` | `one_or_more` | Existence policy, not Item matching. |
| `items_satisfying` | `every` | OVAL `check` is mandatory; do not impute an invalid omitted source check. |
| `field_requirement` | `{values_found: one_or_more, values_matching: every}` | One paired control; overrides always save both members. |
| `reported_elements` | `all` | NG reporting policy, not an OVAL equivalent. |
| File `filesystem` | `local` for **new authoring** | Converted OVAL omitted `recurse_file_system` has effective `all` and **stays `all`**. |

The 2026-10-31 source audit inventories 100 mappings/453 rows (13 approved rows, 433 inactive candidates and seven held function rows), **not** 453 unique owner choices. Candidate suggestions include selector `equals`, Variable/array `every`, logical `and`, set `union`/filter `exclude`, and platform-specific traversal/depth *when that construct is enabled*. The owner voiced support for shellcommand `error_if_exit_status_not_0: false` and `error_if_stderr_exists: false` new-authoring suggestions, consistent with OVAL; formal upstream annotation/decision registration should still be checked separately. Do not enable isolated candidate Variable functions or add non-existent traversal fields as a shortcut.

**Mandatory editor behavior:**

- A clearly reachable **Show all settings** / **Hide approved defaults** switch, plus a prototype **hide more suggested defaults** comparison mode for user research. Indicate the number and category of currently hidden controls.
- Never hide a non-default value, an explicit override, important diagnostic/error, or a semantic exception behind an unexplained label. All controls remain editable; a field or branch can be revealed in source.
- Hide only if the **actual serialized YAML contains** the expected value; no hidden scanner/compiler fallback. A no-op open/save must be byte-identical. Do not silently add defaults when merely opening an existing file; materialize new authoring values through explicit creation/accepted edit flows.
- Distinguish `oval_effective_default`, `editor_suggested_default`, and `serialized_ng_value` in versioned schema/crosswalk documentation. Converter preserves the source's actual/effective values, even when they differ from the new-authoring suggestion.
- Optional constructs remain optional: do not invent a `traversal`, Set, Filter, or expression merely to show a default. No `max_depth: null` or magic `-1`; use approved `unlimited` only if traversal is enabled.

The **semantic 0.4 schema freeze** and **editor presentation/hideability experiments** are distinct; changing presentation metadata is reviewed/versioned, but does not authorize changing normative evaluation behavior.

## 4. First-class offline regex tester (not optional)

Put a regex-focused **Test** action adjacent to every applicable `matches_regex`, regex selector, and Variable `regex_capture` editor. It must be usable while offline and without a scanner or account.

Required regex UX:

- Paste/edit sample text, including multiline and multiple positive/negative cases; maintain immediate highlighting and spans.
- Show match/no match, capture groups, named groups when supported, extracted values and derived/declared datatypes (including the known integer-capture boundary: text `exec-timeout 5 0` -> captured integer `5`).
- Report invalid patterns, flags, unsupported constructs and input errors at the exact field; show case handling explicitly, never infer all Windows values are case-insensitive.
- Show whether the pattern is matching the intended string, line, field, record, or collected Item. Offer an explicit comparison of expected versus observed for each sample.
- Bound input, execution time and memory; provide cancellation and protection against pathological regex patterns. No opaque remote regex API and no uploads.
- Crucially, use a regex engine/dialect **qualified to the selected SCAP-NG scanner/evaluator contract**. If the embedded preview uses a different dialect, prominently label it as an **editor regex preview** and block claims of scanner parity. Never silently substitute JavaScript/ECMAScript regex semantics for another scanner dialect.
- Save/share sanitized sample cases with the project when the author explicitly chooses, and rerun them after edits. No secrets committed or uploaded automatically.

Example boundary: original-source Windows/IOS-style text regex capturing `5` from `exec-timeout 5 0` is not the same as treating the whole source string as an integer; preview and diagnostics must distinguish input and capture result.

## 5. Sample collected-data playground and test-driven authoring

Offer sample evidence for **typed collected Items** (JSON/YAML), including field names/types, records, multiple Items, absent fields vs absent Items, empty populations, collection errors/incompleteness, Variables, and the Assessment's explicit `require` and `evaluate` logic. Use a side-by-side input/expected/result/trace presentation. Support positive and negative saved cases and optional author-labelled expected outcomes.

Required explanatory trace when a **compatible local evaluator actually exists**:

- Which Test/Item/Field/Record/Variable and predicate determined the outcome; expected vs actual and selection/matching counts.
- Difference between no Item, no field, present-but-nonmatching, and failed/incomplete collection (the last is not absence).
- Which ordered `if/else_if/else` guard and branch ran; propagate error/unknown/not_evaluated/not_applicable correctly. A known fail never becomes informational. A selected explicit `not_evaluated` reason may require manual follow-up; `not_applicable` requires genuine inapplicability.
- Distinguish static schema/compile success, local predicate-preview behavior, supplied-result branch simulation, source proof and **real scanner result** with separate labels.

**Non-negotiable truth boundary:** The current compiler/schema and supplied-result branch tests are not a scanner. Until a qualified, version-compatible local evaluator is available, the editor may run a narrow explicitly labelled regex/value preview, but must show **Assessment execution unavailable** rather than invent PASS/FAIL or scanner-equivalent branch results. Never execute authored `shellcommand`, traverse local files, query registry/WMI, contact network shares, or scan a host merely by opening a sample or pressing general validation. Any real execution must be separate, safe and explicitly opted in.

The longer-term authoring workflow is **test-driven**: user supplies a properly configured sample and an improperly configured sample, authors until the qualified evaluator classifies them as expected, and retains the cases as regression fixtures. Persist fixture format/provenance/version so old fixtures cannot silently be treated as new normative conformance proof.

## 6. Acceptance demonstrations and priority

**P0–P1 (build foundation):** Source/Structured/Guided load the same version-pinned schema/mapping/help, no duplicate enums, zero silent YAML rewrite, contextual `?` and YAML hover for real fields, obvious Show All/Hide Defaults with count, full edit/reveal/undo. Document offline pin and stale-schema errors.

**P3 (first authoring demonstration):** A novice creates a Windows registry DWORD policy check through Guided mode, edits one expected field, sees compact intent, reveals matching defaults, inspects hover help, and views exact valid YAML. Verify title/description + all enum meanings. Run a brief user study with an author who did not design NG; do not claim usability based only on expert opinion.

**P3/P4 (regex acceptance, mandatory):** An offline author tests patterns against multiple sample texts; previews highlight matches and captures, flags invalid patterns, respects explicit dialect qualification, preserves cases after editing; the same pattern can be used for a Linux configuration/file check and a Variable regex capture. This capability must not wait for a full scanner.

**P4 (sample evidence, staged safely):** Import/paste sample Items and display provenance/typed fields; introduce deterministic comparison and branch traces **only alongside a compatible qualified evaluator**. Until then explain unavailable portions and never show fabricated compliance results.

**Representative scenarios:** (1) actual source-backed Windows Server registry DWORD sample [SV-278080](https://github.com/vanderpol/scap-ng/blob/05fbd7a4e49aea4f49e223552d18c9951531322d/docs/examples/owner-contract-20261031/windows-server-2025-shows-on-lock-screen-sv-278080-assessment.yaml); (2) source-backed RHEL 9 /home `nosuid` [SV-257851](https://github.com/vanderpol/scap-ng/blob/05fbd7a4e49aea4f49e223552d18c9951531322d/docs/examples/owner-contract-20261031/linux-home-mount-nosuid-assessment.yaml); (3) *constructed compiler-tested, not source/scanner proved* Windows-like `if/else_if` branching with `not_evaluated` remote ACL and `not_applicable` [compatibility suite](https://github.com/vanderpol/scap-ng/blob/05fbd7a4e49aea4f49e223552d18c9951531322d/docs/audit/v04-owner-conditional-compatibility-20261031.md).

Use separate acceptance badges for **schema valid**, **compiled**, **static source compared**, **regex-only preview**, **supplied-results simulation**, and **scanner executed**. Never conflate them.

## 7. Maintenance and coordination

- Treat this as a **product acceptance contract** superseding older editor statements that all hidden defaults are prohibited or regex/sample-data interaction is optional future polish. Do not weaken existing truth boundaries: runtime evaluation still requires an actual evaluator.
- Implement in the dedicated VS Code repository. Schema descriptions/default annotations/crosswalk changes must be proposed and reviewed **upstream**, version-pinned against the exact compatible grammar; do not silently modify frozen sources or pending PR #268. Existing upstream #244 is the metadata integration point.
- Use the current 453-row OVAL crosswalk to classify analogous/defaulted/inapplicable/optional/ambiguous controls. Most should be mechanically dispositioned; only real ambiguities or deviations need owner votes. Never turn 433 candidate rows into 433 separate owner requests.
- Keep a short recorded demo, screenshots/GIF, fixture/test output, exact schema SHA and before/after YAML diff with each meaningful milestone. Report what is **implemented**, what is **demonstrated**, and what remains **unqualified** separately.
