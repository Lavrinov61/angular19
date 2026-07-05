import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { FOTO_NA_GREEN_CARD } from '../data/document-photos.data';

@Component({
  selector: 'app-foto-na-green-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class FotoNaGreenCardComponent {
  pageData = FOTO_NA_GREEN_CARD;
}


