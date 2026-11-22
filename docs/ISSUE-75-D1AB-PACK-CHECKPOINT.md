# Issue #75 canonical d1ab pack checkpoint

The editor is repinned to canonical SCAP-NG 0.4.1 commit
`d1ab0283e09369c2c734d3b8f93b65007441cf07`.

- Schema family: `1755c893712ef30334dc7ecadc88e5abf387c2d60a75211bc2445b7cefa2e7d4`
- Pack: 238 resources, 101 active capabilities
- Pack manifest SHA-256: `9a531bcaaf6555b50689f4ceee06fb604c7013b3ee0b544b3af9e6b9dc7ac6e1`
- Resource identity SHA-256: `0dec67789229634cbd426229f899bf68876882eaa7ebc881f275f7731b649bc5`
- Exporter: `scap-ng-tools@12fdbad376a83a8a691bdb8509de36ede1480088`

The canonical mapping inventory is 105: 101 active editor capabilities and
four experimental ESX mappings (`esx.host_account`, `esx.host_advancedsetting`,
`esx.host_service`, `esx.host_vib`). The four ESX mappings require OVAL 6.0
source material and remain proposed/experimental; they are not silently added
to the active 0.4.1 editor pack. The reconciliation is machine-checked by
`npm run audit:capabilities`.

This distinction is structural/editor qualification only. It is not scanner
execution or RI equivalence; ESX execution remains separately owned by RI #196.
