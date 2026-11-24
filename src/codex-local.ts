/**
 * Local Codex CLI bridge.
 *
 * The editor never reads or stores Codex credentials. The CLI owns provider
 * configuration and authentication; this module only invokes it in a
 * read-only, ephemeral process and captures its final response.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { OpenAiChatMessage } from './ai-remote.js';
import { normalizeCodexReasoningEffort, type CodexReasoningEffort } from './ai-configuration.js';

export interface CodexLocalAvailability {
  ok: boolean;
  message: string;
  executable?: string;
}

export interface CodexModelCatalog {
  models: string[];
  message: string;
}

export interface CodexLocalRunOptions {
  cwd?: string;
  timeoutMs?: number;
  probe?: boolean;
  /** Optional per-request model override. Empty leaves the host Codex configuration in control. */
  model?: string;
  /** Per-request effort; host leaves model_reasoning_effort from Codex config.toml unchanged. */
  reasoningEffort?: CodexReasoningEffort;
  /** Abort an in-flight provider process when the author cancels generation. */
  signal?: AbortSignal;
}

const MAX_CAPTURED_STDERR = 24_000;
const MAX_CAPTURED_STDOUT = 24_000;

/**
 * The final response contract used by SCAP-NG AI authoring.  This is enforced
 * by Codex CLI before its last message is written, which prevents prose,
 * Markdown fences, or missing coverage metadata from reaching the YAML parser.
 * Semantic/schema validation still happens in ai-assessment.ts.
 */
const SCAP_NG_AI_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: ['generated_mode', 'confidence', 'assessment_yaml', 'assumptions', 'unresolved_questions', 'citations', 'rationale', 'coverage'],
  properties: {
    generated_mode: { type: 'string', enum: ['automated', 'manual-only'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    assessment_yaml: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    unresolved_questions: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    coverage: {
      type: 'object', additionalProperties: false,
      required: ['applicability', 'procedure_steps', 'path_patterns'],
      properties: {
        applicability: { type: 'string', enum: ['implemented', 'not-needed', 'not-representable'] },
        procedure_steps: { type: 'array', items: { type: 'object', required: ['summary', 'represented'], properties: { summary: { type: 'string' }, represented: { type: 'boolean' }, tests: { type: 'array', items: { type: 'string' } } }, additionalProperties: true } },
        path_patterns: { type: 'array', items: { type: 'object', required: ['pattern', 'represented'], properties: { pattern: { type: 'string' }, represented: { type: 'boolean' }, strategy: { type: 'string' } }, additionalProperties: true } }
      }
    }
  }
} as const;

function executableCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.SCAP_NG_CODEX_BIN?.trim()) candidates.push(process.env.SCAP_NG_CODEX_BIN.trim());
  if (process.env.CODEX_BIN?.trim()) candidates.push(process.env.CODEX_BIN.trim());
  candidates.push('codex');
  const roots = [
    join(homedir(), '.vscode', 'extensions'),
    join(homedir(), '.vscode-server', 'extensions')
  ];
  for (const root of roots) {
    let entries: string[] = [];
    try { entries = readdirSync(root).filter(entry => /^openai\.chatgpt-/i.test(entry)).sort().reverse(); } catch { continue; }
    for (const entry of entries) {
      const relative = platform() === 'win32'
        ? join(entry, 'bin', 'windows-x86_64', 'codex.exe')
        : join(entry, 'bin', platform() === 'darwin' ? 'aarch64-apple-darwin' : 'linux-x86_64', 'codex');
      candidates.push(join(root, relative));
    }
  }
  return [...new Set(candidates)];
}

function firstAbsoluteCandidate(): string | undefined {
  return executableCandidates().find(candidate => candidate !== 'codex' && existsSync(candidate));
}

function trimCapture(value: string, limit: number): string {
  return value.length > limit ? value.slice(0, limit) + '\n[…truncated…]' : value;
}

function promptFor(messages: OpenAiChatMessage[]): string {
  return messages.map(message => {
    const role = String(message.role ?? 'user').toUpperCase();
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
    return `--- ${role} ---\n${content}`;
  }).join('\n\n');
}

async function runProcess(executable: string, args: string[], input: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const killChild = () => {
      try { child.kill('SIGTERM'); } catch { /* already exited */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } }, 500);
    };
    let removeAbortListener: () => void = () => undefined;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeAbortListener();
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        removeAbortListener();
        killChild();
        reject(new Error('The local Codex request timed out.'));
      }
    }, timeoutMs);
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeAbortListener();
      killChild();
      reject(new Error('The local Codex request was canceled.'));
    };
    if (signal) {
      if (signal.aborted) { cancel(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', cancel);
    }
    child.stdout.on('data', chunk => { stdout = trimCapture(stdout + String(chunk), MAX_CAPTURED_STDOUT); });
    child.stderr.on('data', chunk => { stderr = trimCapture(stderr + String(chunk), MAX_CAPTURED_STDERR); });
    child.stdin.on('error', () => { /* A short-lived probe may exit before stdin drains. */ });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => finish({ code: typeof code === 'number' ? code : 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

function processFailure(result: { code: number; stderr: string; stdout: string }): string {
  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
  if (/quota|rate.?limit|insufficient|credit|billing|token limit/i.test(details)) return `Local Codex provider reported a quota or token limit: ${details}`;
  if (/unauthori[sz]|forbidden|not logged|authentication|credential/i.test(details)) return `Local Codex provider authentication failed: ${details}`;
  return `Local Codex provider exited with status ${result.code}${details ? `: ${details}` : '.'}`;
}


function parseModelCatalog(stdout: string): string[] {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Codex model catalog did not return JSON.');
  let payload: any;
  try { payload = JSON.parse(stdout.slice(start, end + 1)); }
  catch { throw new Error('Codex model catalog returned invalid JSON.'); }
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const ids = models
    .filter((model: any) => model && typeof model.slug === 'string' && model.slug.trim() && model.visibility !== 'hidden' && model.supported_in_api !== false)
    .map((model: any) => String(model.slug).trim()) as string[];
  return [...new Set<string>(ids)].sort((a, b) => a.localeCompare(b));
}

export async function runCodexLocal(messages: OpenAiChatMessage[], options: CodexLocalRunOptions = {}): Promise<string> {
  const cwd = options.cwd || process.cwd();
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 120_000);
  const outputDirectory = await mkdtemp(join(tmpdir(), 'scap-ng-codex-'));
  const outputFile = join(outputDirectory, 'last-message.txt');
  const outputSchemaFile = join(outputDirectory, 'ai-response.schema.json');
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd];
  if (!options.probe) {
    // Codex CLI can enforce the outer JSON protocol itself. This removes a
    // common first-pass failure mode before SCAP-NG semantic validation runs.
    await writeFile(outputSchemaFile, JSON.stringify(SCAP_NG_AI_RESPONSE_SCHEMA), 'utf8');
    args.push('--output-schema', outputSchemaFile);
  }
  const model = options.model?.trim();
  if (model) args.push('--model', model);
  const reasoningEffort = normalizeCodexReasoningEffort(options.reasoningEffort);
  if (reasoningEffort !== 'host' && reasoningEffort !== 'auto') args.push('-c', `model_reasoning_effort=\"${reasoningEffort}\"`);
  args.push('--output-last-message', outputFile);
  const prompt = options.probe
    ? 'Reply with exactly CODEX_SMOKE_OK. Do not inspect or modify files.'
    : promptFor(messages);
  try {
    const preferred = firstAbsoluteCandidate();
    const commands = preferred ? [preferred, 'codex'] : ['codex'];
    let lastError: unknown;
    const launchFailures: string[] = [];
    for (const executable of commands) {
      try {
        const result = await runProcess(executable, args, prompt, cwd, timeoutMs, options.signal);
        if (result.code !== 0) throw new Error(processFailure(result));
        const response = (await readFile(outputFile, 'utf8').catch(() => '')).trim() || result.stdout.trim();
        if (!response) throw new Error('Local Codex completed without a final response.');
        return response;
      } catch (error) {
        lastError = error;
        if (!(error instanceof Error) || !/ENOENT|not found/i.test(error.message)) throw error;
        launchFailures.push(`${executable}: ${error.message}`);
      }
    }
    if (launchFailures.length) {
      throw new Error(`Codex CLI could not be launched from the VS Code extension host. ${launchFailures.join(' | ')}. Install/enable Codex in this same host or set SCAP_NG_CODEX_BIN to its executable path.`);
    }
    throw lastError instanceof Error ? lastError : new Error('The Codex executable was not found.');
  } finally {
    await rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function testCodexLocal(cwd = process.cwd(), model?: string, reasoningEffort?: CodexReasoningEffort): Promise<CodexLocalAvailability> {
  const preferred = firstAbsoluteCandidate();
  if (!preferred && !process.env.PATH?.split(delimiter).length) return { ok: false, message: 'Codex CLI was not found on PATH or in the installed VS Code Codex extension.' };
  try {
    const response = await runCodexLocal([], { cwd, timeoutMs: 45_000, probe: true, model, reasoningEffort });
    if (response.trim() !== 'CODEX_SMOKE_OK') return { ok: false, message: 'Codex CLI responded, but the bounded availability test returned an unexpected response.' , executable: preferred ?? 'codex' };
    return { ok: true, message: `Codex local is available through the configured CLI${preferred ? ` (${preferred})` : ''}.`, executable: preferred ?? 'codex' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), executable: preferred ?? 'codex' };
  }
}

/**
 * Ask the host Codex CLI for its configured provider model catalog. This is a
 * metadata request, not an Assessment request; credentials and endpoint
 * configuration remain owned by Codex. The catalog may be refreshed by the
 * CLI and can therefore fail when the host is unauthenticated or offline.
 */
export async function discoverCodexModels(cwd = process.cwd()): Promise<CodexModelCatalog> {
  const preferred = firstAbsoluteCandidate();
  const commands = preferred ? [preferred, 'codex'] : ['codex'];
  let lastError: unknown;
  for (const executable of commands) {
    try {
      const result = await runProcess(executable, ['debug', 'models'], '', cwd, 30_000);
      if (result.code !== 0) throw new Error(processFailure(result));
      const models = parseModelCatalog(result.stdout);
      if (!models.length) throw new Error('Codex returned no selectable models from its configured catalog.');
      return { models, message: `Codex CLI returned ${models.length} selectable model${models.length === 1 ? '' : 's'} from its configured catalog.` };
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !/ENOENT|not found/i.test(error.message)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The Codex executable was not found.');
}
