import { Component, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { FOTO_NA_PAMYATNIK } from '../data/photo-print.data';

@Component({
  selector: 'app-foto-na-pamyatnik',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData" />`,
})
export class FotoNaPamyatnikComponent {
  pageData = FOTO_NA_PAMYATNIK;
}


