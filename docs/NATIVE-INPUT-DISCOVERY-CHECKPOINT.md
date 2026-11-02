# Native Input discovery pin checkpoint (Issue #25)

Owner-approved upstream pre-release 0.4.0 amendment:
https://github.com/vanderpol/scap-ng/issues/8#issuecomment-6587857027.
Schema source `d4e477998cda438a1e53a7c3c84123ec92e5ba1f`, public tools
`1c8aa287808f3ad0aa3d5e8aa610d800e8862c22`, unchanged sample data
`950b9f6ac75e51fbe0bf20a1a8713ca2f1d27136` and official OVAL5.12.3
`2f140ee5c5dd1ed9606fcd5afc301f6baeb48706` are pinned together.

Metadata manifest SHA256:
`33fa58aa40b627fc1d3ae03a5ef08312461614f3c99f21ffedf26003524d4dee`.
The prior public schema family digest is
`ab1933f2d9171ee0af70c0fab855b00f5faf78bf59ad4924fbf24b402ac4072a`;
the explicitly amended family digest is
`04074a04cf3e5378fcc99e4f7780ff2e10f032e400751c35cea960aa0c42d971`.
Only `schemas/rule.schema.json` changes among235 exported resources;234 are
byte-identical. Previous pins/profile remain in Git history at editor `8501bf4`.
The old frozen semantic pack is retained by provenance in the tools review.

Rule source may omit `organizational_input_requirements`; the compiler derives
its native `kind: value|presence` / RFC6901 `source_path` metadata from actual
Assessment references and explicit bindings. Explicit and packaged maps must
agree exactly. The schema marks this read-only metadata. The editor should not
ask authors to type pointers or silently modify their source to add them.
The current public grouped `require.item_requirement` grammar remains the sole
current authoring shape. Legacy0.3 State tuples remain a separate version.

The new offline integration test checks authored omission, compiled native
record shape, wrong-version/invalid-kind/invalid-escape rejection and source-byte
identity against the actual pinned pack. Schema validation does not establish
graph closure, optional-use dominance, package validity or scanner truth; those
remain toolchain/runtime responsibilities. No UI or evaluator behavior is added.

Qualification: fresh public dependency bootstrap and pack hash verification,
offline audit, TypeScript lint,4 unit tests,15 integration tests and VSIX packaging.
Exact editor-source CI links are attached to the PR after publication.
No private research or historical65-stream library is a dependency.
