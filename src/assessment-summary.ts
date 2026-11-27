/**
 * Turn a parsed native Assessment into a short author-facing explanation.
 * This describes the authored Test/Object/Require/Evaluate structure; it never
 * evaluates evidence or repeats provider rationale.
 */

function quote(value: unknown): string {
  if (typeof value === 'string') return `“${value}”`;
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map(quote).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function label(value: unknown): string {
  return String(value ?? '').replaceAll('_', ' ').replaceAll('-', ' ');
}

function capabilityLabel(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return 'the configured collector';
  const human = text.split('.').map(label).join(' ');
  return human.charAt(0).toUpperCase() + human.slice(1);
}

function hiveLabel(value: unknown): string {
  const token = String(value ?? '').toLowerCase();
  const names: Record<string, string> = {
    local_machine: 'HKEY_LOCAL_MACHINE',
    current_user: 'HKEY_CURRENT_USER',
    users: 'HKEY_USERS',
    classes_root: 'HKEY_CLASSES_ROOT',
    current_config: 'HKEY_CURRENT_CONFIG'
  };
  return names[token] ?? String(value ?? '');
}

const operationLabels: Record<string, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  matches_regex: 'matches the regular expression',
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  less_than: 'is less than',
  less_than_or_equal: 'is less than or equal to',
  greater_than: 'is greater than',
  greater_than_or_equal: 'is greater than or equal to',
  in: 'is one of',
  not_in: 'is not one of'
};

function predicate(field: string, value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${label(field)} is ${quote(value)}`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return label(field);
  const [operation, operand] = entries[0];
  if (operation === 'exists') return operand === false ? `${label(field)} is absent` : `${label(field)} exists`;
  if (operation === 'not' && operand && typeof operand === 'object') return `not (${predicate(field, operand)})`;
  return `${label(field)} ${operationLabels[operation] ?? label(operation)} ${quote(operand)}`;
}

function objectDescription(test: any): string {
  const object = test?.object;
  if (!object || typeof object !== 'object' || Array.isArray(object)) return 'items from the selected source';
  const clauses = Object.entries(object as Record<string, unknown>);
  const values = new Map<string, unknown>();
  for (const [field, spec] of clauses) {
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && Object.hasOwn(spec, 'equals')) values.set(field, (spec as any).equals);
  }
  const capability = String(test?.capability ?? '').toLowerCase();
  if (capability === 'windows.registry' && values.has('hive') && values.has('key') && values.has('name')) {
    const address = `${hiveLabel(values.get('hive'))}\\${String(values.get('key'))}\\${String(values.get('name'))}`;
    return `the Windows registry value ${quote(address)}`;
  }
  if ((capability.endsWith('.file') || capability === 'unix.file') && (values.has('full_path') || values.has('filepath') || values.has('path'))) {
    const path = values.get('full_path') ?? values.get('filepath') ?? values.get('path');
    return `the file ${quote(path)}`;
  }
  if (!clauses.length) return 'items from the selected source';
  return clauses.map(([field, spec]) => predicate(field, spec)).join(' and ');
}

function cardinality(value: unknown, noun: 'item' | 'field value' | 'matching item' | 'matching field value'): string {
  const token = String(value ?? '');
  if (token === 'none') return noun.startsWith('matching') ? `no ${noun}` : `no ${noun}s`;
  if (token === 'exactly_one') return `exactly one ${noun}`;
  if (token === 'zero_or_more') return `zero or more ${noun}s`;
  if (token === 'one_or_more') return `at least one ${noun}`;
  if (token === 'every') return `every ${noun}`;
  return `the required number of ${noun}s`;
}

function requirementDescription(requirement: any): string {
  if (!requirement || typeof requirement !== 'object') return 'uses the authored requirement';
  for (const logical of ['and', 'or', 'one', 'xor']) {
    if (Array.isArray(requirement[logical])) {
      const children = requirement[logical].map((child: any) => requirementDescription(child));
      const joiner = logical === 'and' ? ' and ' : logical === 'or' ? ' or ' : ', ';
      const prefix = logical === 'one' ? 'exactly one of ' : logical === 'xor' ? 'an odd number of ' : '';
      return prefix + children.join(joiner);
    }
  }
  const item = requirement.item_requirement;
  const field = requirement.field_requirement;
  const fields = requirement.fields && typeof requirement.fields === 'object'
    ? Object.entries(requirement.fields as Record<string, unknown>).map(([name, spec]) => predicate(name, spec))
    : [];
  const itemText = item?.items_found ? cardinality(item.items_found, 'item') : undefined;
  const itemScope = itemText ? `${itemText}${item?.items_satisfying ? `, with ${cardinality(item.items_satisfying, 'matching item')}` : ''}` : undefined;
  const fieldText = field?.values_found ? cardinality(field.values_found, 'field value') : undefined;
  const fieldScope = fieldText ? `${fieldText}${field?.values_matching ? `, with ${cardinality(field.values_matching, 'matching field value')}` : ''}` : undefined;
  const scopes = [itemScope, fieldScope].filter((value): value is string => Boolean(value));
  if (!scopes.length && !fields.length) return 'uses the authored requirement';
  const scopeText = scopes.length ? `requires ${scopes.join(' and ')}` : 'checks the collected fields';
  if (!fields.length) return scopeText;
  return `${scopeText}: ${fields.join(' and ')}`;
}

function evaluationDescription(node: any, titles: Map<string, string>): string {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.test === 'string') return `“${titles.get(node.test) ?? node.test}”`;
  for (const logical of ['and', 'or', 'one', 'xor']) {
    if (Array.isArray(node[logical])) {
      const children = node[logical].map((child: any) => evaluationDescription(child, titles));
      if (logical === 'and') return children.join(' and ');
      if (logical === 'or') return children.join(' or ');
      if (logical === 'one') return `exactly one of ${children.join(', ')}`;
      return `an odd number of ${children.join(', ')}`;
    }
  }
  if (node.not) return `not (${evaluationDescription(node.not, titles)})`;
  return '';
}

export function humanReadableAssessmentSummary(result: any): string | undefined {
  const assessment = result?.assessment ?? result?.document?.assessment;
  if (!assessment || typeof assessment !== 'object') return undefined;
  const tests = assessment.tests && typeof assessment.tests === 'object' ? Object.entries(assessment.tests) : [];
  if (!tests.length) return 'This Assessment does not define any Tests.';
  const titles = new Map(tests.map(([id, test]: [string, any]) => [id, String(test?.test_title ?? id)]));
  const descriptions = tests.map(([id, test]: [string, any]) => {
    const title = String(test?.test_title ?? id);
    const source = capabilityLabel(test?.capability);
    const object = objectDescription(test);
    const requirement = requirementDescription(test?.require);
    return `“${title}” uses the ${source} collector to inspect ${object}; it ${requirement}.`;
  });
  const evaluation = evaluationDescription(assessment.evaluate, titles);
  return `${descriptions.join(' ')}${evaluation ? ` Overall, the Assessment requires ${evaluation} to pass.` : ''}`;
}
