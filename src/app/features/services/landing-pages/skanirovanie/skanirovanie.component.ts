import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { SKANIROVANIE } from '../data/print-polygraphy.data';

@Component({
  selector: 'app-skanirovanie',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class SkanirovanieComponent {
  pageData = SKANIROVANIE;
}


