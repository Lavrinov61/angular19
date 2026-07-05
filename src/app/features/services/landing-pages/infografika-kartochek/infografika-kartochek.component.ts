import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { INFOGRAFIKA } from '../data/marketplace-services.data';

@Component({
  selector: 'app-infografika-kartochek',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class InfografikaKartochekComponent {
  pageData = INFOGRAFIKA;
}
