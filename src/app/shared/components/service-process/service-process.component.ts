import { Component, input, ChangeDetectionStrategy } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatStepperModule } from '@angular/material/stepper';

export interface ProcessStep {
  title: string;
  description: string;
  icon: string;
  duration?: string;
}

@Component({
  selector: 'app-service-process',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatIconModule,
    MatStepperModule
],
  template: `
    <section class="process-section">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">{{ title() }}</h2>
          @if (subtitle()) {
            <p class="section-subtitle">{{ subtitle() }}</p>
          }
        </div>

        <div class="process-steps">
          @for (step of steps(); track step.title || $index; let i = $index) {
            <div 
              class="step-item"
              [class.last]="i === steps().length - 1"
            >
              <div class="step-number">{{ i + 1 }}</div>
              <div class="step-content">
                <mat-card class="step-card">
                  <mat-card-content>
                    <div class="step-icon">
                      <mat-icon>{{ step.icon }}</mat-icon>
                    </div>
                    <h3 class="step-title">{{ step.title }}</h3>
                    <p class="step-description">{{ step.description }}</p>
                    @if (step.duration) {
                      <div class="step-duration">
                        <mat-icon>schedule</mat-icon>
                        <span>{{ step.duration }}</span>
                      </div>
                    }
                  </mat-card-content>
                </mat-card>
              </div>
              @if (i < steps().length - 1) {
                <div class="step-connector">
                  <mat-icon>arrow_forward</mat-icon>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .process-section {
      padding: 2rem 0;
      background: var(--ed-surface-container, #1a1a1a);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1rem;
    }

    .section-header {
      text-align: center;
      margin-bottom: 3rem;
    }

    .section-title {
      font-size: 2rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 1rem;
    }

    .section-subtitle {
      font-size: 1.1rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      max-width: 600px;
      margin: 0 auto;
    }

    .process-steps {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3rem;
    }

    .step-item {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 400px;
      width: 100%;
      flex: 1;
    }

    .step-number {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.2rem;
      margin-bottom: 1rem;
      z-index: 2;
      box-shadow: 0 4px 16px rgba(98, 0, 238, 0.3);
    }

    .step-card {
      height: 100%;
      transition: all 0.3s ease;
      border-radius: 16px;
      overflow: hidden;
    }

    .step-card:hover {
      transform: translateY(-8px);
      box-shadow: 0 12px 32px rgba(0,0,0,0.15);
    }

    .step-icon {
      text-align: center;
      margin-bottom: 1rem;
    }

    .step-icon mat-icon {
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
      color: var(--ed-accent, #f59e0b);
    }

    .step-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 0.75rem;
      text-align: center;
    }

    .step-description {
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.6;
      text-align: center;
      margin-bottom: 1rem;
    }

    .step-duration {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--ed-accent, #f59e0b);
      font-weight: 500;
    }

    .step-duration mat-icon {
      font-size: 1.2rem;
      width: 1.2rem;
      height: 1.2rem;
    }

    .step-connector {
      position: static;
      transform: rotate(90deg);
      margin: 1rem 0;
      z-index: 1;
    }

    .step-connector mat-icon {
      color: var(--ed-accent, #f59e0b);
      opacity: 0.6;
    }

    @media (min-width: 840px) {
      .process-section {
        padding: 4rem 0;
      }

      .section-title {
        font-size: 2.5rem;
      }
    }

    @media (min-width: 968px) {
      .process-steps {
        flex-direction: row;
        justify-content: center;
        align-items: flex-start;
        gap: 2rem;
        flex-wrap: wrap;
      }

      .step-connector {
        position: absolute;
        top: 24px;
        right: -2rem;
        transform: translateX(50%);
        margin: 0;
      }

      .step-item {
        max-width: 280px;
      }
    }
  `]
})
export class ServiceProcessComponent {
  title = input<string>('Как мы работаем');
  subtitle = input<string | undefined>(undefined);
  steps = input<ProcessStep[]>([]);
}
