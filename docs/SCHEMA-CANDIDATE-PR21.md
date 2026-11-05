# Unmerged SCAP-NG schema candidate: PR #21

**Status:** integration-only candidate; not merged to `scap-ng/main` and not a
stable editor contract.

The active integration profile uses the exact head of coordinated draft PR #21:

- Repository: `vanderpol/scap-ng`
- Pull request: [#21](https://github.com/vanderpol/scap-ng/pull/21)
- Candidate commit: `7b9b61108aa30a601828268576308e510477094e`
- Candidate schema snapshot: 145 JSON files, 35 root schemas, 652 root `$ref`s  
- Candidate schema aggregate SHA-256: `2adf88f5c1fd950e997579c00064388b5f12e9e29cde38075bf75b76d1f25843`
- Candidate editor-pack resource count: 236
- Candidate pack manifest SHA-256: `b156e978c2655fa6231c5d8b86d54e873e78ee344b606dd3cdc7e1702830269f`

The pack is generated from the exact candidate checkout and the pinned OVAL
5.12.3 inputs. The currently pinned `scap-ng-tools` exporter rejects the
candidate because its frozen snapshot guard only accepts the stable 143-file
snapshot. For this integration artifact only, the exporter was run from an
isolated temporary compatibility copy with the candidate's exact snapshot
counts/digest and generated resource identity digest. No canonical schema files,
converter behavior, or upstream PRs were modified.

The candidate pack must not be treated as a release or as proof that the
converter/scanner supports the draft contracts. PR #21 itself records unresolved
cross-repository compatibility gaps.

## Stable rollback

The previous stable pin remains preserved in:

- `schema-profile.stable.json`
- `dependency-pins.stable.json`
- ignored local checkout `.external/scap-ng-stable-463675f3b931e596c922352a131cb3c515ab2265`
- ignored local pack `.external/editor-pack-stable-0b8df930cb25ce173138a759449dcf437a6ac3f3d3d680ecfaee6cb0024b464f`

Stable source commit: `463675f3b931e596c922352a131cb3c515ab2265`  
Stable pack manifest SHA-256: `0b8df930cb25ce173138a759449dcf437a6ac3f3d3d680ecfaee6cb0024b464f`

To roll back an integration workspace, restore the two stable JSON pin files,
restore the stable `.external` checkout/pack, and run the offline verification
before launching the editor.

## Editor verification

The editor resolves the candidate's conditional native-selector overlay through
`assessment-language.schema.json`; it does not derive capability/operator names
in TypeScript. With this pack, `linux.partition.mount_point` offers exactly:
`equals`, `not_equal`, `case_insensitive_equals`, `case_insensitive_not_equal`,
and `matches_regex`. Recursive Variable expression completion exposes the seven
schema branches: `literal`, `variable`, `values`, `concat`, `regex_capture`,
`unique`, and `merge`.

The overlay lookup is cached per verified metadata pack and falls back to the
pinned generated capability schema when an overlay is absent. This preserves
stable-pack behavior while allowing future schema revisions to add contracts
without another editor implementation change.
