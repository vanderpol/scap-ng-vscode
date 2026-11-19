/**
 * Return a stable filename stem for a newly authored Assessment.
 *
 * Assessment IDs commonly already carry the `-assessment` suffix while the
 * on-disk convention adds that suffix to titles/stems. Normalize repeated
 * trailing suffixes so generated files never become `*-assessment-assessment`.
 */
export function safeAssessmentStem(value: unknown): string {
  const normalized = String(value ?? 'new-assessment')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const withoutAssessmentSuffix = normalized.replace(/(?:-assessment)+$/, '');
  return withoutAssessmentSuffix || 'new-assessment';
}

export function assessmentFileName(value: unknown): string {
  return `${safeAssessmentStem(value)}-assessment.yaml`;
}
