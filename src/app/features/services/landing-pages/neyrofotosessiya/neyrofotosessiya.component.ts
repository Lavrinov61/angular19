import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { NEYROFOTOSESSIYA } from '../data/online-services.data';

@Component({
  selector: 'app-neyrofotosessiya',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class NeyrofotosessiyaComponent {
  pageData = NEYROFOTOSESSIYA;
}
