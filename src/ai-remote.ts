export class OpenAiCompatibleHttpError extends Error {
  readonly status: number;
  constructor(status: number, detail?: string) {
    super(`Gateway responded with HTTP ${status}${detail ? `: ${detail}` : '.'}`);
    this.name = 'OpenAiCompatibleHttpError';
    this.status = status;
  }
}

function providerErrorDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error ?? parsed;
    const parts = [error?.type, error?.code, error?.param, error?.message]
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.trim());
    if (parts.length) return [...new Set(parts)].join(' · ').slice(0, 600);
  } catch { /* Fall through without echoing arbitrary response bodies. */ }
  return undefined;
}

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

export interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface OpenAiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenAiToolHandler = (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;

function responseText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part: any) => typeof part === 'string' ? part : part?.text).filter((part: unknown): part is string => typeof part === 'string').join('');
  return '';
}

type ParsedToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

function parseChatCompletionBody(body: string): { content: string; toolCalls: ParsedToolCall[] } {
  const parseMessage = (message: any): { content: string; toolCalls: ParsedToolCall[] } => ({
    content: responseText(message?.content),
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : []
  });
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.choices?.[0]?.message;
    if (message) return parseMessage(message);
  } catch { /* Try an OpenAI-compatible SSE stream below. */ }

  const content: string[] = [];
  const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  let sawEvent = false;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let chunk: any;
    try { chunk = JSON.parse(data); } catch { continue; }
    sawEvent = true;
    const delta = chunk?.choices?.[0]?.delta;
    const deltaText = responseText(delta?.content);
    if (deltaText) content.push(deltaText);
    for (const part of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
      const index = Number.isInteger(part?.index) ? part.index : toolCalls.length;
      const existing = toolCalls[index] ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
      if (typeof part?.id === 'string') existing.id = part.id;
      if (part?.type === 'function') existing.type = 'function';
      if (typeof part?.function?.name === 'string') existing.function.name += part.function.name;
      if (typeof part?.function?.arguments === 'string') existing.function.arguments += part.function.arguments;
      toolCalls[index] = existing;
    }
  }
  if (!sawEvent) throw new Error('Gateway returned neither a JSON completion nor an SSE stream.');
  return { content: content.join(''), toolCalls: toolCalls.filter(call => call.id || call.function.name) };
}

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
  const deadline = Date.now() + timeoutMs;
  let requestJsonMode = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('The AI request timed out.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const body = { model, messages, temperature: 0.1, max_tokens: 12000, stream: true, ...(requestJsonMode ? { response_format: { type: 'json_object' } } : {}) };
      const response = await fetch(completionUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const responseBody = await response.text();
      if (!response.ok) {
        const error = new OpenAiCompatibleHttpError(response.status, providerErrorDetail(responseBody));
        // Some OpenAI-compatible gateways do not implement JSON mode even
        // though their models support it. Retry once without that optional
        // parameter, within the same total deadline.
        if (requestJsonMode && response.status === 400 && attempt === 0) {
          requestJsonMode = false;
          continue;
        }
        throw error;
      }
      const parsed = parseChatCompletionBody(responseBody);
      if (parsed.content.trim()) return parsed.content;
      throw new Error('Gateway response did not contain choices[0].message.content.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('The AI request timed out.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw new Error('The AI request did not produce a response.');
}



/**
 * Send an OpenAI-compatible request with local function tools. Tool execution
 * remains inside the extension host; only the tool call and its bounded result
 * are sent back to the configured provider. A single deadline covers all tool
 * turns so a slow provider cannot multiply the request timeout.
 */
export async function requestOpenAiCompatibleChatWithTools(
  endpoint: string,
  apiKey: string,
  model: string,
  initialMessages: OpenAiChatMessage[],
  tools: OpenAiToolDefinition[],
  handler: OpenAiToolHandler,
  timeoutMs = 120000
): Promise<string> {
  if (!apiKey.trim()) throw new Error('No stored remote API key is available.');
  if (!model.trim()) throw new Error('Select or enter a model before generating AI content.');
  let base: URL;
  try { base = new URL(endpoint); }
  catch { throw new Error('The configured AI endpoint is not a valid URL.'); }
  if (base.protocol !== 'https:') throw new Error('Configured remote AI endpoints must use HTTPS.');
  if (base.username || base.password) throw new Error('Configured AI endpoints must not embed credentials in the URL.');
  const completionUrl = new URL('chat/completions', `${base.toString().replace(/\/$/, '')}/`).toString();
  const deadline = Date.now() + timeoutMs;
  const messages: OpenAiChatMessage[] = initialMessages.map(message => ({ ...message }));
  for (let turn = 0; turn < 8; turn++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('The AI request timed out.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(completionUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        // Match the wire shape used by Cline/AI-SDK OpenAI-compatible clients:
        // tools are offered, the response is streamed, and tool_choice is left
        // at the provider default instead of forcing an often-unsupported
        // explicit `auto` value.
        body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 12000, tools, stream: true }),
        signal: controller.signal
      });
      const body = await response.text();
      if (!response.ok) throw new OpenAiCompatibleHttpError(response.status, providerErrorDetail(body));
      const parsed = parseChatCompletionBody(body);
      const message = { content: parsed.content };
      const toolCalls = parsed.toolCalls;
      if (toolCalls.length) {
        messages.push({ role: 'assistant', content: message.content, tool_calls: toolCalls });
        for (const call of toolCalls) {
          if (!call?.id || call.type !== 'function' || typeof call.function?.name !== 'string') throw new Error('Gateway returned an invalid tool call.');
          let args: Record<string, unknown> = {};
          try {
            const parsedArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) throw new Error('Tool arguments must be an object.');
            args = parsedArgs;
          } catch { throw new Error(`Tool ${call.function.name} returned invalid JSON arguments.`); }
          let result: unknown;
          try { result = await handler(call.function.name, args); }
          catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        continue;
      }
      const content = responseText(message?.content);
      if (content.trim()) return content;
      throw new Error('Gateway response did not contain choices[0].message.content or tool_calls.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('The AI request timed out.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw new Error('The AI tool-call loop exceeded its maximum of 8 turns.');
}
