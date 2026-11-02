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
