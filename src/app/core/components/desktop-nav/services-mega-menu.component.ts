import { Component, output, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { getServiceCategoriesWithItems, ServiceCategoryWithItems } from '../../data/service-categories.data';

@Component({
  selector: 'app-services-mega-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatIconModule],
  template: `
    <div class="mega-menu"
         (mouseenter)="menuEnter.emit()"
         (mouseleave)="menuLeave.emit()">
      <div class="mega-grid">
        @for (category of categories; track category.id) {
          <div class="mega-column">
            <div class="mega-column-header">
              <mat-icon class="mega-column-icon">{{ category.icon }}</mat-icon>
              <span class="mega-column-title">{{ category.title }}</span>
            </div>
            <ul class="mega-list">
              @for (item of category.items; track item.id) {
                <li>
                  <a [routerLink]="'/' + item.slug"
                     class="mega-link"
                     (click)="itemClick.emit()">
                    {{ item.title }}
                    @if (item.tag) {
                      <span class="mega-tag" [attr.data-tag]="item.tag">
                        {{ tagLabels[item.tag] }}
                      </span>
                    }
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      </div>
      <div class="mega-footer">
        <a routerLink="/services" class="mega-all-link" (click)="itemClick.emit()">
          Все услуги
          <mat-icon class="mega-arrow">arrow_forward</mat-icon>
        </a>
      </div>
    </div>
  `,
  styles: [`
    .mega-menu {
      width: 100%;
      max-height: calc(100dvh - 64px);
      overflow-y: auto;
      background: #0b0b0d;
      border-top: 1px solid #25252a;
      box-shadow: 0 30px 80px rgb(0 0 0 / 52%);
      padding: 32px max(24px, calc((100vw - 1240px) / 2)) 36px;
    }

    .mega-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 44px;
      max-width: 1240px;
      margin: 0 auto;
    }

    @media (max-width: 1099px) {
      .mega-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    @media (max-width: 839px) {
      .mega-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .mega-column-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #25252a;
    }

    .mega-column-icon {
      color: #ef3124;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .mega-column-title {
      font-family: 'Oswald', sans-serif;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #8d8d93;
    }

    .mega-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .mega-link {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      border-radius: 0;
      color: #f5f5f5;
      text-decoration: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      line-height: 1.4;
      transition: all 150ms ease;

      &:hover {
        color: #ef3124;
      }
    }

    .mega-tag {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;

      &[data-tag="popular"] {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
      }

      &[data-tag="new"] {
        background: rgba(34, 197, 94, 0.15);
        color: #22c55e;
      }

      &[data-tag="sale"] {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
      }
    }

    .mega-footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #25252a;
      display: flex;
      justify-content: flex-end;
      max-width: 1240px;
      margin-left: auto;
      margin-right: auto;
    }

    .mega-all-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #ef3124;
      text-decoration: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      font-weight: 600;
      transition: gap 200ms ease;

      &:hover {
        gap: 8px;
      }
    }

    .mega-arrow {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
  `]
})
export class ServicesMegaMenuComponent {
  readonly menuEnter = output<void>();
  readonly menuLeave = output<void>();
  readonly itemClick = output<void>();

  protected readonly categories: ServiceCategoryWithItems[] = getServiceCategoriesWithItems();

  protected readonly tagLabels: Record<string, string> = {
    popular: 'Хит',
    new: 'Новинка',
    sale: 'Акция',
  };
}
