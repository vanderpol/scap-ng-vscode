# Newer full-65 conversion ledger compatibility

**Status:** The reported newer ledger is located, but its generated Assessment corpus is not published or present locally. Only ledger/Rule-record evidence is available; no fresh conversion was run.

## Exact ledger and source

The counts **6,473 automated / 1,403 manual-only / 114 blocked / 209 excluded** are from:

- Tools commit: `93387510fbca35e775d3ef488b9a47778b12c6a4` (`Rebuild active ledger after function recovery`, 2026-11-06)
- Open draft PR: [vanderpol/scap-ng-tools#33](https://github.com/vanderpol/scap-ng-tools/pull/33)
- Ledger: `docs/evidence/issue28/ACTIVE-CANDIDATE-LEDGER.json`
- Rule records: `docs/evidence/issue28/ACTIVE-CANDIDATE-RULES.json.gz`
- Source: `niwc-atlantic/scap-content-library@8c8e5dff860af6b1290ee9273a282db24278f8d5`
- Scope: 63 active benchmarks / 8,199 Rules; Windows Server 2012 and 2012 R2 are retained historically but excluded from the active modernization scope.

The later PR head `7106c6dd8093ee7b74ccfbad88ae1667a24c5516` changed the active result to **6,479 / 1,403 / 108 / 209**. It is not the source of the 6,473 / 114 numbers.

The ledger can be obtained without conversion from the PR history:

```sh
git fetch origin pull/33/head
TOOLS=/path/to/scap-ng-tools
git -C "$TOOLS" show 93387510fbca35e775d3ef488b9a47778b12c6a4:docs/evidence/issue28/ACTIVE-CANDIDATE-LEDGER.json > ACTIVE-CANDIDATE-LEDGER.json
git -C "$TOOLS" show 93387510fbca35e775d3ef488b9a47778b12c6a4:docs/evidence/issue28/ACTIVE-CANDIDATE-RULES.json.gz > ACTIVE-CANDIDATE-RULES.json.gz
```

The committed tree contains no generated `assessment.json`/`assessment.yaml` payloads. The `artifacts` members in the Rule records are paths that would exist in a conversion output; they are not embedded files. No release asset or complete newer generated corpus was found. Therefore there is nothing newer to attach to the VS Code corpus directory without performing a conversion.

## Schema comparison

| Snapshot | Commit | JSON files | Root schemas | Root `$ref`s | Family SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| Historical tool snapshot | `463675f3b931e596c922352a131cb3c515ab2265` | 143 | 34 | 242 | `ab1933f2d9171ee0af70c0fab855b00f5faf78bf59ad4924fbf24b402ac4072a` |
| VS Code editor pin | `7b9b61108aa30a601828268576308e510477094e` | 145 | 35 | 652 | `2adf88f5c1fd950e997579c00064388b5f12e9e29cde38075bf75b76d1f25843` |
| 6,473 ledger converter pin | `a0363570dff78fd0520f84801d635593ce5c8146` | 145 | 35 | 675 | `094cc95219a0fad3640c5fda366b8ff865eb73e255013d92f46edd24cb579c6b` |

The 143-to-145 inventory difference is exact: the two added JSON members are:

- `schema/native-selector-contracts.json`
- `schema/native-selector.schema.json`

They are legitimate native selector-contract additions, not stale generated metadata. The 143-file snapshot consequently cannot validate the 145-file editor schema and must not be made to do so by changing the digest constant.

The newer ledger's `a036357` snapshot keeps the same 145-file inventory but is a later schema candidate. Relative to the editor's `7b9b611` pin, 18 existing JSON/schema resources changed, including `variable-expression.schema.json` (the OVAL function contract), the native selector overlay, selector mappings for `unix.file`/Windows file capabilities, result schemas, `rule.schema.json`, and editor-default policy. These changes account for the digest and root-reference change; they are legitimate contract evolution. The newer converter's `FrozenSchemaSnapshot` is correctly pinned to `094cc...` / 675 refs and accepts its intended schema, not the editor's earlier `2adf...` / 652-ref snapshot.

There is one separate provenance defect in the published candidate evidence: `ACTIVE-CANDIDATE-LEDGER.json` identifies `a036357` / `094cc...`, while the committed `ACTIVE-CANDIDATE-RULES.json.gz` metadata still identifies `7354a24c...` / `63a61b...`. The gzip contains Rule records and artifact references, not generated Assessments. This stale metadata must be corrected before treating the candidate evidence as one reproducible package.

## Smallest coordinated upstream correction

1. In `scap-ng-tools`, regenerate the candidate Rule-record gzip and all ledger/provenance metadata from the same `a036357` schema snapshot and commit; fail CI if embedded scope pins disagree.
2. Publish the actual generated Assessment output (or a content-addressed archive) if editor testing is required; the current PR publishes no such payload.
3. Have `scap-ng` and `scap-ng-tools` agree on the owner-approved schema candidate. If `7b9b611` remains the VS Code canonical pin, the recovery converter must be repinned/requalified against its `2adf...` schema, not bypass verification. If `a036357` is approved instead, update the VS Code dependency/schema-pack pins together and validate the resulting pack.
4. Do not change frozen schemas, copy missing files into the 143 snapshot, or alter converter digest constants independently.
