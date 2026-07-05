import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ServiceCardComponent } from './service-card.component';
import type {
  UiCategory,
  UiServiceOption,
  SearchResult,
} from '../models/payment-dialog.models';

@Component({
  selector: 'app-pd-service-grid',
  imports: [MatIconModule, ServiceCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    <div class="sg-scroll">
      @if (mode() === 'search') {
        @if (searchResults().length === 0) {
          <div class="sg-empty">
            <mat-icon>search_off</mat-icon>
            <span>Услуга не найдена</span>
          </div>
        } @else {
          <div class="sg-section-label">Результаты поиска</div>
          <div class="sg-grid">
            @for (result of searchResults(); track result.service.id + result.categorySlug) {
              <app-service-card
                [service]="result.service"
                [selected]="selectedIds().has(result.service.id)"
                [showCategory]="true"
                [categoryName]="result.categoryName"
                (toggled)="serviceToggled.emit({ service: result.service, categoryName: result.categoryName })"
              />
            }
          </div>
        }
      } @else {
        @for (section of sections(); track section.slug) {
          <div class="sg-section-label">
            <mat-icon class="sg-section-icon">{{ section.icon }}</mat-icon>
            {{ section.name }}
          </div>
          @for (group of section.groups; track group.slug) {
            @if (section.groups.length > 1) {
              <div class="sg-group-label">{{ group.name }}</div>
            }
            <div class="sg-grid">
              @for (svc of group.options; track svc.id) {
                <app-service-card
                  [service]="svc"
                  [selected]="selectedIds().has(svc.id)"
                  (toggled)="serviceToggled.emit({ service: svc, categoryName: section.name })"
                />
              }
            </div>
          }
        }
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      min-height: 0;
      height: 100%;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .sg-scroll {
      flex: 1;
      overflow-y: auto;
      max-height: none;
      min-height: 80px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
    }

    .sg-section-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7a7a7a;
      margin: 4px 0 8px;

      &:not(:first-child) { margin-top: 14px; }
    }

    .sg-section-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
      color: #f59e0b;
    }

    .sg-group-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #5c5c5c;
      margin: 8px 0 6px;
      padding-left: 2px;
    }

    .sg-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
      gap: 6px;
    }

    .sg-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 24px 0;
      color: #7a7a7a;

      mat-icon { font-size: 32px; width: 32px; height: 32px; }
      span { font-size: 13px; }
    }
  `],
})
export class ServiceGridComponent {
  readonly mode = input.required<'browse' | 'search'>();
  readonly sections = input<readonly UiCategory[]>([]);
  readonly searchResults = input<readonly SearchResult[]>([]);
  readonly selectedIds = input.required<ReadonlySet<string>>();

  readonly serviceToggled = output<{ service: UiServiceOption; categoryName: string }>();
}
