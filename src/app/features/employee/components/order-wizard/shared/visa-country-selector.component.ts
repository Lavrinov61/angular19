import {
  Component,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';

import { OrderWizardStore, VISA_COUNTRY_OPTIONS } from '../order-wizard.store';

@Component({
  selector: 'app-visa-country-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatSelectModule, MatFormFieldModule],
  host: { class: 'visa-country-selector' },
  template: `
    <mat-form-field appearance="outline" class="vcs-field">
      <mat-label>Страна визы</mat-label>
      <mat-select
        [value]="store.visaCountry()"
        (selectionChange)="store.selectVisaCountry($event.value)"
      >
        <mat-optgroup label="Популярные">
          @for (c of popularCountries; track c.code) {
            <mat-option [value]="c.code">
              {{ c.name }} ({{ c.photoSize }} мм)
            </mat-option>
          }
        </mat-optgroup>
        <mat-optgroup label="Азия">
          @for (c of asiaCountries; track c.code) {
            <mat-option [value]="c.code">
              {{ c.name }} ({{ c.photoSize }} мм)
            </mat-option>
          }
        </mat-optgroup>
        <mat-optgroup label="Другие">
          @for (c of otherCountries; track c.code) {
            <mat-option [value]="c.code">
              {{ c.name }} ({{ c.photoSize }} мм)
            </mat-option>
          }
        </mat-optgroup>
      </mat-select>
    </mat-form-field>
  `,
  styles: [`
    :host { display: block; }

    .vcs-field {
      width: 100%;
      max-width: 360px;
    }
  `],
})
export class VisaCountrySelectorComponent {
  readonly store = inject(OrderWizardStore);

  readonly popularCountries = VISA_COUNTRY_OPTIONS.filter(c => c.group === 'popular');
  readonly asiaCountries = VISA_COUNTRY_OPTIONS.filter(c => c.group === 'asia');
  readonly otherCountries = VISA_COUNTRY_OPTIONS.filter(c => c.group === 'other');
}
