import { MetadataPack, type Json } from './metadata.js';
import {
  predicateOperatorChoices,
  predicateValueSourceChoices,
  selectorFieldDatatypes,
  selectorOperatorChoices,
  selectorValueChoices,
  selectorValueSourceChoices,
  type CompletionChoice
} from './completion.js';

export type ExpressionLocation = 'object' | 'require';
export type PredicateDefinition = 'scalar_field_predicate' | 'record_field_predicate' | 'object_record_field_predicate';
export type ExpressionSource = 'fixed' | 'variable' | 'input';
export type VariableCardinality = 'zero_or_one' | 'one' | 'many' | 'unknown';
export type VariableDiagnosticKind = 'declaration' | 'reference' | 'datatype' | 'cardinality' | 'runtime';

export interface ExpressionContract {
  capability: string;
  field: string;
  location: ExpressionLocation;
  schemaUri?: string;
  mappingUri?: string;
  operators: CompletionChoice[];
  operandSources: ExpressionSource[];
  operatorSources: Record<string, ExpressionSource[]>;
  operatorDocumentation: Record<string, string>;
  datatypes: string[];
  fixedChoicesByOperator: Record<string, string[]>;
  cardinalityControls: string[];
}

export interface VariableDiagnostic {
  code: string;
  kind: VariableDiagnosticKind;
  severity: 'info' | 'warning' | 'error';
  path: (string | number)[];
  message: string;
}

export interface VariableDeclarationAnalysis {
  id: string;
  path: (string | number)[];
  declarationValid: boolean;
  declaredDatatype?: string; // Legacy pinned-schema declaration, if present.
  inferredDatatype?: string; // Read-only static inference; never runtime evidence.
  potentialCardinality: VariableCardinality;
  runtimeStatus: 'not_evaluated';
  references: string[];
}

export interface VariableAnalysis {
  declarations: VariableDeclarationAnalysis[];
  diagnostics: VariableDiagnostic[];
  runtimeEvaluation: 'not_available';
}

const schemaBase = 'https://scap-ng.dev/schema/v0.4.0/';
const variableIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-variable$/;

function schemaResource(pack: MetadataPack, suffix: string): string | undefined {
  return pack.manifest.resources.find((resource: any) => resource.kind === 'schema' && resource.uri.endsWith(suffix))?.uri;
}

function enumAt(pack: MetadataPack, uri: string | undefined, path: string): string[] {
  if (!uri) return [];
  try {
    const node: any = pack.node(`${uri}#${path}`);
    return Array.isArray(node.enum) ? node.enum.filter((value: unknown): value is string => typeof value === 'string') : [];
  } catch { return []; }
}

/**
 * One schema/mapping-backed contract for a scalar expression location.
 * This is intentionally capability-agnostic: capability names are data from
 * the verified pack, never branches in this adapter.
 */
export function expressionContract(pack: MetadataPack, capability: string, field: string, location: ExpressionLocation, predicateDefinition?: PredicateDefinition): ExpressionContract {
  const requireField = location === 'require';
  const operators = predicateDefinition
    ? predicateOperatorChoices(pack, predicateDefinition)
    : selectorOperatorChoices(pack, capability, field, requireField);
  const operatorSources: Record<string, ExpressionSource[]> = {};
  const operatorDocumentation: Record<string, string> = {};
  const fixedChoicesByOperator: Record<string, string[]> = {};
  const operandSources = new Set<ExpressionSource>();
  for (const operator of operators) {
    const sources = (predicateDefinition
      ? predicateValueSourceChoices(pack, predicateDefinition, operator.value)
      : selectorValueSourceChoices(pack, capability, field, operator.value, requireField)) as ExpressionSource[];
    operatorSources[operator.value] = sources;
    sources.forEach(source => operandSources.add(source));
    operatorDocumentation[operator.value] = operator.description || operator.label || operator.value;
    fixedChoicesByOperator[operator.value] = predicateDefinition
      ? []
      : selectorValueChoices(pack, capability, field, operator.value, requireField).map(choice => String(choice.value));
  }
  const pin = pack.manifest.capabilities[capability];
  return {
    capability,
    field,
    location,
    schemaUri: pin?.schema_uri,
    mappingUri: pin?.mapping_uri,
    operators,
    operandSources: [...operandSources],
    operatorSources,
    operatorDocumentation,
    datatypes: selectorFieldDatatypes(pack, capability, field, requireField),
    fixedChoicesByOperator,
    cardinalityControls: requireField ? ['values_found', 'values_matching', 'value_match'] : ['value_match']
  };
}

function objectValue(value: any): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function expressionCardinality(expression: any, seen = new Set<any>()): VariableCardinality {
  if (!expression || typeof expression !== 'object' || seen.has(expression)) return 'unknown';
  seen.add(expression);
  if (Object.hasOwn(expression, 'literal')) {
    const literal = expression.literal;
    const value = objectValue(literal) && Object.hasOwn(literal, 'value') ? literal.value : literal;
    return Array.isArray(value) ? 'many' : 'one';
  }
  if (Object.hasOwn(expression, 'variable')) return 'unknown';
  if (Object.hasOwn(expression, 'values')) return 'many';
  if (Object.hasOwn(expression, 'concat') || Object.hasOwn(expression, 'merge')) return 'many';
  if (Object.hasOwn(expression, 'count')) return 'one';
  if (Object.hasOwn(expression, 'unique')) return expressionCardinality(expression.unique, seen);
  if (Object.hasOwn(expression, 'regex_capture')) return 'many';
  return 'unknown';
}

function walk(value: any, path: (string | number)[], visit: (value: any, path: (string | number)[]) => void) {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((child, index) => walk(child, [...path, index], visit));
  else if (objectValue(value)) Object.entries(value).forEach(([key, child]) => walk(child, [...path, key], visit));
}
function valueAt(root: any, path: (string | number)[]): any {
  let current = root;
  for (const part of path) current = current?.[part as any];
  return current;
}

function expressionOutputDatatype(expression: any, variables: Record<string, any>, seen = new Set<string>()): string | undefined {
  if (!objectValue(expression)) return undefined;
  const op = Object.keys(expression);
  if (op.length !== 1) return undefined;
  const key = op[0];
  const payload = expression[key];
  if (key === 'literal') {
    if (objectValue(payload) && typeof payload.datatype === 'string') return payload.datatype;
    const values = Array.isArray(payload) ? payload : [payload];
    if (!values.length) return undefined; // Untyped empty lists need consumer context.
    const types = new Set(values.map(value =>
      typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'float') :
      typeof value === 'string' ? 'string' :
      typeof value === 'boolean' ? 'boolean' : 'unknown'));
    return types.size === 1 && !types.has('unknown') ? [...types][0] : undefined;
  }
  if (key === 'variable') {
    if (typeof payload !== 'string' || seen.has(payload)) return undefined;
    const next = variables[payload];
    if (!objectValue(next)) return undefined;
    const recursive = new Set(seen); recursive.add(payload);
    return expressionOutputDatatype(next.expression, variables, recursive);
  }
  if (key === 'count') return 'integer';
  if (['split', 'substring', 'concat', 'regex_capture', 'begin', 'end', 'merge'].includes(key)) return 'string';
  if (key === 'unique') {
    const parts = Array.isArray(payload) ? payload : [payload];
    const types = new Set(parts.map(part => expressionOutputDatatype(part, variables, seen)));
    return types.size === 1 ? [...types][0] : undefined;
  }
  if (key === 'arithmetic' && objectValue(payload) && Array.isArray(payload.values)) {
    const types = payload.values.map((part: any) => expressionOutputDatatype(part, variables, seen));
    if (!types.length || types.some((type: string | undefined) => type !== 'integer' && type !== 'float')) return undefined;
    return types.includes('float') ? 'float' : 'integer';
  }
  // values(Object.field) is typed by the canonical collected Item field.
  // This editor does not execute the provider or guess from a selector name.
  return undefined;
}

/** Best-effort static type only; never evidence or an implicit cast. */
export function inferredVariableDatatype(assessment: any, id: string): string | undefined {
  const variables: Record<string, any> = objectValue(assessment?.variables) ? assessment.variables : {};
  const declaration = variables[id];
  return objectValue(declaration)
    ? expressionOutputDatatype(declaration.expression, variables, new Set([id]))
    : undefined;
}

function variableSchema(pack: MetadataPack) {
  const uri = schemaResource(pack, '/variable-expression.schema.json');
  return { uri, declaration: uri ? `${uri}#/$defs/declaration` : undefined };
}

/**
 * Analyze declaration/reference shape without claiming runtime evaluation.
 * `draft` controls severity only: incomplete authoring is reported as info or
 * warning, while a completed operation can promote the same issue to error.
 */
export function analyzeVariables(pack: MetadataPack, assessment: any, draft = true): VariableAnalysis {
  const diagnostics: VariableDiagnostic[] = [];
  const declarations: VariableDeclarationAnalysis[] = [];
  const variables: Record<string, any> = objectValue(assessment?.variables) ? assessment.variables as Record<string, any> : {};
  const ids = new Set(Object.keys(variables));
  const edges = new Map<string, string[]>();
  const variableSchemas = variableSchema(pack);
  const declarationSchema: any = variableSchemas.declaration ? pack.node(variableSchemas.declaration) : undefined;
  const required = declarationSchema?.required ?? ['kind', 'expression'];
  const declarationDatatypeAllowed = !!declarationSchema?.properties?.datatype;
  const kinds = enumAt(pack, variableSchemas.declaration, '/properties/kind');
  const datatypes = (() => {
    try {
      const common = schemaResource(pack, '/capability-common.schema.json');
      return enumAt(pack, common, '/$defs/native_datatype');
    } catch { return []; }
  })();
  const severity = draft ? 'warning' : 'error';
  for (const [id, declaration] of Object.entries(variables)) {
    const path: (string | number)[] = ['assessment', 'variables', id];
    const references: string[] = [];
    const declarationObject: Record<string, any> | undefined = objectValue(declaration) ? declaration as Record<string, any> : undefined;
    let valid = true;
    if (!variableIdPattern.test(id) || id.length > 64) {
      valid = false;
      diagnostics.push({ code: 'invalid-variable-id', kind: 'declaration', severity: 'error', path, message: `Variable ID '${id}' does not match the canonical naming pattern.` });
    }
    if (!declarationObject) {
      valid = false;
      diagnostics.push({ code: 'incomplete-variable-declaration', kind: 'declaration', severity: draft ? 'info' : 'error', path, message: 'Variable declaration is incomplete; complete kind and expression before saving.' });
      declarations.push({ id, path, declarationValid: false, potentialCardinality: 'unknown', runtimeStatus: 'not_evaluated', references });
      continue;
    }
    for (const key of required) if (!Object.hasOwn(declarationObject, key)) {
      valid = false;
      diagnostics.push({ code: 'incomplete-variable-declaration', kind: 'declaration', severity: draft ? 'info' : 'error', path, message: `Variable declaration is missing '${key}' and remains an incomplete draft.` });
    }
    if (typeof declarationObject.kind === 'string' && kinds.length && !kinds.includes(declarationObject.kind)) {
      valid = false;
      diagnostics.push({ code: 'invalid-variable-kind', kind: 'declaration', severity: 'error', path: [...path, 'kind'], message: `Variable kind '${declarationObject.kind}' is not allowed by the pinned schema.` });
    }
    if (!declarationDatatypeAllowed && Object.hasOwn(declarationObject, 'datatype')) {
      valid = false;
      diagnostics.push({ code: 'obsolete-variable-datatype', kind: 'declaration', severity: 'error', path: [...path, 'datatype'], message: 'Variable declaration datatype was removed from canonical 0.4; migrate this value explicitly using typed literals or source provenance. Nothing is silently deleted.' });
    } else if (declarationDatatypeAllowed && typeof declarationObject.datatype === 'string' && datatypes.length && !datatypes.includes(declarationObject.datatype)) {
      valid = false;
      diagnostics.push({ code: 'invalid-variable-datatype', kind: 'declaration', severity: 'error', path: [...path, 'datatype'], message: `Variable datatype '${declarationObject.datatype}' is not allowed by the pinned schema.` });
    }
    if (!objectValue(declarationObject.expression)) {
      valid = false;
      diagnostics.push({ code: 'incomplete-variable-expression', kind: 'declaration', severity: draft ? 'info' : 'error', path: [...path, 'expression'], message: 'Variable expression is incomplete; choose a schema-supported expression branch.' });
    }
    const declarationReferences: string[] = [];
    walk(declarationObject.expression, [...path, 'expression'], (value, valuePath) => {
      if (!objectValue(value) || !Object.hasOwn(value, 'variable')) return;
      if (typeof value.variable !== 'string') {
        valid = false;
        diagnostics.push({ code: 'invalid-variable-reference', kind: 'reference', severity: 'error', path: [...valuePath, 'variable'], message: 'Variable reference must be a string ID.' });
        return;
      }
      references.push(value.variable);
      declarationReferences.push(value.variable);
      if (!variableIdPattern.test(value.variable)) diagnostics.push({ code: 'invalid-variable-reference-id', kind: 'reference', severity: 'error', path: [...valuePath, 'variable'], message: `Variable reference '${value.variable}' does not match the canonical naming pattern.` });
      else if (!ids.has(value.variable)) {
        valid = false;
        diagnostics.push({ code: 'unresolved-variable-reference', kind: 'reference', severity, path: [...valuePath, 'variable'], message: `Variable '${value.variable}' is not declared in this Assessment.` });
      }
    });
    edges.set(id, declarationReferences.filter(reference => ids.has(reference)));
    declarations.push({ id, path, declarationValid: valid, declaredDatatype: declarationDatatypeAllowed && typeof declarationObject.datatype === 'string' ? declarationObject.datatype : undefined, inferredDatatype: expressionOutputDatatype(declarationObject.expression, variables), potentialCardinality: expressionCardinality(declarationObject.expression), runtimeStatus: 'not_evaluated', references: [...new Set(references)] });
  }

  const comparisonLocation = (path: (string | number)[]) => {
    if (path[0] !== 'assessment') return undefined;
    const objectIndex = path.lastIndexOf('object');
    if (objectIndex >= 0 && path.length === objectIndex + 2) {
      let object: any = assessment;
      for (const part of path.slice(0, objectIndex + 1).slice(1)) object = object?.[part as any];
      const capability = object?.capability || (path[1] === 'tests' ? assessment?.tests?.[String(path[2])]?.capability : undefined);
      return typeof capability === 'string' ? { capability, field: String(path[objectIndex + 1]), requireField: false } : undefined;
    }
    if (path[1] === 'shared_objects' && path.length === 5) {
      const object = assessment?.shared_objects?.[String(path[2])];
      return typeof object?.capability === 'string' ? { capability: object.capability, field: String(path[3]), requireField: false } : undefined;
    }
    const requireIndex = path.indexOf('require');
    const fieldsIndex = path.lastIndexOf('fields');
    if (requireIndex >= 0 && fieldsIndex > requireIndex && fieldsIndex + 1 < path.length && (path.length === fieldsIndex + 2 || path.length === fieldsIndex + 3) && path[1] === 'tests') {
      const capability = assessment?.tests?.[String(path[2])]?.capability;
      return typeof capability === 'string' ? { capability, field: String(path[fieldsIndex + 1]), requireField: true } : undefined;
    }
    return undefined;
  };
  walk(assessment, ['assessment'], (value, valuePath) => {
    if (!objectValue(value) || !Object.hasOwn(value, 'variable') || typeof value.variable !== 'string') return;
    const location = comparisonLocation(valuePath.slice(0, -1));
    const variable = variables[value.variable];
    if (!location) return;
    const operation = String(valuePath.at(-1) ?? '');
    // Declaration-expression references are validated in the declaration
    // pass above. This second pass covers document-level Object/Require and
    // other authored usages, so an undeclared Variable cannot disappear
    // merely because it is referenced outside another Variable.
    if (valuePath[1] !== 'variables' && !Object.hasOwn(variables, value.variable)) {
      const referenceCode = variableIdPattern.test(value.variable) ? 'unresolved-variable-reference' : 'invalid-variable-reference-id';
      diagnostics.push({
        code: referenceCode, kind: 'reference', severity: referenceCode === 'unresolved-variable-reference' ? severity : 'error',
        path: [...valuePath, 'variable'],
        message: referenceCode === 'unresolved-variable-reference'
          ? `Variable '${value.variable}' is not declared in this Assessment.`
          : `Variable reference '${value.variable}' does not match the canonical naming pattern.`
      });
      return;
    }
    // Direct Variable-valued Object properties (for example shellcommand
    // `command: {variable: ...}`) are not comparison predicates. Only a
    // Variable nested below a canonical comparison operation requires the
    // predicate's explicit value_match cardinality control.
    const predicatePath = valuePath.slice(1, -1);
    const predicate = valueAt(assessment, predicatePath);
    const operand = objectValue(predicate) ? predicate[operation] : undefined;
    const comparisonOperand = objectValue(operand) && Object.hasOwn(operand, 'variable');
    if (comparisonOperand && variable && operation !== 'variable' && operation !== 'input' && !Object.hasOwn(predicate, 'value_match')) {
      const declaration = declarations.find(item => item.id === value.variable);
      diagnostics.push({
        code: 'missing-value-match-for-variable', kind: 'cardinality', severity,
        path: [...valuePath, 'variable'],
        message: `Variable '${value.variable}' is used by comparison '${operation}' without the canonical value_match cardinality control; potential cardinality is ${declaration?.potentialCardinality ?? 'unknown'}.`
      });
    }
    if (!objectValue(variable)) return;
    const declaration = declarations.find(item => item.id === value.variable);
    const inferredType = declarationDatatypeAllowed ? declaration?.declaredDatatype : declaration?.inferredDatatype;
    if (!inferredType) return; // Unknown is not a fabricated datatype mismatch.
    const expected = selectorFieldDatatypes(pack, location.capability, location.field, location.requireField);
    if (expected.length && !expected.includes(inferredType)) diagnostics.push({
      code: 'incompatible-variable-datatype', kind: 'datatype', severity: 'error', path: [...valuePath, 'variable'],
      message: `Variable '${value.variable}' has ${declarationDatatypeAllowed ? 'declared' : 'inferred'} type '${inferredType}', but ${location.capability}.${location.field} permits: ${expected.join(', ')}.`
    });
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      diagnostics.push({ code: 'variable-cycle', kind: 'reference', severity: 'error', path: ['assessment', 'variables', id], message: `Variable dependency cycle: ${cycle.join(' → ')}.` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id); stack.push(id);
    for (const child of edges.get(id) ?? []) visit(child);
    stack.pop(); visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  return { declarations, diagnostics, runtimeEvaluation: 'not_available' };
}

export function variableAnalysisSummary(analysis: VariableAnalysis): string {
  const incomplete = analysis.declarations.filter(declaration => !declaration.declarationValid).length;
  const unresolved = analysis.diagnostics.filter(diagnostic => diagnostic.code === 'unresolved-variable-reference').length;
  const cardinality = analysis.diagnostics.filter(diagnostic => diagnostic.kind === 'cardinality').length;
  return `${analysis.declarations.length} Variable declaration(s); ${incomplete} incomplete; ${unresolved} unresolved reference(s); ${cardinality} cardinality issue(s); runtime evaluation not available.`;
}
