import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { PECHAT_NA_HOLSTE } from '../data/photo-print.data';

@Component({
  selector: 'app-pechat-foto-na-holste',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class PechatFotoNaHolsteComponent {
  pageData = PECHAT_NA_HOLSTE;
}


