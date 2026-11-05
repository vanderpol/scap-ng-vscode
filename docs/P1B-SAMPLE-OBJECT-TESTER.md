# P1B: Offline Sample Object Tester

The native YAML editor exposes **SCAP-NG: Test Object with Sample Items** in the Command Palette and editor context menu for `*.assessment.yaml`. Place the caret on or inside a Test `object` and invoke it. The host resolves the capability from that enclosing Test's YAML ancestry; it never searches a sibling Test for a capability.

The panel shows the selected Object as read-only and a separate **Collected Item sample input** area. The generated starter is scaffolding only: select all of it and replace it with one canonical collected Item, an array, or `{items: [...]}` from a sanitized qualified fixture. Do not paste the Assessment YAML or raw command output. A canonical Item uses the pinned 0.4 shape (`id`, `capability`, `status`, `fields`, and `provenance`); each typed field includes `datatype`, `status`, and, when present, `value`.

For `independent.shellcommand` and other unsupported Objects, the panel says when the sample preview is postponed or cannot resolve authored members rather than inventing field values from Variable names. The editor never executes a command or resolves a Variable-backed command.

## Result boundary

The bounded adapter reports each Item and selector separately:

- Item index and ID
- selector field, authored operator, expected value, actual value and datatype
- matched, mismatched, missing or indeterminate status
- schema diagnostics for the capability-specific collected Item shape
- selected Item indices

Missing fields, empty fields, non-`exists` field statuses, unresolved Variables/Inputs, multiple operands, incompatible datatypes and operators without a qualified adapter remain explicit indeterminate states. They are not turned into false. The tool does not evaluate `item_requirement`, `field_requirement`, `require.fields`, Variables, Test rollups, groups or six-state Assessment Evaluation, and it never reports scanner evidence or compliance PASS/FAIL.

The currently bounded comparison adapter covers strict `equals`/`not_equal`, string `case_insensitive_equals`/`case_insensitive_not_equal`, finite numeric ordering, and regex preview through the same worker-backed `PCRE2-safe-preview` adapter used by P1A. The authored Object and Item structure remains schema-validated by the selected pinned offline pack. This is an explicit preview boundary, not a replacement for a qualified SCAP-NG evaluator.

No source YAML is modified by the tester. Unsaved document contents are read directly from the active TextDocument, and all sample data remains local to the webview/extension process.
