import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { VIZITKI } from '../data/print-polygraphy.data';

@Component({
  selector: 'app-vizitki',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class VisitkiComponent {
  pageData = VIZITKI;
}


