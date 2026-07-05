import {
  Component, inject, input, output, signal,
  ChangeDetectionStrategy, OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-voice-recorder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @if (recording()) {
      <div class="voice-recording">
        <div class="recording-indicator">
          <span class="recording-dot"></span>
          <span class="recording-time">{{ formatDuration(duration()) }}</span>
        </div>
        <button class="voice-cancel-btn" (click)="cancelRecording()" matTooltip="Отмена" aria-label="Отменить запись">
          <mat-icon>close</mat-icon>
        </button>
        <button class="voice-stop-btn" (click)="stopRecording()" matTooltip="Отправить" aria-label="Остановить и отправить">
          <mat-icon>send</mat-icon>
        </button>
      </div>
    } @else if (sending()) {
      <div class="voice-sending">
        <mat-icon>hourglass_top</mat-icon>
        <span>Отправка...</span>
      </div>
    } @else {
      <button class="voice-btn" (click)="startRecording()" matTooltip="Голосовое сообщение" aria-label="Записать голосовое">
        <mat-icon>mic</mat-icon>
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }

    .voice-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: none;
      border: 1px solid var(--crm-glass-border);
      color: var(--crm-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 150ms;
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
      &:hover {
        color: var(--crm-accent);
        border-color: rgba(245, 158, 11, 0.3);
        background: rgba(245, 158, 11, 0.06);
      }
    }

    .voice-recording {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 24px;
      animation: recordingFadeIn 200ms ease;
    }

    @keyframes recordingFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .recording-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .recording-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      animation: recordPulse 1s ease-in-out infinite;
    }

    @keyframes recordPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .recording-time {
      font-family: var(--crm-font-mono);
      font-size: 14px;
      color: #ef4444;
      min-width: 40px;
    }

    .voice-cancel-btn, .voice-stop-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 150ms;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .voice-cancel-btn {
      background: rgba(255, 255, 255, 0.06);
      color: var(--crm-text-muted);
      &:hover { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
    }

    .voice-stop-btn {
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      color: #000;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
      &:hover { transform: scale(1.1); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4); }
    }

    .voice-sending {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      color: var(--crm-text-muted);
      font-size: 13px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; animation: spin 1s linear infinite; }
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class VoiceRecorderComponent implements OnDestroy {
  private readonly http = inject(HttpClient);

  conversationId = input.required<string>();
  voiceSent = output<void>();

  recording = signal(false);
  duration = signal(0);
  sending = signal(false);

  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  async startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      this.chunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        this.uploadVoice(blob);
      };

      this.mediaRecorder.start(100);
      this.recording.set(true);
      this.duration.set(0);
      this.timer = setInterval(() => this.duration.update(d => d + 1), 1000);
    } catch {
      // Микрофон не доступен
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.recording.set(false);
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  cancelRecording(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
      this.chunks = [];
    }
    this.recording.set(false);
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private uploadVoice(blob: Blob): void {
    if (blob.size === 0) return;
    this.sending.set(true);
    const convId = this.conversationId();
    const filename = `voice-${Date.now()}.webm`;

    this.http.post<{ success: boolean; uploadUrl: string; key: string }>(
      `/api/staff-chat/conversations/${convId}/direct-upload/presign`,
      { filename, contentType: 'audio/webm', size: blob.size }
    ).subscribe({
      next: (res) => {
        if (!res.success) { this.sending.set(false); return; }

        this.http.put(res.uploadUrl, blob, {
          headers: { 'Content-Type': 'audio/webm' }
        }).subscribe({
          next: () => {
            this.http.post(`/api/staff-chat/conversations/${convId}/direct-upload/complete`, {
              key: res.key,
              filename,
              contentType: 'audio/webm',
              size: blob.size,
            }).subscribe({
              next: () => {
                this.sending.set(false);
                this.voiceSent.emit();
              },
              error: () => this.sending.set(false),
            });
          },
          error: () => this.sending.set(false),
        });
      },
      error: () => this.sending.set(false),
    });
  }

  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  ngOnDestroy(): void {
    this.cancelRecording();
  }
}
