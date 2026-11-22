# Assisted Assessment drafts

The Guided Assessment wizard includes an **Assisted Assessment draft** workflow. It accepts a Rule title and pasted human-readable check/procedure text, then applies deterministic offline heuristics. It does not call an AI provider, execute a scanner, or claim a compliance result.

Every generated document is checked against the pinned Assessment schema before it is opened. The YAML begins with review comments containing the confidence, assumptions, unresolved items, and the source check text. When no selector can be inferred safely, the workflow creates a schema-valid manual procedure draft instead of inventing automated semantics.

## Current input scope

The first slice accepts pasted text. Full XCCDF/SCAP data-stream upload is intentionally separate: an XCCDF `check` normally contains an OVAL/OCIL reference rather than the machine-readable selector itself, so reliable automated inference requires resolving the referenced OVAL/OCIL resources. Upload support can be added without changing the deterministic draft contract.

## Conversion corpus evidence

The available Issue #26 receipt set is useful for heuristic research but is not a qualified authoring release. Its report records 2,216 emitted native documents from 1,567 source Rules; 1,102 source Rules have automatic direct-slice conversions and 465 are blocked. The converted outputs are `CONVERTED_UNVERIFIED` and remain outside the repository and VSIX.

A deeper pass also inspected the VM-local Issue #27 Stage A 65-stream subset: 4,524 converted source Rules (8,892 source Rules total) and their preserved manual check text. Against the current editor pack, the assisted matcher now recognizes high-signal native families such as labeled Windows Registry checks, AuditPol subcategories, configuration-file grep checks, sysctl, package, systemd, password/lockout policy, user-right, and explicit command checks. This is a research measurement, not a promise that every converted Assessment can be recovered from prose alone; generated drafts still undergo pinned-schema validation and carry review annotations.

The source XCCDF files show that the automated OVAL checks are generally empty references while the human-readable text is in the manual OCIL check. Therefore title/check-text-only input cannot reliably recover exact automated selectors for every Rule. The assisted workflow deliberately reports this boundary and falls back to manual drafts when the text does not contain an unambiguous supported selector pattern.

## Human approval and deviation policy

An ISSO/ISSM/SA/AO exception does not turn an objectively testable condition into
`not_evaluated`. The generated Assessment should preserve the technical predicate
and allow a known violation to fail. The organization can record and approve a
deviation after reviewing that result. `not_evaluated` is reserved for cases where
the technical check cannot be performed or the required evidence is unavailable.

For example, a wireless-interface draft filters `nmcli device` output and requires
`fields.stdout_line: {values_found: none}`. A matching wireless row therefore fails
the technical check; an ISSO exception is not silently treated as unknown. The
draft still calls out any hardware/applicability ambiguity for author review.
