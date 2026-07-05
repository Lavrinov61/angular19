import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { FOTO_NA_PASPORT } from '../data/document-photos.data';

@Component({
  selector: 'app-foto-na-pasport',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class FotoNaPasportComponent {
  pageData = FOTO_NA_PASPORT;
}


