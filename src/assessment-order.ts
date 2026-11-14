/**
 * Explicit presentation/authoring order for Assessment mapping sections.
 *
 * This policy is used only for newly generated YAML and for inserting a
 * previously absent section. Existing source is never reordered.
 */
export const automatedAssessmentSectionOrder = [
  'id', 'version', 'assessment_title', 'mode', 'class', 'specification',
  'dependencies', 'applicability', 'evaluate', 'tests',
  'shared_objects', 'variables', 'inputs', 'references'
] as const;

export const manualAssessmentSectionOrder = [
  'id', 'version', 'assessment_title', 'mode', 'class', 'specification',
  'dependencies', 'applicability', 'procedure', 'evidence',
  'evidence_guidance', 'response', 'references'
] as const;

export function assessmentSectionOrder(mode: unknown = 'automated'): readonly string[] {
  return mode === 'manual' ? manualAssessmentSectionOrder : automatedAssessmentSectionOrder;
}

/** Return the first authored section that should follow a newly inserted key. */
export function assessmentSectionBeforeKey(existingKeys: readonly string[], key: string, mode?: unknown): string | undefined {
  const order = assessmentSectionOrder(mode);
  const rank = order.indexOf(key);
  if (rank < 0) return undefined;
  return existingKeys.find(existing => {
    const existingRank = order.indexOf(existing);
    return existingRank >= 0 && existingRank > rank;
  });
}

/** Order a newly constructed Assessment mapping without touching existing YAML. */
export function orderGeneratedAssessment<T>(assessment: Record<string, T>, mode?: unknown): Record<string, T> {
  const order = assessmentSectionOrder(mode);
  const ranked = new Map(order.map((key, index) => [key, index]));
  return Object.fromEntries(Object.entries(assessment).sort(([left], [right]) => {
    const leftRank = ranked.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = ranked.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  }));
}
