import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { SMM_CONTENT } from '../data/marketplace-services.data';

@Component({
  selector: 'app-smm-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class SmmContentComponent {
  pageData = SMM_CONTENT;
}
