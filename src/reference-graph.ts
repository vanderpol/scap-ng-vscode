/**
 * Typed, local Assessment reference analysis.
 *
 * This deliberately follows the current native 0.4 shapes instead of treating
 * every matching string as an identifier.  Literal values can equal an ID and
 * must never be rewritten as a side effect of a graphical rename.
 */
export type ReferenceKind = 'test' | 'variable' | 'input' | 'shared-object';
export type ReferencePath = (string | number)[];

export interface AssessmentDefinition {
  kind: ReferenceKind;
  id: string;
  path: ReferencePath;
}

export interface TypedAssessmentReference {
  kind: ReferenceKind;
  targetId: string;
  path: ReferencePath;
  ownerPath: ReferencePath;
  context: 'evaluate' | 'test-source' | 'require-source' | 'variable-expression' | 'shared-object-source';
}

export interface AssessmentReferenceAnalysis {
  definitions: readonly AssessmentDefinition[];
  references: readonly TypedAssessmentReference[];
  unresolved: readonly TypedAssessmentReference[];
  referencesTo(kind: ReferenceKind, targetId: string): TypedAssessmentReference[];
}

function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function path(...parts: (string | number)[]): ReferencePath { return parts; }
function samePath(left: ReferencePath, right: ReferencePath) { return left.length === right.length && left.every((part, index) => part === right[index]); }

/** Analyze one parsed `assessment` mapping, not the outer YAML document. */
export function analyzeAssessmentReferences(assessment: unknown): AssessmentReferenceAnalysis {
  const definitions: AssessmentDefinition[] = [];
  const references: TypedAssessmentReference[] = [];
  if (!object(assessment)) return result(definitions, references);

  const addDefinitions = (kind: ReferenceKind, collection: unknown, collectionName: string) => {
    if (!object(collection)) return;
    for (const id of Object.keys(collection)) definitions.push({ kind, id, path: path('assessment', collectionName, id) });
  };
  addDefinitions('test', assessment.tests, 'tests');
  addDefinitions('variable', assessment.variables, 'variables');
  addDefinitions('input', assessment.inputs, 'inputs');
  addDefinitions('shared-object', assessment.shared_objects, 'shared_objects');

  const add = (kind: ReferenceKind, targetId: unknown, refPath: ReferencePath, ownerPath: ReferencePath, context: TypedAssessmentReference['context']) => {
    if (string(targetId)) references.push({ kind, targetId, path: refPath, ownerPath, context });
  };

  // A one-member source mapping is the schema-authorized Variable/Input
  // reference form. Restricting this to source trees avoids rewriting literal
  // record members named `variable` or `input`.
  const walkSource = (node: unknown, currentPath: ReferencePath, ownerPath: ReferencePath,
      context: Exclude<TypedAssessmentReference['context'], 'evaluate'>, allowInput: boolean) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walkSource(child, [...currentPath, index], ownerPath, context, allowInput));
      return;
    }
    if (!object(node)) return;
    if (Object.keys(node).length === 1 && string(node.variable)) add('variable', node.variable, [...currentPath, 'variable'], ownerPath, context);
    if (allowInput && Object.keys(node).length === 1 && string(node.input)) add('input', node.input, [...currentPath, 'input'], ownerPath, context);
    for (const [key, child] of Object.entries(node)) {
      const childPath = [...currentPath, key];
      // `object` is either a direct Test/shared-object Object use or the
      // source Object in a Variable `values` expression. Inline Objects are
      // traversed normally; only string values are shared-object references.
      if (key === 'object' && string(child)) add('shared-object', child, childPath, ownerPath, context);
      walkSource(child, childPath, ownerPath, context, allowInput);
    }
  };

  const walkEvaluate = (node: unknown, currentPath: ReferencePath) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walkEvaluate(child, [...currentPath, index]));
      return;
    }
    if (!object(node)) return;
    if (string(node.test)) add('test', node.test, [...currentPath, 'test'], path('assessment', 'evaluate'), 'evaluate');
    if (string(node.input_provided)) add('input', node.input_provided, [...currentPath, 'input_provided'], path('assessment', 'evaluate'), 'evaluate');
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'test' && key !== 'input_provided') walkEvaluate(child, [...currentPath, key]);
    }
  };

  if (assessment.evaluate !== undefined) walkEvaluate(assessment.evaluate, path('assessment', 'evaluate'));

  if (object(assessment.tests)) for (const [id, test] of Object.entries(assessment.tests)) {
    const owner = path('assessment', 'tests', id);
    if (!object(test)) continue;
    if (string(test.variable)) add('variable', test.variable, [...owner, 'variable'], owner, 'test-source');
    if (string(test.object)) add('shared-object', test.object, [...owner, 'object'], owner, 'test-source');
    if (test.object && !string(test.object)) walkSource(test.object, [...owner, 'object'], owner, 'test-source', false);
    if (test.require !== undefined) walkSource(test.require, [...owner, 'require'], owner, 'require-source', true);
  }

  if (object(assessment.variables)) for (const [id, variable] of Object.entries(assessment.variables)) {
    const owner = path('assessment', 'variables', id);
    if (object(variable)) walkSource(variable, owner, owner, 'variable-expression', false);
  }
  if (object(assessment.shared_objects)) for (const [id, sharedObject] of Object.entries(assessment.shared_objects)) {
    const owner = path('assessment', 'shared_objects', id);
    walkSource(sharedObject, owner, owner, 'shared-object-source', false);
  }

  return result(definitions, references);
}

function result(definitions: AssessmentDefinition[], references: TypedAssessmentReference[]): AssessmentReferenceAnalysis {
  const definitionSet = new Set(definitions.map(definition => `${definition.kind}:${definition.id}`));
  const unresolved = references.filter(reference => !definitionSet.has(`${reference.kind}:${reference.targetId}`));
  return {
    definitions,
    references,
    unresolved,
    referencesTo(kind, targetId) {
      return references.filter(reference => reference.kind === kind && reference.targetId === targetId);
    }
  };
}

export function definitionFor(analysis: AssessmentReferenceAnalysis, kind: ReferenceKind, id: string) {
  return analysis.definitions.find(definition => definition.kind === kind && definition.id === id);
}

export function referencePathLabel(reference: TypedAssessmentReference): string {
  return reference.path.map(part => typeof part === 'number' ? `[${part}]` : part).join('.').replaceAll('.[', '[');
}

export function hasReference(analysis: AssessmentReferenceAnalysis, kind: ReferenceKind, id: string) {
  return analysis.referencesTo(kind, id).length > 0;
}

// Kept small and exported for focused tests; callers should not use generic
// string matching for rename/delete decisions.
export function pathEquals(left: ReferencePath, right: ReferencePath) { return samePath(left, right); }
