import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { LAMINIROVANIE } from '../data/print-polygraphy.data';

@Component({
  selector: 'app-laminirovanie',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class LaminirovanieComponent {
  pageData = LAMINIROVANIE;
}


