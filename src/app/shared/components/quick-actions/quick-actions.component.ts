import { Component, input, inject, ChangeDetectionStrategy } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { Photographer } from '../../../features/photograph/models/photographer.model';
import { LoggerService } from '../../../core/services/logger.service';

@Component({
  selector: 'app-quick-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, RouterModule],
  templateUrl: './quick-actions.component.html',
  styleUrls: ['./quick-actions.component.scss']
})
export class QuickActionsComponent {
  private log = inject(LoggerService);

  photographer = input.required<Photographer>();

  // Placeholder for future logic, e.g., scrolling to a section
  scrollToPortfolio(): void {
    // Logic to scroll to portfolio section can be added here
    this.log.debug('Scrolling to portfolio...');
  }
}
