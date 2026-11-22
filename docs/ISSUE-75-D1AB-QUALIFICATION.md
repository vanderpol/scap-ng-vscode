# Issue #75 d1ab 0.4.1 editor qualification

This checkpoint qualifies the source-preserving editor against the exact
canonical SCAP-NG 0.4.1 pack, not against a scanner.

## Pins and reconciliation

- SCAP-NG: `d1ab0283e09369c2c734d3b8f93b65007441cf07`
- Schema family SHA-256: `1755c893712ef30334dc7ecadc88e5abf387c2d60a75211bc2445b7cefa2e7d4`
- Tools exporter: `12fdbad376a83a8a691bdb8509de36ede1480088`
- Pack: 238 resources; manifest SHA-256 `9a531bcaaf6555b50689f4ceee06fb604c7013b3ee0b544b3af9e6b9dc7ac6e1`
- Active editor mappings: **101/101**; four ESX mappings remain proposed/experimental and are excluded.

The d1ab conformance corpus was independently opened and modelled against the
current canonical source pin: **158/158 files**, **152 active-editor-qualified
files**, **6 explicitly excluded experimental files**, and **8,027 scalar
properties**. The pre-decision baseline remains reproducibly **147 active files**
(153 total minus the six ESX files); this increment adds five decision/negative
vectors without changing the active language pin. Invalid authoring vectors are
opened for diagnostics and remain separate from scanner qualification. The exclusions are the four direct ESX Assessments and
two aggregate cases that contain those capabilities. This is schema/editor
qualification only; it is not execution evidence.

## Acceptance gates

- `npm test`: **205 passed**
- `npm run verify:offline`: **VERIFIED**
- `npm run audit:capabilities`: **101 active / 105 total; no missing or unexpected active mappings**
- `npm run test:integration` with exact d1ab pack/source: **34 passed**
- Graphical/YAML host probe against d1ab pack: **passed**
- Mutation host probe with isolated Red Hat YAML 2.0.0: **passed**
- Installed VSIX host probe with d1ab pack: **passed**
- Status host probe: **passed**; intentional `partial` status remains visible
- `npm run test:corpus:graphical`: **158 opened, 0 failures**; 152 files model-qualified after six experimental ESX exclusions
- `python3 scripts/audit_repository.py`: **PASS**

The Red Hat YAML host reports one known `$ref` resolution warning for the
cross-resource `typed_comparison_datatype_consistency` fragment in
`native-selector.schema.json`; native pack validation and the acceptance probe
remain green. It is retained as an interoperability note rather than hidden.

## Remaining boundary

Variable-expression authoring coverage now separately witnesses all 14 active
branches (`literal`, `variable`, `input`, `values`, `to_integer`,
`time_difference`, `concat`, `regex_capture`, `unique`, `count`, `split`,
`substring`, `arithmetic`, `begin`, `end`, `merge` — 16 schema alternatives
including the two aliases represented by the 14 function suite entries).
Runtime collection, status propagation, and scanner equivalence remain RI #196
holds and require execution receipts.
