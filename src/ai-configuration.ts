/**
 * User-facing AI authoring configuration.
 *
 * This module deliberately contains configuration and validation only. It does
 * not make network calls, select a model, or mutate Assessment YAML. Provider
 * requests and review-only draft validation live in ai-assessment.ts.
 */
export const aiAssistanceModes = ['none', 'local', 'vscode', 'remote', 'codex-local'] as const;
export type AiAssistanceMode = typeof aiAssistanceModes[number];

export interface AiAuthoringConfiguration {
  mode: AiAssistanceMode;
  endpoint: string;
  model: string;
}

export function normalizeAiAssistanceMode(value: unknown): AiAssistanceMode {
  return typeof value === 'string' && (aiAssistanceModes as readonly string[]).includes(value)
    ? value as AiAssistanceMode
    : 'none';
}

export function aiAssistanceModeLabel(mode: AiAssistanceMode): string {
  switch (mode) {
    case 'local': return 'Local AI';
    case 'vscode': return 'VS Code AI provider';
    case 'remote': return 'Configured remote AI';
    case 'codex-local': return 'Codex (local)';
    default: return 'None (no AI)';
  }
}

export function aiAssistanceModeDescription(mode: AiAssistanceMode): string {
  switch (mode) {
    case 'local': return 'Use a model served by a local endpoint. No internet connection is required.';
    case 'vscode': return 'Use an approved model exposed through the VS Code Language Model API when available.';
    case 'remote': return 'Use an explicitly configured enterprise or remote endpoint after reviewing the data scope.';
    case 'codex-local': return 'Use the Codex CLI available to this VS Code host. Provider authentication and configuration remain outside the editor.';
    default: return 'Do not use AI assistance. The separate deterministic offline workflow remains available.';
  }
}

/**
 * Validate an optional endpoint before it is persisted. Empty endpoints are
 * allowed because provider integration is not configured by this slice.
 * Local mode is intentionally restricted to loopback addresses; remote mode
 * requires HTTPS. This prevents a future provider from silently sending source
 * content to an arbitrary or insecure endpoint.
 */
export function aiEndpointError(mode: AiAssistanceMode, endpoint: string): string | undefined {
  const value = endpoint.trim();
  if (!value || mode === 'none' || mode === 'vscode' || mode === 'codex-local') return undefined;
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { return 'AI endpoint must be a valid URL.'; }
  if (mode === 'remote' && parsed.protocol !== 'https:') return 'Remote AI endpoints must use HTTPS.';
  if (mode === 'local') {
    const host = parsed.hostname.toLocaleLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return 'Local AI endpoints must use localhost or a loopback address.';
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Local AI endpoints must use HTTP or HTTPS.';
  }
  return undefined;
}
