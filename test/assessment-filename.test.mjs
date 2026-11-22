import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentFileName, safeAssessmentStem } from '../dist/assessment-filename.js';

test('generated Assessment filenames normalize existing suffixes', () => {
  assert.equal(safeAssessmentStem('The Red Hat Enterprise Linux operating system must be configured-assessment'), 'the-red-hat-enterprise-linux-operating-system-must-be-configured');
  assert.equal(safeAssessmentStem('the-red-hat-enterprise-linux-operating-system-must-b-assessment-assessment'), 'the-red-hat-enterprise-linux-operating-system-must-b');
  assert.equal(assessmentFileName('the-red-hat-enterprise-linux-operating-system-must-b-assessment'), 'the-red-hat-enterprise-linux-operating-system-must-b-assessment.yaml');
  assert.equal(assessmentFileName('New assessment'), 'new-assessment.yaml');
});
