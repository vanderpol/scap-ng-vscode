# SCAP-NG Assessment Studio for VS Code

An open-source, offline-first VS Code extension for drafting and reviewing **SCAP-NG** security Assessments, Rules and STIG content.

**[Current 0.4.0 native YAML downloads and small Assessment examples](https://github.com/vanderpol/scap-ng/blob/main/docs/releases/0.4.0-downloads-and-samples.md)** include the normalized all-65 review library, original DRAFT and exact standalone Python maintenance toolchain. [The CLI/editor integration contract](https://github.com/vanderpol/scap-ng/blob/ff69d46b36e05e45074a5e7f43bf2ef3cf464ddf/docs/developer/NATIVE-LIBRARY.md) is available for [implementation issue #3](https://github.com/vanderpol/scap-ng-vscode/issues/3); this **does not** mean the extension or its backend integration is already implemented.

**Status:** pre-alpha design/bootstrap. This repository is the editor, not the SCAP-NG standard, converter, compiler, or scanner.

## Start here (especially for Codex)

1. **[AGENTS.md](AGENTS.md)** — mandatory operating rules, source-of-truth boundaries, licensing/security and workflow.
2. **[SCAP-NG primer](docs/SCAP-NG-PRIMER.md)** — what a Benchmark, Rule, Assessment, Test, Object, require, capability and result actually mean; current 0.4 rules.
3. **[Editor blueprint](docs/EDITOR-BLUEPRINT.md)** — Source/Structured/Guided, Assessment Studio UI, workspace index, offline design, proposed architecture and test contracts.
4. **[Implementation roadmap / Issue #1](https://github.com/vanderpol/scap-ng-vscode/issues/1)** — first runnable VSIX milestone.

### Ordered implementation issues

| Phase | Work |
| --- | --- |
| [P0 · #1](https://github.com/vanderpol/scap-ng-vscode/issues/1) | Extension bootstrap, pin current 0.4 contracts, first validation, installable VSIX |
| [P1 · #2](https://github.com/vanderpol/scap-ng-vscode/issues/2) | Byte-preserving YAML Source ↔ Structured editing |
| [P2 · #3](https://github.com/vanderpol/scap-ng-vscode/issues/3) | Searchable STIG/Assessment Library and ID/reference graph |
| [P3 · #4](https://github.com/vanderpol/scap-ng-vscode/issues/4) | Guided authoring, capabilities, require, logical alternatives |
| [P4 · #5](https://github.com/vanderpol/scap-ng-vscode/issues/5) | Optional local compiler diagnostics and provenance, no invented runtime results |
| [P5 · #6](https://github.com/vanderpol/scap-ng-vscode/issues/6) | Offline VSIX, security, accessibility, license and documentation checks |

## Design principles

- STIG Library is a **child of SCAP-NG Assessment Studio**. Standalone Assessments require no STIG.
- One source TextDocument underlies Source / Structured / Guided modes; formatting-preserving minimal edits are essential.
- All fields editable; exact schema/mapping enumerations and versioned human guidance; logical IDs rather than authored source paths.
- No network/telemetry/AI requirement, no automatic upload of source/evidence, no hidden execution of scanner or shell commands.
- Distinguish YAML/schema/graph/compile checks, draft/proof warnings and genuine runtime scanner results.
- Reuse suitable permissively licensed components where it reduces risk, but **do not copy third-party source-available code or unlicensed upstream material**.

The authoritative SCAP-NG 0.4 schema and assessment contracts are maintained in [vanderpol/scap-ng](https://github.com/vanderpol/scap-ng/tree/main/schema/v0.4.0); editor builds must pin the exact upstream version/commit.

## License

This editor repository is licensed under **Apache License 2.0** (see [LICENSE](LICENSE)). That license does not automatically grant rights to redistribute upstream content, schema assets or third-party code.
