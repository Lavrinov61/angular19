import { spawn } from 'node:child_process';
import type { AgentConfig } from './config.js';

export interface NativeNotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  urgency?: 'normal' | 'high';
  url?: string;
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

export function parseNotificationPayload(value: unknown): NativeNotificationPayload | null {
  if (!isObject(value)) return null;
  if (typeof value['id'] !== 'string') return null;
  if (typeof value['type'] !== 'string') return null;
  if (typeof value['title'] !== 'string') return null;
  if (typeof value['body'] !== 'string') return null;
  if (typeof value['createdAt'] !== 'string') return null;

  return {
    id: value['id'],
    type: value['type'],
    title: value['title'],
    body: value['body'],
    createdAt: value['createdAt'],
    urgency: value['urgency'] === 'high' ? 'high' : 'normal',
    url: typeof value['url'] === 'string' ? value['url'] : undefined,
  };
}

function limitText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function run(command: string, args: readonly string[], timeoutMs = 5000): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      windowsHide: true,
    });

    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);

    child.once('error', () => finish(false));
    child.once('exit', code => finish(code === 0));
  });
}

async function playSound(config: AgentConfig): Promise<boolean> {
  if (!config.sound.enabled) return true;

  if (process.platform === 'win32') {
    return run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '[Console]::Beep(880, 350); Start-Sleep -Milliseconds 80; [Console]::Beep(988, 250)',
    ], 3000);
  }

  if (process.platform === 'darwin') {
    return run('afplay', [config.sound.macosSound], 3000);
  }

  process.stdout.write('\u0007');
  return true;
}

async function showToast(config: AgentConfig, payload: NativeNotificationPayload): Promise<boolean> {
  if (!config.toast.enabled) return true;

  const title = limitText(payload.title, 80);
  const body = limitText(payload.body, 180);

  if (process.platform === 'darwin') {
    return run('osascript', [
      '-e', 'on run argv',
      '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e', 'end run',
      title,
      body,
    ], 4000);
  }

  if (process.platform === 'win32') {
    return run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '$title=$args[0]; $body=$args[1]; if (Get-Command New-BurntToastNotification -ErrorAction SilentlyContinue) { New-BurntToastNotification -Text $title,$body | Out-Null }',
      title,
      body,
    ], 4000);
  }

  return run('notify-send', [title, body], 4000);
}

export async function showNativeNotification(config: AgentConfig, payload: NativeNotificationPayload): Promise<void> {
  const [soundOk, toastOk] = await Promise.all([
    playSound(config),
    showToast(config, payload),
  ]);

  if (!soundOk || !toastOk) {
    throw new Error(`Native notification partial failure: sound=${soundOk}, toast=${toastOk}`);
  }
}
