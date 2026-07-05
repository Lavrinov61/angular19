import { Component, input, ChangeDetectionStrategy } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';

export interface Advantage {
  icon: string;
  title: string;
  description: string;
  color?: string;
}

@Component({
  selector: 'app-advantages-section',
  
  imports: [MatIconModule],
  templateUrl: './advantages-section.component.html',
  styleUrls: ['./advantages-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdvantagesSectionComponent {
  advantages = input<Advantage[]>([]);
  title = input<string>('Почему выбирают нас');
  subtitle = input<string | undefined>(undefined);

  trackByIndex(index: number): number {
    return index;
  }

  getCardAnimation(index: number): string {
    return `${index * 100}ms`;
  }

  getCardColor(advantage: Advantage, index: number): string {
    if (advantage.color) return advantage.color;
    
    const colors = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
      'linear-gradient(135deg, #e0c3fc 0%, #9bb5ff 100%)'
    ];
    
    return colors[index % colors.length];
  }
}
