# Offline metadata and source-edit checkpoint

Implements the adapter fallback explicitly authorized in [upstream #269](https://github.com/vanderpol/scap-ng/issues/269); coordinated under [editor #7](https://github.com/vanderpol/scap-ng-vscode/issues/7), dependencies #1/#2. The source repository was documentation-only at `2f12e81b38a996e55e115ec72caa02e49099ad53`.

## Exact external profile

`schema-profile.json` pins SCAP-NG0.4.0 source `fecb541f9c226706738fd3d113ef1047f37faaaf`, manifest SHA256 `7c75a0dcdd97398395e407a5f5368c0f2b9e653b9b0aaf9f1e80407a438a6161`. This is a draft metadata checkpoint, not a release. Select an existing owner-authorized local upstream checkout at that commit and export to a new directory:

```sh
PYTHONDONTWRITEBYTECODE=1 python /path/to/scap-ng/tools/build_v04_editor_metadata_pack.py --output /path/to/metadata-pack
SCAP_NG_METADATA_PACK=/path/to/metadata-pack SCAP_NG_SOURCE_ROOT=/path/to/scap-ng npm run test:integration
```

The pack is generated externally from all100 capability schemas/mappings, shared schemas and version-local vocabulary. No upstream assets, content or implementation are copied into this editor repository. No upstream license decision is implied. The manifest and each resource must match the explicit profile, version and SHA; traversal, symlink escapes, duplicate resource identities, unpublished packs, corrupt hashes and stale versions fail closed. There is no network loader, telemetry or source upload. Manifest hashes provide integrity against the selected profile, not publisher signatures.

## Implemented and tested

- One immutable adapter reads the same schema help/defaults/enums for Source/Structured/Guided consumers; mode cannot select a different registry. Vocabulary/mappings are available from the same pinned pack.
- The #268 conformance-remediation pin supplies resolved descriptions for all610 Object property occurrences. A fresh external integration checks every location through the actual adapter; no competing help registry or upstream assets are vendored. This does not supply the still-missing extension host.
- All264 newly annotated locations resolve, every scalar/object suggestion validates, every key default is present in the schema-derived alternatives, and38 distinct controls are accounted for across100 contracts.
- Show All, Hide Defaults and separate aggressive-preview **view models** have counts/group summaries and a reveal path (`show-all`). Hidden values stay serialized. Explicit overrides, non-defaults, diagnostics, absent values and unknown context remain visible. Operator hiding affects the dropdown only; operands/predicates remain visible. No full Assessment evaluation is provided.
- New authoring is an explicit API operation with supplied seeds/operands. It does not create optional branches. Conditional matching follows schema pointers; schema validation never inserts defaults. Shell suggestions false/false are preserved as Booleans. Present Windows and Unix traversal suggestions remain distinct.
- SourceBuffer never changes existing documents on open/save. Supported scalar edits splice one YAML source range; undo restores the exact original string. Unsafe anchors/aliases/tags/block scalars and malformed YAML decline graphical editing. Existing source remains available. Stale revision hashes fail. This is a source-edit foundation, **not native VS Code undo/redo or a TextDocument integration**.
- Integration opens three real original-backed Linux/Windows fixtures from the external source checkout, validates their schemas and tests byte-identical open/save, minimal title edit, schema revalidation and undo. No fixture content is vendored here.
- Synthetic unit tests verify metadata/help updates with deliberately repinned schemas, stale/hash/path failures, one-source help across modes, required serialization, absent optional structures, view models and source preservation. Synthetic schema tokens are test data, not a SCAP grammar/enum registry.

## Precise implementation dependency

There is no extension-host activation/manifest, `CustomTextEditorProvider`, shared `TextDocument`, `WorkspaceEdit`, Assessment Studio tree, Structured/Guided UI, VSIX or graphical test runner in this repository yet. The deliverable is a TypeScript **library foundation**. A real editor screenshot/GIF cannot be produced until #1/#2 supply that vertical slice; no mock image or fabricated UI evidence is supplied. Those issues remain open. Wire adapter diagnostics into the UI and display the selected profile before accepting graphical edits.

The practical offline regex tester and sample-evidence playground remain required under #7, with dialect labels, bounded worker execution, positive/negative samples and integer regex capture tests. They are **not implemented in this checkpoint**, and must be part of the initial usable editor demo. Full sample Assessment PASS/FAIL remains unavailable until a qualified evaluator exists. These are implementation tasks, not semantic owner votes; they do not block upstream default classification. No scanner-runtime equivalence is claimed.

## Maintenance

`npm ci`, `npm run lint`, `npm test`, `npm run package` are the bounded CI gate. Integration uses the external source/pack paths above and never downloads source at runtime. The package tarball is not a VSIX. Dependency versions/integrity are locked; licenses are in THIRD-PARTY-NOTICES.md. Schemas are supplied separately under owner control. Updating the supported pin is deliberate; a newer compatible metadata pack changes help/enums without changing consumer code, but never bypasses version/hash checks.
