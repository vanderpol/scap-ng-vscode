# Graphical expression contract matrix

Source: pinned SCAP-NG 0.4.0 pack (`schema-profile.json`, canonical schema
source `7b9b61108aa30a601828268576308e510477094e`). The graphical editor uses
`selectorOperatorChoices`, `selectorValueChoices`, and the schema-derived
`selectorValueSourceChoices` from the same completion layer as native YAML.

| Location | Canonical syntax | Value sources | Operator authority | Editor coverage |
|---|---|---|---|---|
| Object selector (`Object.<field>`) | `{equals: literal}` or `{equals: {variable: variable-id}}`; the Object predicate does **not** authorize `{input: ...}` | Fixed, Variable | Capability Object schema, selector `propertyNames`, field datatype mapping | Inline Test, Shared Object, nested Variable `values.object`; single operators remain visible as text |
| Require field predicate (`require.fields.<field>`) | `{equals: literal}`, `{equals: {variable: variable-id}}`, or `{equals: {input: input-id}}` (same source alternatives apply to other scalar operations) | Fixed, Variable, Organizational Input | Capability state-field schema plus canonical scalar predicate and typed datatype consistency | Require fields, including Registry `type`/`value` and shellcommand fields |
| Variable `values.object` | `values: {object: {...}, field: ...}`; its nested Object selectors use the Object syntax above | Fixed, Variable | Nested capability Object schema | Variable inspector and source-preserving edit controls |
| Variable transformations | `literal`, `variable`, `regex_capture`, `concat`, `unique`, `merge` branches from `variable-expression.schema.json` | Schema branch-specific | Variable expression schema | Existing staged Variable inspector; no runtime evaluation is implied |
| Assessment Evaluate | `and`, `or`, `one`, `xor`, conditional/input branches from `expression.schema.json` | Not a scalar value source | Expression schema and vocabulary term scopes | Source-backed evaluation tree with a schema-driven Add Test wizard; logical changes remain minimal and do not imply execution |
| Item/field cardinality | `item_requirement` and `field_requirement` members | Not a value source | Pinned cardinality schemas | Separate controls; never included in scalar operator lists |

## Variable compatibility

The schema validates the shape and named reference, while the editor also checks
a declared Variable datatype against the capability mapping's field datatype when
that metadata is available. Incompatible references are rejected before the
atomic source edit. Unknown or incomplete declarations remain visible as
unresolved source choices and are not replaced automatically.

The schema does not provide a generic “variable reference” wrapper outside these
specific alternatives. The editor therefore does not invent one, and it does
not expose Organizational Inputs as Object-selector sources.

## Visual evidence

- [Unified graphical-controls capture](evidence/graphical-unified-controls-20261106.png)
- [Extension Host graphical surface](evidence/issue-44-revised-host-1920x1080.png)
