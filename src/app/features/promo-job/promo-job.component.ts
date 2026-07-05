import {
  Component, ChangeDetectionStrategy, inject, OnInit,
} from '@angular/core';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-promo-job',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="pj-root">

  <!-- ===== HERO ===== -->
  <section class="pj-hero">
    <div class="pj-hero-bg"></div>
    <div class="pj-container">
      <div class="pj-hero-label">3 вакансии</div>
      <h1 class="pj-hero-title">ПОДРАБОТКА<br><span class="pj-hero-accent">В ФОТОСТУДИИ</span></h1>
      <p class="pj-hero-sub">
        «Своё Фото», сеть фотостудий в&nbsp;центре Ростова, 27 лет.
        Три вакансии, свободный график, без опыта, оплата сразу.
      </p>

      <div class="pj-hero-cta">
        <a href="/partners" class="pj-btn-primary">
          Зарегистрироваться &rarr;
        </a>
        <a href="https://t.me/FmagnusBot" target="_blank" rel="noopener" class="pj-btn-outline">
          <img src="/assets/icons/channel-telegram.svg" alt="">
          <span>Telegram</span>
        </a>
        <a href="https://max.ru/magnus_photo" target="_blank" rel="noopener" class="pj-btn-outline">
          <img src="/assets/icons/channel-max.svg" alt="">
          <span>МАКС</span>
        </a>
      </div>
    </div>
  </section>

  <!-- ===== JOB 1: ПРОМОУТЕР ===== -->
  <section class="pj-job pj-job--1">
    <div class="pj-job-accent"></div>
    <div class="pj-container">
      <div class="pj-job-grid">
        <div class="pj-job-info">
          <div class="pj-job-num">01</div>
          <h2 class="pj-job-title">ПРОМОУТЕР<br>У СТУДИИ</h2>
          <div class="pj-job-pay">150 ₽/час + до 10%* с каждого чека</div>
          <p class="pj-job-desc">
            Раздаёшь флаеры у&nbsp;входа в&nbsp;студию. Студия в&nbsp;10 метрах -
            люди заходят сразу. Не&nbsp;холодные продажи, не&nbsp;обход зданий.
            Клиент получает скидку по&nbsp;твоему промокоду.
          </p>
          <div class="pj-job-details">
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">График</span>
              <span class="pj-job-detail-value">Свободный, от 3 ч/день</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Где</span>
              <span class="pj-job-detail-value">У входа в студию, на улице</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Оплата</span>
              <span class="pj-job-detail-value">После каждой смены</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Кабинет</span>
              <span class="pj-job-detail-value">Личный кабинет партнёра</span>
            </div>
          </div>
        </div>
        <div class="pj-job-calc">
          <div class="pj-calc-title">Заработок за 6 часов</div>
          <div class="pj-calc-row">
            <span>Ставка 150 ₽ × 6 ч</span>
            <span>900 ₽</span>
          </div>
          <div class="pj-calc-row">
            <span>до 10% с чеков клиентов</span>
            <span>800-1 500 ₽</span>
          </div>
          <div class="pj-calc-row pj-calc-row--total">
            <span>Итого на руки</span>
            <span class="pj-calc-total">1 700-2 400 ₽</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== JOB 2: СВОБОДНЫЙ АГЕНТ ===== -->
  <section class="pj-job pj-job--2">
    <div class="pj-job-accent"></div>
    <div class="pj-container">
      <div class="pj-job-grid">
        <div class="pj-job-info">
          <div class="pj-job-num">02</div>
          <h2 class="pj-job-title">СВОБОДНЫЙ<br>АГЕНТ</h2>
          <div class="pj-job-pay">до 15%* с каждого чека</div>
          <p class="pj-job-desc">
            Берёшь флаеры со&nbsp;своим промокодом. Раздаёшь где хочешь -
            в&nbsp;универе, на&nbsp;работе, в&nbsp;спортзале, в&nbsp;своём районе.
            Клиент получает скидку по&nbsp;промокоду, тебе 15%.
          </p>
          <div class="pj-job-details">
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">График</span>
              <span class="pj-job-detail-value">Нет графика</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Где</span>
              <span class="pj-job-detail-value">Где хочешь</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Флаеры</span>
              <span class="pj-job-detail-value">Бесплатно</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Кабинет</span>
              <span class="pj-job-detail-value">Личный кабинет партнёра</span>
            </div>
          </div>
        </div>
        <div class="pj-job-calc">
          <div class="pj-calc-title">Пример заработка</div>
          <div class="pj-calc-row">
            <span>Средний чек клиента</span>
            <span>~800 ₽</span>
          </div>
          <div class="pj-calc-row">
            <span>до 15% тебе</span>
            <span>~120 ₽</span>
          </div>
          <div class="pj-calc-row pj-calc-row--total">
            <span>10 клиентов в неделю</span>
            <span class="pj-calc-total">1 200 ₽</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== JOB 3: ОНЛАЙН-ПАРТНЁР ===== -->
  <section class="pj-job pj-job--3">
    <div class="pj-job-accent"></div>
    <div class="pj-container">
      <div class="pj-job-grid">
        <div class="pj-job-info">
          <div class="pj-job-num">03</div>
          <h2 class="pj-job-title">ОНЛАЙН-<br>ПАРТНЁР</h2>
          <div class="pj-job-pay">до 20%* с каждого чека</div>
          <p class="pj-job-desc">
            Получаешь персональный промокод, который даёт клиентам скидку
            в&nbsp;нашей студии. Печатай его или&nbsp;постишь в&nbsp;интернете -
            соцсети, мессенджеры, чаты. Клиент делает заказ со&nbsp;скидкой -
            тебе 20%. Без встреч.
          </p>
          <div class="pj-job-details">
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">График</span>
              <span class="pj-job-detail-value">Нет графика</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Где</span>
              <span class="pj-job-detail-value">Онлайн</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Нужно</span>
              <span class="pj-job-detail-value">Только телефон</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Кабинет</span>
              <span class="pj-job-detail-value">Личный кабинет партнёра</span>
            </div>
            <div class="pj-job-detail">
              <span class="pj-job-detail-label">Материалы</span>
              <span class="pj-job-detail-value">Готовые промо-материалы</span>
            </div>
          </div>
        </div>
        <div class="pj-job-calc">
          <div class="pj-calc-title">Пример заработка</div>
          <div class="pj-calc-row">
            <span>Средний чек клиента</span>
            <span>~800 ₽</span>
          </div>
          <div class="pj-calc-row">
            <span>до 20% тебе</span>
            <span>~160 ₽</span>
          </div>
          <div class="pj-calc-row pj-calc-row--total">
            <span>10 клиентов в неделю</span>
            <span class="pj-calc-total">1 600 ₽</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== FAQ ===== -->
  <section class="pj-section pj-section--alt">
    <div class="pj-container">
      <div class="pj-section-label">Вопросы</div>
      <h2 class="pj-section-title">FAQ</h2>

      <div class="pj-faq">
        @for (item of faq; track item.q) {
          <div class="pj-faq-item">
            <div class="pj-faq-q">{{ item.q }}</div>
            <div class="pj-faq-a">{{ item.a }}</div>
          </div>
        }
      </div>
    </div>
  </section>

  <!-- ===== LOCATIONS ===== -->
  <section class="pj-section">
    <div class="pj-container">
      <div class="pj-section-label">Адрес студии</div>
      <h2 class="pj-section-title">ГДЕ РАБОТАТЬ</h2>

      <div class="pj-locs">
        <div class="pj-loc">
          <div class="pj-loc-name">Переулок Соборный, 21</div>
          <div class="pj-loc-area">рядом с Большой Садовой</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== CTA ===== -->
  <section class="pj-section pj-section--cta">
    <div class="pj-container pj-cta-inner">
      <div class="pj-section-label">Откликнуться</div>
      <h2 class="pj-section-title">НАПИШИ НАМ</h2>
      <p class="pj-cta-sub">
        В&nbsp;Telegram или в&nbsp;чат на&nbsp;сайте. Ответим, расскажем условия.
      </p>
      <div class="pj-cta-btns">
        <a href="/partners" class="pj-btn-primary">
          Зарегистрироваться &rarr;
        </a>
        <a href="https://t.me/FmagnusBot" target="_blank" rel="noopener" class="pj-btn-outline">
          <img src="/assets/icons/channel-telegram.svg" alt="">
          <span>Telegram</span>
        </a>
        <a href="https://max.ru/magnus_photo" target="_blank" rel="noopener" class="pj-btn-outline">
          <img src="/assets/icons/channel-max.svg" alt="">
          <span>МАКС</span>
        </a>
      </div>
    </div>
  </section>

  <div class="pj-footnote">
    <div class="pj-container">
      * Процент указан максимальный. Точный размер зависит от&nbsp;услуги.
    </div>
  </div>

  <footer class="pj-footer">
    <strong>Своё Фото</strong>, фотостудия в Ростове-на-Дону, 27 лет, рейтинг 5.0
    <span class="pj-stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span>
  </footer>

</div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #0a0a0a;
      color: #f5f5f5;
      font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .pj-container { max-width: 1140px; margin: 0 auto; padding: 0 24px; }

    /* ── Section ── */
    .pj-section { padding: 80px 0; }
    .pj-section--alt { background: #111; }
    .pj-section--cta {
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1000 100%);
      text-align: center;
    }
    .pj-section-label {
      font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
      color: #f59e0b; margin-bottom: 16px;
    }
    .pj-section-title {
      font-family: 'Oswald', 'Impact', sans-serif;
      font-size: clamp(32px, 5vw, 52px); font-weight: 700;
      text-transform: uppercase; line-height: 1.1;
      color: #f5f5f5; margin: 0 0 48px;
    }

    /* ── HERO ── */
    .pj-hero {
      position: relative; padding: 100px 0 80px; overflow: hidden;
      background: #0a0a0a;
    }
    .pj-hero-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 70% 50%, rgba(245,158,11,0.08) 0%, transparent 60%);
      pointer-events: none;
    }
    .pj-hero-label {
      font-size: 11px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase;
      color: #f59e0b; margin-bottom: 20px;
    }
    .pj-hero-title {
      font-family: 'Oswald', 'Impact', sans-serif;
      font-size: clamp(48px, 9vw, 88px); font-weight: 700;
      text-transform: uppercase; line-height: 0.95;
      color: #f5f5f5; margin: 0 0 24px;
    }
    .pj-hero-accent { color: #f59e0b; }
    .pj-hero-sub {
      font-size: clamp(16px, 2.5vw, 20px); color: #9ca3af;
      max-width: 600px; line-height: 1.6; margin-bottom: 48px;
    }
    .pj-hero-cta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }

    /* ── Buttons ── */
    .pj-btn-primary {
      display: inline-flex; align-items: center;
      padding: 16px 36px; border-radius: 6px;
      background: #f59e0b; color: #0a0a0a;
      font-weight: 700; font-size: 16px; letter-spacing: 0.5px;
      border: none; cursor: pointer; text-decoration: none;
      transition: background 0.2s, transform 0.1s;
    }
    .pj-btn-primary:hover { background: #fbbf24; }
    .pj-btn-primary:active { transform: scale(0.98); }

    .pj-btn-outline {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 15px 32px; border-radius: 6px;
      background: transparent; color: #f5f5f5;
      font-weight: 600; font-size: 16px;
      border: 1px solid #3a3a3a; text-decoration: none;
      transition: border-color 0.2s, color 0.2s;
    }
    .pj-btn-outline img { width: 20px; height: 20px; display: block; }
    .pj-btn-outline:hover { border-color: #f59e0b; color: #f59e0b; }

    /* ── JOB SECTIONS ── */
    .pj-job {
      padding: 80px 0;
      position: relative;
      overflow: hidden;
    }
    .pj-job--1 { background: #0a0a0a; }
    .pj-job--2 { background: #0d1117; }
    .pj-job--3 { background: #110d00; }

    .pj-job-accent {
      position: absolute; top: 0; left: 0;
      width: 4px; height: 100%;
    }
    .pj-job--1 .pj-job-accent { background: #f59e0b; }
    .pj-job--2 .pj-job-accent { background: #3b82f6; }
    .pj-job--3 .pj-job-accent { background: #10b981; }

    .pj-job-grid {
      display: grid; grid-template-columns: 1fr 340px;
      gap: 60px; align-items: start;
    }

    .pj-job-num {
      font-family: 'Oswald', sans-serif;
      font-size: 14px; font-weight: 700; letter-spacing: 3px;
      margin-bottom: 16px;
    }
    .pj-job--1 .pj-job-num { color: #f59e0b; }
    .pj-job--2 .pj-job-num { color: #3b82f6; }
    .pj-job--3 .pj-job-num { color: #10b981; }

    .pj-job-title {
      font-family: 'Oswald', 'Impact', sans-serif;
      font-size: clamp(36px, 5vw, 56px); font-weight: 700;
      text-transform: uppercase; line-height: 1;
      color: #f5f5f5; margin: 0 0 16px;
    }
    .pj-job-pay {
      font-size: 18px; font-weight: 700;
      margin-bottom: 24px;
    }
    .pj-job--1 .pj-job-pay { color: #f59e0b; }
    .pj-job--2 .pj-job-pay { color: #3b82f6; }
    .pj-job--3 .pj-job-pay { color: #10b981; }

    .pj-job-desc {
      font-size: 16px; color: #9ca3af; line-height: 1.6;
      margin-bottom: 32px; max-width: 520px;
    }

    .pj-job-details {
      display: flex; flex-direction: column; gap: 12px;
    }
    .pj-job-detail {
      display: flex; gap: 16px;
    }
    .pj-job-detail-label {
      font-size: 12px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; color: #6b7280;
      min-width: 80px; flex-shrink: 0;
    }
    .pj-job-detail-value {
      font-size: 15px; color: #f5f5f5; font-weight: 500;
    }

    /* ── Job calc card ── */
    .pj-job-calc {
      border-radius: 12px; padding: 28px;
      position: sticky; top: 100px;
    }
    .pj-job--1 .pj-job-calc {
      background: #1a1500;
      border: 1px solid rgba(245,158,11,0.2);
    }
    .pj-job--2 .pj-job-calc {
      background: #0d1520;
      border: 1px solid rgba(59,130,246,0.2);
    }
    .pj-job--3 .pj-job-calc {
      background: #0a1510;
      border: 1px solid rgba(16,185,129,0.2);
    }

    .pj-calc-title {
      font-size: 11px; font-weight: 700; letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 20px; padding-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .pj-job--1 .pj-calc-title { color: #f59e0b; }
    .pj-job--2 .pj-calc-title { color: #3b82f6; }
    .pj-job--3 .pj-calc-title { color: #10b981; }

    .pj-calc-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 8px 0; font-size: 14px; color: #9ca3af;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .pj-calc-row span:last-child { color: #f5f5f5; font-weight: 600; }
    .pj-calc-row:last-child { border-bottom: none; }
    .pj-calc-row--total {
      padding-top: 16px; margin-top: 8px;
      border-bottom: none;
    }
    .pj-job--1 .pj-calc-row--total { border-top: 1px solid rgba(245,158,11,0.2); }
    .pj-job--2 .pj-calc-row--total { border-top: 1px solid rgba(59,130,246,0.2); }
    .pj-job--3 .pj-calc-row--total { border-top: 1px solid rgba(16,185,129,0.2); }

    .pj-calc-total {
      font-family: 'Oswald', sans-serif;
      font-size: 28px; font-weight: 700;
    }
    .pj-job--1 .pj-calc-total { color: #f59e0b; }
    .pj-job--2 .pj-calc-total { color: #3b82f6; }
    .pj-job--3 .pj-calc-total { color: #10b981; }

    /* ── FAQ ── */
    .pj-faq { max-width: 700px; }
    .pj-faq-item {
      padding: 24px;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .pj-faq-item:last-child { margin-bottom: 0; }
    .pj-faq-q {
      font-weight: 700; font-size: 16px; color: #f5f5f5;
      margin-bottom: 8px;
    }
    .pj-faq-a {
      font-size: 14px; color: #9ca3af; line-height: 1.6;
    }

    /* ── Locations ── */
    .pj-locs {
      display: grid; grid-template-columns: repeat(2, 1fr);
      gap: 16px; max-width: 600px;
    }
    .pj-loc {
      padding: 24px;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      transition: border-color 0.2s;
    }
    .pj-loc:hover { border-color: rgba(245,158,11,0.3); }
    .pj-loc-name { font-weight: 700; font-size: 16px; color: #f5f5f5; margin-bottom: 4px; }
    .pj-loc-area { font-size: 14px; color: #6b7280; }

    /* ── CTA ── */
    .pj-cta-inner { max-width: 600px; }
    .pj-cta-sub {
      color: #9ca3af; font-size: 18px; line-height: 1.6;
      margin-bottom: 40px;
    }
    .pj-cta-btns {
      display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;
    }

    /* ── Footnote ── */
    .pj-footnote {
      padding: 16px 0;
      font-size: 12px; color: #6b7280;
      border-top: 1px solid #1a1a1a;
    }

    /* ── Footer ── */
    .pj-footer {
      padding: 24px; text-align: center;
      font-size: 13px; color: #6b7280;
      border-top: 1px solid #1a1a1a;
    }
    .pj-footer strong { font-weight: 700; color: #f5f5f5; }
    .pj-stars { color: #f59e0b; margin-left: 4px; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .pj-hero { padding: 70px 0 60px; }
      .pj-hero-title { font-size: clamp(36px, 10vw, 56px); }

      .pj-job { padding: 60px 0; }
      .pj-job-grid {
        grid-template-columns: 1fr;
        gap: 32px;
      }
      .pj-job-calc { position: static; }
      .pj-job-title { font-size: clamp(32px, 8vw, 44px); }

      .pj-section { padding: 60px 0; }
      .pj-locs { grid-template-columns: 1fr; }
    }
  `],
})
export class PromoJobComponent implements OnInit {
  private seo = inject(SeoService);

  readonly faq = [
    {
      q: 'Нужен ли опыт?',
      a: 'Нет. Всё объясним при встрече.',
    },
    {
      q: 'Когда платят?',
      a: 'Промоутерам, после каждой смены. Агентам и онлайн-партнёрам, при накоплении от 1 000 ₽.',
    },
    {
      q: 'Как отслеживается заработок?',
      a: 'У каждого свой промокод. Все клиенты фиксируются. Статистика доступна.',
    },
    {
      q: 'Промоутер получит деньги, если никто не зайдёт?',
      a: 'Да. 150 ₽/час, фиксированная ставка. Проценты, бонус сверху.',
    },
    {
      q: 'Можно совмещать?',
      a: 'Да.',
    },
  ];

  ngOnInit(): void {
    this.seo.setAllMetaData(
      'Подработка в Ростове, от 1 700 ₽/день | Своё Фото',
      'Три вакансии в фотостудии Своё Фото: промоутер (150 ₽/ч + 10%), агент (15%), онлайн-партнёр (20%). Свободный график, без опыта. Ростов-на-Дону.',
      undefined,
      '/promo-job',
      'подработка ростов, работа промоутер, подработка для студентов ростов, раздача флаеров',
    );
  }
}
