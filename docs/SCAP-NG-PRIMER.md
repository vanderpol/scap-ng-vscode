# SCAP-NG primer for editor implementers

**Audience:** A developer or Codex instance competent with VS Code/TypeScript/React/YAML but new to SCAP, STIGs and OVAL. Read this before designing UI or data models. This is an **editor orientation**, not a replacement for the authoritative specification.

## 1. Trust the versioned authoritative sources

SCAP-NG is an evolving pre-alpha replacement for parts of the SCAP 1.4 ecosystem. The editor must **consume a pinned version** of the real project, never invent its own dialect.

- [Canonical SCAP-NG repository](https://github.com/vanderpol/scap-ng)
- [v0.4.0 schema README](https://github.com/vanderpol/scap-ng/blob/main/schema/v0.4.0/README.md)
- [v0.4.0 Assessment JSON Schema](https://github.com/vanderpol/scap-ng/blob/main/schema/v0.4.0/assessment.schema.json)
- [v0.4.0 Rule JSON Schema](https://github.com/vanderpol/scap-ng/blob/main/schema/v0.4.0/rule.schema.json)
- [Versioned authoring vocabulary](https://github.com/vanderpol/scap-ng/blob/main/schema/v0.4.0/authoring-vocabulary.en.json)
- [Package identity and integrity](https://github.com/vanderpol/scap-ng/blob/main/specification/package/package-and-integrity.md)
- [Assessment method and standalone role](https://github.com/vanderpol/scap-ng/blob/main/specification/assessment/assessment-method.md)
- [Pre-alpha 0.4 release-candidate guide](https://github.com/vanderpol/scap-ng/blob/main/docs/releases/0.4.0-rc.md)

At initial implementation, record the exact upstream SHA and verify hashes of schema, mappings, examples and vocabulary. After the official 0.4.0 release, explicitly upgrade from the pinned candidate to the tag. **Do not mix current v0.4 files with historical 0.3 or early 0.4-A sample content.** The schema README itself contains historical dated paragraphs; its topmost current-candidate status and version-local files take priority.

## 2. Mental model: policy is not a check

- **STIG:** A set of security policy requirements for a target product, generally represented by a Benchmark.
- **Benchmark:** Policy container with Rules and profiles/applicability.
- **Rule:** Human-readable requirement, severity, rationale, identifiers and a selected Assessment. It has named `assessment_choices` and an optional/default choice; manual and automated alternatives can coexist.
- **Assessment:** Standalone, potentially reusable method of checking a condition. It has a stable logical ID, version, title, mode, class/purpose and (if automated) Tests. It can exist without a Rule or Benchmark. **A Rule is policy; an Assessment is a check.**
- **Test:** One acquisition/evaluation operation inside an automated Assessment. It declares a technical `capability`, an Object or other supported source and a `require` predicate.
- **Object:** Describes what to collect. May be inline under a Test or a named reusable `shared_objects` entry within the Assessment. It is not itself a pass/fail condition.
- **require:** Describes existence, matching and field/record conditions on collected Items. It replaces older named-State authoring.
- **evaluate:** Combines named Test results using explicit Boolean operators.
- **Variable/input:** Explicit values or dependent data flow; neither is a hidden default. Organizational input belongs to a declared policy/input contract, not an arbitrary editable constant.
- **Applicability:** Separate question about whether the Benchmark or Rule applies. Editor platform selection is not applicability evaluation.
- **Profile:** Policy selection, usually disabling/enabling Rules, not a separate check.
- **Result:** An execution-time artifact produced by a scanner/validator, not something an editor should infer from authoring alone.

## 3. Actual 0.4 grammar (never guess from old examples)

Authoring files are YAML/JSON with a single document root such as `assessment:` or `rule:`. The v0.4.0 JSON Schema is the formal contract. Many complete Rule fields are required; do **not** infer a complete valid Rule from the small conceptual fragments below.

**Illustrative fragment only (not a full schema-valid document):**

```yaml
assessment:
  id: example-linux-file-assessment
  version: "1"
  assessment_title: Check a file condition
  mode: automated
  class: compliance
  purpose: assessment
  tests:
    example-file-test:
      capability: unix.file
      object: {filepath: /etc/ssh/sshd_config}
      require:
        items_found: one_or_more
```

Before accepting or emitting this structure, consult the pinned schema's required Test fields, capability contract and naming rules. The editor must not silently supply undocumented defaults.

Important 0.4 details:

- `capability` belongs at **Test** level, not redundantly inside an inline Object.
- Native Object fields are direct capability-specific source fields; do not add legacy `select`/`collect` wrappers.
- Test expectations belong in `require`; old top-level `state`/`states`/`states_match` are not supported native authoring.
- Existence and satisfaction are **independent**: `items_found` is not `items_satisfying`; field `values_found` is distinct from `values_matching`; record `records_found` is distinct from `records_matching`.
- Source-given data types and quantifiers must remain explicit. Absence-only requirements must use the sanctioned version-local grammar and must not carry meaningless comparisons.
- Boolean `and`, `or`, `one` and `xor` apply at their defined logical scope. `one` = exactly one true; `xor` = odd number of true branches. Never conflate with one Item or with `one_or_more`.
- Flow-style YAML (`{filepath: /etc/passwd}`) and equivalent block-style YAML must remain usable; format is an author preference, not an Assessment semantic.
- Records and dynamic record-member keys may need specialized UI. All field names and keys must remain editable; there is no fixed collection of "Field 1/Field 2" labels.
- `reported_elements` and evidence/provenance can matter to results even when they are not convenient for a generic form. Do not discard unknown but schema-permitted metadata.
- For `shellcommand`, source interpreter is explicit where required. Do not turn ordinary file traversal into shell commands as an editor convenience.
- Defaults that appear in the current mapping/schema are a contract; do not invent hidden defaults from older SCAP 1.4 conventions.

## 4. A unique ID is not a filesystem path

A Rule names its selected Assessment by logical ID, not a relative file path. The editor should recursively discover content and build an ID→file URI/type/version index and reverse "Used by" references.

- Duplicate Assessment IDs in the current authoring index should be diagnosed, not randomly resolved by whichever file happens to be first.
- Human-readable titles are not reliable identities.
- An Assessment may serve several Rules/Benchmarks. Reuse is inferred from references, not an authored `shared: true` field.
- The current source-graph tooling has some **local vs shared directory-scope** checks. Do not strip those constraints without a coordinated versioned change. The longer-term design goal is path-independent identity and shallow/optional organization.
- A compiled bundle's manifest maps logical identity to immutable member and checksum. Scanner path resolution uses the manifest; authoring YAML should not contain compiled-package paths.
- Automatically identifying near-duplicates does not authorize changing, merging or rewriting Assessment definitions. Preserve semantics and source authorship.

## 5. Applicability, results and scanner boundaries

Do not show a real PASS/FAIL merely because text matches an example or the document compiles.

Distinguish prominently:

1. YAML parse success.
2. Native JSON Schema success.
3. Workspace reference and capability-contract success.
4. Native compiler/package verification success.
5. Independent static semantic proof of converted OVAL content.
6. Actual scanner runtime evaluation on a target.

The original SCAP 1.4 converter may classify content as `CONVERTED_VERIFIED`, `CONVERTED_UNVERIFIED`, `BLOCKED` or manual/OCIL preserved. These are conversion provenance labels, **not** security scan results.

- `all_exist` may be warning-lowered to `items_found: one_or_more` in a draft. This is **not unrestricted runtime equivalence** with expected missing, incomplete/error/not-collected populations. SCAP-NG scanners must not fabricate nonexistent Items.
- Nonstandard NIWC `ds:uri` catalog extensions may be warning-admitted only after exact deterministic reference-chain resolution. Do not silently rewrite signed source or suggest equivalent scanner proof.
- A scanner's incomplete or unknown collection must not automatically be rendered compliant. Editor validation should report its own "unknown/not run" status when there is no evaluator.
- Manual Assessment involves human procedure and provenance; never fabricate execution evidence.

## 6. Guided authoring vocabulary and modes

The version-local `authoring-vocabulary.en.json` holds prompts such as platform, capability and logical combination. **Use it for human-facing labels**, then source canonical enumerations from the same version's schema/mappings. Keep native tokens unchanged.

- **Source:** Raw YAML and native VS Code language functions.
- **Structured:** Complete schema-driven editing, dynamic records, fields, lists, logical trees, source references.
- **Guided:** Human questions following platform → capability → Object/collection → require/existence/matching → alternatives → multiple Tests/evaluate. Users can move to Structured/Source for advanced features at any time.
- **STIG Library:** A child of Assessment Studio, searchable/lazy; a standalone Assessment is not forced into a STIG.
- **Sample data:** Future local real evaluation only through a version-compatible evaluator. Illustrative expression testing must be clearly labeled non-scanner/non-compliance.

## 7. Pitfalls specific to an offline VS Code extension

- JSON Schema is structural validation; graph integrity and source runtime semantics require additional mechanisms.
- A generic form may lose YAML comments, anchors, aliases, quoting, one-line formatting and ordering; use source-range minimal patches, not global serialize-on-save.
- VS Code supports a custom **text** editor sharing the actual TextDocument, `WorkspaceEdit`, undo/redo and change events. Use this rather than a separate private YAML snapshot as authoritative truth.
- Revisions to pinned schema/mappings must be explicit; maintain a compatibility error instead of guessing.
- Never send sensitive local content to AI, schema catalogs, telemetry or external services without opt-in permission.
- Do not embed whole signed DISA/NIWC source packages or large 65-STIG corpora in the editor repo. Use bounded publicly redistributable fixtures or user-supplied local samples.
- Verify licensing before copying any other project's code. The editor repository's Apache-2.0 license does not automatically license the upstream schema/content.
