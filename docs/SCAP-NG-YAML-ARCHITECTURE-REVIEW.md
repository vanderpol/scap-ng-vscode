# SCAP-NG YAML architecture review

Updated 2026-11-03. This review evaluates **Option 1: the Red Hat YAML language service** before considering a custom language server.

## Recommendation

Keep the native `yaml` language ID and integrate with Red Hat YAML through the supported workspace `yaml.schemas` association. Do not replace VS Code's YAML editor or the source-preservation layer. Disable word-based suggestions only in the isolated SCAP-NG workspace configuration:

```json
{
  "yaml.schemas": {
    "file:///absolute/path/to/editor-pack/schemas/assessment.schema.json": ["**/*.assessment.yaml", "**/*.assessment.yml"]
  },
  "[yaml]": { "editor.wordBasedSuggestions": "off" }
}
```

The pinned offline pack remains authoritative. Red Hat owns ordinary JSON-Schema enum completion, hover, and schema diagnostics. A small SCAP-NG adapter is retained only for facts the JSON Schema cannot express or for behavior demonstrated missing in the host:

- selecting the capability schema from the authored `tests.*.capability` value;
- supplying capability identifiers from the pinned manifest catalog;
- supplying dynamic capability-object property names from the selected capability schema;
- filling cardinality completion in block mappings where the tested Red Hat release did not return a result;
- mapping incomplete YAML cursor positions, including flow maps, to those contexts.

This is an extension completion adapter, not a second YAML language server. It has no SCAP-NG enum or capability-field tables.

## Explicit host test dependency

The real host test uses the pinned test dependency in [`test-dependency-pins.json`](../test-dependency-pins.json): `redhat.vscode-yaml` v2.0.0. Install it into a temporary directory, never the user's global VS Code profile:

```sh
mkdir -p /tmp/scap-ng-redhat-extensions
code --extensions-dir /tmp/scap-ng-redhat-extensions \
  --install-extension /path/to/redhat.vscode-yaml-2.0.0.vsix
SCAP_NG_EXTENSIONS_DIR=/tmp/scap-ng-redhat-extensions npm run verify:test-deps
```

The extension directory is passed to the host with `--extensions-dir`; no global settings or global extensions are changed. The test is offline after the VSIX is available.

For disconnected DoD deployment, create `scap-ng-vscode-p0-offline-bundle.tgz` with:

```sh
SCAP_NG_METADATA_PACK=/approved/editor-pack \
SCAP_NG_REDHAT_YAML_DIR=/approved/redhat.vscode-yaml-2.0.0 \
npm run package:offline-bundle
```

The bundle contains the SCAP-NG VSIX, Red Hat YAML extension files, the verified editor pack, the pin descriptor, and third-party notices. It does not run `npm install` or fetch schemas at install/runtime.

## Real extension-host acceptance

Run from the extension root:

```sh
SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
SCAP_NG_EXTENSIONS_DIR=/tmp/scap-ng-redhat-extensions \
SCAP_NG_EXTENSION_PATH="$PWD" \
npm run test:host:redhat
```

`scripts/host-acceptance-probe.mjs` launches the actual VS Code executable with temporary user data, opens the real Windows Registry Assessment, and exercises the aggregated completion menu through `vscode.executeCompletionItemProvider`. It records and asserts:

- native language ID `yaml`;
- exact `class`, `mode`, `capability`, `items_found`, `items_satisfying`, `values_found`, and `values_matching` menus;
- no duplicate labels;
- selected-value insertion into incomplete block YAML;
- completion queried after a typed `c` prefix (without invoking Ctrl+Space);
- byte-for-byte source preservation on opening the canonical document;
- flow-map behavior;
- selected capability-schema object fields;
- Red Hat schema hover text;
- no diagnostics for the valid document and an error diagnostic for an invalid enum;
- workspace-local schema association;
- canonical Windows Registry, Unix file, and two-Test Assessment fixtures with inline and nested mappings.

Observed on 2026-11-03 with Red Hat YAML v2.0.0, using the installed VSIX in the user's VS Code extension directory:

```text
native language: yaml
completion menus: exact expected sets; no duplicate labels
insertion: class: compliance
hover: canonical Assessment allowed-values documentation
valid diagnostics: none
invalid enum: yaml-schema error
capability object: fields derived from windows.registry.schema.json
```

This is the first passing real-host receipt. Earlier receipts correctly exposed the defect: Red Hat returned no capability catalog (the assessment schema intentionally has no capability enum), and the extension's broad provider duplicated Red Hat enum entries. Both issues are now covered by the adapter boundary and duplicate-label assertions.

## Red Hat limitations and evidence

Red Hat YAML cannot infer a capability catalog from the assessment schema because `capability` is an open string selected by the pinned manifest. It also does not dynamically switch to a capability schema solely from that string. The host receipt demonstrated this by returning no capability values and no capability-specific object fields with Red Hat alone. The adapter supplies those values from `manifest.capabilities[capability].schema_uri`.

In the same host evaluation, the tested Red Hat release returned cardinality values for flow mappings after the language server warmed, but did not return the blank scalar completion for the corresponding block mapping. The adapter supplies only the missing block context and suppresses those values in flow contexts, preventing duplicates. Re-run with `SCAP_NG_SKIP_SCAP_EXTENSION=1` to inspect Red Hat-only behavior; the probe intentionally exits nonzero when the documented gaps are present.

The language service also cannot provide a schema-defined enum for an open catalog field or perform SCAP-NG semantic execution. Those are deliberately outside this integration. No network fetch is used for schemas or validation; all schema URIs resolve to the configured local pack.

## Schema-mutation acceptance

Two acceptance paths prove that the sources are not duplicated in extension code:

```sh
SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SOURCE_ROOT=.external/scap-ng \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:integration

SCAP_NG_EXTENSIONS_DIR=/tmp/scap-ng-redhat-extensions \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:host:mutation
```

The mutation probe copies the verified pack, changes a schema enum, description, and default, adds a compatible manifest capability, repins only the temporary fixture, and runs the real extension host. The 2026-11-03 receipt showed the new enum in completion and invalid-value diagnostic text, the changed description in hover, the changed default in completion metadata, and the new capability in the exact expected catalog. The integration acceptance additionally verifies that native completion and Graphical model controls expose the mutated enum, description, default, and capability without changing extension source.

## Schema-driven contract

The canonical schemas and manifest are authoritative for properties, types, enumerations, defaults, descriptions, validation, and capability-specific fields. The adapter may contain cursor/context resolution because JSON Schema cannot identify a YAML cursor or select a schema from an open catalog string. It must not contain a parallel vocabulary. A compatible schema-defined capability or field is therefore visible after pack replacement, as demonstrated by the mutation acceptance.

The Graphical editor remains frozen while P0 native authoring is stabilized. No read-only YAML preview or alternate YAML language mode is introduced by this evaluation. Source fidelity and offline operation remain unchanged.
