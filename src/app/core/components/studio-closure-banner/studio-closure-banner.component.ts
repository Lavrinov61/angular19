import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { StudioAlertService, type ClosureInfo, type StudioStatus } from '../../services/studio-alert.service';

@Component({
  selector: 'app-studio-closure-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule],
  template: `
    @if (shouldShow()) {
      <div class="banner">
        <div class="banner-content">
          @for (closure of closures(); track closure.location_code) {
            <div class="banner-item">
              <mat-icon class="banner-icon">location_off</mat-icon>
              <div class="banner-text">
                <span class="banner-address">{{ shortName(closure) }}</span>
                <span class="banner-dash">, </span>
                <span class="banner-reason">{{ closureLabel(closure) }}</span>
                @if (openAlternativeLabel(); as alternativeLabel) {
                  <span class="banner-alt"> · Работаем ежедневно на <strong>{{ alternativeLabel }}</strong></span>
                }
              </div>
            </div>
          }
        </div>
        <button mat-icon-button class="banner-close" (click)="dismiss()" aria-label="Закрыть">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: sticky;
      top: 56px;
      z-index: 99;
    }

    @media (min-width: 600px) {
      :host {
        top: 64px;
      }
    }
    .banner {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 16px;
      background: linear-gradient(135deg, #78350f, #451a03);
      color: #fef3c7;
      font-size: 14px;
      line-height: 1.5;
      animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .banner-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .banner-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .banner-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 2px;
      color: #fcd34d;
    }
    .banner-text {
      flex: 1;
    }
    .banner-address {
      font-weight: 600;
    }
    .banner-alt {
      opacity: 0.85;
    }
    .banner-close {
      flex-shrink: 0;
      color: #fcd34d;
      width: 28px;
      height: 28px;
      line-height: 28px;
      --mdc-icon-button-icon-size: 18px;
      --mdc-icon-button-state-layer-size: 28px;
    }
    @keyframes slideDown {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `,
})
export class StudioClosureBannerComponent {
  private alertService = inject(StudioAlertService);

  protected closures = this.alertService.activeClosures;
  protected openAlternatives = this.alertService.openStudios;
  protected visible = this.alertService.hasActiveClosures;
  protected dismissed = signal(false);
  protected shouldShow = computed(() => this.visible() && !this.dismissed());
  protected openAlternativeLabel = computed(() => {
    const alternative = this.openAlternatives().find(studio => this.hasPhysicalAlternativeLabel(studio));
    return alternative ? this.alternativeLabel(alternative) : '';
  });

  protected closureLabel(closure: ClosureInfo): string {
    if (closure.reason) return closure.reason;

    const dates = closure.closure_dates;
    const today = this.todayStr();

    // Закрытие только на сегодня — самый частый случай
    if (dates.length === 1 && dates[0] === today) {
      return 'сегодня не работает';
    }
    // Закрытие на один будущий день
    if (dates.length === 1) {
      return `не работает ${this.formatRussianDate(dates[0])}`;
    }
    // Несколько дней (или статус студии) — показываем день, когда снова открыта
    if (closure.reopen_date) {
      return `перерыв до ${this.formatRussianDate(closure.reopen_date)}`;
    }
    return closure.reason || 'временно не работает';
  }

  protected shortName(closure: ClosureInfo): string {
    return this.shortAddr(closure.address) || closure.studio_name;
  }

  protected shortAddr(address: string | null | undefined): string {
    return (address ?? '')
      .replace(/^г\.\s*Ростов-на-Дону,?\s*/i, '')
      .replace(/^ул\.\s*/i, '')
      .replace(/,\s*Ростов-на-Дону$/i, '')
      .trim();
  }

  dismiss(): void {
    this.dismissed.set(true);
  }

  private formatDateRange(dates: string[]): string {
    if (dates.length === 0) return '';
    if (dates.length === 1) return this.formatRussianDate(dates[0]);
    return `${this.formatRussianDate(dates[0])}, ${this.formatRussianDate(dates[dates.length - 1])}`;
  }

  private hasPhysicalAlternativeLabel(studio: StudioStatus): boolean {
    return studio.location_code !== 'online' && this.alternativeLabel(studio).length > 0;
  }

  private alternativeLabel(studio: StudioStatus): string {
    if (studio.location_code === 'soborny') return 'Соборном 21';
    return this.shortAddr(studio.address) || this.shortStudioName(studio.name);
  }

  private shortStudioName(name: string): string {
    return name.replace(/^Своё Фото\s*-\s*/i, '').trim();
  }

  private todayStr(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatRussianDate(dateStr: string | Date): string {
    let d: Date;
    if (dateStr instanceof Date) {
      d = dateStr;
    } else {
      d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
}
