# SCAP-NG AI authoring playbook

This document is guidance for an AI authoring provider. It is not a second
schema and it does not grant permission to invent SCAP-NG vocabulary. The pinned
0.4.1 JSON Schemas, capability mappings, and supplied source procedure remain
authoritative.

## Authoring method

1. Read the Rule title, target platform, complete manual procedure, current Rule
   YAML, and any supplied Benchmark conditions.
2. Decompose the procedure into populations, applicability statements, commands,
   selectors, expected values, finding conditions, exceptions, and review-only
   steps. Preserve their order and relationships.
3. Map each objective collection step to an existing capability mapping. Derive
   the Object selectors from the procedure and the selected capability schema;
   never select a capability because it appeared in an example.
4. Write one or more complete Tests. A Test's Object selects Items; its Require
   expresses Item existence/satisfaction and field predicates. Do not replace a
   missing predicate with an empty Object or a presence-only placeholder.
5. Set `reported_elements` to the scalar `all` or `compared` enum, or to an
   array of explicit field names. Do not serialize `all` as an array.
6. Connect multiple Tests with an explicit Evaluate expression. Validate the
   complete Assessment against the supplied 0.4.1 schema before returning it.
7. Mark every inference and unresolved limitation for author review. Return
   manual-only when an objective predicate, population, relationship, or
   schema-authorized branch cannot be represented completely.

## Applicability and evaluation

A statement such as “Not Applicable when no X exists” is a population gate, not a
comment. If the supplied procedure provides enough evidence, create a population
Test and a separate technical Test, then use the generic shape:

```yaml
evaluate:
  if:
    test: population-present-test
  then:
    test: technical-requirement-test
  else:
    not_applicable:
      reason: The required population was not detected.
```

Use a supplied reusable applicability Assessment only when its ID and version are
provided by the Benchmark. Do not invent external IDs. A platform label alone is
not proof of applicability.

An ISSO, ISSM, SA, AO, or owner exception does not change an objective technical
result. If the technical predicate is violated, let the Test fail and record an
approved deviation after evaluation. Do not use `not_evaluated` merely because a
human may approve an exception. Use `not_evaluated` only when the technical check
cannot run or required evidence is genuinely unavailable.

A known negative result must never be made informational by an Evaluate branch.
A branch may be `not_applicable` only for genuine inapplicability and may be
`not_evaluated` only for an unavailable/unfinished technical assessment.

## Windows per-profile registry rule

When the source explicitly identifies `HKEY_CURRENT_USER` (or `HKCU`), the
capability is always `windows.ntuser`, never `windows.registry`. The registry
collector observes only the currently logged-in user; `windows.ntuser` is the
per-profile collector for the user hives stored in NTUSER.DAT.

For the normal “all users who have logged in” population, serialize the native
Object acquisition controls explicitly:

```yaml
object:
  include_default: false
  item_creation: every_ntuser
  key:
    equals: Software\Policies\Example
  name:
    equals: Setting
```

The technical `Require` predicate remains unchanged. Do not substitute a
single-user `windows.registry` Test for an explicit HKCU source. This is a
generic capability/population rule, not a Rule-specific exception.

## Native Test semantics

Use the exact schema shape and explicit values:

```yaml
require:
  item_requirement:
    items_found: one_or_more
    items_satisfying: every
  field_requirement:
    values_found: one_or_more
    values_matching: every
  fields:
    value:
      equals: expected
```

For a populated field, use one comparison operator inside the field map; do not
put `values_matching` beside that operator. For example:

```yaml
fields:
  stdout_line:
    matches_regex: '^\s*\S+\s+wifi\s+'
```

For an absence check, use a field existence predicate and retain the Item count:

```yaml
require:
  item_requirement:
    items_found: one_or_more
    items_satisfying: every
  field_requirement:
    values_found: one_or_more
    values_matching: every
  fields:
    stdout_line:
      values_found: none
```

`independent.shellcommand` always creates one Item so stdout/stderr can be
reported. It must not use `items_found: zero_or_more` to model empty stdout. Put
a line filter in the shellcommand Object's `pattern`; then apply a valid
`stdout_line` predicate to the filtered values. A field predicate cannot be only
`{values_found: one_or_more}`: use a comparison such as
`{matches_regex: pattern}` for a populated field. Conversely,
`{values_found: none}` is valid only inside `fields.<field>` and must not be put
under `require.field_requirement`; the latter is a paired comparison cardinality.

## Safety and provenance

Never copy a command, Test ID, path, selector, or expected value from a generic
example. Never claim scanner execution, compliance PASS/FAIL proof, or runtime
behavior. Do not silently reduce wildcards, directory sets, per-user relations,
or multiple configuration files to one example. If the source contains a human
review step that cannot be objectively collected, preserve it as manual-only
rather than fabricating automation.
