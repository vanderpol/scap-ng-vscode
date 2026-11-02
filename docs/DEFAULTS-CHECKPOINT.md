# Offline metadata and source-edit checkpoint

Implements the offline adapter fallback accepted in historical research #269;
coordinated under public [editor #7](https://github.com/vanderpol/scap-ng-vscode/issues/7),
dependencies #1/#2. Historical upstream issue references have moved into the
private `scap-ng-research` repository and are not required for current editor
development.

## Exact external profile

`schema-profile.json` pins the public canonical SCAP-NG 0.4 source
`d4e477998cda438a1e53a7c3c84123ec92e5ba1f`, manifest SHA-256
`33fa58aa40b627fc1d3ae03a5ef08312461614f3c99f21ffedf26003524d4dee`.
This is a pre-alpha metadata checkpoint, not a release. Select exact checked-out
copies of the public canonical spec, tools exporter and official OVAL v5.12.3.
This follow-on source pin incorporates presentation-only requirements-first
canonical examples. All 235 resource identities/capability definitions are
identical to the prior pack; only the manifest's source commit and manifest
digest changed from the previously reviewed profile.
From a single VS Code editor checkout, see [the bootstrap guide](WORKSPACE-BOOTSTRAP.md)
and use `npm run bootstrap:deps`, install the tools Python dependencies, then
`npm run bootstrap:pack` and `npm run verify:offline`. The equivalent manual
external export is:

```sh
PYTHONPATH=/path/to/scap-ng-tools/src python /path/to/scap-ng-tools/scripts/build_v04_editor_metadata_pack.py \
  --schema-root /path/to/scap-ng \
  --oval-root /path/to/OVAL-v5.12.3 \
  --source-commit d4e477998cda438a1e53a7c3c84123ec92e5ba1f \
  --output /path/to/metadata-pack
SCAP_NG_METADATA_PACK=/path/to/metadata-pack SCAP_NG_SOURCE_ROOT=/path/to/scap-ng npm run test:integration
```

The pack is generated externally from all 100 capability schemas/mappings,
34 root schemas and version-local vocabulary (235 resources). Only three small,
reviewed synthetic Result A/selector test fixtures are carried in this editor
repository, with exact hashes in [fixture provenance](../test/fixtures/README.md).
No canonical schema files or signed benchmark content are bundled. The manifest
and each resource must match the explicit profile, version and SHA; traversal,
symlink escapes, duplicate resource identities, unpublished packs, corrupt hashes
and stale versions fail closed. There is no runtime network loader, telemetry or
source upload. Manifest hashes provide integrity, not publisher signatures.

## Implemented and tested

- One immutable adapter reads the same schema help/defaults/enums for Source/Structured/Guided consumers; mode cannot select a different registry. Vocabulary/mappings are available from the same pinned pack.
- The owner-amended schema pack supplies resolved descriptions for all 610 Object property occurrences. A fresh external integration checks every location through the actual adapter; no competing help registry or upstream assets are vendored. This does not supply the still-missing extension host.
- All 264 annotated locations resolve, every scalar/object suggestion validates, every key default is present in the schema-derived alternatives, and 38 distinct controls are accounted for across 100 contracts.
- Show All, Hide Defaults and separate aggressive-preview **view models** have counts/group summaries and a reveal path (`show-all`). Hidden values stay serialized. Explicit overrides, non-defaults, diagnostics, absent values and unknown context remain visible. Operator hiding affects the dropdown only; operands/predicates remain visible. No full Assessment evaluation is provided.
- New authoring is an explicit API operation with supplied seeds/operands. It does not create optional branches. Conditional matching follows schema pointers; schema validation never inserts defaults. Shell suggestions false/false are preserved as Booleans. Present Windows and Unix traversal suggestions remain distinct.
- SourceBuffer never changes existing documents on open/save. Supported scalar edits splice one YAML source range; undo restores the exact original string. Unsafe anchors/aliases/tags/block scalars and malformed YAML decline graphical editing. Existing source remains available. Stale revision hashes fail. This is a source-edit foundation, **not native VS Code undo/redo or a TextDocument integration**.
- Integration opens three real original-backed Linux/Windows fixtures from the external source checkout, validates their schemas and tests byte-identical open/save, minimal title edit, schema revalidation and undo. No fixture content is vendored here.
- Synthetic unit tests verify metadata/help updates with deliberately repinned schemas, stale/hash/path failures, one-source help across modes, required serialization, absent optional structures, view models and source preservation. Synthetic schema tokens are test data, not a SCAP grammar/enum registry.

## Precise implementation dependency

The P0/P1 extension host, `CustomTextEditorProvider`, shared `TextDocument`, `WorkspaceEdit`, Assessment Studio tree, source-backed Structured UI and VSIX are now implemented. Guided authoring remains a later milestone; no mock image or fabricated UI evidence is supplied. Wire adapter diagnostics into the UI and display the selected profile before accepting graphical edits.

The practical offline regex tester and sample-evidence playground remain required under #7, with dialect labels, bounded worker execution, positive/negative samples and integer regex capture tests. They are **not implemented in this checkpoint**, and must be part of the initial usable editor demo. Full sample Assessment PASS/FAIL remains unavailable until a qualified evaluator exists. These are implementation tasks, not semantic owner votes; they do not block upstream default classification. No scanner-runtime equivalence is claimed.

## Maintenance

`npm ci`, `npm run lint`, `npm test`, and `npm run package:vsix` are the bounded local gate. Integration uses the external source/pack paths above and never downloads source at runtime. The generated VSIX is verified as a ZIP archive before installation. Dependency versions/integrity are locked; licenses are in THIRD-PARTY-NOTICES.md. Schemas are supplied separately under owner control. Updating the supported pin is deliberate; a newer compatible metadata pack changes help/enums without changing consumer code, but never bypasses version/hash checks.

## Historical conformance handoff — reproducible export

Recovery found that the prior external pack exporter serialized selector maps in
Python set order: identical source trees produced different byte hashes. The
adapter correctly rejected the mismatched digest; its integrity checks remain
unchanged. Upstream now sorts JSON object keys and tests whole-pack equality
across separate processes/hash seeds. The profile above selects that new exact
source, with no grammar, help, default or enum changes. Two fresh clean exports
must be byte-identical before repinning. This is still an offline adapter; all
extension-host, UI and playground dependencies above remain open under #7/#1/#2.

## Adopted optional Input guard profile

The selected upstream draft now includes the owner-adopted explicit
input_provided conditional and closed Input declaration controls. External
integration opens its distinct source-derived example without inserting
bindings/defaults, validates shape, preserves no-op bytes and rejects missing
required declaration fields. Static transitive guard dominance, supplied binding
states and program0.2 verification belong to the upstream compiler/tests; JSON
Schema-only adapter checks do not claim those semantic or runtime guarantees.
The original host/UI/playground dependencies remain open. The earlier NO-GO
decision was superseded by the owner freeze and the specifically approved
2026-11-02 pre-release Item grouping amendment. This pin is still not a release
or an independent scanner/proof qualification.

The previous 2026-11-02 research profile captured the correction preserving
authored logical names in program0.2 source paths. The **current canonical
profile** reproduces the **owner-amended 235-resource** schema/mapping/
vocabulary pack, not the byte-identical original research export: the
Item requirement schema and vocabulary changed deliberately while the 100
capability/mapping resource definitions remained stable. Legacy program0.1 and
historical proof bytes remain outside this editor project.
