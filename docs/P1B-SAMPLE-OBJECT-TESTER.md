# P1B: Offline Sample Object Tester

The native YAML editor exposes **SCAP-NG: Test Object with Sample Items** in the Command Palette and editor context menu for `*.assessment.yaml`. Place the caret inside an inline Test `object` and invoke it. The host resolves the capability from that enclosing Test's YAML ancestry; it never searches a sibling Test for a capability.

The panel shows the selected Object and an editable YAML/JSON sample area. Samples may be one canonical collected Item, an array, or `{items: [...]}`. A canonical Item uses the pinned 0.4 shape (`id`, `capability`, `status`, `fields`, and `provenance`); each typed field includes `datatype`, `status`, and, when present, `value`. The starter sample is generated from the selected Object only as editable authoring scaffolding and is labeled as offline sample data.

## Result boundary

The bounded adapter reports each Item and selector separately:

- Item index and ID
- selector field, authored operator, expected value, actual value and datatype
- matched, mismatched, missing or indeterminate status
- schema diagnostics for the capability-specific collected Item shape
- selected Item indices

Missing fields, empty fields, non-`exists` field statuses, unresolved Variables/Inputs, multiple operands, incompatible datatypes and operators without a qualified adapter remain explicit indeterminate states. They are not turned into false. The tool does not evaluate `item_requirement`, `field_requirement`, `require.fields`, Variables, Test rollups, groups or six-state Assessment Evaluation, and it never reports scanner evidence or compliance PASS/FAIL.

The currently bounded comparison adapter covers strict `equals`/`not_equal`, string `case_insensitive_equals`/`case_insensitive_not_equal`, finite numeric ordering, and regex preview through the same worker-backed `ECMAScript-safe-preview` adapter used by P1A. The authored Object and Item structure remains schema-validated by the selected pinned offline pack. This is an explicit preview boundary, not a replacement for a qualified SCAP-NG evaluator.

No source YAML is modified by the tester. Unsaved document contents are read directly from the active TextDocument, and all sample data remains local to the webview/extension process.
