# Issues #37, #38 and #39 native YAML progress

The pinned canonical schema and metadata pack remain unchanged. Graphical work is
frozen; existing Graphical entry remains an explicit optional command.

## Delivered

- **#39 / #35 autocomplete:** mapping completion now returns only missing,
  schema-valid keys at the current mapping level. Existing keys are excluded,
  including flow mappings with keys later on the same line. Prefixes such as
  `k:` still resolve to the missing canonical `key` property. Capability Object
  and `require.fields` scopes continue to derive from the selected capability
  schema and pinned capability metadata.
- Selecting a structured key in a block mapping no longer inserts an invalid
  flow opener. For example, `require` inserts `require:` in block context and
  retains flow syntax only inside an existing flow map. This prevents the
  common `require: {` followed by comma-less block children error.
- **#37 status:** recognized `*.assessment.yaml` documents automatically load
  the local verified pack and schema association. A compact clickable status
  item reports healthy/partial/error state. `SCAP-NG: Show YAML status` reports
  document URI/language, schema URI/version/path, pack path and manifest SHA,
  Red Hat status, association state, diagnostics and related commands.
- **#38 default:** the custom editor remains `priority: option`; ordinary
  double-click/open therefore uses the native full-width YAML editor. The
  Graphical editor is available only through the explicit command/menu.

## Actual host evidence

Using the installed Red Hat YAML extension and the pinned local pack:

- canonical Registry Assessment: status `healthy`, `yaml`, schema association
  present, schema `0.4.0`, pack manifest SHA
  `0b8df930cb25ce173138a759449dcf437a6ac3f3d3d680ecfaee6cb0024b464f`;
- ordinary `ordinary.yaml`: SCAP-NG status hidden;
- deleting rows and invoking completion in real host: missing-only menus for
  `object`, `require`, `item_requirement`, `field_requirement`, `fields` and
  `capability`; block `require` insertion is `require:`;
- no-pack host: status `error`, visible, association `false`, with actionable
  “No verified offline SCAP-NG metadata pack was found” detail.

Commands:

```sh
SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:host

npm run test:host:status
```

The host probe also covers hover, schema diagnostics, flow/block mappings,
Quick Fixes, schema-default templates, duplicate prevention, undo/redo and
schema mutation. A wrong-version/integrity pack is rejected by the pinned
`MetadataPack` validation and existing offline unit/integration tests; no
canonical schema is modified.
