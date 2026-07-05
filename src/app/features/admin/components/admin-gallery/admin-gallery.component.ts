import { Component, ChangeDetectionStrategy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatGridListModule } from '@angular/material/grid-list';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';

@Component({
  selector: 'app-admin-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule, MatGridListModule, RouterLink, MatIconModule, HasPermissionDirective],
  templateUrl: './admin-gallery.component.html',
  styleUrl: './admin-gallery.component.scss'
})
export class AdminGalleryComponent {
  // Placeholder data for the gallery management
  photos = [
    { id: '1', title: 'Фото 1', thumbnail: 'assets/static/gallery/placeholder-1.jpg', category: 'Портреты' },
    { id: '2', title: 'Фото 2', thumbnail: 'assets/static/gallery/placeholder-2.jpg', category: 'Семейные' },
    { id: '3', title: 'Фото 3', thumbnail: 'assets/static/gallery/placeholder-3.jpg', category: 'Свадебные' },
    { id: '4', title: 'Фото 4', thumbnail: 'assets/static/gallery/placeholder-4.jpg', category: 'Портреты' },
    { id: '5', title: 'Фото 5', thumbnail: 'assets/static/gallery/placeholder-5.jpg', category: 'Коммерческие' },
    { id: '6', title: 'Фото 6', thumbnail: 'assets/static/gallery/placeholder-6.jpg', category: 'Свадебные' },
  ];
}
