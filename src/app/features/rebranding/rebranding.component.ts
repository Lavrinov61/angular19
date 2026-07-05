import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-rebranding',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="rebranding-page">
      <div class="container">
        <header class="rebranding-header">
          <h1>МагнусФото теперь, Своё Фото!</h1>
          <p class="subtitle">Мы обновили название, но качество осталось неизменным</p>
        </header>

        <section class="announcement">
          <div class="announcement-card">
            <div class="old-name">
              <span class="label">Было</span>
              <span class="name crossed">МагнусФото</span>
            </div>
            <div class="arrow">→</div>
            <div class="new-name">
              <span class="label">Стало</span>
              <span class="name highlight">Своё Фото</span>
            </div>
          </div>
        </section>

        <section class="details">
          <h2>Что изменилось?</h2>
          <ul class="changes-list">
            <li>
              <span class="icon">✓</span>
              <div>
                <strong>Новое название:</strong> Своё Фото, более тёплое и близкое
              </div>
            </li>
            <li>
              <span class="icon">✓</span>
              <div>
                <strong>Актуальный адрес:</strong> переулок Соборный 21
              </div>
            </li>
            <li>
              <span class="icon">✓</span>
              <div>
                <strong>Студия на Соборном:</strong> работает как прежде
              </div>
            </li>
          </ul>
        </section>

        <section class="unchanged">
          <h2>Что осталось неизменным?</h2>
          <ul class="unchanged-list">
            <li>📸 Качество фотографий на документы</li>
            <li>👩‍🎨 Профессиональная ретушь</li>
            <li>⚡ Быстрое обслуживание</li>
            <li>💰 Доступные цены</li>
            <li>👨‍👩‍👧‍👦 Семейная атмосфера</li>
          </ul>
        </section>

        <section class="new-address">
          <h2>Адрес студии</h2>
          <div class="address-card">
            <div class="address-info">
              <p class="address">переулок Соборный 21</p>
              <p class="city">г. Ростов-на-Дону</p>
              <p class="note">📍 Удобное расположение в центре города</p>
              <p class="opening">🕘 Ежедневно 09:00-19:30</p>
            </div>
          </div>
        </section>

        <section class="cta">
          <a routerLink="/booking" class="btn-primary">Записаться онлайн</a>
          <a routerLink="/contacts" class="btn-secondary">Наши контакты</a>
        </section>

        <section class="seo-content">
          <h2>О студии Своё Фото</h2>
          <p>
            <strong>Своё Фото</strong> (ранее известная как <em>МагнусФото</em>), 
            профессиональная фотостудия в Ростове-на-Дону, специализирующаяся на 
            фотографиях для документов, портретной съёмке и печати фотографий.
          </p>
          <p>
            Мы работаем под новым именем и принимаем клиентов в студии на Соборном переулке.
            Адрес для визита: переулок Соборный 21.
          </p>
          <p>
            Если вы ищете <em>МагнусФото в Ростове-на-Дону</em>, вы нашли нас!
            Теперь мы называемся <strong>Своё Фото</strong>, но остаёмся той же 
            командой профессионалов с многолетним опытом.
          </p>
        </section>
      </div>
    </article>
  `,
  styles: [`
    .rebranding-page {
      min-height: 100vh;
      padding: 2rem 1rem;
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
    }

    .rebranding-header {
      text-align: center;
      margin-bottom: 3rem;
    }

    h1 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 2.5rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 0.5rem;
    }

    .subtitle {
      font-size: 1.25rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .announcement-card {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2rem;
      padding: 2rem;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 16px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      margin-bottom: 3rem;
    }

    .old-name, .new-name {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .label {
      font-size: 0.875rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 0.5rem;
    }

    .name {
      font-size: 1.5rem;
      font-weight: 600;
    }

    .crossed {
      text-decoration: line-through;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .highlight {
      color: var(--ed-accent, #f59e0b);
      background: linear-gradient(90deg, #f59e0b, #fbbf24);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .arrow {
      font-size: 2rem;
      color: var(--ed-accent, #f59e0b);
    }

    section {
      margin-bottom: 2.5rem;
    }

    h2 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.5rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 1rem;
    }

    .changes-list, .unchanged-list {
      list-style: none;
      padding: 0;
    }

    .changes-list li {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }

    .changes-list .icon {
      color: var(--ed-accent, #f59e0b);
      font-weight: bold;
    }

    .unchanged-list li {
      padding: 0.75rem 0;
      font-size: 1.1rem;
    }

    .address-card {
      background: var(--ed-surface-container, #1a1a1a);
      padding: 2rem;
      border-radius: 16px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .address {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .city {
      font-size: 1.1rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .note, .opening {
      margin-top: 1rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .cta {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }

    .btn-primary, .btn-secondary {
      padding: 1rem 2rem;
      border-radius: 8px;
      font-weight: 600;
      text-decoration: none;
      transition: transform 0.2s;
    }

    .btn-primary {
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
    }

    .btn-secondary {
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
    }

    .btn-primary:hover, .btn-secondary:hover {
      transform: translateY(-2px);
    }

    .seo-content {
      background: var(--ed-surface-container, #1a1a1a);
      padding: 2rem;
      border-radius: 16px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      margin-top: 3rem;
    }

    .seo-content p {
      margin-bottom: 1rem;
      line-height: 1.7;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    @media (max-width: 600px) {
      h1 { font-size: 1.75rem; }
      .announcement-card { flex-direction: column; gap: 1rem; }
      .arrow { transform: rotate(90deg); }
    }
  `]
})
export class RebrandingComponent {
  private meta = inject(Meta);
  private title = inject(Title);

  constructor() {
    this.title.setTitle('МагнусФото теперь Своё Фото, ребрендинг фотостудии в Ростове-на-Дону');
    
    this.meta.updateTag({ 
      name: 'description', 
      content: 'Фотостудия МагнусФото сменила название на Своё Фото. Актуальный адрес: переулок Соборный 21. Качество фотографий на документы остаётся неизменным.'
    });
    
    this.meta.updateTag({ 
      name: 'keywords', 
      content: 'МагнусФото, Своё Фото, ребрендинг, смена названия, фотостудия Ростов-на-Дону, фото на документы, svoefoto' 
    });
  }
}
