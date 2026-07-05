import { Component, signal, ChangeDetectionStrategy, OnInit, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { ProductionOrdersComponent } from './sections/production-orders.component';
import { ProductionHousesComponent } from './sections/production-houses.component';
import { ProductionCatalogComponent } from './sections/production-catalog.component';
import { ProductionAnalyticsComponent } from './sections/production-analytics.component';
import { ProductionAiComponent } from './sections/production-ai.component';
import { ProductionReferenceDataComponent } from './sections/production-reference-data.component';

type Section = 'orders' | 'houses' | 'catalog' | 'analytics' | 'ai' | 'reference';
const VALID_SECTIONS: Section[] = ['orders', 'houses', 'catalog', 'analytics', 'ai', 'reference'];

@Component({
  selector: 'app-production',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatButtonToggleModule,
    MatIconModule,
    ProductionOrdersComponent,
    ProductionHousesComponent,
    ProductionCatalogComponent,
    ProductionAnalyticsComponent,
    ProductionAiComponent,
    ProductionReferenceDataComponent,
    RouterModule,
  ],
  template: `
    <div class="production-page">
      <div class="page-header">
        <h1><mat-icon>factory</mat-icon> Производства</h1>
        <mat-button-toggle-group [value]="activeSection()" (change)="setSection($event.value)">
          <mat-button-toggle value="orders">
            <mat-icon>assignment</mat-icon>
            <span class="toggle-label">Заказы</span>
          </mat-button-toggle>
          <mat-button-toggle value="houses">
            <mat-icon>business</mat-icon>
            <span class="toggle-label">Типографии</span>
          </mat-button-toggle>
          <mat-button-toggle value="catalog">
            <mat-icon>menu_book</mat-icon>
            <span class="toggle-label">Каталог</span>
          </mat-button-toggle>
          <mat-button-toggle value="analytics">
            <mat-icon>bar_chart</mat-icon>
            <span class="toggle-label">Аналитика</span>
          </mat-button-toggle>
          <mat-button-toggle value="ai">
            <mat-icon>auto_awesome</mat-icon>
            <span class="toggle-label">AI</span>
          </mat-button-toggle>
          <mat-button-toggle value="reference">
            <mat-icon>library_books</mat-icon>
            <span class="toggle-label">Справочник</span>
          </mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="section-content">
        @switch (activeSection()) {
          @case ('orders') { <app-production-orders [deepLinkOrderId]="deepLinkOrderId()" /> }
          @case ('houses') { <app-production-houses /> }
          @case ('catalog') { <app-production-catalog /> }
          @case ('analytics') { <app-production-analytics /> }
          @case ('ai') { <app-production-ai /> }
          @case ('reference') { <app-production-reference-data /> }
        }
      </div>
    </div>
  `,
  styles: `
    .production-page {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;
      flex-wrap: wrap;

      h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--crm-text-primary);
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 140px;

        mat-icon { color: var(--crm-accent); }
      }
    }

    .toggle-label {
      margin-left: 4px;
      @media (max-width: 599px) { display: none; }
    }

    .section-content {
      flex: 1;
      overflow-y: auto;
    }
  `,
})
export class ProductionComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly activeSection = signal<Section>('orders');
  readonly deepLinkOrderId = signal<string | null>(null);

  ngOnInit() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const section = params.get('section') as Section | null;
      if (section && VALID_SECTIONS.includes(section)) {
        this.activeSection.set(section);
      }
      const orderId = params.get('orderId');
      if (orderId) {
        this.activeSection.set('orders');
        this.deepLinkOrderId.set(orderId);
      }
    });
  }

  setSection(section: Section): void {
    this.activeSection.set(section);
    void this.router.navigate([], {
      queryParams: { section },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
