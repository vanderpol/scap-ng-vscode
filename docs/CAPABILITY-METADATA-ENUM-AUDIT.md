# Capability metadata enum audit

Updated 2026-11-03 for the SCAP-NG 0.4.0 native YAML acceptance work.

## Decision

`native.selector_value_enums` and `native.state_value_enums` are part of the
pinned SCAP-NG capability-mapping contract. They are not editor-only or
converter-private fields, and they do not reintroduce authored OVAL `State`
objects.

The names are source-lineage terminology:

- `selector_value_enums` describes closed values for native `Object` selector
  fields.
- `state_value_enums` describes closed values for collected fields used by
  native `require.fields` predicates. “State” here identifies the collected
  field domain inherited from the source model; SCAP-NG 0.4 authoring still
  uses `require.fields`, not OVAL State objects.

No canonical mapping, authoring schema, or converter contract is renamed by
this audit.

## Evidence that the fields are canonical

The pinned 0.4 mapping records use format
`scap-ng-capability-mapping-0.2`, carry `specification_version: 0.4.0`, and
ship these fields under `native` in the canonical SCAP-NG repository. They are
also referenced by the pinned `authoring-vocabulary.en.json`:

- `windows.registry` selector `hive` → `native.selector_value_enums.hive`
- `windows.registry` field `type` → `native.state_value_enums.type`

The generated-schema tool consumes `selector_value_enums` when generating
closed Object selector schemas. The runtime converter consumes both fields
when validating source enum crosswalks and native values. Documentation
-generation consumes `state_value_enums` for capability field tables.

Repository consumers found in this audit:

| Consumer | Use |
|---|---|
| `scap-ng-tools/scripts/_v04_generation/generate_capability_schema_v04.py` | Emits reviewed closed selector enum constraints |
| `scap-ng-tools/src/.../v04_direct_converter.py` | Validates selector/state crosswalks and native enum values |
| `scap-ng/tools/generate_docs.py` | Generates capability metadata documentation |
| `schema/authoring-vocabulary.en.json` | Declares editor-facing `allowed_values_source` pointers |
| VS Code extension adapter | Uses mapping values only when the selected field schema has no enum |

The converter uses the fields in current 0.4 runtime paths; therefore treating
them as legacy converter-internal names and renaming them in the editor would
break the canonical producer/consumer contract.

## Schema versus mapping authority

The extension now follows this order for a selected capability field:

1. Use an enum directly present in the selected JSON Schema operator/value
   branch.
2. If the schema intentionally models the capability-native field as an open
   string, use the pinned mapping's `native.selector_value_enums` for Object
   selectors or `native.state_value_enums` for `require.fields`.
3. If neither source supplies a closed domain, leave the value authorable as a
   free scalar and rely on schema diagnostics/semantic validation.

This is required for `windows.registry` `type`: the generated 0.4 schema
currently describes the collected `type` field as a string comparison field;
the capability mapping supplies the reviewed native Registry-type domain.
No value list is duplicated in extension source.

## Modern naming proposal

`object_value_enums` and `field_value_enums` are clearer to authors because
they avoid the historical “State” word. They should be considered only as an
**additive, versioned mapping-contract change**, not an editor-only rename.

If the canonical SCAP-NG project adopts them, the compatibility plan should
be:

1. Add the modern names in a reviewed mapping format revision while retaining
   the current names for one compatibility period.
2. Normalize both spellings in one small versioned metadata adapter:
   - Object: `object_value_enums` ↔ `selector_value_enums`
   - require field: `field_value_enums` ↔ `state_value_enums`
3. If both spellings are present, require byte-equivalent value domains;
   conflicting domains must disable the affected completion rather than pick
   one silently.
4. Update the generator, converter, documentation generator, vocabulary
   source pointers, pack manifest/profile, and third-party acceptance fixtures
   together.
5. Repin the editor pack only after owner review. Do not modify the 0.4
   authoring JSON Schemas as part of the naming migration.

Until that contract change is approved, the extension intentionally reads the
canonical names and isolates the fallback in `mappingEnumValues`.

## Windows Registry datatype verification

The native Registry field domain contains 12 normalized SCAP-NG values:

```text
binary
dword
dword_big_endian
expand_string
link
multi_string
none
qword
string
resource_list
full_resource_descriptor
resource_requirements_list
```

The mapping crosswalk is reviewed against the pinned OVAL Windows registry
schema:

| Source registry type | SCAP-NG native value |
|---|---|
| `reg_binary` | `binary` |
| `reg_dword` | `dword` |
| `reg_dword_little_endian` | `dword` |
| `reg_dword_big_endian` | `dword_big_endian` |
| `reg_expand_sz` | `expand_string` |
| `reg_link` | `link` |
| `reg_multi_sz` | `multi_string` |
| `reg_none` | `none` |
| `reg_qword` | `qword` |
| `reg_qword_little_endian` | `qword` |
| `reg_sz` | `string` |
| `reg_resource_list` | `resource_list` |
| `reg_full_resource_descriptor` | `full_resource_descriptor` |
| `reg_resource_requirements_list` | `resource_requirements_list` |

The source contains deprecated little-endian aliases whose semantics are
explicitly the same as `reg_dword`/`reg_qword`; collapsing those aliases is
intentional. The 12-value native list therefore represents the supported
Windows Registry storage types without exposing deprecated source spellings
as separate SCAP-NG values. It is distinct from the comparison datatype of
`value` (`string`, `integer`, `binary`, or `version`).

## Acceptance status

The single-Registry Assessment host probe now verifies:

- Registry `hive` schema enum completion;
- Registry `type` mapping enum completion, including `dword`;
- schema-derived operator menus and insertion;
- no duplicate or hardcoded capability vocabulary;
- valid canonical Windows Registry, Unix file, and multi-Test documents;
- Red Hat YAML diagnostics/hover behavior.

No canonical schema or converter functionality was changed during this audit.
