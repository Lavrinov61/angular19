import { Component, ChangeDetectionStrategy, input } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { RouterModule } from '@angular/router';
import { Photographer } from '../../models/photographer.model';

@Component({
  selector: 'app-attention-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    RouterModule
],
  templateUrl: './attention-section.component.html',
  styleUrl: './attention-section.component.scss'
})
export class AttentionSectionComponent {
  photographer = input.required<Photographer>();
}
