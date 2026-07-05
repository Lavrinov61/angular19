import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-requisites',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="legal-page">
      <div class="legal-container">
        <h1>Реквизиты</h1>

        <section>
          <h2>Индивидуальный предприниматель</h2>
          <table class="info-table">
            <tr><td>Наименование</td><td>Индивидуальный предприниматель Лавринова Елена Борисовна</td></tr>
            <tr><td>ИНН</td><td>262603741214</td></tr>
            <tr><td>ОГРНИП</td><td>324619600264982</td></tr>
            <tr><td>Телефон</td><td><a href="tel:+78633226575">+7 (863) 322-65-75</a></td></tr>
            <tr><td>Email</td><td><a href="mailto:info&#64;svoefoto.ru">info&#64;svoefoto.ru</a></td></tr>
            <tr><td>Сайт</td><td><a href="https://svoefoto.ru">svoefoto.ru</a></td></tr>
          </table>
        </section>

        <section>
          <h2>Банковские реквизиты</h2>
          <table class="info-table">
            <tr><td>Расчётный счёт</td><td>40802810600007478711</td></tr>
            <tr><td>Банк</td><td>АО «ТБанк»</td></tr>
            <tr><td>ИНН банка</td><td>7710140679</td></tr>
            <tr><td>БИК</td><td>044525974</td></tr>
            <tr><td>Корр. счёт</td><td>30101810145250000974</td></tr>
            <tr><td>Адрес банка</td><td>127287, г. Москва, ул. Хуторская 2-я, д. 38А, стр. 26</td></tr>
          </table>
        </section>

        <section>
          <h2>Адрес студии</h2>
          <ul>
            <li><strong>Студия на Соборном</strong>, г. Ростов-на-Дону, пер. Соборный, д. 21</li>
          </ul>
        </section>

        <section>
          <h2>Режим работы</h2>
          <p>Ежедневно с 09:00 до 19:30</p>
        </section>
      </div>
    </div>
  `,
  styles: [`
    .legal-page {
      padding: 24px 16px 64px;
      min-height: 60vh;
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
    }
    .legal-container {
      max-width: 800px;
      margin: 0 auto;
    }
    h1 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      font-size: 1.75rem;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 32px;
    }
    h2 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      font-size: 1.25rem;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 24px 0 16px;
    }
    .info-table {
      width: 100%;
      border-collapse: collapse;
    }
    .info-table td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      font-size: 1rem;
      color: var(--ed-on-surface, #f5f5f5);
    }
    .info-table td:first-child {
      font-weight: 500;
      white-space: nowrap;
      width: 140px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }
    .info-table a {
      color: var(--ed-accent, #f59e0b);
      text-decoration: none;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    ul li {
      padding: 8px 0;
      font-size: 1rem;
      color: var(--ed-on-surface, #f5f5f5);
    }
    p {
      font-size: 1rem;
      color: var(--ed-on-surface, #f5f5f5);
    }
    @media (max-width: 599px) {
      .info-table td:first-child {
        width: auto;
        display: block;
        padding-bottom: 4px;
        border: none;
      }
      .info-table td:last-child {
        display: block;
        padding-top: 0;
      }
    }
  `]
})
export class RequisitesComponent implements OnInit {
  private readonly seo = inject(SeoService);

  ngOnInit(): void {
    this.seo.setAllMetaData(
      'Реквизиты, Своё Фото',
      'Реквизиты ИП Лавринова Елена Борисовна. ИНН 262603741214, ОГРНИП 324619600264982. Фотостудия Своё Фото, Ростов-на-Дону.',
      undefined,
      '/rekvizity'
    );
  }
}
