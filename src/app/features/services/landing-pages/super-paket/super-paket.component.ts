import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { SUPER_PAKET } from '../data/marketplace-services.data';

@Component({
  selector: 'app-super-paket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class SuperPaketComponent {
  pageData = SUPER_PAKET;
}
