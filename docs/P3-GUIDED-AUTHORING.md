# P3 Guided authoring checkpoint

The first Guided authoring slice is now available as **SCAP-NG: Create Guided Assessment**. It requires an explicitly configured, verified offline metadata pack and uses that pack for platform labels, mode/class enums, capability labels, cardinalities, and logical-operator descriptions.

The wizard supports:

- platform authoring context (not implicit CPE/applicability);
- standalone manual or automated Assessments;
- explicit manual procedure/response contract;
- capability, inline Object, Test title/ID and comparison fields;
- presence-only versus comparison `require` forms;
- `and`, `or`, `one`, and `xor` Test evaluation choices;
- schema validation before opening the generated YAML in VS Code.

Generated comparison requirements insert `item_requirement`, then `field_requirement`, then `fields`, preserving the owner-approved presentation order. `one` and `xor` remain distinct native tokens. The wizard does not emit scanner results or claim compliance.

This is intentionally a thin slice. Advanced multi-Test editing, dynamic record keys, variables, dependent inputs, diff approval, and full accessibility/extension-host coverage remain follow-up work. Users can immediately continue in Source or Structured mode; generated YAML is not a private second document model.

## Identity-first follow-up — 2026-11-04

The Guided Object step now treats item identity as a schema-derived contract:

- capability Object selector fields come from the pinned
  `x-scap-ng-authoring.context: selector_comparison` metadata;
- required selector groups come from the Object schema's `oneOf` branches;
- a Registry Object therefore requires `hive`, `key`, and `name`, while a Unix
  file Object can choose `full_path` or `directory` plus `name`;
- selector operators, datatypes, and selector enum values are resolved from the
  same schema pack used by native YAML completion;
- creation is blocked with a field-group message until one complete identity is
  supplied. No `replace me` value or scanner result is generated.

This is still a new-document wizard. Existing YAML remains source-authoritative;
advanced Object forms, Variables, dependent inputs, and multi-Test editing stay
available in Source/Structured mode.
