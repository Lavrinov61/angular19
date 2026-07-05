import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface FaceValidationBadgeData {
  face_height_mm: number | null;
  gost_pass: boolean;
  gost_height_min_mm: number;
  gost_height_max_mm: number;
  document_type?: string;
}

@Component({
  selector: 'app-face-validation-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatChipsModule, MatIconModule, MatTooltipModule],
  template: `
    @if (badgeState(); as state) {
      <mat-chip [class]="state.cls"
                class="face-badge"
                [matTooltip]="state.tooltip">
        <mat-icon matChipAvatar>{{ state.icon }}</mat-icon>
        {{ state.label }}
      </mat-chip>
    }
  `,
  styles: [`
    .face-badge {
      font-size: 12px;
      height: 26px;
      --mdc-chip-label-text-size: 12px;
    }

    .badge-pass {
      --mdc-chip-elevated-container-color: rgba(34, 197, 94, 0.15);
      --mdc-chip-label-text-color: #22c55e;
      --mdc-chip-with-icon-icon-color: #22c55e;
    }

    .badge-fail {
      --mdc-chip-elevated-container-color: rgba(234, 179, 8, 0.15);
      --mdc-chip-label-text-color: #eab308;
      --mdc-chip-with-icon-icon-color: #eab308;
    }

    .badge-none {
      --mdc-chip-elevated-container-color: rgba(160, 160, 160, 0.12);
      --mdc-chip-label-text-color: #a0a0a0;
      --mdc-chip-with-icon-icon-color: #a0a0a0;
    }
  `],
})
export class FaceValidationBadgeComponent {
  readonly faceValidation = input<FaceValidationBadgeData | null>(null);

  readonly badgeState = computed(() => {
    const fv = this.faceValidation();
    if (!fv) {
      return { cls: 'badge-none', icon: 'help_outline', label: 'Не проверено', tooltip: 'ГОСТ-проверка не выполнена' };
    }

    if (fv.gost_pass) {
      const label = fv.face_height_mm != null ? `${fv.face_height_mm}мм` : 'ГОСТ';
      return {
        cls: 'badge-pass',
        icon: 'check_circle',
        label: `\u2705 ${label}`,
        tooltip: fv.document_type
          ? `${fv.document_type}: лицо ${fv.face_height_mm}мм, соответствует ГОСТ (${fv.gost_height_min_mm}-${fv.gost_height_max_mm}мм)`
          : `Лицо ${fv.face_height_mm}мм, соответствует ГОСТ`,
      };
    }

    const heightText = fv.face_height_mm != null ? `${fv.face_height_mm}мм` : '?';
    return {
      cls: 'badge-fail',
      icon: 'warning',
      label: `\u26A0\uFE0F ${heightText} (нужно ${fv.gost_height_min_mm}-${fv.gost_height_max_mm}мм)`,
      tooltip: fv.document_type
        ? `${fv.document_type}: лицо ${fv.face_height_mm}мм, НЕ соответствует ГОСТ (${fv.gost_height_min_mm}-${fv.gost_height_max_mm}мм)`
        : `Лицо ${fv.face_height_mm}мм, не соответствует ГОСТ`,
    };
  });
}
