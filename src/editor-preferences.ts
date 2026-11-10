/**
 * Workbench editor associations managed by SCAP-NG Assessment Studio.
 *
 * Keep this deliberately small: changing the Assessment editor preference must
 * not overwrite unrelated editor associations configured by the user.
 */
export const assessmentEditorAssociationPatterns = [
  '**/*.assessment.yaml',
  '**/*.assessment.yml'
] as const;

export const assessmentEditorModes = ['yaml', 'graphical'] as const;
export type AssessmentEditorMode = typeof assessmentEditorModes[number];
export const assessmentCustomEditorId = 'scapNg.assessment';

export function isAssessmentEditorMode(value: unknown): value is AssessmentEditorMode {
  return value === 'yaml' || value === 'graphical';
}

/** Return a new association map with only SCAP-NG's entries changed. */
export function withAssessmentEditorAssociation(
  current: unknown,
  mode: AssessmentEditorMode
): Record<string, unknown> {
  const associations: Record<string, unknown> = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};

  for (const pattern of assessmentEditorAssociationPatterns) {
    if (mode === 'graphical') {
      associations[pattern] = assessmentCustomEditorId;
    } else if (associations[pattern] === assessmentCustomEditorId) {
      // YAML mode restores VS Code's normal text-editor choice while leaving
      // any unrelated association untouched.
      delete associations[pattern];
    }
  }
  return associations;
}

export function sameEditorAssociations(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
