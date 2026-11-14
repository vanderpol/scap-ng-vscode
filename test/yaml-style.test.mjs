import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleGeneratedObjects, normalizeYamlObjectStyle } from '../dist/yaml-style.js';

test('Object style preference has compact, expanded, and tree modes', () => {
  assert.equal(normalizeYamlObjectStyle('compact'), 'compact');
  assert.equal(normalizeYamlObjectStyle('expanded'), 'expanded');
  assert.equal(normalizeYamlObjectStyle('tree'), 'tree');
  assert.equal(normalizeYamlObjectStyle('unknown'), 'tree');
});

test('generated GUI Objects honor explicit style without changing the data', () => {
  const value = { assessment: { tests: { check: { object: { full_path: { equals: '/etc/passwd' }, recursive: false } } } } };
  const compact = styleGeneratedObjects(value, 'compact');
  const expanded = styleGeneratedObjects(value, 'expanded');
  const tree = styleGeneratedObjects(value, 'tree');
  assert.match(compact, /object: \{ full_path: \{ equals: \/etc\/passwd \}, recursive: false \}/);
  assert.match(expanded, /object:\n        full_path:/);
  assert.equal(tree, expanded);
  assert.doesNotMatch(expanded, /object: \{/);
});
