export interface RemoteConnectionResult {
  ok: boolean;
  message: string;
  models?: number;
  modelIds?: string[];
}

/**
 * Probe an OpenAI-compatible gateway without sending Assessment content. The
 * models endpoint is intentionally used instead of a completion request.
 */
export async function testOpenAiCompatibleGateway(endpoint: string, apiKey: string, timeoutMs = 10000): Promise<RemoteConnectionResult> {
  if (!apiKey.trim()) return { ok: false, message: 'No stored remote API key is available.' };
  let base: URL;
  try { base = new URL(endpoint); }
  catch { return { ok: false, message: 'The configured AI endpoint is not a valid URL.' }; }
  const modelsUrl = new URL('models', `${base.toString().replace(/\/$/, '')}/`).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(modelsUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) return { ok: false, message: `Gateway responded with HTTP ${response.status}.` };
    let modelIds: string[] = [];
    try {
      const body = await response.json() as any;
      const entries = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
      modelIds = entries.map((entry: any) => typeof entry === 'string' ? entry : entry?.id ?? entry?.name ?? entry?.model).filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0);
    } catch { /* A successful gateway response is still useful even without a JSON model list. */ }
    return { ok: true, models: modelIds.length, modelIds, message: modelIds.length ? `Connection succeeded; ${modelIds.length} model(s) are available.` : 'Connection succeeded; the gateway returned no model list.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.name === 'AbortError' ? 'The gateway connection timed out.' : `Gateway connection failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally { clearTimeout(timer); }
}
