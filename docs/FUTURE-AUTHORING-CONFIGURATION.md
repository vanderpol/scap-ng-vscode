# Future YAML authoring configuration

This document records planned authoring preferences. These settings are **not
implemented yet** and should not be added to a user's `settings.json` until the
extension contributes them.

## Proposed Object style preference

The native YAML completion could expose:

```json
"scapNg.objectStyle": "auto"
```

Supported values under consideration:

- `auto` — preserve the surrounding YAML style; recommended default.
- `block` — insert new Object mappings as readable multiline YAML.
- `flow` — use compact `{...}` mappings when safe.

The preference would affect newly inserted completion and Quick Fix text only.
It would not reformat an existing Assessment on open or save. `flow` would fall
back to block style when comments, anchors, multiline scalars, complex keys, or
line-length limits make a one-liner unsafe.

## Discoverability

When implemented, the extension should make preferences discoverable through:

1. **Settings UI** — search for `SCAP-NG` or `SCAP-NG Object Style`; the
   contributed setting should provide the enum choices and descriptions.
2. **Command Palette** — `SCAP-NG: Configure YAML authoring` should open the
   relevant settings and explain the active choices.
3. **Settings JSON** — the setting name and examples should be documented here,
   in the README, and in the extension's configuration contribution.
4. **Status/diagnostics** — authoring diagnostics should identify when a
   preference is unavailable or overridden by a workspace setting; they should
   not silently change YAML semantics.

## Other future preferences

Additional candidates can be added only when they have a clear source-preserving
contract:

- preferred indentation width for newly inserted block structures;
- an optional line-length threshold for `auto` style;
- whether required-property Quick Fixes are offered individually, as a grouped
  Object action, or both;
- visibility of schema documentation in an optional side panel;
- whether completion details show defaults, placeholders, or both.

These are presentation and authoring preferences, not alternate schemas. The
pinned offline schema pack remains authoritative for properties, operators,
values, defaults, and validation. Preferences must not introduce capability,
operator, function, or semantic lists in TypeScript.
