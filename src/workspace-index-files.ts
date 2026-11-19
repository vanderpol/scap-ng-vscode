/**
 * Workspace document globs used by the Assessment Studio index.
 *
 * Converted corpora commonly use names ending in `-assessment.yaml` (and
 * exact `benchmark.yaml`/`applicability.yaml` roots), while editor-authored
 * files traditionally use dotted names such as `foo.assessment.yaml`.
 * Keep both forms discoverable so applicability catalogs and their target
 * Assessments are available to the Guided wizard.
 */
export const workspaceIndexPatterns = [
  '**/*assessment.yaml',
  '**/*assessment.yml',
  '**/*rule.yaml',
  '**/*rule.yml',
  '**/*benchmark.yaml',
  '**/*benchmark.yml',
  '**/*applicability.yaml',
  '**/*applicability.yml'
] as const;
