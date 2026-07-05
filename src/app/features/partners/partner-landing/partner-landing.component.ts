import {
  Component, signal, computed, inject, OnInit, PLATFORM_ID, ChangeDetectionStrategy,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { AuthDialogService } from '../../../shared/services/auth-dialog.service';
import { AuthChatService } from '../../../core/services/auth-chat.service';
import { PartnerApiService } from '../services/partner-api.service';
import { OAUTH_BUTTONS } from '../../auth/components/oauth-providers.data';

type PartnerType = 'promoter' | 'agent' | 'online' | 'referral' | 'business' | 'affiliate';

const FAQ_ITEMS = [
  {
    q: 'Как работает партнёрская программа?',
    a: 'Вы получаете уникальный промокод. Когда клиент использует его при заказе в Своё Фото, вы получаете комиссию 50% от стоимости заказа. Всё автоматически, ни звонков, ни сложных систем.',
  },
  {
    q: 'Сколько я смогу заработать?',
    a: 'При 5 клиентах в месяц со средним чеком 3 500 ₽, это 8 750 ₽/мес пассивного дохода. При 20 клиентах, уже 35 000 ₽/мес. Всё зависит от вашей аудитории.',
  },
  {
    q: 'Когда выплачиваются деньги?',
    a: 'Вы запрашиваете выплату в личном кабинете. Обрабатываем в течение 24 часов. Доступные методы: перевод на карту, СБП по номеру телефона, банковский перевод.',
  },
  {
    q: 'Нужно ли что-то продавать?',
    a: 'Нет! Просто делитесь промокодом с друзьями, подписчиками или клиентами. Ваша задача, привести человека. Остальное берём на себя.',
  },
  {
    q: 'Есть ли ограничения по количеству клиентов?',
    a: 'Никаких ограничений. Приводите столько клиентов, сколько сможете. Комиссия начисляется за каждый оплаченный заказ с вашим промокодом.',
  },
  {
    q: 'Какие услуги входят в программу?',
    a: 'Все услуги Своё Фото: фото на документы, портретная съёмка, печать фото, ламинирование, сканирование, нейрофотосессии, ретушь, реставрация и другие.',
  },
];

@Component({
  selector: 'app-partner-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, DecimalPipe],
  template: `
<div class="pl-root">

  <!-- ===== HERO ===== -->
  <section class="pl-hero">
    <div class="pl-hero-bg"></div>
    <div class="pl-container">
      <div class="pl-hero-label">Партнёрская программа</div>
      <h1 class="pl-hero-title">ЗАРАБАТЫВАЙТЕ<br><span class="pl-hero-accent">С НАМИ</span></h1>
      <p class="pl-hero-sub">Рекомендуйте Своё Фото, получайте до <strong>50%</strong> от каждого заказа.<br>Без вложений. Без ограничений. Деньги на карту за 24 часа.</p>

      <div class="pl-stats-row">
        <div class="pl-stat">
          <div class="pl-stat-val">50%</div>
          <div class="pl-stat-lab">комиссия</div>
        </div>
        <div class="pl-stat">
          <div class="pl-stat-val">от 1 000 ₽</div>
          <div class="pl-stat-lab">за клиента</div>
        </div>
        <div class="pl-stat">
          <div class="pl-stat-val">24 ч</div>
          <div class="pl-stat-lab">выплаты</div>
        </div>
        <div class="pl-stat">
          <div class="pl-stat-val">0 ₽</div>
          <div class="pl-stat-lab">вложений</div>
        </div>
      </div>

      <div class="pl-hero-cta">
        @if (isLoggedIn()) {
          @if (isPartner()) {
            <a routerLink="/partner-dashboard" class="pl-btn-primary">Перейти в кабинет →</a>
          } @else {
            <button class="pl-btn-primary" (click)="scrollToReg()">Стать партнёром →</button>
          }
        } @else {
          <button class="pl-btn-primary" (click)="scrollToReg()">Стать партнёром →</button>
        }
      </div>
    </div>
  </section>

  <!-- ===== CALCULATOR ===== -->
  <section class="pl-section pl-section--dark" id="calculator">
    <div class="pl-container">
      <div class="pl-section-label">Калькулятор дохода</div>
      <h2 class="pl-section-title">Сколько вы можете<br>зарабатывать?</h2>

      <div class="pl-calc">
        <div class="pl-calc-slider">
          <span class="pl-calc-label" aria-label="Клиентов в месяц">Клиентов в месяц: <strong>{{ clientCount() }}</strong></span>
          <input type="range" min="1" max="50" step="1"
            [value]="clientCount()"
            (input)="clientCount.set(+$any($event.target).value)"
            class="pl-slider" />
          <div class="pl-slider-marks">
            <span>1</span><span>10</span><span>25</span><span>50</span>
          </div>
        </div>

        <div class="pl-calc-result">
          <div class="pl-calc-income">
            <div class="pl-calc-income-label">Ваш доход</div>
            <div class="pl-calc-income-val">{{ formatMoney(bestIncome()) }} ₽/мес</div>
            <div class="pl-calc-income-sub">Это <strong>{{ formatMoney(bestIncome() * 12) }} ₽ в год</strong>, просто за рекомендации</div>
          </div>
        </div>

        <div class="pl-calc-table">
          <div class="pl-calc-table-head">
            <span>Средний чек</span>
            <span>Клиентов</span>
            <span>Доход/мес</span>
            <span>Доход/год</span>
          </div>
          @for (row of calcRows(); track row.avgCheck) {
            <div class="pl-calc-table-row" [class.pl-calc-table-row--best]="row.isBest">
              <span>{{ row.avgCheck | number }} ₽</span>
              <span>{{ clientCount() }}</span>
              <span class="pl-calc-income-cell">{{ formatMoney(row.monthly) }} ₽</span>
              <span class="pl-calc-income-cell">{{ formatMoney(row.yearly) }} ₽</span>
            </div>
          }
        </div>
      </div>
    </div>
  </section>

  <!-- ===== HOW IT WORKS ===== -->
  <section class="pl-section">
    <div class="pl-container">
      <div class="pl-section-label">Как это работает</div>
      <h2 class="pl-section-title">4 простых шага</h2>

      <div class="pl-steps">
        <div class="pl-step">
          <div class="pl-step-num">01</div>
          <div class="pl-step-icon">📋</div>
          <div class="pl-step-title">Зарегистрируйтесь</div>
          <div class="pl-step-desc">Войдите через телефон и нажмите «Стать партнёром». Занимает 2 минуты.</div>
        </div>
        <div class="pl-step-arrow">→</div>
        <div class="pl-step">
          <div class="pl-step-num">02</div>
          <div class="pl-step-icon">📤</div>
          <div class="pl-step-title">Поделитесь</div>
          <div class="pl-step-desc">Получите личный промокод и реферальную ссылку. Отправьте друзьям или подписчикам.</div>
        </div>
        <div class="pl-step-arrow">→</div>
        <div class="pl-step">
          <div class="pl-step-num">03</div>
          <div class="pl-step-icon">🛒</div>
          <div class="pl-step-title">Клиент заказывает</div>
          <div class="pl-step-desc">Клиент называет ваш промокод при заказе. Система автоматически фиксирует реферал.</div>
        </div>
        <div class="pl-step-arrow">→</div>
        <div class="pl-step">
          <div class="pl-step-num">04</div>
          <div class="pl-step-icon">💳</div>
          <div class="pl-step-title">Получите деньги</div>
          <div class="pl-step-desc">Комиссия зачисляется на баланс. Выводите на карту, СБП или банк в 1 клик.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== PARTNER TYPES ===== -->
  <section class="pl-section pl-section--dark">
    <div class="pl-container">
      <div class="pl-section-label">Типы партнёров</div>
      <h2 class="pl-section-title">Найдите своё место</h2>

      <div class="pl-types">
        <div class="pl-type-card">
          <div class="pl-type-icon">👥</div>
          <div class="pl-type-name">Реферальный</div>
          <div class="pl-type-badge pl-type-badge--green">Мгновенная активация</div>
          <div class="pl-type-desc">Рекомендуете друзьям и знакомым. Идеально если у вас широкий круг общения или большая семья.</div>
          <ul class="pl-type-list">
            <li>Автоматическое одобрение</li>
            <li>Промокод сразу</li>
            <li>50% комиссия</li>
          </ul>
        </div>
        <div class="pl-type-card pl-type-card--accent">
          <div class="pl-type-icon">🏢</div>
          <div class="pl-type-name">Бизнес</div>
          <div class="pl-type-badge pl-type-badge--amber">Для компаний</div>
          <div class="pl-type-desc">Отели, HR-агентства, корпоративные партнёры. Направляете клиентов потоком, получаете потоковый доход.</div>
          <ul class="pl-type-list">
            <li>Персональный менеджер</li>
            <li>Объёмные бонусы</li>
            <li>Корпоративный договор</li>
          </ul>
        </div>
        <div class="pl-type-card">
          <div class="pl-type-icon">📱</div>
          <div class="pl-type-name">Блогер</div>
          <div class="pl-type-badge pl-type-badge--purple">Пассивный доход</div>
          <div class="pl-type-desc">Монетизируйте аудиторию. Один пост в Stories или Telegram-канале = рабочий инструмент на годы.</div>
          <ul class="pl-type-list">
            <li>Промо-материалы</li>
            <li>Эксклюзивный контент</li>
            <li>Спецусловия для подписчиков</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== BENEFITS ===== -->
  <section class="pl-section">
    <div class="pl-container">
      <div class="pl-section-label">Преимущества</div>
      <h2 class="pl-section-title">Почему с нами выгодно</h2>

      <div class="pl-benefits">
        <div class="pl-benefit">
          <div class="pl-benefit-icon">💰</div>
          <div class="pl-benefit-title">Высокая комиссия</div>
          <div class="pl-benefit-desc">50% от заказа, одна из лучших ставок на рынке. Без скрытых условий.</div>
        </div>
        <div class="pl-benefit">
          <div class="pl-benefit-icon">⚡</div>
          <div class="pl-benefit-title">Быстрые выплаты</div>
          <div class="pl-benefit-desc">Деньги на карту в течение 24 часов. Карта, СБП, банк, как удобно.</div>
        </div>
        <div class="pl-benefit">
          <div class="pl-benefit-icon">🚀</div>
          <div class="pl-benefit-title">Без вложений</div>
          <div class="pl-benefit-desc">Регистрация бесплатна. Никаких взносов, лицензий и скрытых платежей.</div>
        </div>
        <div class="pl-benefit">
          <div class="pl-benefit-icon">📊</div>
          <div class="pl-benefit-title">Личный кабинет</div>
          <div class="pl-benefit-desc">Отслеживайте статистику, рефералов и доходы в реальном времени.</div>
        </div>
        <div class="pl-benefit">
          <div class="pl-benefit-icon">🎯</div>
          <div class="pl-benefit-title">Все услуги</div>
          <div class="pl-benefit-desc">Комиссия на все 30+ услуг студии, фото, печать, ретушь, сувениры и другие.</div>
        </div>
        <div class="pl-benefit">
          <div class="pl-benefit-icon">🤝</div>
          <div class="pl-benefit-title">Поддержка</div>
          <div class="pl-benefit-desc">Персональный менеджер для крупных партнёров. Всегда на связи в мессенджере.</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== SOCIAL PROOF ===== -->
  <section class="pl-section pl-section--dark">
    <div class="pl-container">
      <div class="pl-proof-total">
        <div class="pl-proof-label">Наши партнёры уже заработали</div>
        <div class="pl-proof-val">347 000 ₽</div>
        <div class="pl-proof-sub">и это только начало</div>
      </div>

      <div class="pl-reviews">
        <div class="pl-review">
          <div class="pl-review-avatar">АЛ</div>
          <div class="pl-review-body">
            <div class="pl-review-name">Алина Л.</div>
            <div class="pl-review-role">Риелтор</div>
            <div class="pl-review-text">Рекомендую клиентам фото для документов при оформлении сделок. За первый месяц вышло 12 000 ₽, просто за то, что называю студию.</div>
          </div>
        </div>
        <div class="pl-review">
          <div class="pl-review-avatar">МК</div>
          <div class="pl-review-body">
            <div class="pl-review-name">Максим К.</div>
            <div class="pl-review-role">Telegram-канал 4 200 подписчиков</div>
            <div class="pl-review-text">Сделал один пост с промокодом, 8 заказов за неделю. Деньги пришли на карту на следующий день. Честно, не ожидал такой скорости.</div>
          </div>
        </div>
        <div class="pl-review">
          <div class="pl-review-avatar">ОП</div>
          <div class="pl-review-body">
            <div class="pl-review-name">Ольга П.</div>
            <div class="pl-review-role">HR-менеджер</div>
            <div class="pl-review-text">Направляю новых сотрудников на корпоративные фото. Стабильный доход каждый месяц без какого-либо дополнительного времени.</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ===== FAQ ===== -->
  <section class="pl-section">
    <div class="pl-container pl-container--narrow">
      <div class="pl-section-label">FAQ</div>
      <h2 class="pl-section-title">Частые вопросы</h2>

      <div class="pl-faq">
        @for (item of faqItems; track item.q; let i = $index) {
          <div class="pl-faq-item" [class.pl-faq-item--open]="openFaq() === i">
            <button class="pl-faq-q" (click)="toggleFaq(i)">
              {{ item.q }}
              <span class="pl-faq-icon">{{ openFaq() === i ? '−' : '+' }}</span>
            </button>
            @if (openFaq() === i) {
              <div class="pl-faq-a">{{ item.a }}</div>
            }
          </div>
        }
      </div>
    </div>
  </section>

  <!-- ===== REGISTRATION CTA ===== -->
  <section class="pl-section pl-section--cta" id="register">
    <div class="pl-container pl-container--narrow">
      <div class="pl-section-label">Регистрация</div>
      <h2 class="pl-section-title">Начните зарабатывать<br>прямо сейчас</h2>

      @if (isPartner()) {
        <div class="pl-already-partner">
          <div class="pl-already-icon">✅</div>
          <div class="pl-already-text">Вы уже являетесь партнёром!</div>
          <a routerLink="/partner-dashboard" class="pl-btn-primary">Перейти в кабинет →</a>
        </div>
      } @else if (isLoggedIn()) {
        <div class="pl-reg-form">
          @if (regStep() === 1) {
            <!-- Шаг 1: Выбор типа -->
            <div class="pl-reg-form-title">Выберите тип партнёрства</div>
            <div class="pl-reg-types">
              <label class="pl-reg-type" [class.pl-reg-type--selected]="selectedType() === 'promoter'">
                <input type="radio" name="type" value="promoter"
                  [checked]="selectedType() === 'promoter'"
                  (change)="selectedType.set('promoter')" />
                <span class="pl-reg-type-icon">📋</span>
                <span class="pl-reg-type-name">Промоутер у студии</span>
                <span class="pl-reg-type-rate">150 руб/ч + до 10%</span>
                <span class="pl-reg-type-note">Нужна самозанятость</span>
              </label>
              <label class="pl-reg-type" [class.pl-reg-type--selected]="selectedType() === 'agent'">
                <input type="radio" name="type" value="agent"
                  [checked]="selectedType() === 'agent'"
                  (change)="selectedType.set('agent')" />
                <span class="pl-reg-type-icon">🚀</span>
                <span class="pl-reg-type-name">Свободный агент</span>
                <span class="pl-reg-type-rate">до 15% с чека</span>
                <span class="pl-reg-type-note">Нужна самозанятость</span>
              </label>
              <label class="pl-reg-type" [class.pl-reg-type--selected]="selectedType() === 'online'">
                <input type="radio" name="type" value="online"
                  [checked]="selectedType() === 'online'"
                  (change)="selectedType.set('online')" />
                <span class="pl-reg-type-icon">📱</span>
                <span class="pl-reg-type-name">Онлайн-партнёр</span>
                <span class="pl-reg-type-rate">до 20% с чека</span>
                <span class="pl-reg-type-note">Мгновенная активация</span>
              </label>
            </div>
            <button class="pl-btn-primary pl-btn-primary--full"
              (click)="nextStep()">
              @if (selectedType() === 'online') {
                Стать партнёром →
              } @else {
                Далее →
              }
            </button>
          } @else {
            <!-- Шаг 2: Самозанятость + ИНН -->
            <button class="pl-reg-back" (click)="regStep.set(1)">← Назад к выбору типа</button>

            <div class="pl-se-info">
              <div class="pl-se-title">Для работы нужен статус самозанятого</div>
              <div class="pl-se-subtitle">Это бесплатно, без поездок в налоговую, делается с телефона за 10 минут</div>

              <button class="pl-se-toggle" (click)="toggleInstruction()">
                {{ showInstruction() ? 'Скрыть инструкцию' : 'Как оформить самозанятость за 10 минут' }}
                <span>{{ showInstruction() ? '−' : '+' }}</span>
              </button>

              @if (showInstruction()) {
                <div class="pl-se-instruction">
                  <div class="pl-se-step"><strong>Шаг 1.</strong> Скачайте приложение «Мой налог» (разработчик, ФНС России):<br>
                    <a href="https://apps.apple.com/ru/app/id1397893031" target="_blank" rel="noopener">App Store</a> ·
                    <a href="https://play.google.com/store/apps/details?id=com.gnivts.nakhodki" target="_blank" rel="noopener">Google Play</a> ·
                    <a href="https://apps.rustore.ru/app/com.gnivts.nakhodki" target="_blank" rel="noopener">RuStore</a>
                  </div>
                  <div class="pl-se-step"><strong>Шаг 2.</strong> Откройте приложение → «Стать самозанятым»</div>
                  <div class="pl-se-step"><strong>Шаг 3.</strong> Подтвердите номер телефона кодом из СМС</div>
                  <div class="pl-se-step"><strong>Шаг 4.</strong> Выберите регион, Ростовская область</div>
                  <div class="pl-se-step"><strong>Шаг 5.</strong> Сфотографируйте паспорт (разворот с фото) и сделайте селфи</div>
                  <div class="pl-se-step"><strong>Шаг 6.</strong> Проверьте данные и отправьте заявку</div>
                  <div class="pl-se-note">Статус придёт в течение нескольких минут.</div>
                </div>
              }
            </div>

            <div class="pl-se-inn-block">
              <label class="pl-se-inn-label" for="inn-input">ИНН самозанятого (12 цифр)</label>
              <input id="inn-input" type="text" inputmode="numeric" maxlength="12"
                class="pl-se-inn-input" [class.pl-se-inn-input--error]="innError()"
                placeholder="123456789012"
                [value]="innValue()"
                (input)="onInnInput($event)" />
              @if (innError()) {
                <div class="pl-se-inn-error">{{ innError() }}</div>
              }
            </div>

            <div class="pl-se-tax-info">
              <div class="pl-se-tax-title">Что важно знать</div>
              <ul class="pl-se-tax-list">
                <li>Налог 6% с дохода считается автоматически, платить до 28 числа следующего месяца</li>
                <li>Первые 10 000 руб налога, бонусный вычет, платить не нужно</li>
                <li>Если за месяц не было дохода, платить ничего не нужно</li>
                <li>Чек формируется в приложении после каждой выплаты</li>
              </ul>
            </div>

            <button class="pl-btn-primary pl-btn-primary--full"
              [disabled]="registering() || !innValue() || !!innError()"
              (click)="register()">
              @if (registering()) {
                Проверяем и регистрируем...
              } @else {
                Подать заявку →
              }
            </button>
          }

          @if (regError()) {
            <div class="pl-reg-error">{{ regError() }}</div>
          }
        </div>
      } @else {
        <!-- Inline auth form for partners -->
        @if (registeredEmail()) {
          <div class="pl-auth-verify">
            <div class="pl-auth-verify-icon">✉️</div>
            <div class="pl-auth-verify-title">Проверьте почту</div>
            <div class="pl-auth-verify-text">
              Мы отправили ссылку для подтверждения на<br>
              <strong>{{ registeredEmail() }}</strong>
            </div>
            @if (resendDone()) {
              <div class="pl-auth-verify-sent">Письмо отправлено повторно</div>
            } @else {
              <button class="pl-btn-secondary" (click)="onResendPartnerVerification()"
                      [disabled]="resendLoading()">
                {{ resendLoading() ? 'Отправляем...' : 'Отправить повторно' }}
              </button>
            }
          </div>
        } @else {
          <div class="pl-inline-auth">
            <div class="pl-auth-tabs">
              <button class="pl-auth-tab" [class.pl-auth-tab--active]="authMode() === 'register'"
                      (click)="authMode.set('register')">Регистрация</button>
              <button class="pl-auth-tab" [class.pl-auth-tab--active]="authMode() === 'login'"
                      (click)="authMode.set('login')">Вход</button>
            </div>

            @if (authError()) {
              <div class="pl-auth-error">{{ authError() }}</div>
            }

            <div class="pl-auth-fields">
              @if (authMode() === 'register') {
                <input type="text" class="pl-auth-input" placeholder="Ваше имя"
                       name="name" autocomplete="name"
                       [value]="authName()" (input)="authName.set($any($event.target).value)" />
              }
              <input type="email" class="pl-auth-input" placeholder="Email"
                     name="email" autocomplete="email"
                     [value]="authEmail()" (input)="authEmail.set($any($event.target).value)" />
              <div class="pl-auth-password-wrap">
                <input [type]="hideAuthPassword() ? 'password' : 'text'"
                       class="pl-auth-input"
                       [placeholder]="authMode() === 'register' ? 'Пароль (мин. 8 символов)' : 'Пароль'"
                       [name]="authMode() === 'register' ? 'new-password' : 'current-password'"
                       [attr.autocomplete]="authMode() === 'register' ? 'new-password' : 'current-password'"
                       [value]="authPassword()" (input)="authPassword.set($any($event.target).value)"
                       (keydown.enter)="onAuthSubmit()" />
                <button class="pl-auth-eye" type="button"
                        (click)="hideAuthPassword.set(!hideAuthPassword())">
                  {{ hideAuthPassword() ? '👁' : '👁‍🗨' }}
                </button>
              </div>
            </div>

            <button class="pl-btn-primary pl-btn-primary--full"
                    [disabled]="authLoading() || !authEmail() || !authPassword()"
                    (click)="onAuthSubmit()">
              {{ authLoading() ? 'Подождите...' : (authMode() === 'register' ? 'Зарегистрироваться' : 'Войти') }}
            </button>

            @if (availableOAuthButtons().length > 0) {
              <div class="pl-auth-divider"><span>или</span></div>
              <div class="pl-auth-oauth">
                @for (btn of availableOAuthButtons(); track btn.id) {
                  <button [class]="'pl-oauth-btn pl-oauth-' + btn.id"
                          (click)="onPartnerOAuth(btn.id)" type="button">
                    <span class="pl-oauth-icon" [innerHTML]="btn.safeSvg"></span>
                    <span>{{ btn.label }}</span>
                  </button>
                }
              </div>
            }
          </div>
        }
      }
    </div>
  </section>

  <!-- Footer note -->
  <div class="pl-footer-note">
    <div class="pl-container">
      <p>© Своё Фото, Партнёрская программа. Ростов-на-Дону.</p>
      <p>Вопросы: <a href="tel:+78633226575">+7 (863) 322-65-75</a> | <a href="https://t.me/magnus_photo" target="_blank" rel="noopener">Telegram</a> · <a href="https://max.ru/magnus_photo" target="_blank" rel="noopener">МАКС</a></p>
    </div>
  </div>

</div>
  `,
  styles: [`
    /* ── Root ── */
    .pl-root {
      min-height: 100vh;
      background: #0a0a0a;
      color: #f5f5f5;
      font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
    }

    /* ── Container ── */
    .pl-container { max-width: 1140px; margin: 0 auto; padding: 0 24px; }
    .pl-container--narrow { max-width: 720px; margin: 0 auto; padding: 0 24px; }

    /* ── Section ── */
    .pl-section { padding: 80px 0; }
    .pl-section--dark { background: #111; }
    .pl-section--cta { background: linear-gradient(135deg, #0a0a0a 0%, #1a1000 100%); }
    .pl-section-label {
      font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
      color: #f59e0b; margin-bottom: 16px;
    }
    .pl-section-title {
      font-family: 'Oswald', 'Impact', sans-serif;
      font-size: clamp(32px, 5vw, 52px); font-weight: 700;
      text-transform: uppercase; line-height: 1.1;
      color: #f5f5f5; margin: 0 0 48px;
    }

    /* ── HERO ── */
    .pl-hero {
      position: relative; padding: 100px 0 80px; overflow: hidden;
      background: #0a0a0a; min-height: 600px;
    }
    .pl-hero-bg {
      position: absolute; inset: 0;
      background: radial-gradient(ellipse at 70% 50%, rgba(245,158,11,0.08) 0%, transparent 60%);
      pointer-events: none;
    }
    .pl-hero-label {
      font-size: 11px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase;
      color: #f59e0b; margin-bottom: 20px;
    }
    .pl-hero-title {
      font-family: 'Oswald', 'Impact', sans-serif;
      font-size: clamp(52px, 10vw, 96px); font-weight: 700;
      text-transform: uppercase; line-height: 0.95;
      color: #f5f5f5; margin: 0 0 24px;
    }
    .pl-hero-accent { color: #f59e0b; }
    .pl-hero-sub {
      font-size: clamp(16px, 2.5vw, 20px); color: #9ca3af;
      max-width: 600px; line-height: 1.6; margin-bottom: 48px;
      strong { color: #f5f5f5; }
    }
    .pl-stats-row {
      display: flex; gap: 0; flex-wrap: wrap; margin-bottom: 48px;
    }
    .pl-stat {
      padding: 20px 32px; border: 1px solid rgba(245,158,11,0.3);
      background: rgba(245,158,11,0.05);
      &:first-child { border-radius: 8px 0 0 8px; }
      &:last-child { border-radius: 0 8px 8px 0; }
      & + & { border-left: none; }
    }
    .pl-stat-val {
      font-family: 'Oswald', sans-serif; font-size: clamp(24px, 3vw, 36px);
      font-weight: 700; color: #f59e0b; line-height: 1;
    }
    .pl-stat-lab { font-size: 12px; color: #6b7280; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
    .pl-hero-cta { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
    .pl-hero-note { font-size: 13px; color: #6b7280; }

    /* ── Buttons ── */
    .pl-btn-primary {
      display: inline-flex; align-items: center;
      padding: 16px 36px; border-radius: 6px;
      background: #f59e0b; color: #0a0a0a;
      font-weight: 700; font-size: 16px; letter-spacing: 0.5px;
      border: none; cursor: pointer; text-decoration: none;
      transition: background 0.2s, transform 0.1s;
      &:hover { background: #fbbf24; }
      &:active { transform: scale(0.98); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .pl-btn-primary--full { width: 100%; justify-content: center; }

    /* ── Calculator ── */
    .pl-calc { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 40px; }
    .pl-calc-label { font-size: 16px; color: #d1d5db; display: block; margin-bottom: 16px; strong { color: #f59e0b; } }
    .pl-slider {
      width: 100%; appearance: none; height: 4px;
      background: rgba(245,158,11,0.2); border-radius: 2px; outline: none; cursor: pointer;
      &::-webkit-slider-thumb {
        appearance: none; width: 20px; height: 20px;
        border-radius: 50%; background: #f59e0b; cursor: pointer;
      }
      &::-moz-range-thumb {
        width: 20px; height: 20px; border-radius: 50%;
        background: #f59e0b; cursor: pointer; border: none;
      }
    }
    .pl-slider-marks {
      display: flex; justify-content: space-between;
      font-size: 12px; color: #6b7280; margin-top: 8px;
    }
    .pl-calc-result { margin: 32px 0 24px; }
    .pl-calc-income-label { font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px; }
    .pl-calc-income-val {
      font-family: 'Oswald', sans-serif; font-size: clamp(36px, 6vw, 64px);
      font-weight: 700; color: #f59e0b; line-height: 1;
      margin-bottom: 8px;
    }
    .pl-calc-income-sub { font-size: 15px; color: #9ca3af; strong { color: #f5f5f5; } }
    .pl-calc-table { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 24px; }
    .pl-calc-table-head {
      display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
      padding: 8px 16px; font-size: 11px; color: #6b7280;
      text-transform: uppercase; letter-spacing: 1px;
    }
    .pl-calc-table-row {
      display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
      padding: 12px 16px; border-radius: 8px; font-size: 15px;
      transition: background 0.2s;
      &:hover { background: rgba(255,255,255,0.04); }
    }
    .pl-calc-table-row--best {
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.2);
      .pl-calc-income-cell { color: #f59e0b; font-weight: 700; }
    }
    .pl-calc-income-cell { font-weight: 600; color: #f5f5f5; }

    /* ── Steps ── */
    .pl-steps {
      display: flex; align-items: flex-start; gap: 0;
      flex-wrap: wrap;
    }
    .pl-step {
      flex: 1; min-width: 200px;
      padding: 32px 24px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px; background: rgba(255,255,255,0.02);
      transition: border-color 0.2s;
      &:hover { border-color: rgba(245,158,11,0.3); }
    }
    .pl-step-arrow {
      display: flex; align-items: center; padding: 0 8px;
      font-size: 24px; color: #f59e0b; margin-top: 48px;
    }
    .pl-step-num { font-family: 'Oswald', sans-serif; font-size: 40px; font-weight: 700; color: rgba(245,158,11,0.3); line-height: 1; }
    .pl-step-icon { font-size: 32px; margin: 12px 0; }
    .pl-step-title { font-size: 18px; font-weight: 700; color: #f5f5f5; margin-bottom: 8px; }
    .pl-step-desc { font-size: 14px; color: #9ca3af; line-height: 1.6; }

    /* ── Types ── */
    .pl-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
    .pl-type-card {
      padding: 32px; border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px; background: rgba(255,255,255,0.02);
      transition: border-color 0.2s, transform 0.2s;
      &:hover { border-color: rgba(245,158,11,0.3); transform: translateY(-4px); }
    }
    .pl-type-card--accent { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.04); }
    .pl-type-icon { font-size: 40px; margin-bottom: 16px; }
    .pl-type-name { font-size: 22px; font-weight: 700; color: #f5f5f5; margin-bottom: 8px; }
    .pl-type-badge {
      display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; padding: 4px 10px; border-radius: 99px; margin-bottom: 16px;
    }
    .pl-type-badge--green { background: rgba(16,185,129,0.15); color: #10b981; }
    .pl-type-badge--amber { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .pl-type-badge--purple { background: rgba(139,92,246,0.15); color: #8b5cf6; }
    .pl-type-desc { font-size: 14px; color: #9ca3af; line-height: 1.6; margin-bottom: 16px; }
    .pl-type-list {
      list-style: none; padding: 0; margin: 0;
      li { font-size: 14px; color: #6b7280; padding: 4px 0;
        &::before { content: '✓ '; color: #f59e0b; }
      }
    }

    /* ── Benefits ── */
    .pl-benefits { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
    .pl-benefit {
      padding: 28px;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
    }
    .pl-benefit-icon { font-size: 32px; margin-bottom: 12px; }
    .pl-benefit-title { font-size: 17px; font-weight: 700; color: #f5f5f5; margin-bottom: 8px; }
    .pl-benefit-desc { font-size: 14px; color: #9ca3af; line-height: 1.6; }

    /* ── Social Proof ── */
    .pl-proof-total { text-align: center; margin-bottom: 48px; }
    .pl-proof-label { font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px; }
    .pl-proof-val {
      font-family: 'Oswald', sans-serif; font-size: clamp(48px, 8vw, 80px);
      font-weight: 700; color: #f59e0b;
    }
    .pl-proof-sub { font-size: 16px; color: #6b7280; }
    .pl-reviews { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
    .pl-review {
      display: flex; gap: 16px; padding: 24px;
      border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;
      background: rgba(255,255,255,0.02);
    }
    .pl-review-avatar {
      width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
      background: rgba(245,158,11,0.2); color: #f59e0b;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700;
    }
    .pl-review-name { font-size: 14px; font-weight: 700; color: #f5f5f5; }
    .pl-review-role { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
    .pl-review-text { font-size: 13px; color: #9ca3af; line-height: 1.6; }

    /* ── FAQ ── */
    .pl-faq { border-top: 1px solid rgba(255,255,255,0.08); }
    .pl-faq-item { border-bottom: 1px solid rgba(255,255,255,0.08); }
    .pl-faq-q {
      display: flex; justify-content: space-between; align-items: center;
      width: 100%; padding: 20px 0; background: transparent; border: none;
      color: #f5f5f5; font-size: 16px; font-weight: 600; cursor: pointer; text-align: left;
      gap: 16px;
      &:hover { color: #f59e0b; }
    }
    .pl-faq-icon { font-size: 24px; color: #f59e0b; flex-shrink: 0; }
    .pl-faq-a { padding: 0 0 20px; font-size: 15px; color: #9ca3af; line-height: 1.7; }

    /* ── Registration form ── */
    .pl-reg-form {
      background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px; padding: 40px;
    }
    .pl-reg-form-title { font-size: 18px; font-weight: 700; color: #f5f5f5; margin-bottom: 24px; }
    .pl-reg-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .pl-reg-type {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 20px 16px; border: 2px solid rgba(255,255,255,0.08);
      border-radius: 12px; cursor: pointer; transition: border-color 0.2s;
      input[type="radio"] { display: none; }
      &:hover { border-color: rgba(245,158,11,0.4); }
    }
    .pl-reg-type--selected { border-color: #f59e0b; background: rgba(245,158,11,0.06); }
    .pl-reg-type-icon { font-size: 28px; }
    .pl-reg-type-name { font-size: 15px; font-weight: 700; color: #f5f5f5; }
    .pl-reg-type-rate { font-size: 13px; font-weight: 600; color: #f59e0b; }
    .pl-reg-type-note { font-size: 11px; color: #9ca3af; }
    .pl-reg-error { margin-top: 12px; padding: 12px 16px; border-radius: 8px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; font-size: 14px; }

    /* ── Self-Employment Step ── */
    .pl-reg-back {
      background: none; border: none; color: #9ca3af; font-size: 14px;
      cursor: pointer; padding: 0; margin-bottom: 24px;
      &:hover { color: #f59e0b; }
    }
    .pl-se-info { margin-bottom: 24px; }
    .pl-se-title { font-size: 20px; font-weight: 700; color: #f5f5f5; margin-bottom: 8px; }
    .pl-se-subtitle { font-size: 14px; color: #9ca3af; margin-bottom: 16px; }
    .pl-se-toggle {
      display: flex; justify-content: space-between; align-items: center; width: 100%;
      padding: 14px 16px; background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2);
      border-radius: 8px; color: #f59e0b; font-size: 14px; font-weight: 600; cursor: pointer;
      span { font-size: 18px; }
      &:hover { background: rgba(245,158,11,0.1); }
    }
    .pl-se-instruction {
      padding: 20px; margin-top: 12px; background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
    }
    .pl-se-step {
      padding: 8px 0; font-size: 14px; color: #d1d5db; line-height: 1.6;
      a { color: #f59e0b; text-decoration: underline; }
    }
    .pl-se-note { margin-top: 12px; font-size: 13px; color: #10b981; font-weight: 600; }

    .pl-se-inn-block { margin-bottom: 24px; }
    .pl-se-inn-label { display: block; font-size: 14px; font-weight: 600; color: #d1d5db; margin-bottom: 8px; }
    .pl-se-inn-input {
      width: 100%; padding: 14px 16px; font-size: 18px; letter-spacing: 2px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px; color: #f5f5f5; font-family: monospace;
      &::placeholder { color: #4b5563; letter-spacing: 1px; }
      &:focus { outline: none; border-color: #f59e0b; }
    }
    .pl-se-inn-input--error { border-color: #ef4444; }
    .pl-se-inn-error { margin-top: 6px; font-size: 13px; color: #ef4444; }

    .pl-se-tax-info {
      margin-bottom: 24px; padding: 16px; background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
    }
    .pl-se-tax-title { font-size: 14px; font-weight: 700; color: #d1d5db; margin-bottom: 10px; }
    .pl-se-tax-list {
      list-style: none; padding: 0; margin: 0;
      li { font-size: 13px; color: #9ca3af; padding: 3px 0; line-height: 1.5;
        &::before { content: '• '; color: #6b7280; }
      }
    }

    /* ── Inline Auth ── */
    .pl-inline-auth {
      max-width: 420px; margin: 0 auto; padding: 32px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
    }
    .pl-auth-tabs {
      display: flex; gap: 0; margin-bottom: 24px;
      border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; overflow: hidden;
    }
    .pl-auth-tab {
      flex: 1; padding: 10px; border: none; background: transparent;
      color: #6b7280; font-size: 14px; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: all 0.15s;
      &--active { background: rgba(245,158,11,0.15); color: #f59e0b; }
    }
    .pl-auth-error {
      padding: 10px 14px; margin-bottom: 16px; border-radius: 8px;
      background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3);
      color: #ef4444; font-size: 13px;
    }
    .pl-auth-fields { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
    .pl-auth-input {
      width: 100%; padding: 12px 16px; border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px; background: rgba(255,255,255,0.06); color: #f5f5f5;
      font-size: 15px; font-family: inherit; outline: none; box-sizing: border-box;
      transition: border-color 0.15s;
      &::placeholder { color: #6b7280; }
      &:focus { border-color: #f59e0b; }
    }
    .pl-auth-password-wrap { position: relative; }
    .pl-auth-password-wrap .pl-auth-input { padding-right: 44px; }
    .pl-auth-eye {
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      background: none; border: none; color: #6b7280; cursor: pointer;
      font-size: 16px; padding: 4px;
    }
    .pl-auth-divider {
      display: flex; align-items: center; gap: 16px; margin: 20px 0;
      &::before, &::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08); }
      span { font-size: 12px; color: #6b7280; white-space: nowrap; }
    }
    .pl-auth-oauth { display: flex; flex-direction: column; gap: 8px; }
    .pl-oauth-btn {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 11px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
      background: transparent; color: #f5f5f5; font-size: 14px; font-weight: 600;
      font-family: inherit; cursor: pointer; transition: all 0.15s;
      &:hover { border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.04); }
    }
    .pl-oauth-icon { display: flex; align-items: center; }
    .pl-oauth-yandex { border-color: rgba(252,65,48,0.3); color: #fc4130;
      &:hover { background: rgba(252,65,48,0.08); } }
    .pl-oauth-vk { border-color: rgba(0,119,255,0.3); color: #0077ff;
      &:hover { background: rgba(0,119,255,0.08); } }
    .pl-auth-verify { text-align: center; padding: 40px; }
    .pl-auth-verify-icon { font-size: 48px; margin-bottom: 16px; }
    .pl-auth-verify-title { font-size: 22px; font-weight: 700; color: #f5f5f5; margin-bottom: 12px; }
    .pl-auth-verify-text { font-size: 15px; color: #9ca3af; margin-bottom: 20px; line-height: 1.5;
      strong { color: #f5f5f5; } }
    .pl-auth-verify-sent { font-size: 14px; color: #4ade80; }
    .pl-btn-secondary {
      padding: 10px 24px; border-radius: 8px; border: 1px solid rgba(245,158,11,0.3);
      background: transparent; color: #f59e0b; font-size: 14px; font-weight: 600;
      font-family: inherit; cursor: pointer; transition: all 0.15s;
      &:hover { background: rgba(245,158,11,0.08); }
      &:disabled { opacity: 0.5; cursor: default; }
    }

    .pl-already-partner { text-align: center; padding: 40px; }
    .pl-already-icon { font-size: 48px; margin-bottom: 16px; }
    .pl-already-text { font-size: 20px; font-weight: 700; color: #f5f5f5; margin-bottom: 24px; }

    /* ── Footer note ── */
    .pl-footer-note {
      padding: 32px 0; border-top: 1px solid rgba(255,255,255,0.06);
      text-align: center; font-size: 13px; color: #6b7280;
      a { color: #9ca3af; }
      p { margin: 4px 0; }
    }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .pl-types { grid-template-columns: 1fr; }
      .pl-benefits { grid-template-columns: repeat(2, 1fr); }
      .pl-reviews { grid-template-columns: 1fr; }
      .pl-reg-types { grid-template-columns: 1fr; }
    }
    @media (max-width: 680px) {
      .pl-section { padding: 60px 0; }
      .pl-hero { padding: 70px 0 60px; }
      .pl-stats-row { flex-direction: column; }
      .pl-stat { border-radius: 8px !important; border: 1px solid rgba(245,158,11,0.3) !important; }
      .pl-stat + .pl-stat { border-left: 1px solid rgba(245,158,11,0.3) !important; margin-top: 8px; }
      .pl-steps { flex-direction: column; }
      .pl-step-arrow { display: none; }
      .pl-benefits { grid-template-columns: 1fr; }
      .pl-calc { padding: 24px; }
      .pl-calc-table-head, .pl-calc-table-row {
        grid-template-columns: 1fr 1fr 1fr 1fr;
        font-size: 12px;
      }
    }
  `],
})
export class PartnerLandingComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly authDialogService = inject(AuthDialogService);
  private readonly visitorChatService = inject(AuthChatService);
  private readonly partnerApi = inject(PartnerApiService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly sanitizer = inject(DomSanitizer);

  readonly faqItems = FAQ_ITEMS;

  readonly isLoggedIn = computed(() => !!this.authService.currentUser());

  // --- Inline auth ---
  readonly authMode = signal<'login' | 'register'>('register');
  readonly authEmail = signal('');
  readonly authPassword = signal('');
  readonly authName = signal('');
  readonly authLoading = signal(false);
  readonly authError = signal<string | null>(null);
  readonly hideAuthPassword = signal(true);
  readonly registeredEmail = signal<string | null>(null);
  readonly resendLoading = signal(false);
  readonly resendDone = signal(false);
  readonly availableOAuthButtons = computed(() =>
    OAUTH_BUTTONS
      .filter(btn => this.authService.availableProviders().some(p => p.id === btn.id))
      .map(btn => ({ ...btn, safeSvg: this.sanitizer.bypassSecurityTrustHtml(btn.svgIcon) as SafeHtml }))
  );
  readonly clientCount = signal(5);
  readonly openFaq = signal<number | null>(null);
  readonly selectedType = signal<PartnerType>('promoter');
  readonly registering = signal(false);
  readonly regError = signal<string | null>(null);
  readonly isPartner = signal(false);
  readonly regStep = signal<1 | 2>(1);
  readonly innValue = signal('');
  readonly innError = signal<string | null>(null);
  readonly showInstruction = signal(false);

  readonly calcRows = computed(() => {
    const checks = [
      { avgCheck: 2000, isBest: false },
      { avgCheck: 3500, isBest: true },
      { avgCheck: 5000, isBest: false },
    ];
    return checks.map(r => ({
      ...r,
      monthly: Math.round(r.avgCheck * this.clientCount() * 0.5),
      yearly: Math.round(r.avgCheck * this.clientCount() * 0.5 * 12),
    }));
  });

  readonly bestIncome = computed(() => {
    const best = this.calcRows().find(r => r.isBest);
    return best ? best.monthly : 0;
  });

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.authService.loadAvailableProviders().subscribe();
      if (this.authService.currentUser()) {
        this.partnerApi.getProfile().subscribe({
          next: () => this.isPartner.set(true),
          error: () => this.isPartner.set(false),
        });
      }
    }
  }

  formatMoney(val: number): string {
    return val.toLocaleString('ru-RU');
  }

  toggleFaq(i: number): void {
    this.openFaq.update(v => v === i ? null : i);
  }

  onAuthSubmit(): void {
    const email = this.authEmail().trim();
    const password = this.authPassword();
    if (!email || !password) return;

    this.authError.set(null);
    this.authLoading.set(true);

    if (this.authMode() === 'login') {
      this.authService.login(email, password).subscribe({
        next: () => {
          this.authLoading.set(false);
          this.visitorChatService.linkUserAfterAuth();
          // isLoggedIn() станет true → шаблон покажет партнёрскую форму
          this.checkPartnerStatus();
        },
        error: (err) => {
          this.authLoading.set(false);
          if (err.error === 'EMAIL_NOT_VERIFIED') {
            this.registeredEmail.set(email);
          } else {
            this.authError.set(err.error || err.message || 'Неверный email или пароль');
          }
        },
      });
    } else {
      const name = this.authName().trim() || undefined;
      this.authService.register(email, password, name).subscribe({
        next: (res) => {
          this.authLoading.set(false);
          if (res.requiresVerification) {
            this.registeredEmail.set(email);
          } else {
            this.visitorChatService.linkUserAfterAuth();
            this.checkPartnerStatus();
          }
        },
        error: (err) => {
          this.authLoading.set(false);
          this.authError.set(err.error || err.message || 'Ошибка регистрации');
        },
      });
    }
  }

  onPartnerOAuth(providerId: string): void {
    this.authService.signInWithProvider(providerId, '/partners').subscribe();
  }

  onResendPartnerVerification(): void {
    const email = this.registeredEmail();
    if (!email || this.resendLoading()) return;
    this.resendLoading.set(true);
    this.resendDone.set(false);
    this.authService.resendVerificationEmail(email).subscribe({
      next: () => { this.resendLoading.set(false); this.resendDone.set(true); },
      error: () => { this.resendLoading.set(false); this.resendDone.set(true); },
    });
  }

  private checkPartnerStatus(): void {
    this.partnerApi.getProfile().subscribe({
      next: () => this.isPartner.set(true),
      error: () => {
        this.isPartner.set(false);
        // Scroll to partner registration form after auth
        setTimeout(() => this.scrollToReg(), 300);
      },
    });
  }

  scrollToReg(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById('register')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  openAuth(): void {
    this.authDialogService.openLoginDialog();
  }

  toggleInstruction(): void {
    this.showInstruction.set(!this.showInstruction());
  }

  nextStep(): void {
    // online = auto-approved without INN (like referral)
    if (this.selectedType() === 'online' || this.selectedType() === 'referral') {
      this.register();
    } else {
      this.regStep.set(2);
    }
  }

  onInnInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 12);
    this.innValue.set(raw);

    if (!raw) {
      this.innError.set(null);
      return;
    }
    if (raw.length < 12) {
      this.innError.set(null); // don't show error while typing
      return;
    }
    // Validate checksum
    if (!this.validateInnChecksum(raw)) {
      this.innError.set('Контрольная сумма ИНН не совпадает, проверьте цифры');
    } else {
      this.innError.set(null);
    }
  }

  private validateInnChecksum(inn: string): boolean {
    if (inn.length !== 12) return false;
    const d = inn.split('').map(Number);
    const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
    const sum1 = w1.reduce((acc, w, i) => acc + w * d[i], 0);
    if ((sum1 % 11) % 10 !== d[10]) return false;
    const sum2 = w2.reduce((acc, w, i) => acc + w * d[i], 0);
    if ((sum2 % 11) % 10 !== d[11]) return false;
    return true;
  }

  register(): void {
    this.regError.set(null);
    this.registering.set(true);

    const type = this.selectedType();
    const requiresInn = type === 'promoter' || type === 'agent' || type === 'business' || type === 'affiliate';
    const inn = requiresInn ? this.innValue() : undefined;

    this.partnerApi.register(type, inn).subscribe({
      next: () => {
        this.registering.set(false);
        this.router.navigate(['/partner-dashboard']);
      },
      error: (err) => {
        this.registering.set(false);
        this.regError.set(err?.error?.error || 'Ошибка регистрации. Попробуйте ещё раз.');
      },
    });
  }
}
