# SCAP-NG schema-version migration plan

## Purpose

SCAP-NG schema revisions are expected frequently while the contract is
stabilizing. The editor must be able to move from one **pinned contract** to
the next without a scattered search-and-replace, ambiguous validation, or
silently mixing converter and editor versions.

The editor remains offline-first, source-preserving, and provenance-pinned.
A schema version is not considered available merely because a converter or
research checkout contains files bearing that version.

## Version vocabulary

Keep these identities separate in code, diagnostics, and documentation:

- **Editor contract version**: the schema pack accepted by `MetadataPack`.
- **Schema URI version**: the version embedded in `$id` and `$ref` URIs.
- **Document specification version**: the version authored in Assessment or
  Benchmark YAML.
- **Converter semantic version**: the version used by an importer/exporter.
- **Pack provenance**: canonical source commit, manifest digest, resource
  digests, and publication/status channel.

The editor must never infer one of these from another.

## Phase 0 — contract gate (before any version change)

1. Obtain the canonical, public schema snapshot and exact source commit.
2. Build or receive the matching offline pack.
3. Record `schemaVersion`, source commit, manifest SHA-256, resource count,
   publication status, and generator revision in `schema-profile.json`.
4. Reject draft/private/unpublished packs as editor build dependencies.
5. Validate a no-op load, a valid document, a malformed document, and an
   intentional schema-negative document against the candidate pack.
6. Keep the current pack available as the rollback baseline.

**Deliverable:** a reviewed versioned pack receipt. No editor code should be
updated before this receipt exists.

## Phase 1 — centralize version access

Create one `SchemaContract` module. It should expose:

```ts
contract.schemaVersion
contract.schemaUri('assessment.schema.json')
contract.resource(uri)
contract.validate(uri, value)
contract.provenance
```

Replace literal `https://scap-ng.dev/schema/v0.4.0/...` strings throughout the
extension with this module. This includes completion, guided authoring,
structured editing, graphical editing, diagnostics, and schema associations.

The UI should consume the active pack contract rather than a compile-time
version constant.

## Phase 2 — explicit compatibility adapters

For each supported document contract, define a small adapter containing only
actual differences:

- document/version field locations;
- schema URI/resource names;
- Assessment specification serialization;
- changed requirement or selector shapes;
- changed authoring metadata.

Do not branch on scattered version strings. Do not silently normalize a newer
document into an older contract. Unsupported versions must produce an
actionable diagnostic with the required pack version.

Initially support:

- the current pinned contract as the rollback baseline;
- the next approved contract as an opt-in migration candidate.

## Phase 3 — converter boundary

The converter must declare its output contract explicitly and emit a receipt
containing:

- source SCAP/XCCDF version and digest;
- target SCAP-NG contract version;
- converter commit;
- transformed document counts;
- unsupported or lossy transformations;
- validation pack provenance.

Converter output must not be admitted to the editor merely because its files
parse. The editor accepts it only when its declared target contract matches
the installed pinned pack.

## Phase 4 — fixtures and regression matrix

Maintain small, version-labeled fixtures for:

- valid automated Assessment;
- valid manual Assessment;
- Benchmark, Rule, and Applicability catalog;
- applicability Assessment;
- malformed YAML;
- source-preservation comments, anchors, flow style, CRLF, and Unicode;
- schema-negative edits;
- graphical edit plus exact Undo/Redo.

Run the same behavioral suite against each supported contract. Preserve the
original fixture bytes; edits operate on copies or reversible buffers. Update
the fixture manifest for every deliberate fixture or pin change.

## Phase 5 — version-aware UX

The Home/About/Diagnostics surfaces should show:

- active schema contract version;
- pack status: verified, missing, mismatched, or unsupported;
- source commit and manifest digest prefix;
- document version versus active pack version;
- a clear “install/select matching pack” action.

Graphical editors should remain schema-driven and avoid hardcoded version-
specific controls where the pack can describe the shape.

## Phase 6 — migration and rollback checklist

For a new approved version:

1. Add the candidate pack and profile receipt.
2. Add the contract adapter and dynamic URI access.
3. Run the dual-version test matrix.
4. Run source-preservation and graphical edit probes.
5. Run converter corpus validation and inspect receipts.
6. Update documentation and build/About output.
7. Package and install the candidate VSIX in an isolated VS Code profile.
8. Test Home, Benchmark selection, Rule/Assessment navigation, YAML,
   Graphical, and Split workflows.
9. Promote the candidate only after review; retain the prior pack for rollback.

Rollback must be a pack/profile selection change, not a source rewrite.

## Immediate next work

1. Add `SchemaContract` and remove hardcoded 0.4.0 URI construction.
2. Add a pack-provenance diagnostic and a version compatibility test.
3. Add a second-contract fixture harness without changing the active pin.
4. Obtain the authoritative 0.4.1 pack and receipt.
5. Run 0.4.1 as an opt-in candidate before changing the default.
