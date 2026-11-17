# P1 Authoring Playground

Issue #41 is delivered as two reviewable increments:

- [P1A Regex Tester](P1A-REGEX-TESTER.md) — draft PR #42
- [P1B Sample Object Tester](P1B-SAMPLE-OBJECT-TESTER.md) — bounded offline selector preview

Both tools are optional webview panels opened beside the native YAML editor. The native YAML `TextDocument` remains authoritative. The panels do not replace Red Hat YAML services, rewrite on open, invoke scanners, call the network, or create compliance evidence. PR #21's unmerged schema candidate and its pinned pack are unchanged.

The shared evaluator boundary is intentional: P1B uses the pinned schema pack for Item structure and the existing bounded regex worker for regex selectors. Full requirement/group/evaluation semantics remain future qualified-runtime work rather than being invented in the editor.
