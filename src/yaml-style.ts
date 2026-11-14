import { Document, isMap } from 'yaml';

/** Presentation preference for newly authored Object mappings. */
export const yamlObjectStyleValues = ['compact', 'expanded', 'tree'] as const;
export type YamlObjectStyle = typeof yamlObjectStyleValues[number];

export function normalizeYamlObjectStyle(value: unknown): YamlObjectStyle {
  return value === 'compact' || value === 'expanded' || value === 'tree' ? value : 'tree';
}

/**
 * Apply the explicit style to generated Assessment Object mappings only.
 * `tree` leaves the YAML library's normal block style intact; source edits
 * use the existing ancestor's flow/block style instead.
 */
export function styleGeneratedObjects(value: unknown, style: YamlObjectStyle): string {
  const document = new Document(value as any);
  if (style === 'tree') return String(document);
  const visit = (node: any, path: string[]) => {
    if (!isMap(node)) return;
    for (const pair of node.items ?? []) {
      const typedPair: any = pair;
      const key = typeof typedPair.key?.value === 'string' ? typedPair.key.value : undefined;
      const childPath = key === undefined ? path : [...path, key];
      const isObjectMap = key === 'object' || (path.at(-1) === 'shared_objects' && key !== undefined);
      if (isObjectMap && isMap(typedPair.value)) typedPair.value.flow = style === 'compact';
      visit(typedPair.value, childPath);
    }
  };
  visit(document.contents, []);
  return String(document);
}
