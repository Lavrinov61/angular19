import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { RESTAVRATSIYA_ONLINE } from '../data/online-services.data';

@Component({
  selector: 'app-restavratsiya-online',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class RestavratsiyaOnlineComponent {
  pageData = RESTAVRATSIYA_ONLINE;
}
