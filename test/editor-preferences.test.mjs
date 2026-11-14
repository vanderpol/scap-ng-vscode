import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessmentEditorAssociationPatterns,
  sameEditorAssociations,
  withAssessmentEditorAssociation,
  assessmentEditorModes,
  isAssessmentEditorMode,
  usesGraphicalEditor,
  usesNativeYamlEditor
} from '../dist/editor-preferences.js';

test('graphical Assessment preference adds both filename associations and preserves unrelated editors', () => {
  const current = { '*.md': 'markdown.preview', '**/*.json': 'json-language-features', ...Object.fromEntries([[assessmentEditorAssociationPatterns[0], 'scapNg.assessment']]) };
  const next = withAssessmentEditorAssociation(current, 'graphical');
  assert.equal(next['*.md'], 'markdown.preview');
  assert.equal(next['**/*.json'], 'json-language-features');
  for (const pattern of assessmentEditorAssociationPatterns) assert.equal(next[pattern], 'scapNg.assessment');
  assert.notStrictEqual(next, current);
});

test('native YAML preference removes only SCAP-NG associations', () => {
  const current = {
    '*.md': 'markdown.preview',
    [assessmentEditorAssociationPatterns[0]]: 'scapNg.assessment',
    [assessmentEditorAssociationPatterns[1]]: 'other.editor'
  };
  const next = withAssessmentEditorAssociation(current, 'yaml');
  assert.deepEqual(next, {
    '*.md': 'markdown.preview',
    [assessmentEditorAssociationPatterns[1]]: 'other.editor'
  });
  assert.equal(sameEditorAssociations(current, next), false);
});

test('Split mode keeps the graphical association and opens a native YAML companion', () => {
  assert.deepEqual(assessmentEditorModes, ['yaml', 'graphical', 'split']);
  assert.equal(isAssessmentEditorMode('split'), true);
  assert.equal(usesGraphicalEditor('split'), true);
  assert.equal(usesNativeYamlEditor('split'), true);
  const current = { '*.md': 'markdown.preview' };
  const next = withAssessmentEditorAssociation(current, 'split');
  for (const pattern of assessmentEditorAssociationPatterns) assert.equal(next[pattern], 'scapNg.assessment');
  assert.equal(next['*.md'], 'markdown.preview');
  const yaml = withAssessmentEditorAssociation(next, 'yaml');
  for (const pattern of assessmentEditorAssociationPatterns) assert.equal(yaml[pattern], undefined);
});
