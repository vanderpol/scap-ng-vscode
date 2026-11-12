import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditEditability } from '../../scripts/audit-editability.mjs';

const packRoot = process.env.SCAP_NG_METADATA_PACK;
const sampleRoot = process.env.SCAP_NG_SAMPLE_ROOT;
if (!packRoot || !sampleRoot) throw new Error('Select SCAP_NG_METADATA_PACK and SCAP_NG_SAMPLE_ROOT explicitly');

test('Issue #61 Phase E audit executes schema-path CRUD coverage on current fixtures', () => {
  const { summary, reports } = auditEditability({ packRoot, sampleRoot });
  assert.equal(summary.failures, 0);
  assert.equal(summary.modelFailures, 0);
  assert.equal(summary.schemaInvalid, 0);
  assert.equal(summary.fixtureCount, 4);
  assert.equal(summary.syntheticCount, 1);
  assert.ok(summary.coverage['scalar-update'] > 0);
  assert.ok(summary.coverage['structural-add'] > 0);
  assert.ok(summary.coverage['structural-remove'] > 0);
  assert.ok(summary.coverage['variant-replace'] > 0);
  assert.ok(summary.coverage['logical-add-remove'] > 0);
  assert.ok(summary.coverage['array-add'] > 0);
  assert.ok(summary.coverage['array-remove'] > 0);
  assert.ok(summary.coverage['structural-invalid'] > 0);
  assert.ok(summary.coverage['required-remove-rejection'] > 0);
  assert.equal(summary.bytePreservationChecks, summary.undoRedoChecks);
  assert.equal(summary.noOpByteChecks, summary.reportCount);
  assert.ok(reports.every(report => report.checks.noOpBytes));
  assert.ok(summary.schemaCoverage.schemaLocations > 2000);
  assert.ok(summary.schemaCoverage.oneOfBranches > 0);
  assert.ok(summary.schemaCoverage.allOfBranches > 0);
  assert.ok(summary.schemaCoverage.conditionalLocations > 0);
  assert.equal(summary.schemaCoverage.patternPropertyLocations, 0, 'the approved pin currently declares no patternProperties');
  assert.equal(summary.schemaCoverage.readOnlyLocations, 0, 'the approved authoring schema declares no read-only nodes');
  assert.ok(summary.schemaCoverage.operationStatuses['read:not-evidenced'] > 0);
  assert.ok(summary.schemaCoverage.operationStatuses['create-member:conditional'] > 0);
  assert.ok(summary.schemaCoverage.operationStatuses['mutate:unsupported'] > 0);
});
