import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { PECHAT_NA_KRUZHKAH } from '../data/souvenirs.data';

@Component({
  selector: 'app-pechat-na-kruzhkah',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class PechatNaKruzhkahComponent {
  pageData = PECHAT_NA_KRUZHKAH;
}


