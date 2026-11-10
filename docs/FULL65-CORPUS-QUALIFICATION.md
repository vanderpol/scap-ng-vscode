# Full 65-benchmark corpus discovery and qualification

**Run date:** 2026-11-10  
**Status:** Existing complete corpus located and qualified for external editor stress testing; regeneration against this checkout's current schema pin is blocked by an upstream tool/schema pin mismatch.

## Located artifacts

The complete VM-local corpus is already present under `.external/` (ignored by Git and excluded from the VSIX):

- Source ZIPs and the 65-input ledger: `.external/full65-current/source-zips-8c8e5dff860af6b1290ee9273a282db24278f8d5/` and `.external/full65-current/pipeline-issue27-20261105/source-pins.json`
- Current-schema automated subset: `.external/full65-current/automated-subset-7354a24cdbfe18321153ccaef5d772801a10cd71-20261105/`
- Source-preserving draft: `.external/full65-current/draft-source-preserving-7354a24cdbfe18321153ccaef5d772801a10cd71-20261105/`
- Machine ledger, manifest, validation and reproducibility receipts: `.external/full65-current/pipeline-issue27-20261105/`

The most recent recorded complete conversion ledger is the Issue #27 Stage A ledger generated on 2026-11-05. Its pinned inputs are:

| Input | Pin |
| --- | --- |
| `niwc-atlantic/scap-content-library` | `8c8e5dff860af6b1290ee9273a282db24278f8d5` |
| `vanderpol/scap-ng-tools` | `c5f5b215000a1f9149ed56541320da5d7918c94a` |
| `vanderpol/scap-ng` schema | `7354a24cdbfe18321153ccaef5d772801a10cd71` |
| schema family SHA-256 | `63a61b3eb0ca95790721699f5e63b6f5a16b146660b9545a437519b508351db5` |

All 65 source ZIPs are present and their recorded SHA-256 and Git blob pins verify.

## Regeneration result and blocker

A regeneration was deliberately not performed with mixed pins. This checkout currently pins `scap-ng@7b9b61108aa30a601828268576308e510477094e` and `scap-ng-tools@1f4f74d215ecb6ac16ded2da9bfe447a9dc45a42`.

The exact fail-closed checks are:

```text
scap-ng-tools@1f4f74d: expected 143 frozen JSON files; found 145
scap-ng-tools@7d028151: frozen 0.4 JSON digest mismatch:
  2adf88f5c1fd950e997579c00064388b5f12e9e29cde38075bf75b76d1f25843
```

The first check is the pinned tool rejecting the current 145-file candidate. The second is a public newer tool candidate rejecting the exact current schema bytes: that candidate expects the later `d2d8d59...` / 673-reference schema family, while the current `7b9b611...` checkout hashes to `2adf88f...` (145 files, 35 roots, 652 root references). Updating constants, copying schema files, or mixing converter and schema revisions would invalidate provenance and is not acceptable. A coordinated upstream tools/schema pin (or an existing artifact built from one) is required before a new current-pin 65-stream regeneration.

The historical public evidence release `v04-human-readable-review-20261030-ab5cddd` is not a substitute: it predates the grouped `item_requirement` amendment and is explicitly historical-only.

## Recorded corpus counts

From `stage-a-ledger.json`:

- 65 benchmarks / streams
- 8,892 source Rules
- 4,524 native automated Rules converted
- 4,368 Rules blocked with explicit diagnostics
- 9,160 native JSON and 9,160 native YAML documents
- 18,320 schema validations passed
- Output checksum root: `af9ae442c0f35ebceb424cc0c2bcb7dc81fc0dab9f270815034c617c32b0cb43`
- Canonical semantic reproducibility: 65/65; one raw diagnostic-order difference in the independent second run

No native manual-only count is claimed. Stage A is an automated subset. Stage B preserves all 8,892 original Rule XML/manual/OCIL records, Profiles, applicability, fixes and provenance, but does not fabricate native manual Assessments or claim complete policy/applicability translation.

The two SQL Database streams contain 46 Rules that remain blocked/excluded from native conversion because of unresolved OCIL hybrid references and unsupported `sqlext` dependencies. SQL Instance streams were retained and converted only where the established selection gates allowed it.

## Editor qualification

The existing corpus was used read-only as external test data, not as current-schema fixtures or authoring templates. The graphical model smoke test was rerun on 2026-11-10:

```sh
SCAP_NG_CORPUS_ROOT=.external/full65-current/automated-subset-7354a24cdbfe18321153ccaef5d772801a10cd71-20261105 \
SCAP_NG_METADATA_PACK=.external/editor-pack \
npm run test:corpus:graphical
```

Result: **4,524/4,524 Assessment YAML documents opened; 0 model failures**. The run indexed 136,322 scalar properties, with a maximum of 410 in one document; 268 documents contained Variables, 598 Filters and 379 Sets. Representative native test families present in the corpus include `windows.registry` (1,319 Tests), `windows.auditeventpolicysubcategories` (541), `unix.file` (522), `independent.shellcommand` (844), `windows.userright` (202), and Windows password/lockout policy capabilities. The largest/most complex RHEL 9 Assessment has 421 Tests, 126 Filters, 55 Sets and a maximum logical depth of 5; the Apache Windows stream has the largest variable inventory (164). This is parser/model stress qualification, not scanner execution or runtime equivalence. The existing host acceptance receipts provide interactive YAML/graphical edit coverage for representative native documents; no generated file was rewritten to satisfy the editor.

## Exact historical regeneration command

With the exact Issue #27 tool/schema/source staging restored, the existing pipeline invokes the public converter once per source ZIP:

```sh
PYTHONPATH=src python -m scap_ng_tools.converter.direct04 \
  --schema-root /path/to/schema \
  /path/to/<stream>.zip \
  --sha256 <source-sha256> \
  --all-rules \
  --output /path/to/output/<stream>
```

Requirements are Python >=3.11, PyYAML >=6,<7, jsonschema >=4.24,<5, the pinned `scap-ng-tools` checkout, the exact schema checkout, and the 65 SHA-256-verified source ZIPs. The existing run used Python 3.12.3, PyYAML 6.0.3 and jsonschema 4.26.0. After conversion, run the recorded `validate_stage_a.py`; it validates both JSON and YAML through the pinned schema snapshot and checks source/status accounting. Reproducibility uses the recorded repeat-run and canonical-semantic receipts.

## Gate summary

| Gate | Result |
| --- | --- |
| Complete source corpus located | PASS |
| 65 source pins verified | PASS |
| Existing 65-stream automated conversion | PASS / `CONVERTED_UNVERIFIED` |
| Existing native JSON/YAML schema validation | PASS (18,320 documents) |
| Complete source-preserving draft | PASS WITH LIMITATIONS |
| Current checkout-pin regeneration | BLOCKED (no coordinated tools/schema pair) |
| Native manual/policy/applicability translation | PARTIAL; source preserved, no placeholders fabricated |
| Compile, independent proof, scanner runtime | BLOCKED / NOT RUN |
| VS Code graphical model stress test | PASS (4,524/4,524) |

## Offline Guided copy/paste coverage audit

The Guided copy/paste recognizer was replayed against all 8,892 source-preserved Rules and their human-readable check text. It does not evaluate systems, claim scanner equivalence, or write bulk Assessments into this repository. The pinned editor pack and generated Assessment drafts were schema-validated through the existing `createGuidedAssessment` path.

Final audit artifact (ignored external data):

```text
.external/full65-current/assisted-guided-audit-20261110/report.json
```

Replay commands:

```sh
python scripts/extract-assisted-corpus.py \
  .external/full65-current/draft-source-preserving-7354a24cdbfe18321153ccaef5d772801a10cd71-20261105 \
  --output /tmp/assisted-65-rules.json
npm run build
SCAP_NG_ASSISTED_INPUT=/tmp/assisted-65-rules.json \
SCAP_NG_ASSISTED_REPORT=/tmp/assisted-65-audit.json \
SCAP_NG_METADATA_PACK=.external/editor-pack \
node scripts/audit-assisted-corpus.mjs
```

Final result:

| Classification | Rules |
| --- | ---: |
| Automated drafts | 7,129 (80.17%) |
| Native capability drafts | 4,233 (47.59%) |
| Shell-command collection drafts | 2,896 (32.56%) |
| Manual fallback | 1,763 (19.83%) |
| Audit errors | 0 |
| Schema-validation fallbacks | 0 |

Recognized native families include Windows Registry, AuditPol subcategories, Windows service/file, Windows password/lockout policy and user rights, Unix file/sshd/sysctl, Linux package/systemd/partition/SELinux/kernel status, macOS systemsetup/disabled services, Cisco IOS global show, Solaris package/SMF, and independent text-file content. Shell-command drafts intentionally contain only an explicit command and Item-presence collection; their output predicates remain an author review task and are not represented as compliance results.

The remaining 1,763 fallbacks are deliberately retained as manual procedures where no supported deterministic selector was safely inferred. The largest residual groups are Solaris/macOS configuration checks, Active Directory and organizational/documentation checks, complex audit/configuration logic, IIS/Apache administration, and multi-step checks. This is a coverage qualification and prioritization artifact, not a claim that every remaining Rule is impossible to automate.

Residual fallback signal counts (overlapping, so they do not sum to 1,763) are: configuration/settings 981, governance/documentation 616, web server administration 219, Active Directory 162, multi-step procedures 156, audit/logging 133, macOS 343, and Solaris 23. These signals are triage hints only; they do not override the manual safety gate.
