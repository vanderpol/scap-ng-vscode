# SCAP-NG YAML architecture review

Updated 2026-11-03. This is a release-blocking review of the failed autocomplete prototype.

## Recommendation

Do not rewrite the Graphical editor or source-preservation layer. Freeze the current completion provider as a diagnostic proof of concept and do not call it accepted.

A dedicated `scap-ng-yaml` language mode is the correct isolation boundary for `editor.wordBasedSuggestions: off`, but the existing Red Hat YAML extension is expected to select `yaml`, not an arbitrary new language identifier. VS Code extensions cannot extend another extension's document selector. Conversely, keeping the document as `yaml` preserves Red Hat integration but makes word-suggestion suppression language-wide; VS Code has no resource-pattern-specific editor override for this setting.

**Decision:** first require an extension-host acceptance run with the actual Red Hat YAML extension. If it cannot attach to `scap-ng-yaml` or provide an opt-in per-resource mode, implement a small, schema-driven SCAP-NG language-service adapter rather than more path-specific completion patches. Keep native YAML/TextDocument editing either way.

## Findings

- The pinned pack is authoritative for schemas, enums, defaults, descriptions, and the manifest capability catalog.
- The built-in VS Code YAML contribution is grammar/configuration support; it does not provide the Red Hat schema language service.
- The current VM has no `redhat.vscode-yaml` extension installed. The host therefore cannot prove Red Hat completion, hover, or schema diagnostics here.
- The prior real-host probe reproduced the failure: when the provider was not selected, `class` returned 69 document-word suggestions and `values_matching` returned 208 unrelated words. With an explicit `file` document selector and flow-map ancestry handling, the same host returned exact scoped lists. That proves the old provider-selection failure; it does **not** prove the Red Hat-backed architecture.

## Schema-driven contract

The language service must consume the verified `MetadataPack` only:

- root Assessment/Rule/Benchmark schemas for properties, types, enums, defaults, descriptions, and validation;
- the manifest capability catalog for capability identifiers;
- the selected capability schema for `object` and result fields;
- YAML CST/AST context for block maps, flow maps, nested tests, and incomplete documents.

The implementation may contain only a small versioned adapter for facts JSON Schema cannot express: selecting a capability schema from the authored `tests.*.capability`, mapping an incomplete YAML cursor to its nearest schema node, and handling schema `oneOf`/`additionalProperties` ambiguity. It must not duplicate SCAP-NG property or vocabulary lists.

## Proof-of-concept and acceptance harness

`scripts/host-acceptance-probe.mjs` launches a real VS Code extension host, opens the canonical Windows Assessment, and records completion, insertion text, hover, diagnostics, language ID, Red Hat-extension presence, and configured schema associations. It derives expected values from the pinned pack rather than hardcoding them. Run it only where VS Code and the optional Red Hat extension are available:

```sh
SCAP_NG_METADATA_PACK=.external/editor-pack \
SCAP_NG_SAMPLE_ROOT=.external/scap-ng-editor-sample-data \
npm run test:host
```

The host receipt is intentionally non-green when Red Hat YAML is absent: absence is an architectural finding, not a completion success. The immediate gate requires exact-only menus for `class`, `mode`, capability, `items_found`, `items_satisfying`, `values_found`, and `values_matching`, correct insertion text, non-empty schema hover, and schema diagnostics on an invalid edit.

## Schema-mutation acceptance

The metadata/unit fixtures already prove that changing an enum or description in a compatible pack changes `MetadataPack.describe()` without extension-source changes. The host acceptance fixture must extend that proof: mutate enum, description, default, and manifest capability definition in a temporary verified pack, open the same real Assessment, and assert that completion, hover, validation, and Graphical controls change. A compatible new capability or field must be visible through the catalog/schema without a new property list in TypeScript.

Until that host receipt passes with the chosen language-service architecture, autocomplete remains release-blocked.
