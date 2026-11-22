import type { IndexedDocument, WorkspaceIndex } from './indexer.js';

export type StudioSearchPick = { label: string; description?: string; detail?: string; record: IndexedDocument };
export type StudioOpenMode = 'yaml' | 'graphical';

/** Return deterministic, identity-oriented search results for the Assessment
 * Studio resolver. Folder-tree filtering is intentionally not used here: a
 * logical ID/title must produce an actionable result even when nested deeply. */
export function searchStudioRecords(index: WorkspaceIndex, query: string): IndexedDocument[] {
  return index.search(query).sort((left, right) =>
    String(left.kind).localeCompare(String(right.kind)) ||
    String(left.title ?? left.id ?? left.path).localeCompare(String(right.title ?? right.id ?? right.path)) ||
    left.path.localeCompare(right.path));
}

/** UI-neutral search/selection flow used by the command and host-testable with
 * a small VS Code window mock. Opening is injected so this module never owns
 * editor mode, URI, or filesystem behavior. */
export async function resolveStudioSearch(
  api: any,
  index: WorkspaceIndex,
  pathLabel: (path: string) => string,
  open: (record: IndexedDocument, mode: StudioOpenMode) => Promise<unknown>
): Promise<IndexedDocument | undefined> {
  const query = await api.window.showInputBox({ prompt: 'Search Assessment Studio index', placeHolder: 'Assessment ID, title, capability, or path' });
  if (query === undefined) return undefined;
  const records = searchStudioRecords(index, query);
  if (!records.length) {
    await api.window.showWarningMessage(`No indexed SCAP-NG document matched “${query}”. Import or refresh the containing content folder, then retry.`);
    return undefined;
  }
  const picks: StudioSearchPick[] = records.map(record => ({
    label: record.title || record.id || record.path,
    description: [record.kind, record.id ? `id: ${record.id}` : undefined, record.version !== undefined ? `version ${record.version}` : undefined].filter(Boolean).join(' · '),
    detail: pathLabel(record.path),
    record
  }));
  const selected = await api.window.showQuickPick(picks, {
    placeHolder: `${records.length} indexed result${records.length === 1 ? '' : 's'} — choose the exact document to open`,
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!selected) return undefined;
  const mode = await api.window.showQuickPick([
    { label: 'Graphical', description: 'Open in Assessment Studio graphical mode', value: 'graphical' as const },
    { label: 'YAML', description: 'Open the native source YAML editor', value: 'yaml' as const }
  ], { placeHolder: `Open ${selected.label} as…` });
  if (!mode) return undefined;
  await open(selected.record, mode.value);
  return selected.record;
}
