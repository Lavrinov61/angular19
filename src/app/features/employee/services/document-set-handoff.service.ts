import { Injectable, signal } from '@angular/core';
import type { FaceValidationResult } from './face-validation-api.service';

/** Одноразовая передача кликнутого фото из чата в print-center для «Комплекта на документы». */
export interface DocumentSetHandoff {
  readonly url: string;
  readonly name: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly faceValidation?: FaceValidationResult;
}

/**
 * Root-singleton для надёжной передачи кликнутого фото в print-center, минуя
 * пере-обнаружение через chatFiles()/messagesToFiles (источник гонки, см.
 * research-frontend-flow.md). chat-detail кладёт фото перед navigate, print-center
 * читает его через consume() и сразу открывает диалог комплекта.
 */
@Injectable({ providedIn: 'root' })
export class DocumentSetHandoffService {
  private readonly _pending = signal<DocumentSetHandoff | null>(null);

  set(handoff: DocumentSetHandoff): void {
    this._pending.set(handoff);
  }

  /** Возвращает отложенный handoff и очищает его (одноразовый). */
  consume(): DocumentSetHandoff | null {
    const value = this._pending();
    if (value) this._pending.set(null);
    return value;
  }
}
