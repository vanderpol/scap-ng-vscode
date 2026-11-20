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
  if (base.protocol !== 'https:') return { ok: false, message: 'Configured remote AI endpoints must use HTTPS.' };
  if (base.username || base.password) return { ok: false, message: 'Configured AI endpoints must not embed credentials in the URL.' };
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

export interface OpenAiChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

/** Send an explicit, user-approved prompt to an OpenAI-compatible gateway. */
export async function requestOpenAiCompatibleChat(endpoint: string, apiKey: string, model: string, messages: OpenAiChatMessage[], timeoutMs = 120000): Promise<string> {
  if (!apiKey.trim()) throw new Error('No stored remote API key is available.');
  if (!model.trim()) throw new Error('Select or enter a model before generating AI content.');
  let base: URL;
  try { base = new URL(endpoint); }
  catch { throw new Error('The configured AI endpoint is not a valid URL.'); }
  if (base.protocol !== 'https:') throw new Error('Configured remote AI endpoints must use HTTPS.');
  if (base.username || base.password) throw new Error('Configured AI endpoints must not embed credentials in the URL.');
  const completionUrl = new URL('chat/completions', `${base.toString().replace(/\/$/, '')}/`).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(completionUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 12000 }), signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error(`Gateway responded with HTTP ${response.status}.`);
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { throw new Error('Gateway returned a non-JSON response.'); }
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content.map((part: any) => typeof part === 'string' ? part : part?.text).filter((part: unknown): part is string => typeof part === 'string').join('');
      if (text.trim()) return text;
    }
    throw new Error('Gateway response did not contain choices[0].message.content.');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The AI request timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}
