import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceIndex } from '../dist/indexer.js';
import { resolveStudioSearch, searchStudioRecords } from '../dist/studio-search.js';

function assessment(id, title, version = 1) {
  return `assessment:\n  id: ${id}\n  version: ${version}\n  assessment_title: ${title}\n  mode: automated\n  class: compliance\n  specification: {id: scap-ng.pre-alpha.assessment, version: 0.4.1}\n  tests: {}\n`;
}

test('Assessment Studio search resolves logical IDs and sorts actionable results deterministically', () => {
  const index = new WorkspaceIndex();
  index.update('file:///z.yaml', assessment('z-child-assessment', 'Zulu child'), '/workspace/z.yaml');
  index.update('file:///a.yaml', assessment('a-child-assessment', 'Alpha child', 2), '/workspace/a.yaml');
  const results = searchStudioRecords(index, 'child-assessment');
  assert.deepEqual(results.map(result => [result.id, result.title, result.version]), [
    ['a-child-assessment', 'Alpha child', 2],
    ['z-child-assessment', 'Zulu child', 1]
  ]);
  assert.equal(searchStudioRecords(index, 'missing-id').length, 0);
});

test('Assessment Studio search offers an actionable open mode and reports no matches', async () => {
  const index = new WorkspaceIndex();
  index.update('file:///child.yaml', assessment('child-assessment', 'FTP child'), '/workspace/nested/child.yaml');
  const opened = [];
  const warnings = [];
  let quickPickCalls = 0;
  const api = { window: {
    showInputBox: async () => 'child-assessment',
    showQuickPick: async choices => quickPickCalls++ === 0 ? choices[0] : choices[1],
    showWarningMessage: async message => warnings.push(message)
  }};
  const selected = await resolveStudioSearch(api, index, path => path, async (record, mode) => opened.push({ id: record.id, mode }));
  assert.equal(selected.id, 'child-assessment');
  assert.deepEqual(opened, [{ id: 'child-assessment', mode: 'yaml' }]);
  const noMatchApi = { window: { showInputBox: async () => 'missing-id', showWarningMessage: async message => warnings.push(message) } };
  assert.equal(await resolveStudioSearch(noMatchApi, index, path => path, async () => {}), undefined);
  assert.match(warnings.at(-1), /No indexed SCAP-NG document matched/);
});
