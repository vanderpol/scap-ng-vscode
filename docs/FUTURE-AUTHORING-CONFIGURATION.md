# Future YAML authoring configuration

This document records authoring preferences. The Object style setting below is
implemented; the remaining ideas are still proposals and should not be added to
a user's `settings.json` until the extension contributes them.

## Object style preference

The YAML editor and GUI-created Assessments should share one presentation
preference for **newly authored Object mappings**:

```json
"scapNg.objectStyle": "tree"
```

Supported values:

- `compact` — write Object mappings in compact inline/flow style where safe,
  such as `object: {full_path: /etc/passwd}`.
- `expanded` — write Object mappings as readable multiline block YAML.
- `tree` — follow the current YAML tree: preserve the nearest ancestor's
  compact/flow or expanded/block style. This is the default.

The `tree` mode is the important default: a new child inserted into a flow
Object remains compact, while a child inserted into a block Object remains
expanded. An explicit `compact` or `expanded` choice applies only to new
Object mappings; it must not reformat an existing Assessment on open or save.
When the requested style cannot be represented safely inside an existing flow
map, the editor preserves the parent's style rather than producing invalid
YAML. Existing comments, anchors, multiline scalars, complex keys, and other
source-preservation hazards likewise remain under the source editor's safe-edit
guards.

This preference affects native YAML completion/Quick Fix insertions and the
serialization of GUI-created Assessment Objects. Minimal edits to existing
YAML continue to preserve the source's own flow/block style regardless of the
setting.

## Discoverability

The Object style setting is discoverable through the VS Code Settings UI and
`settings.json`; its enum choices and descriptions are contributed by the
extension. A future `SCAP-NG: Configure YAML authoring` command may provide a
more guided entry point. Authoring diagnostics should identify when a
preference is unavailable or overridden by a workspace setting; they should not
silently change YAML semantics.

## Other future preferences

Additional candidates can be added only when they have a clear source-preserving
contract:

- preferred indentation width for newly inserted block structures;
- an optional line-length threshold for `compact` style;
- whether required-property Quick Fixes are offered individually, as a grouped
  Object action, or both;
- visibility of schema documentation in an optional side panel;
- whether completion details show defaults, placeholders, or both.

These are presentation and authoring preferences, not alternate schemas. The
pinned offline schema pack remains authoritative for properties, operators,
values, defaults, and validation. Preferences must not introduce capability,
operator, function, or semantic lists in TypeScript.
