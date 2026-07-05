import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ScrollRevealDirective } from '../../../../../../shared/directives/scroll-reveal.directive';

interface Pillar {
  icon: string;
  title: string;
  text: string;
  accent: boolean;
}

@Component({
  selector: 'app-our-approach',
  imports: [MatIconModule, ScrollRevealDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="approach">
      <div class="approach-inner">
        <div class="approach-header" appScrollReveal direction="up">
          <p class="approach-eyebrow">Наш подход</p>
          <h2 class="approach-title">Съёмка без лишнего напряжения</h2>
          <p class="approach-subtitle">Клиент видит понятный процесс: подготовка, кадр, отбор, ретушь и готовый результат.</p>
        </div>

        <div class="approach-grid">
          @for (pillar of pillars; track pillar.title; let i = $index) {
            <div
              class="pillar"
              [class.pillar--accent]="pillar.accent"
              appScrollReveal
              direction="up"
              [delay]="i * 120"
            >
              <div class="pillar__icon-wrap" aria-hidden="true">
                <mat-icon class="pillar__icon">{{ pillar.icon }}</mat-icon>
              </div>
              <h3 class="pillar__title">{{ pillar.title }}</h3>
              <p class="pillar__text">{{ pillar.text }}</p>
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .approach {
      background: #f4f4f4;
      padding: 96px 0 110px;
    }

    .approach-inner {
      max-width: 1320px;
      margin: 0 auto;
      padding: 0 32px;
    }

    .approach-header {
      text-align: left;
      margin-bottom: 34px;
      max-width: 760px;
    }

    .approach-eyebrow {
      font-family: var(--ed-font-body);
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0;
      color: #ef3124;
      margin: 0 0 12px;
    }

    .approach-title {
      font-family: var(--ed-font-body);
      font-size: 52px;
      font-weight: 900;
      letter-spacing: 0;
      color: #111111;
      margin: 0 0 18px;
      line-height: 1.05;
    }

    .approach-subtitle {
      font-family: var(--ed-font-body);
      font-size: 18px;
      color: #666666;
      line-height: 1.5;
      margin: 0;
      max-width: 620px;
    }

    .approach-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 18px;
    }

    .pillar {
      min-height: 300px;
      background: #ffffff;
      border: 1px solid #e7e7e7;
      border-radius: 28px;
      padding: 30px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      transition: border-color var(--ed-duration-normal) ease,
                  transform var(--ed-duration-normal) ease;

      &:hover {
        transform: translateY(-4px);
      }

      &--accent {
        border-color: rgba(239, 49, 36, 0.28);
        background: #fff3f2;

        .pillar__icon-wrap {
          background: #ef3124;
          color: #ffffff;
        }
      }
    }

    .pillar__icon-wrap {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ef3124;
      flex-shrink: 0;
    }

    .pillar__icon {
      font-size: 26px;
    }

    .pillar__title {
      font-family: var(--ed-font-body);
      font-size: 24px;
      font-weight: 900;
      color: #111111;
      letter-spacing: 0;
      line-height: 1.15;
      margin: 0;
    }

    .pillar__text {
      font-family: var(--ed-font-body);
      font-size: 15px;
      line-height: 1.55;
      color: #666666;
      margin: 0;
    }

    @media (max-width: 840px) {
      .approach-grid {
        grid-template-columns: 1fr;
        max-width: 520px;
      }
    }

    @media (max-width: 768px) {
      .approach {
        padding: 72px 0;
      }

      .approach-inner {
        padding: 0 18px;
      }

      .approach-title {
        font-size: 38px;
      }
    }
  `],
})
export class OurApproachComponent {
  readonly pillars: Pillar[] = [
    {
      icon: 'brush',
      title: 'Ручная художественная обработка',
      text: 'Каждый кадр обрабатывается вручную нашими ретушёрами. Никакого AI-конвейера, только профессиональный взгляд и индивидуальный подход к вашему образу.',
      accent: true,
    },
    {
      icon: 'photo_camera',
      title: 'Профессиональное оборудование',
      text: 'Студия оснащена профессиональным студийным светом и камерами Canon. Техника не ограничивает, она открывает возможности. Результат виден с первого кадра.',
      accent: false,
    },
    {
      icon: 'favorite',
      title: 'Атмосфера и комфорт',
      text: 'Наша задача, чтобы вы чувствовали себя свободно. Расслабленный человек перед камерой, это лучшие фотографии. Мы умеем создавать нужное настроение.',
      accent: false,
    },
  ];
}
