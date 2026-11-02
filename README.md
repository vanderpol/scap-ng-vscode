# SCAP-NG Assessment Studio for VS Code

An open-source, offline-first VS Code extension for drafting and reviewing **SCAP-NG** security Assessments, Rules and STIG content.

The authoritative **[owner-amended pre-release 0.4 schemas](https://github.com/vanderpol/scap-ng/tree/463675f3b931e596c922352a131cb3c515ab2265/schema)** and [small, current converted Assessment examples](https://github.com/vanderpol/scap-ng/tree/463675f3b931e596c922352a131cb3c515ab2265/examples) live in the public canonical repository. The [shared converter and metadata-pack tooling](https://github.com/vanderpol/scap-ng-tools) lives separately; its [qualified integration boundary](https://github.com/vanderpol/scap-ng-tools/blob/1f4f74d215ecb6ac16ded2da9bfe447a9dc45a42/docs/CONVERTER-CUTOVER.md) does **not** mean the VS Code extension or its backend integration is already implemented. Large historical research/DRAFT corpora are not part of this editor's bootstrap.

Current editor samples deliberately display the comparison order **Item requirement → Field requirement → fields**. Short predicates can be a compact single `fields: {...}` mapping; long regex or logic groups remain multiline. This is new-authoring presentation guidance, never an instruction to reformat an existing document on open/save.

**Status:** pre-alpha metadata/source-edit foundation implemented; no extension host, graphical UI or VSIX yet. This repository is the editor, not the SCAP-NG standard, converter, compiler, or scanner.

## Start here (especially for Codex)

1. **[AGENTS.md](AGENTS.md)** — mandatory operating rules, source-of-truth boundaries, licensing/security and workflow.
2. **[SCAP-NG primer](docs/SCAP-NG-PRIMER.md)** — what a Benchmark, Rule, Assessment, Test, Object, require, capability and result actually mean; current 0.4 rules.
3. **[Editor blueprint](docs/EDITOR-BLUEPRINT.md)** — Source/Structured/Guided, Assessment Studio UI, workspace index, offline design, proposed architecture and test contracts.
4. **[Implementation roadmap / Issue #1](https://github.com/vanderpol/scap-ng-vscode/issues/1)** — first runnable VSIX milestone.
5. **[One-clone Linux development setup](docs/WORKSPACE-BOOTSTRAP.md)** — exact public dependencies, offline pack, safe PR workflow and large-library boundary.

### One checkout is enough

For Linux desktop Codex or the VS Code integration, clone **only this repo**.
The committed [dependency pins](dependency-pins.json) and standard-library
[bootstrap helper](scripts/bootstrap_dependencies.py) fetch the exact public
schema/tools/sample-data revisions into ignored `.external/`. To build the
verified offline pack, follow [the bootstrap guide](docs/WORKSPACE-BOOTSTRAP.md).
Do not clone private research or commit downloaded corpora into this repo.

### Ordered implementation issues

| Phase | Work |
| --- | --- |
| [P0 · #1](https://github.com/vanderpol/scap-ng-vscode/issues/1) | Extension bootstrap, pin current 0.4 contracts, first validation, installable VSIX |
| [P1 · #2](https://github.com/vanderpol/scap-ng-vscode/issues/2) | Byte-preserving YAML Source ↔ Structured editing |
| [P2 · #3](https://github.com/vanderpol/scap-ng-vscode/issues/3) | Searchable STIG/Assessment Library and ID/reference graph |
| [P3 · #4](https://github.com/vanderpol/scap-ng-vscode/issues/4) | Guided authoring, capabilities, require, logical alternatives |
| [P4 · #5](https://github.com/vanderpol/scap-ng-vscode/issues/5) | Optional local compiler diagnostics and provenance, no invented runtime results |
| [P5 · #6](https://github.com/vanderpol/scap-ng-vscode/issues/6) | Offline VSIX, security, accessibility, license and documentation checks |
| [P6 · #7](https://github.com/vanderpol/scap-ng-vscode/issues/7) | Schema-driven help, hideable serialized defaults and regex/sample-data playground |
| [P7 · #8](https://github.com/vanderpol/scap-ng-vscode/issues/8) | Generate human-readable Test summaries and persist them in `test_title` |

## Design principles

- STIG Library is a **child of SCAP-NG Assessment Studio**. Standalone Assessments require no STIG.
- One source TextDocument underlies Source / Structured / Guided modes; formatting-preserving minimal edits are essential.
- All fields editable; exact schema/mapping enumerations and versioned human guidance; logical IDs rather than authored source paths.
- No network/telemetry/AI requirement, no automatic upload of source/evidence, no hidden execution of scanner or shell commands.
- Distinguish YAML/schema/graph/compile checks, draft/proof warnings and genuine runtime scanner results.
- Reuse suitable permissively licensed components where it reduces risk, but **do not copy third-party source-available code or unlicensed upstream material**.

The authoritative SCAP-NG 0.4 schema and assessment contracts are maintained in [vanderpol/scap-ng](https://github.com/vanderpol/scap-ng/tree/463675f3b931e596c922352a131cb3c515ab2265/schema) under flat `schema/`; editor builds must pin the exact upstream commit and 235-resource metadata manifest.

## License

This editor repository is licensed under **Apache License 2.0** (see [LICENSE](LICENSE)). That license does not automatically grant rights to redistribute upstream content, schema assets or third-party code.

## Runnable metadata checkpoint (#7)

[Implementation, exact pin and remaining UI dependency](docs/DEFAULTS-CHECKPOINT.md).

```sh
npm ci
npm run lint
npm test
```

The adapter reads an explicitly selected local pack; no upstream schemas/content are bundled. `schema-profile.json` pins canonical candidate `463675f3` and manifest SHA-256 `0b8df930…` (235 reviewed derived resources). CI reconstructs the pack using the exact public `scap-ng-tools` exporter from `dependency-pins.json`, tests bootstrap again with networking disabled, and checks real canonical examples plus small reviewed synthetic Result A/selector fixtures. `npm run package` produces a library tarball, **not a VSIX**. Full Assessment evaluation is unavailable.

The current pinned 0.4 schema pack adopts native Result A (`require_*` source
locations and Field Results). Offline integration checks supplied synthetic
Results and rejects legacy wire keys; this does not execute a scanner or replace
upstream source/evidence correlation checks. Compatible field datatype
annotations remain. The historic research issue #255 is private; the editor's
public acceptance requirements are in [#7](https://github.com/vanderpol/scap-ng-vscode/issues/7)
and [#8](https://github.com/vanderpol/scap-ng-vscode/issues/8).
