# Pinned, synthetic SCAP-NG 0.4.1 metadata-contract fixtures

These three small, project-owned JSON fixtures originate from the
Apache-2.0-licensed historical SCAP-NG source at
`vanderpol/scap-ng-research@d12a644f4607cdc9c9ada50e3a96d4fd0060c6d9`.
The research repository is now private; keeping these reviewed synthetic fixtures
here makes editor CI and work-Codex onboarding independent of its access.
The selector/API Assessment fixture was **mechanically upgraded** to the
canonical 0.4.1 `item_requirement` syntax; native Result fixtures retain
their distinct unchanged wire fields.
They are **synthetic authoring/Result-schema boundary examples**, not live
scanner data or a benchmark distribution:

| File | Original path | SHA-256 |
| --- | --- | --- |
| `native.test-result.json` | `docs/examples/native-results-20261102/native.test-result.json` | `c3f5ef89c3f5b1383f4136f35e0dc6f36565b5a32dbf829e4cd2573d51200bfe` |
| `native.assessment-result.json` | `docs/examples/native-results-20261102/native.assessment-result.json` | `a3bac07230c564b2725d5059afdcb970e04c11d88b3deef6e773d3c268537dc4` |
| `selector-api.assessment.json` | amended from historical `tests/fixtures/v04-selector-contracts/authoring.assessment.json` | `85ec4c3b44f2a7eb0488c311d0ed27d516deee698dbd22d9c6ed4a9a5891083f` |

The canonical current source for **real converted authoring examples** is
`vanderpol/scap-ng@cb82e6bd3cbfad2c11bc2ee6e68b87ee6c96944a/examples/`,
loaded from a separate exact checkout in integration tests. The 236-resource
metadata pack is generated from that canonical commit by the separately pinned
`vanderpol/scap-ng-tools` build script, not copied into this extension repo.

Changing one of these fixtures requires a deliberate new source/provenance
review. Schema-validity checks are not scanner/proof qualification.
