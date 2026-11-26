# Converter-first cutover checkpoint — 2026-11-25

## Decision

No editor lifecycle or import implementation should begin until one exact,
compatible SCAP-NG 0.4.1 schema/converter tuple is approved and qualified.
The existing Q4 generated corpus remains an immutable historical/staging input;
it must not be edited in place.

## Pins observed

| Consumer/artifact | SCAP-NG | Tools converter | Status |
|---|---|---|---|
| VS Code dependency pins | `d1ab0283e09369c2c734d3b8f93b65007441cf07` | `12fdbad376a83a8a691bdb8509de36ede1480088` | Active editor pin; must be reconciled |
| Existing Q4 corpus | `2d983fcbd7b2367d567ca8ccc689a378d08905e4` | `46bb58a71cb051a1a2c783e87a75f735c8005f1a` | Existing generated artifact |
| Tools main tested | `2d983fcbd7b2367d567ca8ccc689a378d08905e4` | `d119f0d03e7e6dfe8ea52591364415c90adf4744` | Candidate direct-slice fix; not yet an editor repin |

The candidate Tools main reports interface `scap-ng-convert-v04/1` and requires
an explicit offline schema root. Its runtime pins the `2d983fc` schema family,
not the editor's `d1ab` family. This is a real compatibility hold, not a label
that can be repaired locally.

## Direct-slice reproduction

The existing Q4 corpus manifest reports 65 Benchmarks, 9,257 source Rules and
Tools `46bb58a`. A read-only scan of its 65 Benchmark YAML files found:

- 65/65 Benchmark IDs equal `direct-slice`;
- 65/65 platform IDs equal `fixture-platform` or use the fixture applicability
  namespace;
- 65/65 titles contain `[AUTOMATED PROTOTYPE SUBSET]`.

Using Tools main `d119f0d` on the signed Q4 Windows Server 2012 Member Server
archive (`sha256=a0cfdf21c0519c8330d00a2758e22f9b4089c3e974844351957c20eaf3da157a`)
produced source-derived identities:

```text
benchmark-xccdf-mil-disa-stig-benchmark-windows-201-45d70580eae4
platform-xccdf-mil-disa-stig-benchmark-windows-2012-5a5b7c36eff4
applicability-xccdf-mil-disa-stig-benchmark-windows-45d70580eae4
```

The focused conversion emitted six native documents, validated against the
candidate 0.4.1 schema, and retained the original source Benchmark ID in the
trace. The internal `authoring/direct-slice` directory remains an output layout;
it is no longer a published logical identity.

## Converter tests

At Tools main `d119f0d`, the standard-library suite completed:

```text
511 tests passed
29 skipped
```

A full Ubuntu 24.04 Q4 `--all-rules --include-applicability` run was started
against the pinned archive (`sha256=9429eb85a8fd36f9b46360f1567a61c251a0a8016b5575d8e595536b41dbca42`). It was stopped after approximately nine minutes without a
receipt while still consuming CPU. This is an explicit performance/qualification
hold; it is not counted as a pass or failure.

## Standalone XCCDF manual benchmark capability

The current converter does **not** support this requested mode. Its source model
requires a SCAP 1.4 datastream ZIP containing one XML member resolving to an
XCCDF Benchmark. Standalone modes currently address OVAL Definitions/Tests only;
there is no standalone XCCDF or manual-Benchmark CLI mode.

The required generic Tools feature is a new standalone XCCDF source adapter and
manual projection mode. It should preserve source Benchmark/Group/Profile/Rule
IDs, titles, descriptions, severity, references, remediation text, manual check
content and OCIL references, then emit one `mode: manual` Assessment per Rule.
Missing external OCIL content, unsupported complex checks and unresolved
applicability must fail closed with source-preserving diagnostics. It must emit
no invented automated Assessment.

## Next gated work

1. Reconcile and approve one exact canonical 0.4.1 schema/Tools tuple.
2. Re-run a bounded representative matrix, including automated, OCIL-manual,
   applicability and source-identity cases, with deterministic double generation.
3. Fix or qualify the converter's full-benchmark runtime before attempting a
   65-benchmark rebuild.
4. Regenerate Q4 into a new immutable staging directory and compare source
   counts, dispositions, identities, traces and hashes.
5. Implement and test standalone XCCDF manual projection in Tools, not in VS Code.
6. Only after those gates, update editor pins and begin lifecycle/import work.

No generated content or editor pin was modified by this checkpoint.

## Live mainline check

The live default branches currently resolve to:

```text
scap-ng       58918a32bfa241dcafb16eecfed5931dad076100
scap-ng-tools d119f0d03e7e6dfe8ea52591364415c90adf4744
```

The current SCAP-NG `main` schema tree has the same 147-resource aggregate
family as the Tools main pin:

```text
dc650646a24e727e68de242027cca3058683accc531f07bf6ace217609755b24
```

Thus the latest schema content is effectively the `2d983fc` family even though
SCAP-NG `main` has advanced with documentation/policy commits. The direct-slice
identity correction is merged in Tools PR #124, but the converter is not yet a
release-complete consumer dependency. Tools #71, #83, #86 and #120 remain open;
notably, standalone XCCDF manual conversion, portable offline packaging and
complete converter qualification are still outstanding. Open converter work
also includes the unmerged generic `time_difference`, external Variable and
canonical Variable-operation changes (Tools PRs #67, #99 and #105).
