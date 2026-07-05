import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

export interface CtaButton {
  text: string;
  icon?: string;
  action: 'call' | 'book' | 'contact' | 'route';
  primary?: boolean;
  phone?: string;
}

@Component({
  selector: 'app-service-cta',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule
],
  template: `
    <div class="service-cta">
      <mat-card class="cta-card">
        <mat-card-content>
          <div class="cta-content">
            <div class="cta-text">
              <h3 class="cta-title">{{ title() }}</h3>
              @if (subtitle()) {
                <p class="cta-subtitle">{{ subtitle() }}</p>
              }
              @if (price()) {
                <div class="price-info">
                  <span class="price">{{ price() }}</span>
                  @if (priceNote()) {
                    <span class="price-note">{{ priceNote() }}</span>
                  }
                </div>
              }
            </div>
            
            <div class="cta-buttons">
              @for (button of buttons(); track button.text || $index) {
                <button 
                  mat-raised-button 
                  [color]="button.primary ? 'primary' : 'accent'"
                  class="cta-button"
                  [class.primary]="button.primary"
                  (click)="onButtonClick(button)"
                >
                  @if (button.icon) {
                    <mat-icon>{{ button.icon }}</mat-icon>
                  }
                  {{ button.text }}
                </button>
              }
            </div>

            @if (showWorkingHours()) {
              <div class="working-hours">
                <mat-icon>schedule</mat-icon>
                <span>Работаем ежедневно с 10:00 до 20:00</span>
              </div>
            }
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .service-cta {
      margin: 2rem 0;
    }

    .cta-card {
      background: var(--ed-accent, #f59e0b);
      border-radius: var(--ed-border-radius-md, 8px);
      border: none;
      box-shadow: var(--ed-shadow-accent, 0 4px 24px rgba(245, 158, 11, 0.15));
    }

    .cta-content {
      text-align: center;
      padding: 1.5rem 1rem;
    }

    .cta-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: clamp(1.4rem, 3vw, 1.75rem);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      color: var(--ed-on-accent, #0a0a0a);
      margin-bottom: 0.5rem;
    }

    .cta-subtitle {
      color: var(--ed-on-accent, #0a0a0a);
      opacity: 0.75;
      margin-bottom: 1rem;
      font-size: 0.95rem;
    }

    .price-info {
      margin: 1rem 0;
    }

    .price {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 2rem;
      font-weight: 800;
      color: var(--ed-on-accent, #0a0a0a);
    }

    .price-note {
      display: block;
      font-size: 0.85rem;
      color: var(--ed-on-accent, #0a0a0a);
      opacity: 0.6;
      margin-top: 0.25rem;
    }

    .cta-buttons {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
      flex-wrap: wrap;
      margin: 1.5rem 0;
      flex-direction: column;
      align-items: center;
    }

    .cta-button {
      width: 100%;
      max-width: 280px;
      height: 48px;
      border-radius: 24px;
      font-weight: 600;
      letter-spacing: 0.5px;
      transition: transform 200ms, box-shadow 200ms;
    }

    .cta-button.primary {
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      box-shadow: var(--ed-shadow-md, 0 4px 16px rgba(0, 0, 0, 0.4));
    }

    .cta-button:not(.primary) {
      background: transparent;
      border: 2px solid var(--ed-on-accent, #0a0a0a);
      color: var(--ed-on-accent, #0a0a0a);
    }

    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: var(--ed-shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
    }

    .working-hours {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--ed-on-accent, #0a0a0a);
      opacity: 0.65;
      font-size: 0.85rem;

      .mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    @media (min-width: 840px) {
      .cta-content { padding: 2rem; }

      .cta-buttons {
        flex-direction: row;
        align-items: stretch;
      }

      .cta-button {
        width: auto;
        min-width: 200px;
        max-width: none;
      }
    }
  `]
})
export class ServiceCtaComponent {
  title = input<string>('Готовы заказать услугу?');
  subtitle = input<string | undefined>(undefined);
  price = input<string | undefined>(undefined);
  priceNote = input<string | undefined>(undefined);
  buttons = input<CtaButton[]>([
    { text: 'Позвонить сейчас', icon: 'phone', action: 'call', primary: true },
    { text: 'Записаться онлайн', icon: 'event', action: 'book' }
  ]);
  showWorkingHours = input<boolean>(true);

  buttonClick = output<CtaButton>();

  onButtonClick(button: CtaButton): void {
    this.buttonClick.emit(button);
  }
}

