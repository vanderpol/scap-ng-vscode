# Issue #40 P0 YAML hardening

The pinned SCAP-NG schemas and metadata pack remain unchanged. Graphical work
is frozen.

## Delivered

- Completion capability context is resolved from the YAML AST ranges of the
  enclosing `assessment.tests.<test-id>` mapping. A preceding sibling Test can
  no longer supply selectors to a Test whose capability is missing or invalid.
  This covers block/flow mappings, capability lines reordered within a Test,
  comments, and quoted strings containing `capability:`.
- Parser failure is conservative: capability-specific completion is withheld
  rather than guessed from document text. Existing small lexical helpers remain
  limited to incomplete presentation context and are covered by the existing
  block/flow/incomplete host probes.
- Schema default insertion no longer selects the first constructible `oneOf` or
  `anyOf` branch. A branch default is used only when every alternative produces
  the same complete value; ambiguous alternatives receive an editable
  skeleton. Existing canonical `require` defaults and traversal defaults still
  pass schema validation.
- Union property presentation no longer uses JSON serialization length as a
  semantic branch selector. When no authored discriminator exists, canonical
  traversal order is used as a conservative presentation fallback and schema
  validation remains authoritative.
- Structured object labels now come from pinned vocabulary/schema metadata; the
  previous Windows Registry label table was removed.

## Host evidence

The Red Hat YAML 2.0.0 extension-host probe verifies a pinned Registry Test
followed by a Unix-file Test, including empty/reordered capability context,
flow/block object mappings, nested multi-Test evaluation, source preservation,
hover, diagnostics, and insertion behavior.

Pack SHA-256:
`0b8df930cb25ce173138a759449dcf437a6ac3f3d3d680ecfaee6cb0024b464f`.
