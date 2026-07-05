import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { OrderWizardStore } from '../order-wizard.store';

@Component({
  selector: 'app-form-substitution-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatCheckboxModule],
  host: { class: 'form-substitution-step' },
  template: `
    <div class="fss-content">
      <h3 class="fss-heading">Подставка формы</h3>
      <p class="fss-desc">Опишите желаемую форму одежды, тип погон, нашивки</p>

      <textarea
        class="fss-textarea"
        placeholder="Например: форма МВД, капитан, 2 звезды на погонах, нашивка «Полиция»..."
        [value]="store.formSubstitutionNotes()"
        (input)="store.formSubstitutionNotes.set(asText($event))"
        rows="4"
      ></textarea>

      <mat-checkbox
        [checked]="store.hasMedalsAndChevrons()"
        (change)="store.hasMedalsAndChevrons.set($event.checked)"
      >
        Медали и шевроны на форме
      </mat-checkbox>

      @if (store.hasMedalsAndChevrons()) {
        <textarea
          class="fss-textarea"
          placeholder="Опишите медали, шевроны, нашивки..."
          [value]="store.medalsDescription()"
          (input)="store.medalsDescription.set(asText($event))"
          rows="2"
        ></textarea>
      }

      <div class="fss-actions">
        <button class="fss-btn fss-btn--outline" (click)="store.prevStep()">
          <mat-icon>arrow_back</mat-icon> Назад
        </button>
        <button class="fss-btn fss-btn--primary" (click)="store.nextStep()">
          Далее <mat-icon>arrow_forward</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .fss-content {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .fss-heading {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--crm-text-primary, #ececec);
    }

    .fss-desc {
      margin: 0;
      font-size: 12px;
      color: var(--crm-text-secondary, #a0a0a0);
      line-height: 1.4;
    }

    .fss-textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-surface, #131210);
      color: var(--crm-text-primary, #ececec);
      font: inherit;
      font-size: 13px;
      resize: vertical;
      outline: none;
      transition: border-color var(--crm-transition-fast, 120ms ease);

      &:focus { border-color: var(--crm-accent, #f59e0b); }
      &::placeholder { color: var(--crm-text-muted, #7a7a7a); }
    }

    .fss-actions {
      display: flex;
      gap: 10px;
      padding-top: 4px;
    }

    .fss-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      border: none;
      border-radius: var(--crm-radius-md, 8px);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all var(--crm-transition-fast, 120ms ease);

      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .fss-btn--primary {
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);
      &:hover { background: var(--crm-accent-hover, #fbbf24); }
    }

    .fss-btn--outline {
      background: transparent;
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      color: var(--crm-text-secondary, #a0a0a0);
      &:hover {
        background: var(--crm-surface-hover, rgba(255, 255, 255, 0.035));
        color: var(--crm-text-primary, #ececec);
      }
    }
  `],
})
export class FormSubstitutionStepComponent {
  readonly store = inject(OrderWizardStore);

  asText(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }
}
