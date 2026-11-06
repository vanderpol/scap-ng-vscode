# Graphical operator-control audit

This audit covers the operator-bearing controls rendered by the Assessment Studio
webview.  The editor does not maintain a capability-specific operator registry:
Object and Require operator choices are resolved by
`src/completion.ts` (`selectorOperatorChoices`, `selectorValueChoices`, and
`selectorValueSourceChoices`), the same resolver used by the native YAML completion
adapter. The exact Variable/fixed/input contract is in
`docs/GRAPHICAL-EXPRESSION-CONTRACT-MATRIX.md`.  The resolver reads the pinned schema pack and
capability mapping metadata (`schema_uri`, `mapping_uri`, `state_field_datatypes`/
`field_datatypes`), and intersects typed operation constraints from
`typed_comparison_datatype_consistency`.

| Graphical control | Schema/metadata source | Supported context | Regression coverage |
| --- | --- | --- | --- |
| Test-local Object selector | Capability Object schema/conditional overlay `propertyNames` + scalar predicate schema; `selectorOperatorChoices(..., false)` | Windows registry, Linux partition, shellcommand and every pinned capability; inline Test Object | `test/integration/pinned-pack.test.mjs` capability lists; `test/graphical-density.test.mjs` Object picker contract; Extension Host graphical probe |
| Shared Object selector | Same Object resolver; capability comes from the Shared Object declaration | `assessment.shared_objects.<id>` selectors | `test/native-editor.test.mjs` shared replacement/source tests; integration resolver/model assertions; Extension Host graphical probe |
| Variable `values.object` selector | Same Object resolver; capability comes from nested `values.object` | Variable collection expressions, including nested regex-capture inputs | `test/integration/pinned-pack.test.mjs` recursive Variable completion; graphical-density Variable source-control tests; Extension Host graphical probe |
| Object fixed value / Variable source | Object `equals`/`variable` schema alternatives plus Assessment Variable declarations; source-preserving `replaceSelectorSource` | Test-local, Shared Object and nested Variable Objects | `test/native-editor.test.mjs` fixed/Variable round trip, sibling preservation and undo; graphical-density duplicate-control assertions |
| Require scalar comparison operator | Capability state-field schema + shared scalar/field predicate schema; `selectorOperatorChoices(..., true, datatype)` | `Test.require.fields.<field>`; scalar, enum and typed comparisons | Integration exact lists for Registry, Linux and shellcommand; model compatibility tests; Extension Host graphical probe |
| Require scalar expected value/source | Capability `state_value_enums`/`selector_value_enums` mapping metadata and schema operand alternatives | Registry `type`/`hive`, other finite canonical values; Fixed, Variable, or Input where the schema permits | Integration Registry enum and Variable-contract assertions; `test/source.test.mjs` source-preserving fixed/Variable replacement |
| Require `datatype` compatibility | Capability mapping field datatypes plus schema `typed_comparison_datatype_consistency` | Explicit typed operation selections; authored incompatible operation is retained and marked | Integration typed filtering/model assertions; graphical warning contract; Extension Host probe |
| Item cardinality | Pinned `item_requirement`/`paired_requirement` schema enums and GuidedCatalog | `item_requirement.items_found/items_satisfying` | Existing pinned-pack and graphical density requirement tests |
| Field-value cardinality | Pinned `field_requirement` schema enums and GuidedCatalog | `field_requirement.values_found/values_matching` | Existing pinned-pack and graphical density requirement tests |
| Guided Object operation | `GuidedCatalog.objectFields` delegates to Object resolver | Guided capability/Object authoring | `test/integration/guided.test.mjs`; pinned-pack resolver assertions |
| Guided Require operation | `GuidedCatalog.resultFields` delegates to Require resolver | Guided Require authoring | `test/integration/guided.test.mjs`; pinned-pack resolver assertions |
| Evaluate logical operator | `expression.schema.json` array alternatives (`and`, `or`, `one`, `xor`) and canonical vocabulary term scopes | Assessment-level evaluation tree; distinct from cardinality and scalar comparison | Guided catalog and pinned-pack evaluation-control tests |

A valid authored operator is never replaced when capability or datatype context
changes.  If it becomes incompatible, the current option remains visible with a
warning and the edit is rejected until the author selects a schema-supported
replacement (or edits YAML directly).  No operator list implies scanner
execution or a compliance result.

## Visual evidence

- [Installed-workspace capture (2026-11-06)](evidence/graphical-operator-audit-20261106.png)
- [Extension Host graphical surface capture](evidence/issue-44-revised-host-1920x1080.png)

The Extension Host qualification receipt is produced by
`SCAP_NG_OPEN_GRAPHICAL=1 SCAP_NG_GRAPHICAL_EDIT=1 npm run test:host:redhat`;
its `graphicalLifecycle` receipt records Object and Require edits, reopen, Undo,
Redo, and `failures: []`. These images are UI evidence only; no screenshot is
used as proof of scanner execution or compliance.
