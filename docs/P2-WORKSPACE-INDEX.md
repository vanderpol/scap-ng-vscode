# P2 workspace index checkpoint

`WorkspaceIndex` indexes YAML by logical identity, never by authored source path. It recognizes the top-level `assessment`, `rule` and `benchmark` containers, records IDs/titles/versions/modes/capabilities and extracts Rule `assessment_choices` references.

The Assessment Studio tree keeps `STIG Library` and `Assessment Library` under the same activity container. Discovery is lazy at the tree level: files are parsed once in a bounded batch, root nodes do not eagerly expand every document, and YAML file watcher events update or remove individual records. `SCAP-NG: Search Assessment Studio` searches logical IDs, titles, modes and capabilities.

Diagnostics are deterministic and non-authoritative: duplicate IDs, unresolved Assessment references, ambiguous targets, wrong target kinds and incompatible expected versions are reported without first-file-wins behavior. Reverse `usedBy(id)` navigation is available from the same index. Local/shared source-scope enforcement remains an upstream/compiler concern and is not silently relaxed.

The index does not infer compliance, scanner results, applicability or authored paths. A standalone Assessment is indexed independently of any STIG or Rule.

Regression coverage includes Windows-style and POSIX URI paths, updates/removals, duplicate/missing/wrong-kind/version references and a 10,000-document batch fixture. The batch test completes in under a second locally after avoiding per-file global rebuilds.
