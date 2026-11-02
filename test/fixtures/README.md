# Pinned, synthetic SCAP-NG 0.4 metadata-contract fixtures

These three small, project-owned JSON fixtures originate from the
Apache-2.0-licensed historical SCAP-NG source at
`vanderpol/scap-ng-research@d12a644f4607cdc9c9ada50e3a96d4fd0060c6d9`.
The research repository is now private; keeping these reviewed synthetic fixtures
here makes editor CI and work-Codex onboarding independent of its access.
The selector/API Assessment fixture was **mechanically upgraded** to the
owner-approved 0.4 `item_requirement` syntax; native Result fixtures retain
their distinct unchanged wire fields.
They are **synthetic authoring/Result-schema boundary examples**, not live
scanner data or a benchmark distribution:

| File | Original path | SHA-256 |
| --- | --- | --- |
| `native.test-result.json` | `docs/examples/native-results-20261102/native.test-result.json` | `c3f5ef89c3f5b1383f4136f35e0dc6f36565b5a32dbf829e4cd2573d51200bfe` |
| `native.assessment-result.json` | `docs/examples/native-results-20261102/native.assessment-result.json` | `ecb87275be94e6939606c4ea3e1a28dc11af2e86d1f0beeaf07ebf0dc7e72455` |
| `selector-api.assessment.json` | amended from historical `tests/fixtures/v04-selector-contracts/authoring.assessment.json` | `30fb558b125fa10de1a10b91a9b6e8b36288bf877b7c9959e08359c908ce1642` |

The canonical current source for **real converted authoring examples** is
`vanderpol/scap-ng@463675f3b931e596c922352a131cb3c515ab2265/examples/`,
loaded from a separate exact checkout in integration tests. The 235-resource
metadata pack is generated from that canonical commit by the separately pinned
`vanderpol/scap-ng-tools` build script, not copied into this extension repo.

Changing one of these fixtures requires a deliberate new source/provenance
review. Schema-validity checks are not scanner/proof qualification.
