# Applicability.8 qualification boundary

This document records the read-only qualification of the public
`assessment-corpus-0.4.0-issue28-applicability.8` publication requested by
Issue #61. The archive was downloaded from the immutable GitHub release and
was **not copied into the repository or VSIX**.

## Receipt

- Release: <https://github.com/vanderpol/scap-ng-tools/releases/tag/assessment-corpus-0.4.0-issue28-applicability.8>
- Archive: `applicability.8.tar.gz`
- Archive SHA-256 (GitHub asset and official `.sha256` sidecar):
  `e164ba54ac99ed1ebc6d205205deedea311ad92abd3d83739073eb0751ae4125`
- Archive source/tools metadata: tools `aaf3a420840d8a388ac0eb153e05cd54b9e7741c`, source `8c8e5dff860af6b1290ee9273a282db24278f8d5`
- Archive schema metadata: schema version `0.4.0`, 145 JSON files, 35 roots,
  675 root references, 100 capabilities, aggregate digest
  `6bf2fa369fd7b9a0153899ac25109af3e3f9aa59c0f4aa6bb3be1aebd5b14fa0`

The editor remains qualified against the approved pin, unchanged by this
receipt:

- source/schema commit `7b9b61108aa30a601828268576308e510477094e`
- 145 JSON files, 35 roots, 652 references
- schema digest `2adf88f5c1fd950e997579c00064388b5f12e9e29cde38075bf75b76d1f25843`
- tools commit `1f4f74d215ecb6ac16ded2da9bfe447a9dc45a42`

The archive therefore has the same file count but a different canonical
schema/source/tools qualification. It is not valid evidence for the editor's
approved schema and must not be silently repinned, normalized, or admitted as
current fixtures. The emerging `count` amendment is likewise not adopted.

## Inventory (archive only)

The extracted archive contains 59 document directories and, by YAML filename
and top-level authoring key:

| content | count |
| --- | ---: |
| `applicability.yaml` | 59 |
| `*assessment.yaml` | 14,648 |
| `*rule.yaml` | 7,882 |
| `*benchmark.yaml` | 59 |
| `*.json` | 22,777 |

The archive contains genuine shared applicability Assessment references. A
read-only scan found 14,648 Assessment definitions (14,578 unique IDs) and
14,704 `assessment` reference values; 67 IDs occur in more than one extracted
definition and therefore require provenance-aware interpretation. No editor
operation rewrites these files. The archive's evidence files are not scanner
runtime/equivalence proof.

## Reproduction

The receipt can be reproduced without modifying this checkout:

```bash
work=$(mktemp -d)
curl -L --fail --silent --show-error \
  'https://github.com/vanderpol/scap-ng-tools/releases/download/assessment-corpus-0.4.0-issue28-applicability.8/applicability.8.tar.gz' \
  -o "$work/applicability.8.tar.gz"
printf '%s  %s\n' \
  e164ba54ac99ed1ebc6d205205deedea311ad92abd3d83739073eb0751ae4125 \
  "$work/applicability.8.tar.gz" | sha256sum -c -
tar -tzf "$work/applicability.8.tar.gz" | wc -l
```

This is a qualification boundary, not a blocker to the current Assessment
CRUD implementation. A future coordinated schema/tool repin may rerun the
inventory and admit a small representative fixture set only after its schema
validation, cross-file reference report, source provenance, and license
review are independently recorded.
