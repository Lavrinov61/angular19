import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { TOVARNAYA_SJOMKA } from '../data/marketplace-services.data';

@Component({
  selector: 'app-tovarnaya-sjomka',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class TovarnayaSjomkaComponent {
  pageData = TOVARNAYA_SJOMKA;
}
