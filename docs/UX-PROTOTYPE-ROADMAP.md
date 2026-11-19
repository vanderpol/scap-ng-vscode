# SCAP-NG editor UX prototype roadmap

This is an incremental, non-breaking UX track. Native YAML remains the
source of truth, existing Graphical/Split behavior remains unchanged, and
new actions must be reversible or read-only until explicitly approved.

## Status

| Prototype | Status | User question | Guardrail |
| --- | --- | --- | --- |
| 1. Visible entry points | **In review** | Can a new user discover Assessment creation, Benchmark context, and authoring tools without knowing command IDs? | UI-only contribution; no document or setting changes |
| 2. Benchmark Workspace | Planned | Is a benchmark tree with Rules, Assessments, applicability, and provenance easier than raw YAML? | Read-only first; every open action targets the existing source file |
| 3. Generated-draft review | Planned | Do confidence, assumptions, unresolved fields, and a diff make assisted drafts safe to approve? | Never silently changes manual content; preserve source comments and undo |
| 4. YAML navigation aids | Planned | Do authoring breadcrumbs, reference navigation, and concept-oriented outline reduce YAML friction? | Presentation/navigation only; no inferred defaults or rewritten bytes |
| 5. Safe editing affordances | Planned | Are explicit review gates and scoped actions understandable before editing a Benchmark? | Native YAML stays authoritative; provenance and pin warnings remain visible |

## Prototype 1: visible entry points

The primary prototype is now a dedicated **SCAP-NG Welcome** editor tab,
opened on each verified workspace activation when no document is active. It has room for:

- Create an Assessment
- Browse Benchmarks and Rules
- Open the Authoring sidebar
- Explain offline operation, pinned metadata, and review expectations

The Authoring sidebar remains focused on editing and diagnostics rather than
being overloaded with onboarding copy. Its compact toolbar keeps only the two
high-value actions (Browse Benchmarks and New Assessment), while the full
onboarding explanation stays in the dedicated Welcome editor tab. Native YAML remains the source of truth
and no new persistence path was added. A native VS Code welcome contribution
remains only as a fallback link to this tab.

### Review checklist

- Can a first-time user find the three workflows from the Activity Bar?
- Are the labels understandable without SCAP-NG implementation knowledge?
- Does the welcome text disappear naturally once content is indexed?
- Do the existing YAML, Graphical, and Split paths remain unchanged?
- Does “Browse Benchmarks and Rules” communicate the context action clearly?
- When no Benchmark is indexed, does the folder picker make importing converted
  content discoverable without changing the workspace?

A later prototype should not begin until this surface has been tried in an
Extension Development Host and the wording is accepted.
