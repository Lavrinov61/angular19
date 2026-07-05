import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { PECHAT_NA_FUTBOLKAH } from '../data/souvenirs.data';

@Component({
  selector: 'app-pechat-na-futbolkah',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class PechatNaFutbolkahComponent {
  pageData = PECHAT_NA_FUTBOLKAH;
}


