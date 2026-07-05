import { Component, input, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { NetworkStatusService } from '../../services/network-status.service';

@Component({
  selector: 'app-network-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatProgressBarModule],
  styleUrl: './network-banner.component.scss',
  template: `
    <div class="nb-wrapper"
         [class.is-visible]="ns.activeBanner() !== null"
         [class.section-public]="section() === 'public'"
         [class.section-crm]="section() === 'crm'">
      @switch (ns.activeBanner()) {
        @case ('offline') {
          <div class="nb nb--offline">
            <mat-icon class="nb-icon">cloud_off</mat-icon>
            <span class="nb-msg">Нет подключения к интернету</span>
            @if (ns.pendingCount()) {
              <span class="nb-chip">{{ ns.pendingCount() }} в очереди</span>
            }
            @if (ns.failedCount()) {
              <span class="nb-chip nb-chip--failed">{{ ns.failedCount() }} не синхронизировано</span>
            }
          </div>
        }
        @case ('reconnecting') {
          <div class="nb nb--reconnecting">
            <span class="nb-spinner"></span>
            <span class="nb-msg">Восстанавливаем подключение...</span>
          </div>
        }
        @case ('back-online') {
          <div class="nb nb--back-online">
            <mat-icon class="nb-icon">check_circle</mat-icon>
            <span class="nb-msg">Подключение восстановлено</span>
          </div>
        }
        @case ('syncing') {
          <div class="nb nb--syncing">
            <span class="nb-spinner"></span>
            <span class="nb-msg">
              Синхронизация данных...
              @if (ns.pendingCount()) {
                <span class="nb-count">({{ ns.pendingCount() }})</span>
              }
            </span>
            <mat-progress-bar mode="indeterminate" class="nb-progress" />
          </div>
        }
        @case ('slow') {
          <div class="nb nb--slow">
            <mat-icon class="nb-icon">signal_cellular_alt</mat-icon>
            <span class="nb-msg">Медленное подключение</span>
            <button mat-icon-button class="nb-dismiss" (click)="ns.dismissSlowBanner()" aria-label="Закрыть">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
        @case ('update') {
          <div class="nb nb--update">
            <mat-icon class="nb-icon">system_update</mat-icon>
            <span class="nb-msg">Доступно обновление {{ section() === 'crm' ? 'ФотоПульта' : 'сайта' }}</span>
            <button mat-button class="nb-action" (click)="ns.reloadForUpdate()">Обновить</button>
            <button mat-icon-button class="nb-dismiss" (click)="ns.dismissUpdate()" aria-label="Позже">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }
      }
    </div>
  `
})
export class NetworkBannerComponent {
  section = input<'public' | 'crm'>('public');
  protected readonly ns = inject(NetworkStatusService);
}
