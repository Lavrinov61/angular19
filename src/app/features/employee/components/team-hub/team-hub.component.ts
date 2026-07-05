import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-team-hub',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatTabsModule, MatIconModule],
  host: { class: 'th-host' },
  template: `
    <nav mat-tab-nav-bar [tabPanel]="tabPanel" class="th-tabs" backgroundColor="primary">
      <a mat-tab-link routerLink="staff" routerLinkActive #rla1="routerLinkActive" [active]="rla1.isActive">
        <mat-icon>manage_accounts</mat-icon>
        <span>Команда</span>
      </a>
      <a mat-tab-link routerLink="schedule" routerLinkActive #rla2="routerLinkActive" [active]="rla2.isActive">
        <mat-icon>calendar_month</mat-icon>
        <span>Расписание</span>
      </a>
      <a mat-tab-link routerLink="payroll" routerLinkActive #rla3="routerLinkActive" [active]="rla3.isActive">
        <mat-icon>payments</mat-icon>
        <span>Зарплаты</span>
      </a>
    </nav>
    <mat-tab-nav-panel #tabPanel class="th-panel">
      <router-outlet />
    </mat-tab-nav-panel>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--crm-surface-base);
    }

    .th-tabs {
      flex-shrink: 0;
      background: rgba(12, 11, 9, 0.6);
      border-bottom: 1px solid var(--crm-glass-border);

      a {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--crm-text-secondary);
        font-family: var(--crm-font-sans);
        font-size: var(--crm-text-base);

        mat-icon { font-size: 18px; width: 18px; height: 18px; }

        &.mdc-tab--active {
          color: var(--crm-accent);
        }
      }
    }

    .th-panel {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }
  `],
})
export class TeamHubComponent {}
