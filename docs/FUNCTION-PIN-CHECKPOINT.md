# Coordinated bounded function pin — 2026-11-03

Refs [Issue27](https://github.com/vanderpol/scap-ng-vscode/issues/27),
[canonical Issue10](https://github.com/vanderpol/scap-ng/issues/10), and
[tools Issue14](https://github.com/vanderpol/scap-ng-tools/issues/14).
This isolated branch is stacked on editor PR26 at
`f65a85bdedb23e634244f1071eaf069da33358fc`. It changes exact pins, reference
links and one integration test; no office Issue18 UI implementation is changed.

Current schema `246a8d37cc54875386768a7d76b60a6f9c01d013` adds only arithmetic,
substring and split. Public tools `8f5251dcd1062ed29e33b8e9ef72f2f619d83a0d`
exports the matching 235-resource pack. Schema-profile manifest is
`414c557ad1a0f3b2a93f667cfe4a63d2b1d7615505368bc51fab57049748781f`.
Exactly schemas/variable-expression.schema.json changes among 235 resources;
100 capabilities/mappings, sample-data commit and all existing examples remain
unchanged. Review scope/status/domain boundaries are in the
[canonical packet](https://github.com/vanderpol/scap-ng/blob/246a8d37cc54875386768a7d76b60a6f9c01d013/docs/ISSUE10-FUNCTION-REVIEW.md).
The broader inactive function candidate stays inactive. Structural validation
is distinct from compiler types, source proof, scanner outcomes and human review.

The preceding discovery checkpoint remains recorded at schema
`d4e477998cda438a1e53a7c3c84123ec92e5ba1f`, tools
`1c8aa287808f3ad0aa3d5e8aa610d800e8862c22`, manifest
`33fa58aa40b627fc1d3ae03a5ef08312461614f3c99f21ffedf26003524d4dee`.
Its earlier .external cache was preserved; this worktree bootstrapped a fresh
separate cache from public exact commits. No historical corpus was imported.

Local verification: fresh bootstrap/export and strict offline verification;
repository audit; TypeScript lint; **20 unit tests, 16 integration tests, zero
skips**; local VSIX package build. The new integration test checks positive
three-function shapes, explicit options, unknown/broader-call and arity rejection,
opaque records and byte-identical no-op Source save. Existing native Input and
legacy/source-preservation tests remain. No extension-host interaction, scanner
execution, release/publication or main merge is inferred. Exact hosted CI follows
on this commit and is recorded in the PR conversation.

Reproduce using the one-clone commands in [workspace setup](WORKSPACE-BOOTSTRAP.md).
No sibling/private checkout or prior cache is required. The first local npm
attempt could not write the runner's default cache and was repeated using a new
/tmp cache without changing dependency pins. A sandbox process-spawn restriction
on the Git identity check was resolved by rerunning the unmodified integration
command with the execution environment's normal additional permissions.
