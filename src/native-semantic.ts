/** Scanner-independent 0.4.1 authoring rules that JSON Schema cannot express. */
export interface NativeSemanticDiagnostic {
  code: string;
  rule: string;
  message: string;
  path: Array<string | number>;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function inspectObject(object: any, path: Array<string | number>, diagnostics: NativeSemanticDiagnostic[]) {
  if (!isRecord(object) || object.capability !== 'windows.cmdlet' || !Object.hasOwn(object, 'select')) return;
  if (object.select === null) return;
  const fields = isRecord(object.select) && isRecord(object.select.fields) ? object.select.fields : undefined;
  if (!fields) return; // JSON Schema reports malformed record shape separately.
  if (Object.hasOwn(fields, '*')) diagnostics.push({
    code: 'cmdlet-select-wildcard',
    rule: 'windows.cmdlet.select_no_wildcard',
    message: 'windows.cmdlet object.select must use explicit unique field names; wildcard "*" is rejected before collection.',
    path: [...path, 'select', 'fields', '*']
  });
  for (const [name, value] of Object.entries(fields)) {
    if (name === '*' || !isRecord(value)) continue;
    if (Object.hasOwn(value, 'variable') || Object.hasOwn(value, 'input')) diagnostics.push({
      code: 'cmdlet-select-dynamic',
      rule: 'windows.cmdlet.select_no_wildcard',
      message: 'windows.cmdlet object.select field names must be statically verifiable; dynamic or unverifiable selection fails closed before collection.',
      path: [...path, 'select', 'fields', name]
    });
  }
}

/**
 * Validate approved native semantic constraints without evaluating evidence.
 * Returned diagnostics are suitable for editor diagnostics and pre-collection
 * rejection; an empty result is not scanner qualification.
 */
export function validateNativeSemantics(value: unknown): NativeSemanticDiagnostic[] {
  if (!isRecord(value) || !isRecord(value.assessment)) return [];
  const assessment = value.assessment;
  const diagnostics: NativeSemanticDiagnostic[] = [];
  const tests = isRecord(assessment.tests) ? assessment.tests : {};
  for (const [id, test] of Object.entries(tests)) inspectObject((test as any)?.object, ['assessment', 'tests', id, 'object'], diagnostics);
  const shared = isRecord(assessment.shared_objects) ? assessment.shared_objects : {};
  for (const [id, object] of Object.entries(shared)) inspectObject(object, ['assessment', 'shared_objects', id], diagnostics);
  return diagnostics;
}
