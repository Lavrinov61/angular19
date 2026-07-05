import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { sshCommandTimeoutMs, sshConnectTimeoutSeconds, sshHost } from './config.js';

const execFileAsync = promisify(execFile);

export interface PowerShellRunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

export async function runPowerShell(script: string, options: PowerShellRunOptions = {}): Promise<string> {
  const wrappedScript = `
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
${script}
`;
  const encoded = Buffer.from(wrappedScript, 'utf16le').toString('base64');
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${sshConnectTimeoutSeconds()}`,
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=4',
    sshHost(),
    'powershell',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encoded,
  ];

  try {
    const { stdout, stderr } = await execFileAsync('ssh', args, {
      timeout: options.timeoutMs ?? sshCommandTimeoutMs(),
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      windowsHide: true,
    });
    return stderr ? `${stdout}\n${stderr}`.trim() : stdout.trim();
  } catch (error) {
    if (isExecError(error)) {
      const output = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
      throw new Error(output || error.message);
    }
    throw error;
  }
}

export async function runPowerShellJson(script: string, options: PowerShellRunOptions = {}): Promise<unknown> {
  const output = await runPowerShell(script, options);
  const jsonText = extractJson(output);
  return JSON.parse(jsonText);
}

export function psString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function psStringArray(values: readonly string[]): string {
  return `@(${values.map((value) => psString(value)).join(', ')})`;
}

function extractJson(output: string): string {
  const trimmed = output.trim();
  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const start = objectStart >= 0 ? objectStart : arrayStart;
  const objectEnd = trimmed.lastIndexOf('}');
  const arrayEnd = trimmed.lastIndexOf(']');
  const end = Math.max(objectEnd, arrayEnd);
  if (!Number.isFinite(start) || start < 0 || end < start) {
    throw new Error(`Remote command did not return JSON. Output: ${trimmed.slice(0, 1000)}`);
  }
  return trimmed.slice(start, end + 1);
}

interface ExecFileError extends Error {
  stdout?: string;
  stderr?: string;
}

function isExecError(error: unknown): error is ExecFileError {
  return error instanceof Error;
}
