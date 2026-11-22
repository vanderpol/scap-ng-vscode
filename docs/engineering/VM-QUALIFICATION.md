# Codex VM qualification procedure

The full offline metadata/package/integration workflow is executed on the
retained Codex VM while hosted Actions allowance is exhausted. The existing
`.github/workflows/metadata.yml` remains available through `workflow_dispatch`
for funded independent replay. The focused editor source tests remain a
lightweight hosted check.

Use a clean reviewed checkout and keep generated pack/VSIX output outside the
checkout. Preserve exact pins from `dependency-pins.json` and
`schema-profile.json`.

```bash
df -BG /tmp
python3 scripts/bootstrap_dependencies.py
python3 scripts/bootstrap_dependencies.py --with-pack
python3 scripts/bootstrap_dependencies.py --offline --with-pack
python3 scripts/audit_repository.py
npm ci
npm run lint
npm test
npm run package
npm run test:integration
```

Record exact command argv, exit code, Node/Python/npm versions, reviewed commit,
canonical/converter pins, generated pack and VSIX SHA-256, and an explicit
PASS/FAIL/HOLD in machine-readable evidence. Network bootstrap is only for the
pinned public inputs; the offline verification must run after bootstrap and
must not fetch or silently substitute moving `main` content.
