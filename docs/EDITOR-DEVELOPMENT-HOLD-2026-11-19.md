# Editor development hold — 2026-11-19

PRs #67 and #68 are consolidated in the integration branch for mainline review.
The editor is now a single-version SCAP-NG 0.4.1 consumer and must not return to
0.4.0 or add a parallel grammar.

## Current verified baseline

- Canonical schema: `vanderpol/scap-ng@f51ab2c5bd82c94a9c292a7abb2ef1a7edc91ca2`
- Tools exporter: `vanderpol/scap-ng-tools@f44d71463d12948372747bded6834a10814fd3e7`
- Sample data: `vanderpol/scap-ng-editor-sample-data@990a1bff999f4f82c603bca1de36353c1cb08f01`
- OVAL input: `2f140ee5c5dd1ed9606fcd5afc301f6baeb48706`
- Offline pack: 236 resources; manifest SHA-256
  `4e6caec2f92a0ec35dab0ddf2d6ef88c615f858482e22757cf0326c0945927fb`

## Remaining editor gaps

- The editor validates schema and preserves source edits, but it is not an RI,
  scanner, converter, or proof of runtime equivalence.
- Converter-generated native Rules, Assessments, applicability inheritance,
  Sets/Filters, and gatherer coverage require the schema-first work in
  `scap-ng-tools#83` and normative language decisions in `scap-ng#80`.
- Graphical Rule, Applicability, Condition, and Benchmark workflows still need
  broader real-package acceptance coverage, including cross-file reference
  resolution and complete source-preserving CRUD for every schema-authorized
  branch.
- Installed-host status may report a qualified partial state when the optional
  Red Hat YAML service has unresolved external references; this is distinct from
  the editor's pinned offline schema diagnostics.
- Full corpus qualification and scanner/runtime result qualification remain
  intentionally out of scope. Historical 0.4.0 fixtures are preservation and
  rejection inputs only.

## Hold policy

Until `scap-ng-tools#83` and `scap-ng#80` settle the normative converter/schema
boundary, do not add substantial editor GUI, CRUD, wizard, converter, or
semantic-inference features. Preserve existing work, keep the pinned pack and
regression gates green, and make only bounded maintenance or qualification
fixes. Any new editor proposal must identify its canonical 0.4.1 schema source,
provenance, lossless edit behavior, and test receipt before implementation.
