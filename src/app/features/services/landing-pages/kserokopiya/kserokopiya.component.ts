import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { KSEROKOPIYA } from '../data/print-polygraphy.data';

@Component({
  selector: 'app-kserokopiya',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class KserokopiyaComponent {
  pageData = KSEROKOPIYA;
}


