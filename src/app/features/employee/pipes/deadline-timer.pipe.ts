import { Pipe, PipeTransform, inject } from '@angular/core';
import { DeadlineTimerService } from '../services/deadline-timer.service';

@Pipe({ name: 'deadlineTimer', pure: false, standalone: true })
export class DeadlineTimerPipe implements PipeTransform {
  private readonly timer = inject(DeadlineTimerService);

  transform(deadline: string | null | undefined, format: 'compact' | 'detailed' | 'human' = 'compact'): string {
    switch (format) {
      case 'detailed': return this.timer.formatDetailed(deadline);
      case 'human': return this.timer.formatHuman(deadline);
      default: return this.timer.formatCompact(deadline);
    }
  }
}
