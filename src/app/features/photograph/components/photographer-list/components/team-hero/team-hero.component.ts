import {
  Component,
  ChangeDetectionStrategy,
  PLATFORM_ID,
  inject,
  signal,
  afterNextRender,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface HeroVisual {
  title: string;
  text: string;
  icon: string;
}

interface HeroProof {
  value: string;
  label: string;
}

@Component({
  selector: 'app-team-hero',
  imports: [RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="team-hero">
      <div class="hero-inner">
        <div class="hero-text" [class.visible]="textVisible()">
          <p class="hero-eyebrow">Студия Своё Фото · с 1999 года</p>
          <h1 class="hero-heading">
            Съёмка в студии без лишней суеты
          </h1>
          <p class="hero-sub">
            Фото на документы, портреты, печать и файл проходят в одном понятном процессе:
            кадр, выбор, подготовка результата и выдача.
          </p>

          <div class="hero-actions">
            <a class="hero-cta" routerLink="/booking" href="/booking">
              Записаться
              <span class="hero-cta__arrow">→</span>
            </a>
            <a class="hero-secondary" href="#team-list">
              Как проходит съёмка
            </a>
          </div>

          <div class="hero-proof-grid" aria-label="Преимущества студии">
            @for (proof of proofPoints; track proof.label) {
              <div class="hero-proof">
                <span class="hero-proof__value">{{ proof.value }}</span>
                <span class="hero-proof__label">{{ proof.label }}</span>
              </div>
            }
          </div>
        </div>

        <div class="hero-product-card" [class.visible]="visualVisible()">
          <div class="hero-product-card__main">
            <div class="hero-product-card__icon-stage" aria-hidden="true">
              <span class="hero-product-card__sheet hero-product-card__sheet--back"></span>
              <span class="hero-product-card__sheet hero-product-card__sheet--front"></span>
              <span class="hero-product-card__icon">
                <mat-icon>photo_camera</mat-icon>
              </span>
            </div>
            <div class="hero-product-card__caption">
              <span>Портрет</span>
              <strong>Съёмка в студии</strong>
            </div>
          </div>

          <div class="hero-product-card__side">
            @for (visual of heroVisuals; track visual.title) {
              <div class="hero-mini-card">
                <span class="hero-mini-card__icon" aria-hidden="true">
                  <mat-icon>{{ visual.icon }}</mat-icon>
                </span>
                <div>
                  <strong>{{ visual.title }}</strong>
                  <span>{{ visual.text }}</span>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .team-hero {
      position: relative;
      background: #050505;
      color: #ffffff;
      min-height: calc(100svh - 128px);
      box-sizing: border-box;
      display: flex;
      align-items: center;
      overflow: hidden;
      padding: 88px 0 96px;
    }

    .hero-inner {
      width: 100%;
      max-width: 1320px;
      margin: 0 auto;
      padding: 0 32px;
      display: grid;
      grid-template-columns: minmax(0, 0.86fr) minmax(520px, 1fr);
      gap: 72px;
      align-items: center;
    }

    .hero-text {
      opacity: 0;
      transform: translateY(32px);
      transition: opacity 0.9s var(--ed-ease-out), transform 0.9s var(--ed-ease-out);

      &.visible {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .hero-eyebrow {
      font-family: var(--ed-font-body);
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0;
      color: #ef3124;
      margin: 0 0 18px;
    }

    .hero-heading {
      font-family: var(--ed-font-body);
      font-size: 76px;
      font-weight: 900;
      line-height: 0.95;
      letter-spacing: 0;
      color: #ffffff;
      margin: 0 0 28px;
      max-width: 720px;
    }

    .hero-sub {
      font-family: var(--ed-font-body);
      font-size: 19px;
      line-height: 1.55;
      color: #c8c8c8;
      margin: 0 0 34px;
      max-width: 560px;
    }

    .hero-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .hero-cta {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: #ef3124;
      color: #ffffff;
      font-family: var(--ed-font-body);
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0;
      text-decoration: none;
      padding: 18px 30px;
      border-radius: 12px;
      transition: background var(--ed-duration-fast) ease, transform var(--ed-duration-fast) ease;

      &:hover {
        background: #d9251b;
        transform: translateY(-2px);
      }

      &__arrow {
        font-size: 18px;
        transition: transform var(--ed-duration-fast) ease;
      }

      &:hover &__arrow {
        transform: translateX(4px);
      }
    }

    .hero-secondary {
      display: inline-flex;
      align-items: center;
      min-height: 58px;
      border-radius: 12px;
      padding: 0 24px;
      background: #2f3037;
      color: #ffffff;
      font-family: var(--ed-font-body);
      font-size: 16px;
      font-weight: 800;
      letter-spacing: 0;
      text-decoration: none;
      transition: background var(--ed-duration-fast) ease, transform var(--ed-duration-fast) ease;

      &:hover {
        background: #3a3b43;
        transform: translateY(-2px);
      }
    }

    .hero-proof-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      max-width: 620px;
      margin-top: 34px;
    }

    .hero-proof {
      min-height: 92px;
      border-radius: 20px;
      background: #171717;
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 18px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .hero-proof__value {
      font-family: var(--ed-font-body);
      font-size: 24px;
      font-weight: 900;
      line-height: 1;
      color: #ffffff;
      letter-spacing: 0;
    }

    .hero-proof__label {
      font-family: var(--ed-font-body);
      font-size: 13px;
      line-height: 1.25;
      color: #b6b6b6;
    }

    .hero-product-card {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 16px;
      padding: 16px;
      border-radius: 36px;
      background: #f4f4f4;
      color: #111111;
      box-shadow: 0 42px 120px rgba(0, 0, 0, 0.35);
      overflow: hidden;
      opacity: 0;
      transform: translateY(40px);
      transition: opacity 0.8s var(--ed-ease-out), transform 0.8s var(--ed-ease-out);

      &.visible {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .hero-product-card__main {
      position: relative;
      min-height: 560px;
      border-radius: 28px;
      overflow: hidden;
      background: #e9e9e9;
    }

    .hero-product-card__icon-stage {
      min-height: 560px;
      display: grid;
      place-items: center;
      padding: 42px;
      box-sizing: border-box;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0)),
        #e9e9e9;
    }

    .hero-product-card__sheet {
      position: absolute;
      display: block;
      border-radius: 26px;
      background: #ffffff;
      box-shadow: 0 26px 70px rgba(0, 0, 0, 0.12);
    }

    .hero-product-card__sheet--back {
      width: 44%;
      height: 42%;
      left: 14%;
      top: 18%;
      transform: rotate(-9deg);
      opacity: 0.84;
    }

    .hero-product-card__sheet--front {
      width: 52%;
      height: 50%;
      right: 13%;
      bottom: 16%;
      transform: rotate(5deg);
    }

    .hero-product-card__icon {
      position: relative;
      z-index: 2;
      width: 156px;
      height: 156px;
      border-radius: 32px;
      background: #ef3124;
      color: #ffffff;
      display: grid;
      place-items: center;
      box-shadow: 0 30px 70px rgba(239, 49, 36, 0.26);

      mat-icon {
        width: 84px;
        height: 84px;
        font-size: 84px;
      }
    }

    .hero-product-card__caption {
      position: absolute;
      left: 18px;
      right: 18px;
      bottom: 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.9);
      padding: 14px 16px;
      backdrop-filter: blur(10px);

      span,
      strong {
        font-family: var(--ed-font-body);
        letter-spacing: 0;
      }

      span {
        color: #707070;
        font-size: 13px;
      }

      strong {
        color: #111111;
        font-size: 16px;
        font-weight: 900;
      }
    }

    .hero-product-card__side {
      display: grid;
      gap: 12px;
      align-content: start;
    }

    .hero-mini-card {
      min-height: 158px;
      border-radius: 24px;
      background: #ffffff;
      padding: 14px;
      display: grid;
      gap: 10px;
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.08);

      strong,
      span {
        display: block;
        font-family: var(--ed-font-body);
        letter-spacing: 0;
      }

      strong {
        color: #111111;
        font-size: 15px;
        font-weight: 900;
        line-height: 1.15;
      }

      span {
        margin-top: 3px;
        color: #777777;
        font-size: 12px;
        line-height: 1.25;
      }
    }

    .hero-mini-card__icon {
      width: 100%;
      height: 86px;
      border-radius: 18px;
      background: #f2f2f2;
      color: #ef3124;
      display: grid;
      place-items: center;

      mat-icon {
        width: 42px;
        height: 42px;
        font-size: 42px;
      }
    }

    @media (max-width: 1180px) {
      .hero-inner {
        grid-template-columns: 1fr;
      }

      .hero-heading {
        font-size: 64px;
      }

      .hero-product-card {
        max-width: 760px;
      }
    }

    @media (max-width: 768px) {
      .team-hero {
        padding: 64px 0 70px;
        min-height: auto;
      }

      .hero-inner {
        padding: 0 18px;
        gap: 30px;
      }

      .hero-heading {
        font-size: 48px;
      }

      .hero-sub {
        max-width: 100%;
        font-size: 17px;
      }

      .hero-proof-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .hero-proof {
        min-height: 84px;
        padding: 14px;
      }

      .hero-product-card {
        grid-template-columns: 1fr;
        border-radius: 28px;
      }

      .hero-product-card__main,
      .hero-product-card__icon-stage {
        min-height: 340px;
      }

      .hero-product-card__side {
        display: none;
      }

    }

    @media (max-width: 480px) {
      .hero-heading {
        font-size: 40px;
      }

      .hero-actions,
      .hero-cta,
      .hero-secondary {
        width: 100%;
      }

      .hero-cta,
      .hero-secondary {
        justify-content: center;
      }

      .hero-product-card__side {
        grid-template-columns: 1fr;
      }

      .hero-proof-grid {
        grid-template-columns: 1fr;
      }

      .hero-product-card__main,
      .hero-product-card__icon-stage {
        min-height: 280px;
      }

      .hero-product-card__icon {
        width: 118px;
        height: 118px;
        border-radius: 26px;

        mat-icon {
          width: 62px;
          height: 62px;
          font-size: 62px;
        }
      }
    }
  `],
})
export class TeamHeroComponent {
  private platformId = inject(PLATFORM_ID);
  readonly textVisible = signal(false);
  readonly visualVisible = signal(false);

  protected readonly proofPoints: HeroProof[] = [
    { value: '5.0', label: 'рейтинг на картах' },
    { value: '1999', label: 'работаем для вас' },
    { value: 'ручная', label: 'Ручная ретушь' },
  ];

  protected readonly heroVisuals: HeroVisual[] = [
    {
      title: 'Документы',
      text: 'Свет, поза, требования',
      icon: 'badge',
    },
    {
      title: 'Печать',
      text: 'Фото и готовые отпечатки',
      icon: 'print',
    },
    {
      title: 'Портреты',
      text: 'Образ под задачу',
      icon: 'assignment_ind',
    },
  ];

  constructor() {
    afterNextRender(() => {
      if (isPlatformBrowser(this.platformId)) {
        setTimeout(() => this.textVisible.set(true), 100);
        setTimeout(() => this.visualVisible.set(true), 200);
      }
    });
  }
}
