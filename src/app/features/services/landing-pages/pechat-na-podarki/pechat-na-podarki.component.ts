import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { PECHAT_NA_PODARKI } from '../data/souvenirs.data';

@Component({
  selector: 'app-pechat-na-podarki',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class PechatNaPodarkiComponent {
  pageData = PECHAT_NA_PODARKI;
}


