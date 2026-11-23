/**
 * Local Codex CLI bridge.
 *
 * The editor never reads or stores Codex credentials. The CLI owns provider
 * configuration and authentication; this module only invokes it in a
 * read-only, ephemeral process and captures its final response.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { OpenAiChatMessage } from './ai-remote.js';

export interface CodexLocalAvailability {
  ok: boolean;
  message: string;
  executable?: string;
}

export interface CodexLocalRunOptions {
  cwd?: string;
  timeoutMs?: number;
  probe?: boolean;
  /** Optional per-request model override. Empty leaves the host Codex configuration in control. */
  model?: string;
}

const MAX_CAPTURED_STDERR = 24_000;
const MAX_CAPTURED_STDOUT = 24_000;

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

async function runProcess(executable: string, args: string[], input: string, cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } }, 500);
        reject(new Error('The local Codex request timed out.'));
      }
    }, timeoutMs);
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

export async function runCodexLocal(messages: OpenAiChatMessage[], options: CodexLocalRunOptions = {}): Promise<string> {
  const cwd = options.cwd || process.cwd();
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 120_000);
  const outputDirectory = await mkdtemp(join(tmpdir(), 'scap-ng-codex-'));
  const outputFile = join(outputDirectory, 'last-message.txt');
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd];
  const model = options.model?.trim();
  if (model) args.push('--model', model);
  args.push('--output-last-message', outputFile);
  const prompt = options.probe
    ? 'Reply with exactly CODEX_SMOKE_OK. Do not inspect or modify files.'
    : promptFor(messages);
  try {
    const preferred = firstAbsoluteCandidate();
    const commands = preferred ? [preferred, 'codex'] : ['codex'];
    let lastError: unknown;
    for (const executable of commands) {
      try {
        const result = await runProcess(executable, args, prompt, cwd, timeoutMs);
        if (result.code !== 0) throw new Error(processFailure(result));
        const response = (await readFile(outputFile, 'utf8').catch(() => '')).trim() || result.stdout.trim();
        if (!response) throw new Error('Local Codex completed without a final response.');
        return response;
      } catch (error) {
        lastError = error;
        if (!(error instanceof Error) || !/ENOENT|not found/i.test(error.message)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('The Codex executable was not found.');
  } finally {
    await rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function testCodexLocal(cwd = process.cwd(), model?: string): Promise<CodexLocalAvailability> {
  const preferred = firstAbsoluteCandidate();
  if (!preferred && !process.env.PATH?.split(delimiter).length) return { ok: false, message: 'Codex CLI was not found on PATH or in the installed VS Code Codex extension.' };
  try {
    const response = await runCodexLocal([], { cwd, timeoutMs: 45_000, probe: true, model });
    if (response.trim() !== 'CODEX_SMOKE_OK') return { ok: false, message: 'Codex CLI responded, but the bounded availability test returned an unexpected response.' , executable: preferred ?? 'codex' };
    return { ok: true, message: `Codex local is available through the configured CLI${preferred ? ` (${preferred})` : ''}.`, executable: preferred ?? 'codex' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), executable: preferred ?? 'codex' };
  }
}
