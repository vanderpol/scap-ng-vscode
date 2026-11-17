# P0 native YAML property rediscovery

The native YAML editor remains the authoring surface. Graphical editor work is
frozen while this P0 is evaluated.

## Behavior

- In VS Code, invoke the completion menu with **Ctrl+Space**. **Shift+Space**
  inserts a literal space and is not the VS Code completion command; it will
  therefore show no suggestions. Completion also appears naturally after a
  valid property/value prefix.
- Mapping completion is derived from the pinned assessment and selected
  capability JSON Schemas and suppresses keys already present in the current
  mapping. Prefix edits still replace the typed key rather than creating a
  duplicate. This includes `object`, nested Object mappings,
  `require`, `item_requirement`, `field_requirement`, and capability-specific
  `require.fields` mappings.
- Completion documentation comes from schema descriptions (or the existing
  pinned catalog descriptions for catalog values). Structured properties with
  complete schema defaults insert an inline template; `item_requirement` and
  `field_requirement` therefore insert their complete canonical default pairs.
  A property with no canonical default is inserted as an empty structured
  mapping so the author can continue with the next schema-backed completion;
  no fabricated value is inserted.
- A custom schema-required diagnostic collection reports missing required keys
  without replacing Red Hat YAML's native schema diagnostics. Quick Fixes use
  `WorkspaceEdit`, preserve existing keys, and insert at the YAML CST mapping
  boundary so block siblings are not joined together.
- Existing properties are checked before a Quick Fix is created. Re-running a
  Quick Fix cannot duplicate a key, and the host acceptance probe verifies
  undo/redo restores the exact before/after document text.
- When an Object is missing multiple required members, one additional schema-derived Quick Fix can insert the missing sibling skeletons together; individual fixes remain available. No selector values or operators are invented.

## Verification

The real extension-host probe (`scripts/host-acceptance-probe.mjs`) opens the
canonical Windows Registry Assessment plus Unix and multi-Test fixtures. It
checks completion labels and insertion, schema descriptions for property
items, Red Hat hover/diagnostics, missing-property diagnostics and Quick Fixes
for `object`, `require`, `item_requirement`, `field_requirement`, and `fields`,
flow/block behavior, duplicate prevention, and undo/redo.

Run with the pinned offline inputs:

```sh
SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SOURCE_ROOT=.external/scap-ng \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:integration

SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:host
```

The Red Hat YAML extension must be installed in the VS Code extensions
 directory for host acceptance. The probe does not download schemas or use
 network services.

## Boundary

JSON Schema cannot provide a meaningful value for a required open string or a
non-empty `additionalProperties` mapping when no default is defined. The
extension deliberately does not invent one: it inserts the schema-shaped
mapping and leaves the resulting required-value diagnostic visible. Such
fields continue through the next context-sensitive completion.
