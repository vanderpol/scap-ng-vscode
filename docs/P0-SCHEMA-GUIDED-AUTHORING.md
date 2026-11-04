# P0 schema-guided YAML authoring

**Status:** implementation checkpoint — 2026-11-04

This document records the approved implementation direction for improving the
native YAML authoring experience. YAML remains the authoritative source; the
editor provides contextual assistance without introducing a second Assessment
model.

## Priorities

### P0 — current implementation

1. **Schema-driven completion** resolves the pinned offline pack, `$ref`,
   `allOf`, `oneOf`, `anyOf`, conditional branches, dynamic map keys and array
   item schemas. Variable declarations and recursive Variable expressions use
   the same resolver as native help/definition support.
2. **Required-property actions** use schema validation errors and make a
   minimal insertion. Explicit schema defaults are inserted only when they
   are valid and unambiguous. A completion that merely opens an editable
   schema skeleton is not presented as a default.
3. **Expression choices** expose every valid `oneOf` alternative without
   selecting a branch or inventing an expression meaning. Nested values,
   `regex_capture`, `merge`, and capability-backed Variable Object selectors
   remain schema/mapping driven.
4. **Formatting safety** preserves compact flow mappings when the insertion is
   inside a flow mapping and uses block syntax for new multiline structures.
   Existing YAML is not reformatted as a side effect of completion.

The resolver is cached per verified `MetadataPack`; it performs no network
lookups and does not execute authored commands or scanner logic.

### P1 — approved, not implemented in this checkpoint

- An optional, persistent documentation panel using the exact descriptions and
  constraints already used by hover.
- Conservative schema-aware code actions beyond missing required properties.

### P2 — investigate later

- Improve the existing VS Code Outline/document-symbol experience before
  creating a separate Variable/expression tree.

### P3 — deferred

- Natural-language Test summaries remain deferred until schema resolution,
  completion, insertion, and diagnostics are reliable.

## Shared architecture

`src/schema-resolver.ts` is the shared schema expansion layer. It is used by
native completion and YAML hover/definition resolution. It deliberately
returns all compatible union branches rather than choosing the first branch;
validation remains authoritative for the authored value. Capability context is
resolved from the enclosing Test or from a nested Variable `values.object`.

Canonical schemas, capability mappings, and authoring vocabulary remain the
only sources for properties, enum values, operator restrictions, descriptions,
and defaults. TypeScript contains no capability/operator/function registry.

## Default and placeholder policy

- A JSON Schema `default` is a valid suggestion only when it is applicable to
  the current context and validates against its schema.
- For a union, an automatic default is used only when all applicable branches
  yield the same complete value. Otherwise the editor offers the alternatives
  and leaves the author to choose.
- Required-property actions may insert an explicit, schema-approved default.
  They do not add optional properties merely because a schema defines them.
- Expression completion may insert an editable structural skeleton (for
  example an object or array opener), but that insertion is not labeled as a
  valid default and the author must complete it before the document is valid.
- Unknown or incomplete YAML never borrows a capability or branch from a
  neighboring Test.

## Regression coverage

- Unit/integration completion assertions cover recursive Variable expressions,
  array items, nested `regex_capture.value`, `merge`, and capability-backed
  Variable Objects.
- Schema mutation coverage adds a new expression branch to a copied verified
  pack and verifies that completion discovers it without TypeScript changes.
- The VS Code host acceptance probe continues to exercise native completion,
  schema association, required-property actions, minimal insertion, undo/redo,
  and hover behavior against the pinned offline pack.

The P0 boundary is intentionally limited to authoring assistance. It does not
claim compilation, scanner execution, or compliance results.
