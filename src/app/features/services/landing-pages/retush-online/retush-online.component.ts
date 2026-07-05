import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { RETUSH_ONLINE } from '../data/online-services.data';

@Component({
  selector: 'app-retush-online',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class RetushOnlineComponent {
  pageData = RETUSH_ONLINE;
}
