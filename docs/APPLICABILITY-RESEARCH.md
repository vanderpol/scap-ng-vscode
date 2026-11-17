# SCAP-NG applicability research and Guided Assessment design

**Research date:** 2026-11-10

This note records the applicability model found in the pinned SCAP-NG 0.4 contract and in the source-preserving 65-benchmark corpus. It is an implementation boundary for the offline Guided copy/paste workflow; it does not claim scanner/runtime equivalence.

## Findings from the SCAP-NG contract

The current editor pack (`scap-ng@7b9b61108aa30a601828268576308e510477094e`, candidate PR #21) and stable rollback (`463675f3b931e596c922352a131cb3c515ab2265`) contain the same relevant applicability shape:

- `assessment.applicability` is optional and is either an `expression` or `null`.
- An Assessment declares external Assessment dependencies in `assessment.dependencies`. Each dependency has a local kebab-case alias, target Assessment ID, required version, and optional `purpose: applicability`.
- The applicability expression consumes the dependency alias, for example:

  ```yaml
  dependencies:
    domain-joined:
      assessment: windows-domain-joined-applicability-assessment
      expected_version: 1
      purpose: applicability
  applicability:
    assessment: domain-joined
  ```

- The separate `applicability.schema.json` is a Benchmark-level catalog. It maps named condition keys to applicability Assessment IDs:

  ```yaml
  applicability:
    id: windows-11-applicability
    conditions:
      domain-joined:
        assessment: windows-domain-joined-applicability-assessment
  ```

- Rule applicability is a separate policy-layer array of catalog condition names. It is not the same field as `assessment.applicability`.
- Benchmark/platform applicability is also separate. Selecting `windows` in Guided authoring is an authoring context and must not silently create a CPE/platform applicability claim.
- Applicability is therefore an **external Assessment dependency**, not a free-form boolean, prose field, hidden platform flag, or extra predicate in the compliance Test.

The Tools input/dependency analysis explicitly walks `assessment.applicability`, resolves dependency aliases, and requires declared dependencies. This confirms that the dependency/reference graph is part of the intended authoring contract.

## Findings from the converted corpus

The source-preserving corpus contains 8,892 Rules. The source XML contains:

- 848 Rules with an XCCDF `<platform>` reference.
- 1,337 Rules whose manual/check text contains applicability language.
- 146 Rules mentioning domain-joined/domain-member conditions.
- 122 Rules mentioning standalone systems.
- 1,308 Rules containing `NA`/`not applicable` language.

The current 65-benchmark converted output is **not an applicability implementation reference**:

- Generated Assessments contain no `assessment.applicability` property.
- Generated Rule files have empty `applicability` arrays.
- Generated Benchmark platform applicability is an empty fixture object.
- The generated applicability catalog is an empty `fixture-applicability` catalog.
- The converter receipts explicitly state that native applicability translation was not qualified and that original source applicability was preserved instead.

This is an intentional safety boundary, not evidence that applicability should be omitted from the product.

### Exact Windows 11 evidence

The pasted scenario corresponds to Windows 11 Rule `SV-253379` in the preserved source. Its XCCDF platform is `Windows Domain Member Workstation`. The source defines that platform with OVAL inventory definition `oval:mil.disa.stig.win:def:100002`, whose test is:

```xml
<wmi57_object id="...:obj:10000100">
  <namespace>root\cimv2</namespace>
  <wql>SELECT DomainRole FROM win32_computersystem</wql>
</wmi57_object>
<wmi57_state id="...:ste:10000200">
  <result datatype="record" operation="equals">
    <field name="domainrole">1</field>
  </result>
</wmi57_state>
```

The manual OCIL text separately says the requirement is applicable to domain-joined systems and NA for standalone systems. The generated native registry Assessment preserves the registry check but drops both applicability paths. This is the exact gap the Guided workflow must expose.

The current SCAP-NG capability contract can represent the source inventory check as a native `windows.wmi.query` Test with `root\\cimv2`, `SELECT DomainRole FROM Win32_ComputerSystem`, and a record field predicate `domainrole: {equals: 1}`. A direct schema validation of that shape passes through the pinned editor pack. Runtime support and equivalence still require a qualified evaluator.

## Recommended Guided implementation

### 1. Detect, but do not silently serialize, applicability language

The paste recognizer should classify applicability separately from the compliance candidate:

- `none`
- `detected-unbound`
- `attached-existing`
- `companion-draft`
- `ambiguous/manual-review`

For the example, the generated YAML should not silently pretend the Assessment is universally applicable. The UI/result should display:

> Applicability detected: Windows domain-member system; standalone systems are not applicable. No applicability Assessment is attached yet.

The original check text remains preserved in the annotations.

### 2. Add an explicit Applicability section to Guided authoring

Place it after Assessment title/class and before capability/Test construction:

1. No applicability condition.
2. Attach an existing applicability Assessment.
3. Create a companion applicability Assessment draft.
4. Leave unbound and require manual review.

The platform selector remains only an authoring context. It must not answer this question automatically.

### 3. Attach an existing condition safely

When the author selects an existing condition, generate both the dependency declaration and applicability expression. Never invent a target ID or version:

```yaml
assessment:
  dependencies:
    domain-joined:
      assessment: windows-domain-joined-applicability-assessment
      expected_version: 1
      purpose: applicability
  applicability:
    assessment: domain-joined
```

The workspace index should resolve the target, verify kind/version/scope, and report dangling or incompatible applicability dependencies just like other graph references.

### 4. Generate a companion draft only when evidence supports it

For this specific Windows 11 source context, a companion draft can use the source-proven WMI DomainRole=1 check. For generic pasted text without a benchmark/platform source, the recognizer must not choose between workstation role, member-server role, or a broader `PartOfDomain` interpretation without author confirmation.

The companion draft should therefore be visibly labelled:

> Best guess applicability Assessment; review target role and evaluator support before use.

The main Assessment should only receive the `dependencies`/`applicability` fields after the user confirms or selects the companion. A one-file paste action should not create an unresolved dependency reference.

### 5. Keep applicability separate from compliance evaluation

Do not add the domain-membership Test to the registry Test's `and` expression. A false domain-membership Test would become a failed compliance expression instead of a genuine `not_applicable` disposition. Do not hard-code `{not_applicable: ...}` either; that is a runtime result and requires an evaluated applicability condition.

## Suggested delivery sequence

1. Add applicability-language detection and a visible unbound diagnostic to assisted drafts.
2. Add schema-backed attachment of an existing applicability Assessment.
3. Add companion-draft generation for reviewed mappings, beginning with Windows Domain Member Workstation (`DomainRole=1`).
4. Add workspace graph diagnostics and save/open tests for the dependency/catalog relationship.
5. Only then expand to generic domain membership, server roles, application-installed conditions, and other STIG applicability patterns.

Required tests include schema validation, unresolved dependency diagnostics, exact dependency alias serialization, `not_applicable` versus failed compliance semantics, and no-op behavior when no applicability text is present.

## Editor work completed while the 65-benchmark conversion is pending

The editor now has corpus-independent groundwork for this workflow:

- The workspace index recognizes top-level `applicability.yaml` catalogs.
- Catalog conditions resolve to Assessment IDs and are exposed as dropdown options only when exactly one compatible Assessment is found.
- Assessments with `dependencies.*.purpose: applicability` are also discoverable while a catalog is being assembled.
- Applicability dependencies participate in unresolved, wrong-kind, duplicate and version diagnostics.
- Guided Assessment creation can serialize a selected condition as the schema-native `dependencies` plus `applicability` pair.
- Assisted drafts can carry the same selected applicability condition when one is chosen.
- No generated bulk corpus or conversion output is required for these features.

The dropdown intentionally does not infer applicability from a directory name alone. A future content workspace can use a convention such as `assessments/applicability/`, but the catalog/reference graph remains authoritative. This prevents a normal compliance Assessment from being silently treated as an applicability Assessment.
