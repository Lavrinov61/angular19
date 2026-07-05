import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';


import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AuthService, type UserProfile } from '../../../../core/services/auth.service';
import { FileStorageService } from '../../../../core/services/file-storage.service';
import { NotificationApiService, NotificationSettings } from '../../../../core/services/notification-api.service';
import { AvatarUploadDialogComponent } from '../avatar-upload-dialog/avatar-upload-dialog.component';
import { AvatarBottomSheetComponent, AvatarAction } from '../avatar-bottom-sheet/avatar-bottom-sheet.component';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

interface LinkedChannel {
  channel: string;
  display_name: string | null;
  username: string | null;
  verified_at: string;
  linked_by: string;
}

interface ChannelsResponse {
  channels: LinkedChannel[];
}

interface ChannelLinkResponse {
  success?: boolean;
  linked?: boolean;
  channel?: LinkedChannel;
  message?: string;
  deepLink?: string;
  expiresInSeconds?: number;
}

interface ChannelDef {
  id: string;
  name: string;
  icon: string;
  color: string;
}

type ProfilePersonalData = NonNullable<UserProfile['personal_data']>;
type CustomerAccountType = NonNullable<UserProfile['account_type']>;

interface AccountTypeOption {
  readonly type: CustomerAccountType;
  readonly label: string;
  readonly icon: string;
  readonly discountBadge: string;
  readonly description: string;
  readonly serviceScope?: string;
  readonly documentExample: string;
  readonly photoExample: string;
  readonly activationText: string;
  readonly useCases?: readonly string[];
}

const ACCOUNT_TYPE_OPTIONS: readonly AccountTypeOption[] = [
  {
    type: 'personal',
    label: 'Личный аккаунт',
    icon: 'person',
    discountBadge: '−20% / −10%',
    description: 'Документы −20%, фотопечать от 10x15 до А4 −10%.',
    documentExample: 'А4 −20%',
    photoExample: 'Фото 10×15 −10%',
    activationText: 'Выберите тип и подключите личный доступ.',
  },
  {
    type: 'business',
    label: 'Бизнес аккаунт',
    icon: 'business_center',
    discountBadge: 'B2B',
    description: 'Корпоративный аккаунт с реквизитами, сотрудниками, счетами и B2B-условиями.',
    serviceScope: 'Съёмки команды, индивидуальный выезд, счета и закрывающие документы по B2B-сценарию.',
    documentExample: 'А4 −40%',
    photoExample: 'Фото 10×15 −15%',
    activationText: 'Подключается как организация: реквизиты, подтверждение через банк или менеджера, оплата по счёту.',
    useCases: [
      'пропуска сотрудников',
      'медкнижки, анкеты и личные дела',
      'счета, реестр печати и корпоративные базы',
    ],
  },
  {
    type: 'education',
    label: 'Образовательный аккаунт',
    icon: 'school',
    discountBadge: '199 ₽/мес',
    description: 'Документы −70%, премиум-фотопечать от 10x15 до А4 −50%.',
    documentExample: 'А4 10 ₽ → 3 ₽',
    photoExample: 'Фото 10x15 20 ₽ → 10 ₽',
    activationText: 'Подтвердите статус и оплатите 199 ₽ в месяц.',
  },
];

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function readErrorMessage(error: unknown, fallback: string): string {
  const record = readObject(error);
  const responseError = record?.['error'];
  if (typeof responseError === 'string' && responseError.trim()) {
    return responseError;
  }
  const body = readObject(responseError);
  const apiError = body?.['error'] ?? body?.['message'] ?? record?.['message'];
  return typeof apiError === 'string' && apiError.trim() ? apiError : fallback;
}

const CHANNEL_DEFS: ChannelDef[] = [
  { id: 'telegram', name: 'Telegram', icon: 'channel-telegram', color: '#29B6F6' },
  { id: 'vk', name: 'ВКонтакте', icon: 'channel-vk', color: '#4C75A3' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'channel-whatsapp', color: '#25D366' },
  { id: 'max', name: 'МАКС', icon: 'channel-max', color: '#168DE2' },
  { id: 'instagram', name: 'Instagram', icon: 'channel-instagram', color: '#E4405F' },
];

@Component({
  selector: 'app-account-center',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatBottomSheetModule,
    MatDividerModule,
    MatTooltipModule,
    RouterLink,
  ],
  template: `
    <div class="account-center">

      <!-- Header -->
      @if (!profileLoaded()) {
        <div class="ac-header">
          <div class="ac-avatar skeleton-pulse"></div>
          <div>
            <div class="skeleton-line skeleton-pulse" style="width: 180px; height: 22px;"></div>
            <div class="skeleton-line skeleton-pulse" style="width: 120px; height: 14px; margin-top: 8px;"></div>
          </div>
        </div>
      } @else {
        @let userProfile = authService.currentUser();
        @if (userProfile) {
          <div class="ac-header">
            <div class="ac-avatar" (click)="openAvatarUpload()" (keydown.enter)="openAvatarUpload()" tabindex="0" matTooltip="Сменить фото">
              @if (userProfile.photoURL || userProfile.photo_url) {
                <img [src]="userProfile.photoURL || userProfile.photo_url" alt="Фото профиля" />
              } @else {
                <mat-icon class="ac-avatar-placeholder">account_circle</mat-icon>
              }
              <div class="ac-avatar-overlay">
                <mat-icon>photo_camera</mat-icon>
              </div>
            </div>
            <div>
              <h2 class="ac-title">Аккаунт</h2>
              <p class="ac-subtitle">{{ userProfile.displayName || userProfile.display_name || userProfile.email }}</p>
            </div>
          </div>
        }
      }

      <!-- Two-column grid layout -->
      <div class="ac-grid">
        <!-- LEFT column, Профиль + Уведомления + Мессенджеры -->
        <div class="ac-column-main">

          <!-- Секция: Личные данные -->
          <section class="ac-section">
            <div class="ac-section-header">
              <mat-icon>person</mat-icon>
              <h3>Личные данные</h3>
            </div>
            <div class="ac-section-body">
              <div class="ac-fields">
                @for (field of profileFields; track field.key) {
                  <div class="ac-field" [class.ac-field-saving]="savingField() === field.key">
                    @if (editingField() === field.key) {
                      <div class="ac-field-edit">
                        @if (field.key === 'dateOfBirth') {
                          <mat-form-field appearance="outline" class="ac-field-input">
                            <mat-label>{{ field.label }}</mat-label>
                            <input matInput [matDatepicker]="datePicker" [formControl]="editControls.dateOfBirth" />
                            <mat-datepicker-toggle matSuffix [for]="datePicker" />
                            <mat-datepicker #datePicker />
                          </mat-form-field>
                        } @else {
                          <mat-form-field appearance="outline" class="ac-field-input">
                            <mat-label>{{ field.label }}</mat-label>
                            <input matInput [formControl]="getEditControl(field.key)"
                              [placeholder]="field.placeholder"
                              [inputMode]="field.key === 'phoneNumber' ? 'tel' : 'text'" />
                          </mat-form-field>
                        }
                        <div class="ac-field-actions">
                          <button mat-icon-button class="ac-confirm-btn" (click)="confirmField(field.key)"
                            [disabled]="savingField() === field.key">
                            @if (savingField() === field.key) {
                              <mat-spinner diameter="18" />
                            } @else {
                              <mat-icon>check</mat-icon>
                            }
                          </button>
                          <button mat-icon-button class="ac-cancel-btn" (click)="cancelEdit()">
                            <mat-icon>close</mat-icon>
                          </button>
                        </div>
                      </div>
                    } @else if (field.readonly) {
                      <div class="ac-field-display">
                        <div class="ac-field-label">{{ field.label }}</div>
                        <div class="ac-field-value">{{ profileForm.getRawValue()[field.key] || 'Не указан' }}</div>
                        <div class="ac-field-hint"><mat-icon class="lock-icon">lock</mat-icon> Email нельзя изменить</div>
                      </div>
                    } @else {
                      <div class="ac-field-display" tabindex="0" role="button"
                        (click)="startEdit(field.key)" (keydown.enter)="startEdit(field.key)">
                        <div class="ac-field-label">{{ field.label }}</div>
                        @if (field.key === 'dateOfBirth') {
                          <div class="ac-field-value">{{ formatDate(profileForm.get('dateOfBirth')?.value) }}</div>
                        } @else {
                          @if (profileForm.get(field.key)?.value) {
                            <div class="ac-field-value">{{ profileForm.get(field.key)?.value }}</div>
                          } @else {
                            <div class="ac-field-empty">Не указано</div>
                          }
                        }
                      </div>
                      <button mat-icon-button class="ac-edit-btn" (click)="startEdit(field.key)">
                        <mat-icon>edit</mat-icon>
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
          </section>

          <!-- Секция: Тип аккаунта -->
          <section class="ac-section">
            <div class="ac-section-header">
              <mat-icon>badge</mat-icon>
              <h3>Тип аккаунта и скидки</h3>
            </div>
            <div class="ac-section-body">
              <div class="ac-account-notice">
                <span class="ac-account-notice__icon"><mat-icon>workspace_premium</mat-icon></span>
                <span class="ac-account-notice__text">
                  <strong>Выбор типа не списывает деньги</strong>
                  <small>Скидка применяется после подключения доступа: личный, по подписке, образовательный, после проверки; бизнес оформляется как B2B-аккаунт с реквизитами и оплатой по счёту.</small>
                </span>
                <span class="ac-account-notice__actions">
                  <a mat-flat-button routerLink="/user-profile/subscription">Личный доступ</a>
                  <a mat-stroked-button routerLink="/business">Бизнес-аккаунт</a>
                  <a mat-stroked-button routerLink="/user-profile/education">199 ₽/мес для учёбы</a>
                </span>
              </div>
              <div class="ac-account-options">
                @for (option of accountOptions; track option.type) {
                  <button
                    type="button"
                    class="ac-account-option"
                    [class.ac-account-option-active]="currentAccountType() === option.type"
                    [disabled]="accountTypeSaving() !== null || currentAccountType() === option.type"
                    (click)="selectAccountType(option.type)">
                    <span class="ac-account-option__icon"><mat-icon>{{ option.icon }}</mat-icon></span>
                    <span class="ac-account-option__body">
                      <span class="ac-account-option__top">
                        <strong>{{ option.label }}</strong>
                        <em>{{ option.discountBadge }}</em>
                      </span>
                      <small>{{ option.description }}</small>
                      @if (option.serviceScope) {
                        <span class="ac-account-option__service">
                          <mat-icon>photo_camera</mat-icon>
                          {{ option.serviceScope }}
                        </span>
                      }
                      <span class="ac-account-option__prices">
                        <span>
                          <small>Документы</small>
                          <b>{{ option.documentExample }}</b>
                        </span>
                        <span>
                          <small>Фотопечать</small>
                          <b>{{ option.photoExample }}</b>
                        </span>
                      </span>
                      @if (option.useCases; as useCases) {
                        <span class="ac-account-option__usecases">
                          @for (useCase of useCases; track useCase) {
                            <span>{{ useCase }}</span>
                          }
                        </span>
                      }
                      <span class="ac-account-option__activation">{{ option.activationText }}</span>
                    </span>
                    @if (accountTypeSaving() === option.type) {
                      <mat-spinner diameter="18" />
                    } @else if (currentAccountType() === option.type) {
                      <mat-icon class="ac-account-option__check">check_circle</mat-icon>
                    }
                  </button>
                }
              </div>
            </div>
          </section>

          <!-- Секция: Уведомления -->
          <section class="ac-section">
            <div class="ac-section-header">
              <mat-icon>notifications</mat-icon>
              <h3>Уведомления</h3>
            </div>
            <div class="ac-section-body">
              <div class="ac-notifications">
                <div class="ac-notif-group">
                  <div class="ac-notif-group-title">Категории</div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <mat-icon class="ac-notif-icon">receipt_long</mat-icon>
                      <div>
                        <div class="ac-notif-name">Статус заказов</div>
                        <div class="ac-notif-desc">Уведомления о готовности, изменении статуса заказа</div>
                      </div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.orderStatus.value"
                      [attr.aria-pressed]="notifControls.orderStatus.value"
                      aria-label="Статус заказов"
                      (click)="toggleNotificationControl(notifControls.orderStatus)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <mat-icon class="ac-notif-icon">print</mat-icon>
                      <div>
                        <div class="ac-notif-name">Готовность печати</div>
                        <div class="ac-notif-desc">Уведомления когда ваш заказ напечатан и готов к выдаче</div>
                      </div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.printReady.value"
                      [attr.aria-pressed]="notifControls.printReady.value"
                      aria-label="Готовность печати"
                      (click)="toggleNotificationControl(notifControls.printReady)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <div class="ac-notif-name">Подтверждения записей</div>
                      <div class="ac-notif-desc">Статус ваших записей на фотосессии</div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.bookingConfirmation.value"
                      [attr.aria-pressed]="notifControls.bookingConfirmation.value"
                      aria-label="Подтверждения записей"
                      (click)="toggleNotificationControl(notifControls.bookingConfirmation)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <div class="ac-notif-name">Напоминания о записях</div>
                      <div class="ac-notif-desc">За день и за час до начала</div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.bookingReminders.value"
                      [attr.aria-pressed]="notifControls.bookingReminders.value"
                      aria-label="Напоминания о записях"
                      (click)="toggleNotificationControl(notifControls.bookingReminders)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <div class="ac-notif-name">Системные уведомления</div>
                      <div class="ac-notif-desc">Обновления и изменения сервиса</div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.systemUpdates.value"
                      [attr.aria-pressed]="notifControls.systemUpdates.value"
                      aria-label="Системные уведомления"
                      (click)="toggleNotificationControl(notifControls.systemUpdates)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <div class="ac-notif-name">Специальные предложения</div>
                      <div class="ac-notif-desc">Акции и скидки</div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.specialOffers.value"
                      [attr.aria-pressed]="notifControls.specialOffers.value"
                      aria-label="Специальные предложения"
                      (click)="toggleNotificationControl(notifControls.specialOffers)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                </div>

                <div class="ac-notif-group">
                  <div class="ac-notif-group-title">Способы доставки</div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <div class="ac-notif-name">Email</div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.emailNotifications.value"
                      [attr.aria-pressed]="notifControls.emailNotifications.value"
                      aria-label="Email"
                      (click)="toggleNotificationControl(notifControls.emailNotifications)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <div class="ac-notif-name">Push-уведомления</div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.pushNotifications.value"
                      [attr.aria-pressed]="notifControls.pushNotifications.value"
                      [disabled]="!isPushSupported()"
                      aria-label="Push-уведомления"
                      (click)="toggleNotificationControl(notifControls.pushNotifications, !isPushSupported())">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                  <div class="ac-notif-row">
                    <div class="ac-notif-info">
                      <div class="ac-notif-name">SMS</div>
                    </div>
                    <button type="button" class="ac-site-toggle"
                      [class.ac-site-toggle-on]="notifControls.smsNotifications.value"
                      [attr.aria-pressed]="notifControls.smsNotifications.value"
                      aria-label="SMS"
                      (click)="toggleNotificationControl(notifControls.smsNotifications)">
                      <span class="ac-site-toggle-thumb"></span>
                    </button>
                  </div>
                </div>

                <button mat-flat-button class="ac-notif-save" (click)="saveNotificationSettings()"
                  [disabled]="notifSaving()">
                  @if (notifSaving()) {
                    <mat-spinner diameter="18" />
                  } @else {
                    <mat-icon>save</mat-icon>
                  }
                  Сохранить
                </button>
              </div>
            </div>
          </section>

          <!-- Секция: Мессенджеры -->
          <section class="ac-section">
            <div class="ac-section-header">
              <mat-icon>chat</mat-icon>
              <h3>Мессенджеры</h3>
            </div>
            <div class="ac-section-body">
              @if (channelsLoading()) {
                <div class="ac-channels-loading">
                  <mat-spinner diameter="28" />
                </div>
              } @else {
                @if (accountPhone(); as phone) {
                  <div class="ac-phone-anchor">
                    <mat-icon>phone_iphone</mat-icon>
                    <div>
                      <span>Единый номер аккаунта</span>
                      <strong>{{ phone }}</strong>
                    </div>
                  </div>
                } @else {
                  <div class="ac-phone-anchor ac-phone-anchor-warning">
                    <mat-icon>warning</mat-icon>
                    <div>
                      <span>Привязка идет через телефон аккаунта</span>
                      <strong>Укажите номер в личных данных</strong>
                    </div>
                  </div>
                }

                <div class="ac-channels">
                  @for (ch of channelDefs; track ch.id) {
                    <div class="ac-channel">
                      <div class="ac-channel-info">
                        <div class="ac-channel-icon" [style.background]="ch.color + '1a'" [style.color]="ch.color">
                          <mat-icon [svgIcon]="ch.icon"></mat-icon>
                        </div>
                        <div class="ac-channel-text">
                          <span class="ac-channel-name">{{ ch.name }}</span>
                          @if (getLinkedChannel(ch.id); as linked) {
                            <span class="ac-channel-detail">
                              {{ linked.username ? '@' + linked.username : linked.display_name || 'Привязано' }}
                            </span>
                          }
                        </div>
                      </div>
                      <div class="ac-channel-actions">
                        @if (getLinkedChannel(ch.id)) {
                          <span class="ac-linked-badge">Привязано</span>
                          <button mat-button class="ac-unlink-btn"
                            [disabled]="channelLinking() === ch.id"
                            (click)="unlinkChannel(ch.id)">
                            @if (channelLinking() === ch.id) {
                              <mat-spinner diameter="16" />
                            } @else {
                              Отвязать
                            }
                          </button>
                        } @else {
                          @if (ch.id === 'max' || ch.id === 'instagram') {
                            <button mat-stroked-button class="ac-link-btn ac-link-external"
                              (click)="linkChannel(ch.id)">
                              <mat-icon>open_in_new</mat-icon> Написать нам
                            </button>
                          } @else {
                            <button mat-flat-button class="ac-link-btn"
                              [disabled]="channelLinking() !== null || !hasAccountPhone()"
                              [matTooltip]="!hasAccountPhone() ? 'Сначала укажите номер телефона в личных данных' : ''"
                              (click)="linkChannel(ch.id)">
                              @if (channelLinking() === ch.id) {
                                <mat-spinner diameter="16" />
                              } @else if (!hasAccountPhone()) {
                                Укажите телефон
                              } @else {
                                Привязать
                              }
                            </button>
                          }
                        }
                      </div>
                    </div>
                  }
                </div>

                <!-- Telegram deep link panel -->
                @if (telegramDeepLink()) {
                  <div class="ac-deep-link">
                    <div class="ac-deep-link-header">
                      <mat-icon class="ac-deep-link-icon">send</mat-icon>
                      <span>Привязка Telegram</span>
                      <button mat-icon-button class="ac-deep-link-close" (click)="telegramDeepLink.set(null)">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                    <p class="ac-deep-link-text">
                      Откройте бота в Telegram и нажмите <strong>Start</strong>.
                      После этого вернитесь сюда и нажмите "Проверить привязку".
                      Привязка будет закреплена за номером аккаунта.
                    </p>
                    @if (telegramLinkExpiry() > 0) {
                      <p class="ac-tg-expiry">
                        <mat-icon>timer</mat-icon>
                        Ссылка действительна: {{ formatExpiry(telegramLinkExpiry()) }}
                      </p>
                    }
                    <div class="ac-deep-link-actions">
                      <a mat-flat-button class="ac-open-tg-btn"
                        [href]="telegramDeepLink()" target="_blank" rel="noopener">
                        <mat-icon>open_in_new</mat-icon> Открыть Telegram
                      </a>
                      <button mat-stroked-button class="ac-check-btn"
                        [disabled]="channelLinking() === 'telegram' || telegramCheckCooldown()"
                        (click)="checkTelegramLink()">
                        @if (channelLinking() === 'telegram') {
                          <mat-spinner diameter="16" />
                        } @else if (telegramCheckCooldown()) {
                          <span class="ac-check-btn-content">
                            <mat-icon>hourglass_empty</mat-icon>
                            <span>Подождите...</span>
                          </span>
                        } @else {
                          <span class="ac-check-btn-content">
                            <mat-icon>refresh</mat-icon>
                            <span>Проверить привязку</span>
                          </span>
                        }
                      </button>
                    </div>
                  </div>
                }
              }
            </div>
          </section>

        </div>

        <!-- RIGHT column, Безопасность + Верификация -->
        <div class="ac-column-side">

          <!-- Секция: Безопасность -->
          <section class="ac-section">
            <div class="ac-section-header">
              <mat-icon>lock</mat-icon>
              <h3>Безопасность</h3>
            </div>
            <div class="ac-section-body">
              <div class="ac-security">
                <!-- Смена пароля -->
                <div class="ac-sec-item">
                  <div class="ac-sec-info">
                    <mat-icon class="ac-sec-icon">lock_reset</mat-icon>
                    <div>
                      <div class="ac-sec-title">Изменить пароль</div>
                      <div class="ac-sec-desc">Ссылка для смены пароля будет отправлена на ваш email</div>
                    </div>
                  </div>
                  <button mat-stroked-button class="ac-sec-btn" (click)="changePassword()">Изменить</button>
                </div>

                <!-- 2FA -->
                <div class="ac-sec-item">
                  <div class="ac-sec-info">
                    <mat-icon class="ac-sec-icon" [class.ac-icon-active]="is2FAEnabled()">verified_user</mat-icon>
                    <div>
                      <div class="ac-sec-title">Двухфакторная аутентификация</div>
                      <div class="ac-sec-desc">
                        @if (!authService.isPhoneVerified()) {
                          Сначала укажите телефон в секции «Личные данные»
                        } @else if (is2FAEnabled()) {
                          Включена, SMS-код при каждом входе
                        } @else {
                          Дополнительная защита аккаунта через SMS
                        }
                      </div>
                    </div>
                  </div>
                  <button type="button" class="ac-site-toggle ac-site-toggle-sec"
                    [class.ac-site-toggle-on]="is2FAEnabled()"
                    [attr.aria-pressed]="is2FAEnabled()"
                    [disabled]="!authService.isPhoneVerified() || twoFactorLoading()"
                    aria-label="Двухфакторная аутентификация"
                    (click)="toggle2FASwitch()">
                    <span class="ac-site-toggle-thumb"></span>
                  </button>
                </div>

                <!-- Удалить аккаунт -->
                <div class="ac-sec-item ac-danger-zone">
                  <div class="ac-sec-info">
                    <mat-icon class="ac-sec-icon ac-danger-icon">delete_forever</mat-icon>
                    <div>
                      <div class="ac-sec-title ac-danger-text">Удалить аккаунт</div>
                      <div class="ac-sec-desc">Все ваши данные будут безвозвратно удалены</div>
                    </div>
                  </div>
                  <button mat-stroked-button class="ac-sec-btn ac-danger-btn" (click)="deleteAccount()">Удалить</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Секция: Верификация -->
          <section class="ac-section">
            <div class="ac-section-header">
              <mat-icon>verified_user</mat-icon>
              <h3>Верификация</h3>
              @if (hasUnverified()) {
                <span class="ac-badge">!</span>
              }
            </div>
            <div class="ac-section-body">
              @let verifyUser = authService.currentUser();
              @if (verifyUser) {
                <div class="ac-verify">
                  <!-- Email -->
                  <div class="ac-verify-item">
                    <div class="ac-verify-icon">
                      @if (verifyUser.emailVerified || verifyUser.email_verified) {
                        <mat-icon class="ac-verified">check_circle</mat-icon>
                      } @else {
                        <mat-icon class="ac-unverified">cancel</mat-icon>
                      }
                    </div>
                    <div class="ac-verify-info">
                      <div class="ac-verify-label">Email</div>
                      <div class="ac-verify-value">{{ verifyUser.email }}</div>
                      @if (verifyUser.emailVerified || verifyUser.email_verified) {
                        <span class="ac-state-ok">Подтвержден</span>
                      } @else {
                        <span class="ac-state-pending">Не подтвержден</span>
                      }
                    </div>
                    @if (!(verifyUser.emailVerified || verifyUser.email_verified)) {
                      <button mat-stroked-button class="ac-verify-btn" (click)="sendEmailVerification()">
                        <mat-icon>send</mat-icon> Подтвердить
                      </button>
                    }
                  </div>

                  <!-- Phone -->
                  <div class="ac-verify-item">
                    <div class="ac-verify-icon">
                      @if (authService.isPhoneVerified()) {
                        <mat-icon class="ac-verified">check_circle</mat-icon>
                      } @else {
                        <mat-icon class="ac-unverified">cancel</mat-icon>
                      }
                    </div>
                    <div class="ac-verify-info">
                      <div class="ac-verify-label">Телефон</div>
                      <div class="ac-verify-value">{{ verifyUser.phone || 'Не указан' }}</div>
                      @if (authService.isPhoneVerified()) {
                        <span class="ac-state-ok">Привязан</span>
                      } @else {
                        <span class="ac-state-missing">Укажите телефон в секции «Личные данные»</span>
                      }
                    </div>
                  </div>

                  <!-- Phone code input -->
                  @if (phoneVerifyStep() === 'code_sent') {
                    <div class="ac-phone-code">
                      <p class="ac-phone-code-hint">
                        <mat-icon>smartphone</mat-icon>
                        Код отправлен на {{ verifyUser.phone }}
                      </p>
                      <div class="ac-phone-code-row">
                        <mat-form-field appearance="outline" class="ac-code-field">
                          <mat-label>Код из SMS</mat-label>
                          <input matInput
                            [formControl]="phoneCodeControl"
                            placeholder="123456"
                            maxlength="6"
                            inputmode="numeric"
                            autocomplete="one-time-code" />
                        </mat-form-field>
                        <button mat-flat-button class="ac-code-submit"
                          [disabled]="phoneCodeControl.invalid || phoneVerifyLoading()"
                          (click)="verifyPhoneCode()">
                          @if (phoneVerifyLoading()) {
                            <mat-spinner diameter="16" />
                          } @else {
                            <mat-icon>check</mat-icon>
                          }
                          Подтвердить
                        </button>
                      </div>
                      <div class="ac-code-bottom-row">
                        <button mat-button class="ac-code-resend"
                          [disabled]="phoneCodeCooldown()"
                          (click)="sendPhoneCode()">
                          @if (phoneCodeCooldown()) {
                            Повторить через {{ phoneCodeTimer() }}с
                          } @else {
                            Отправить код снова
                          }
                        </button>
                        <button mat-button class="ac-code-cancel" (click)="phoneVerifyStep.set('idle')">Отмена</button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </section>

        </div>
      </div>

      @if (isLoading()) {
        <div class="ac-loading-overlay">
          <mat-spinner diameter="36" />
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 0 32px;
      color-scheme: light;
      --ed-surface-container: #ffffff;
      --ed-surface-container-high: #f6f7fa;
      --ed-outline-variant: #e1e6ee;
      --ed-on-surface: #111318;
      --ed-on-surface-variant: #667085;
      --ed-on-surface-muted: #98a2b3;
      --ed-accent: #ff9900;
      --ed-error: #ef3124;
      --ed-success: #12b76a;
    }

    /* ===== Skeleton ===== */
    @keyframes skeleton-pulse {
      0%, 100% { opacity: 0.15; }
      50% { opacity: 0.3; }
    }
    .skeleton-pulse {
      animation: skeleton-pulse 1.5s ease-in-out infinite;
      background: rgba(245, 158, 11, 0.12);
      border-radius: 6px;
    }
    .skeleton-line { display: block; border-radius: 4px; }

    /* ===== Header ===== */
    .ac-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
      padding: 24px 0 0;
    }

    .ac-title {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .ac-subtitle {
      margin: 4px 0 0;
      font-size: 14px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    /* ===== Avatar ===== */
    .ac-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--ed-surface-container, #1a1a1a);
      overflow: hidden;
      cursor: pointer;
      position: relative;
      flex-shrink: 0;
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      transition: border-color 0.2s;

      &:hover, &:focus-within, &:focus {
        border-color: var(--ed-accent, #f59e0b);
        .ac-avatar-overlay { opacity: 1; }
      }

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .ac-avatar-placeholder {
      font-size: 40px !important;
      width: 40px !important;
      height: 40px !important;
      color: var(--ed-on-surface-variant, #666);
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }

    .ac-avatar-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s;

      mat-icon { color: #fff; font-size: 20px; }
    }

    /* ===== Grid layout ===== */
    .ac-grid {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 24px;
      align-items: start;
    }

    @media (max-width: 1200px) {
      .ac-grid {
        grid-template-columns: 1fr;
      }
    }

    /* ===== Sections ===== */
    .ac-section {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 16px 38px rgba(17, 24, 39, 0.08);
      margin-bottom: 24px;
    }

    .ac-section-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .ac-section-header mat-icon {
      color: var(--ed-accent, #f59e0b);
    }

    .ac-section-header h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    /* ===== Badge ===== */
    .ac-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--ed-error, #ef4444);
      color: white;
      font-size: 11px;
      font-weight: 700;
      margin-left: 8px;
    }

    /* ===== Profile fields ===== */
    .ac-fields {
      display: flex;
      flex-direction: column;
    }

    .ac-field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 8px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      min-height: 52px;
      border-radius: 8px;
      transition: background 0.2s;

      &:last-child { border-bottom: none; }
      &:hover { background: #f8fafc; }
    }

    .ac-field-saving { opacity: 0.6; }

    .ac-field-display {
      flex: 1;
      min-width: 0;
      cursor: pointer;
    }

    .ac-field-label {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 4px;
      font-weight: 500;
    }

    .ac-field-value {
      font-size: 15px;
      color: var(--ed-on-surface, #f5f5f5);
      word-break: break-word;
    }

    .ac-field-empty {
      font-size: 15px;
      color: var(--ed-on-surface-muted, #666);
      font-style: italic;
    }

    .ac-field-hint {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--ed-on-surface-muted, #666);
      margin-top: 2px;
    }

    .lock-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .ac-edit-btn {
      flex-shrink: 0;
      color: var(--ed-on-surface-variant, #888);
      &:hover { color: var(--ed-accent, #f59e0b); }
      mat-icon { font-size: 18px; }
    }

    .ac-field-edit {
      flex: 1;
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }

    .ac-field-input { flex: 1; }

    .ac-field-actions {
      display: flex;
      flex-shrink: 0;
      padding-top: 4px;
    }

    .ac-confirm-btn { color: #22c55e; }
    .ac-cancel-btn { color: var(--ed-on-surface-variant, #888); }

    /* ===== Account type ===== */
    .ac-account-notice {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr);
      align-items: start;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      border: 1px solid rgba(245, 158, 11, 0.24);
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.08);
    }

    .ac-account-notice__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.16);
      color: var(--ed-accent, #f59e0b);
    }

    .ac-account-notice__text {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .ac-account-notice__text strong {
      font-size: 14px;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .ac-account-notice__text small {
      color: var(--ed-on-surface-variant, #888);
      line-height: 1.35;
    }

    .ac-account-notice__actions {
      grid-column: 2;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    .ac-account-notice__actions a {
      flex: 0 1 200px;
      min-height: 36px;
      border-radius: 8px;
      white-space: normal;
      text-align: center;
      line-height: 1.2;
      justify-content: center;
    }

    .ac-account-notice__actions a.mat-mdc-unelevated-button {
      background: var(--ed-accent, #f59e0b) !important;
      color: #111318 !important;
    }

    .ac-account-notice__actions a.mat-mdc-outlined-button {
      --mdc-outlined-button-label-text-color: #344054;
      --mdc-outlined-button-outline-color: rgba(52, 64, 84, 0.65);
      color: #344054 !important;
    }

    .ac-account-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
    }

    .ac-account-option {
      width: 100%;
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr);
      align-items: start;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 8px;
      background: #ffffff;
      color: var(--ed-on-surface, #111318);
      text-align: left;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s, transform 0.2s;

      &:hover:not(:disabled), &:focus-visible {
        border-color: var(--ed-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.08);
        transform: translateY(-1px);
      }

      &:disabled {
        cursor: default;
        opacity: 0.85;
      }
    }

    .ac-account-option-active {
      border-color: rgba(255, 153, 0, 0.55);
      background: #fff8ec;
    }

    .ac-account-option__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: rgba(96, 165, 250, 0.12);
      color: #60a5fa;
    }

    .ac-account-option__body {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .ac-account-option__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      flex-wrap: wrap;
    }

    .ac-account-option__top strong {
      font-size: 14px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }

    .ac-account-option__top em {
      font-style: normal;
      font-size: 12px;
      font-weight: 700;
      color: #34d399;
      white-space: nowrap;
    }

    .ac-account-option__body small {
      color: var(--ed-on-surface-variant, #888);
      line-height: 1.35;
    }

    .ac-account-option__service {
      display: inline-flex;
      align-items: flex-start;
      gap: 6px;
      padding: 7px 8px;
      border-radius: 7px;
      background: #fff7e6;
      color: #7c4a03;
      font-size: 12px;
      font-weight: 750;
      line-height: 1.35;
      overflow-wrap: anywhere;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
        color: #f59e0b;
        flex: 0 0 auto;
      }
    }

    .ac-account-option__prices {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .ac-account-option__prices span {
      min-width: 0;
      display: grid;
      gap: 2px;
      padding: 7px 8px;
      border-radius: 7px;
      background: var(--ed-surface-container-high, #f6f7fa);
      color: var(--ed-on-surface, #111318);
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    .ac-account-option__prices small {
      color: var(--ed-on-surface-variant, #667085);
      font-size: 10px;
      font-weight: 700;
    }

    .ac-account-option__prices b {
      color: var(--ed-on-surface, #111318);
      font-size: 12px;
      font-weight: 900;
    }

    .ac-account-option__usecases {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;

      span {
        min-height: 22px;
        padding: 3px 7px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.12);
        color: #9a5b00;
        font-size: 11px;
        font-weight: 750;
        line-height: 1.25;
      }
    }

    .ac-account-option__activation {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 4px 8px;
      border-radius: 6px;
      background: #eafaf1;
      color: #087443;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .ac-account-option__check {
      grid-column: 2;
      justify-self: end;
      color: #12b76a;
    }

    .ac-account-option mat-spinner {
      grid-column: 2;
      justify-self: end;
    }

    /* ===== Security ===== */
    .ac-security {
      display: flex;
      flex-direction: column;
    }

    .ac-sec-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);

      &:last-child { border-bottom: none; }
    }

    .ac-sec-info {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .ac-sec-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--ed-accent, #f59e0b);
      flex-shrink: 0;
      margin-top: 2px;
    }

    .ac-sec-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 2px;
    }

    .ac-sec-desc {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #888);
      line-height: 1.4;
    }

    .ac-sec-btn {
      border-color: var(--ed-outline-variant, #2a2a2a) !important;
      color: var(--ed-on-surface-variant, #888) !important;
      white-space: nowrap;
      flex-shrink: 0;
      font-size: 13px;

      &:hover:not([disabled]) {
        border-color: var(--ed-accent, #f59e0b) !important;
        color: var(--ed-accent, #f59e0b) !important;
      }
    }

    .ac-icon-active { color: var(--ed-accent, #f59e0b) !important; }
    .ac-danger-icon { color: var(--ed-error, #ef4444) !important; }
    .ac-danger-text { color: var(--ed-error, #ef4444) !important; }
    .ac-danger-btn:hover:not([disabled]) {
      border-color: var(--ed-error, #ef4444) !important;
      color: var(--ed-error, #ef4444) !important;
    }

    /* ===== Verification ===== */
    .ac-verify {
      display: flex;
      flex-direction: column;
    }

    .ac-verify-item {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);

      &:last-child { border-bottom: none; }
    }

    .ac-verify-icon { flex-shrink: 0; margin-top: 2px; }
    .ac-verified { color: var(--ed-success, #22c55e); font-size: 24px; }
    .ac-unverified { color: var(--ed-on-surface-variant, #888); font-size: 24px; }

    .ac-verify-info { flex: 1; min-width: 0; }

    .ac-verify-label {
      font-size: 12px;
      color: var(--ed-accent, #f59e0b);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }

    .ac-verify-value {
      font-size: 14px;
      color: var(--ed-on-surface, #f5f5f5);
      font-weight: 500;
      margin-bottom: 4px;
    }

    .ac-state-ok { font-size: 12px; color: var(--ed-success, #22c55e); }
    .ac-state-pending { font-size: 12px; color: var(--ed-accent, #f59e0b); }
    .ac-state-missing { font-size: 12px; color: var(--ed-on-surface-variant, #888); }

    .ac-verify-btn {
      border-color: var(--ed-outline-variant, #2a2a2a) !important;
      color: var(--ed-on-surface-variant, #888) !important;
      font-size: 13px;
      flex-shrink: 0;

      mat-icon { font-size: 16px; margin-right: 4px; }
      &:hover:not([disabled]) {
        border-color: var(--ed-accent, #f59e0b) !important;
        color: var(--ed-accent, #f59e0b) !important;
      }
    }

    /* Phone code */
    .ac-phone-code {
      margin-top: 12px;
      padding: 16px;
      background: rgba(245, 158, 11, 0.04);
      border: 1px solid rgba(245, 158, 11, 0.15);
      border-radius: 12px;
    }

    .ac-phone-code-hint {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--ed-on-surface-variant, #888);
      font-size: 13px;
      margin: 0 0 12px;

      mat-icon { font-size: 16px; color: var(--ed-accent, #f59e0b); }
    }

    .ac-phone-code-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .ac-code-field { width: 160px; flex-shrink: 0; }

    .ac-code-submit {
      background: var(--ed-accent, #f59e0b) !important;
      color: #111 !important;
      font-weight: 700;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .ac-code-cancel {
      margin-top: 8px;
      font-size: 13px;
      color: var(--ed-on-surface-variant, #888) !important;
    }

    /* ===== Notifications ===== */
    .ac-notifications {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .ac-notif-group-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--ed-on-surface-variant, #888);
      font-weight: 700;
      margin-bottom: 8px;
    }

    .ac-notif-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      gap: 12px;

      &:last-child { border-bottom: none; }
    }

    .ac-notif-info { flex: 1; min-width: 0; }

    .ac-notif-name {
      font-size: 14px;
      color: var(--ed-on-surface, #f5f5f5);
      font-weight: 500;
    }

    .ac-notif-desc {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #888);
      margin-top: 2px;
    }

    .ac-notif-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--ed-accent, #f59e0b);
      flex-shrink: 0;
      margin-right: 10px;
    }

    .ac-site-toggle {
      position: relative;
      width: 46px;
      height: 26px;
      padding: 0;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 999px;
      background: var(--ed-surface-container-high, #232323);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.18s ease, border-color 0.18s ease, opacity 0.18s ease;

      &:focus-visible {
        outline: 2px solid rgba(245, 158, 11, 0.45);
        outline-offset: 2px;
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
    }

    .ac-site-toggle-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--ed-on-surface-variant, #9ca3af);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      transition: transform 0.18s ease, background 0.18s ease;
    }

    .ac-site-toggle-on {
      border-color: rgba(245, 158, 11, 0.48);
      background: rgba(245, 158, 11, 0.18);

      .ac-site-toggle-thumb {
        transform: translateX(20px);
        background: var(--ed-accent, #f59e0b);
      }
    }

    .ac-site-toggle-sec {
      align-self: center;
    }

    .ac-notif-save {
      background: var(--ed-accent, #f59e0b) !important;
      color: #111 !important;
      font-weight: 700;
      border-radius: 12px;
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ===== Channels ===== */
    .ac-channels-loading {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    .ac-channels {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ac-phone-anchor {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);

      mat-icon {
        color: var(--ed-accent, #f59e0b);
        flex-shrink: 0;
      }

      span {
        display: block;
        margin-bottom: 2px;
        font-size: 12px;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }

      strong {
        display: block;
        font-size: 14px;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
      }
    }

    .ac-phone-anchor-warning {
      background: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.22);

      mat-icon {
        color: var(--ed-error, #ef4444);
      }
    }

    .ac-channel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px;
      border-radius: 12px;
      background: var(--ed-surface-container-high, #222);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      margin-bottom: 4px;
      transition: all 0.2s ease;

      &:hover {
        border-color: #cfd6df;
        box-shadow: 0 8px 20px rgba(17, 24, 39, 0.08);
      }
    }

    .ac-channel-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .ac-channel-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      flex-shrink: 0;

      mat-icon { font-size: 24px; width: 24px; height: 24px; }
    }

    .ac-channel-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .ac-channel-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .ac-channel-detail {
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .ac-channel-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .ac-linked-badge {
      font-size: 0.75rem;
      font-weight: 600;
      color: #22c55e;
      background: rgba(34, 197, 94, 0.15);
      padding: 4px 10px;
      border-radius: 100px;
    }

    .ac-link-btn {
      background: var(--ed-accent, #f59e0b) !important;
      color: #000 !important;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      min-width: 100px;
      height: 34px;
    }

    .ac-link-external {
      background: transparent !important;
      border-color: var(--ed-outline-variant, #2a2a2a) !important;
      color: var(--ed-on-surface-variant, #999) !important;
      font-size: 13px;
      font-weight: 500;

      mat-icon { font-size: 16px; margin-right: 4px; }
      &:hover {
        border-color: var(--ed-accent, #f59e0b) !important;
        color: var(--ed-accent, #f59e0b) !important;
      }
    }

    .ac-unlink-btn {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #999) !important;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 8px;
      min-width: 80px;
      height: 34px;

      &:hover {
        color: var(--ed-error, #ef4444) !important;
        border-color: var(--ed-error, #ef4444);
      }
    }

    /* Deep link */
    .ac-deep-link {
      margin-top: 16px;
      padding: 16px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);
      border-radius: 12px;
    }

    .ac-deep-link-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin-bottom: 8px;

      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }

    .ac-deep-link-icon {
      color: var(--ed-accent, #f59e0b);
    }

    .ac-deep-link-close {
      margin-left: auto;
      width: 28px !important;
      height: 28px !important;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .ac-deep-link-text {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #bbb);
      margin: 0 0 12px;
      line-height: 1.5;
    }

    .ac-deep-link-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .ac-open-tg-btn {
      background: var(--ed-accent, #f59e0b) !important;
      color: #000 !important;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      text-decoration: none;
      height: 36px;
      mat-icon { font-size: 18px; margin-right: 4px; }
    }

    .ac-check-btn {
      font-size: 13px;
      border-radius: 8px;
      color: var(--ed-on-surface-variant, #bbb) !important;
      height: 36px;
    }

    .ac-check-btn-content {
      display: inline-flex;
      align-items: center;
      gap: 4px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    /* Telegram expiry */
    .ac-tg-expiry {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--ed-accent, #f59e0b);
      margin: 0 0 12px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    /* Phone code resend */
    .ac-code-bottom-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .ac-code-resend {
      font-size: 13px;
      color: var(--ed-accent, #f59e0b) !important;

      &:disabled { color: var(--ed-on-surface-variant, #888) !important; }
    }

    /* ===== Loading overlay ===== */
    .ac-loading-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.4);
      z-index: 100;
    }

    /* ===== Form field theming ===== */
    ::ng-deep .account-center {
      .mat-mdc-form-field {
        --mdc-outlined-text-field-outline-color: var(--ed-outline-variant, #2a2a2a);
        --mdc-outlined-text-field-hover-outline-color: #cfd6df;
        --mdc-outlined-text-field-focus-outline-color: var(--ed-accent, #f59e0b);
        --mdc-outlined-text-field-label-text-color: var(--ed-on-surface-variant, #888);
        --mdc-outlined-text-field-input-text-color: var(--ed-on-surface, #f5f5f5);
      }
    }

    /* ===== Responsive ===== */
    @media (max-width: 900px) {
      .ac-account-options {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 600px) {
      :host { padding: 16px 12px 32px; }
      .ac-header h2 { font-size: 20px; }
      .ac-header { padding: 0 4px; }
      .ac-avatar { width: 48px; height: 48px; }
      .ac-section { padding: 16px; }

      .ac-account-notice {
        grid-template-columns: 40px minmax(0, 1fr);
      }

      .ac-account-notice__actions {
        grid-column: 1 / -1;
        justify-content: stretch;
      }

      .ac-account-notice__actions a {
        flex: 1 1 100%;
        justify-content: center;
      }

      .ac-account-option {
        grid-template-columns: 40px minmax(0, 1fr);
      }

      .ac-account-option__prices {
        grid-template-columns: 1fr;
      }

      .ac-account-option mat-spinner,
      .ac-account-option__check {
        grid-column: 2;
        justify-self: end;
      }

      .ac-sec-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        .ac-sec-btn { align-self: flex-end; }
      }

      .ac-verify-item {
        flex-wrap: wrap;
        .ac-verify-btn { margin-left: 38px; }
      }

      .ac-phone-code-row {
        flex-direction: column;
        .ac-code-field { width: 100%; }
      }

      .ac-channel {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }

      .ac-channel-actions { justify-content: flex-end; }

      .ac-deep-link-actions { flex-direction: column; }
      .ac-open-tg-btn, .ac-check-btn { width: 100%; justify-content: center; }
    }
  `],
})
export class AccountCenterComponent implements OnDestroy {
  protected readonly authService = inject(AuthService);
  private readonly fileStorageService = inject(FileStorageService);
  private readonly notificationApiService = inject(NotificationApiService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly platformId = inject(PLATFORM_ID);

  // Loading
  protected readonly isLoading = signal(false);
  protected readonly profileLoaded = signal(false);

  // Inline edit
  protected readonly editingField = signal<string | null>(null);
  protected readonly savingField = signal<string | null>(null);

  // Account type
  protected readonly accountTypeSaving = signal<CustomerAccountType | null>(null);
  protected readonly accountOptions = ACCOUNT_TYPE_OPTIONS;
  protected readonly currentAccountType = computed<CustomerAccountType>(() =>
    this.authService.currentUser()?.account_type
      ?? this.authService.currentUser()?.accountType
      ?? 'personal',
  );

  // Phone verify
  protected readonly phoneVerifyStep = signal<'idle' | 'code_sent'>('idle');
  protected readonly phoneVerifyLoading = signal(false);
  protected readonly phoneCodeCooldown = signal(false);
  protected readonly phoneCodeTimer = signal(0);
  readonly phoneCodeControl = new FormControl('', [
    Validators.required,
    Validators.minLength(6),
    Validators.maxLength(6),
    Validators.pattern(/^\d{6}$/),
  ]);

  // 2FA
  protected readonly is2FAEnabled = signal(false);
  protected readonly twoFactorLoading = signal(false);

  // Notifications
  protected readonly notifSaving = signal(false);
  protected readonly isPushSupported = signal(false);
  readonly notifControls = {
    orderStatus: new FormControl(true),
    printReady: new FormControl(true),
    bookingConfirmation: new FormControl(true),
    bookingReminders: new FormControl(true),
    systemUpdates: new FormControl(true),
    specialOffers: new FormControl(false),
    emailNotifications: new FormControl(true),
    pushNotifications: new FormControl(false),
    smsNotifications: new FormControl(false),
  };

  // Channels
  protected readonly channels = signal<LinkedChannel[]>([]);
  protected readonly channelsLoading = signal(true);
  protected readonly channelLinking = signal<string | null>(null);
  protected readonly telegramDeepLink = signal<string | null>(null);
  protected readonly telegramCheckCooldown = signal(false);
  protected readonly telegramLinkExpiry = signal(0);
  readonly channelDefs = CHANNEL_DEFS;

  protected readonly accountPhone = computed(() => this.authService.currentUser()?.phone?.trim() ?? '');
  protected readonly hasAccountPhone = computed(() => this.accountPhone().length > 0);

  protected readonly linkedMap = computed(() => {
    const map = new Map<string, LinkedChannel>();
    for (const ch of this.channels()) {
      map.set(ch.channel, ch);
    }
    return map;
  });

  protected readonly hasUnverified = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return false;
    const emailOk = user.emailVerified || user.email_verified;
    const phoneOk = this.authService.isPhoneVerified();
    return !emailOk || !phoneOk;
  });

  // Profile form
  readonly profileForm: FormGroup = this.fb.group({
    displayName: [''],
    email: [{ value: '', disabled: true }],
    phoneNumber: ['', [Validators.required, Validators.pattern(/^\+?[0-9\s\-()]{10,15}$/)]],
    firstName: [''],
    lastName: [''],
    dateOfBirth: [null as Date | null],
  });

  readonly editControls = {
    firstName: new FormControl(''),
    lastName: new FormControl(''),
    displayName: new FormControl(''),
    phoneNumber: new FormControl('', [Validators.required, Validators.pattern(/^\+?[0-9\s\-()]{10,15}$/)]),
    dateOfBirth: new FormControl<Date | null>(null),
  };

  readonly profileFields = [
    { key: 'firstName', label: 'Имя', placeholder: 'Иван', readonly: false },
    { key: 'lastName', label: 'Фамилия', placeholder: 'Иванов', readonly: false },
    { key: 'displayName', label: 'Отображаемое имя', placeholder: 'Как отображать ваше имя', readonly: false },
    { key: 'email', label: 'Email', placeholder: '', readonly: true },
    { key: 'phoneNumber', label: 'Номер телефона', placeholder: '+7 (999) 123-45-67', readonly: false },
    { key: 'dateOfBirth', label: 'Дата рождения', placeholder: '', readonly: false },
  ];

  constructor() {
    effect(() => {
      const currentUser = this.authService.currentUser();
      if (currentUser) {
        this.profileLoaded.set(true);
        this.is2FAEnabled.set(currentUser.two_factor_enabled ?? false);
        this.profileForm.patchValue({
          displayName: currentUser.displayName || currentUser.display_name || '',
          email: currentUser.email || '',
          phoneNumber: currentUser.phone || '',
          firstName: currentUser.personal_data?.firstName || currentUser.first_name || '',
          lastName: currentUser.personal_data?.lastName || currentUser.last_name || '',
          dateOfBirth: currentUser.personal_data?.dateOfBirth
            ? new Date(currentUser.personal_data.dateOfBirth)
            : null,
        });
      }
    });

    if (isPlatformBrowser(this.platformId)) {
      this.isPushSupported.set('Notification' in window);
      this.loadChannels();
      this.loadNotificationSettings();
    }
  }

  // ===== Profile inline edit =====

  getEditControl(key: string): FormControl {
    return this.editControls[key as keyof typeof this.editControls] as FormControl;
  }

  startEdit(fieldKey: string): void {
    const currentValue = this.profileForm.get(fieldKey)?.value;
    const control = this.editControls[fieldKey as keyof typeof this.editControls];
    if (control) {
      control.setValue(currentValue);
    }
    this.editingField.set(fieldKey);
  }

  cancelEdit(): void {
    this.editingField.set(null);
  }

  confirmField(fieldKey: string): void {
    const control = this.editControls[fieldKey as keyof typeof this.editControls];
    if (!control || control.invalid) return;

    const newValue = control.value;
    const oldValue = this.profileForm.get(fieldKey)?.value;

    if (newValue === oldValue) {
      this.editingField.set(null);
      return;
    }

    this.savingField.set(fieldKey);
    const payload = this.buildFieldPayload(fieldKey, newValue);

    this.authService.updateUserProfile(payload).pipe(
      finalize(() => this.savingField.set(null)),
    ).subscribe({
      next: (profile) => {
        this.profileForm.get(fieldKey)?.setValue(this.readUpdatedFieldValue(fieldKey, profile, newValue));
        this.editingField.set(null);
        this.snackBar.open('Сохранено', '', { duration: 2000 });
      },
      error: (err) => this.handleError(err, 'Ошибка сохранения'),
    });
  }

  formatDate(value: Date | string | null | undefined): string {
    if (!value) return 'Не указана';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return 'Не указана';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ===== Avatar =====

  openAvatarUpload(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      const sheetRef = this.bottomSheet.open(AvatarBottomSheetComponent);
      sheetRef.afterDismissed().subscribe((action: AvatarAction | undefined) => {
        if (action) this.handleAvatarAction(action);
      });
    } else {
      const dialogRef = this.dialog.open(AvatarUploadDialogComponent, {
        width: '500px',
        data: { userId: this.authService.currentUser()?.id || this.authService.currentUser()?.uid },
      });
      dialogRef.afterClosed().subscribe((result) => {
        if (result) {
          this.snackBar.open('Фото профиля обновлено', '', { duration: 3000 });
        }
      });
    }
  }

  // ===== Security =====

  changePassword(): void {
    const email = this.authService.currentUser()?.email;
    if (!email) return;

    this.isLoading.set(true);
    this.authService.sendPasswordResetEmail(email).subscribe({
      next: () => this.snackBar.open('Ссылка для смены пароля отправлена на email', '', { duration: 5000 }),
      error: (err) => this.handleError(err, 'Ошибка отправки'),
      complete: () => this.isLoading.set(false),
    });
  }

  toggle2FA(enabled: boolean): void {
    this.twoFactorLoading.set(true);
    const action = enabled
      ? this.authService.enable2FA('sms')
      : this.authService.disable2FA();

    action.pipe(
      finalize(() => this.twoFactorLoading.set(false)),
    ).subscribe({
      next: () => {
        this.is2FAEnabled.set(enabled);
        this.snackBar.open(enabled ? '2FA включена' : '2FA отключена', '', { duration: 3000 });
      },
      error: (err) => {
        this.snackBar.open(readErrorMessage(err, 'Ошибка 2FA'), '', { duration: 5000 });
      },
    });
  }

  toggle2FASwitch(): void {
    if (!this.authService.isPhoneVerified() || this.twoFactorLoading()) return;
    this.toggle2FA(!this.is2FAEnabled());
  }

  selectAccountType(accountType: CustomerAccountType): void {
    if (this.currentAccountType() === accountType || this.accountTypeSaving() !== null) return;

    this.accountTypeSaving.set(accountType);
    this.authService.updateUserProfile({ account_type: accountType }).pipe(
      finalize(() => this.accountTypeSaving.set(null)),
    ).subscribe({
      next: () => {
        this.snackBar.open('Тип аккаунта обновлён', '', { duration: 2500 });
      },
      error: (err) => this.handleError(err, 'Не удалось обновить тип аккаунта'),
    });
  }

  deleteAccount(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Удаление аккаунта',
        message: 'Вы уверены, что хотите удалить свой аккаунт? <strong>Это действие нельзя отменить.</strong>',
        confirmButtonText: 'Удалить аккаунт',
        cancelButtonText: 'Отмена',
        type: 'danger',
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.isLoading.set(true);
        this.authService.deleteAccount().subscribe({
          next: () => {
            this.snackBar.open('Аккаунт удален', '', { duration: 3000 });
            this.router.navigate(['/']);
          },
          error: (err) => this.handleError(err, 'Ошибка удаления'),
          complete: () => this.isLoading.set(false),
        });
      }
    });
  }

  // ===== Verification =====

  sendEmailVerification(): void {
    this.isLoading.set(true);
    this.authService.sendEmailVerification().subscribe({
      next: () => this.snackBar.open('Письмо с подтверждением отправлено', '', { duration: 5000 }),
      error: (err) => this.handleError(err, 'Ошибка отправки'),
      complete: () => this.isLoading.set(false),
    });
  }

  sendPhoneCode(): void {
    const phone = this.authService.currentUser()?.phone;
    if (!phone) return;

    this.phoneVerifyLoading.set(true);
    this.authService.sendPhoneCode(phone, 'phone_verify').pipe(
      finalize(() => this.phoneVerifyLoading.set(false)),
    ).subscribe({
      next: () => {
        this.phoneVerifyStep.set('code_sent');
        this.phoneCodeControl.reset();
        this.snackBar.open(`Код отправлен на ${phone}`, '', { duration: 4000 });
        this.startPhoneCodeCooldown();
      },
      error: (err) => {
        this.snackBar.open(readErrorMessage(err, 'Ошибка отправки кода'), '', { duration: 5000 });
      },
    });
  }

  verifyPhoneCode(): void {
    const phone = this.authService.currentUser()?.phone;
    const code = this.phoneCodeControl.value?.trim();
    if (!phone || !code) return;

    this.phoneVerifyLoading.set(true);
    this.authService.verifyPhone(phone, code).pipe(
      finalize(() => this.phoneVerifyLoading.set(false))
    ).subscribe({
      next: () => {
        this.phoneVerifyStep.set('idle');
        this.phoneCodeControl.reset();
        this.snackBar.open('Телефон подтвержден!', '', { duration: 4000 });
      },
      error: (err) => {
        this.snackBar.open(readErrorMessage(err, 'Неверный код'), '', { duration: 5000 });
      },
    });
  }

  // ===== Notifications =====

  saveNotificationSettings(): void {
    this.notifSaving.set(true);
    const settings: Partial<NotificationSettings> = {
      orderStatus: this.notifControls.orderStatus.value ?? true,
      printReady: this.notifControls.printReady.value ?? true,
      bookingConfirmation: this.notifControls.bookingConfirmation.value ?? true,
      bookingReminders: this.notifControls.bookingReminders.value ?? true,
      systemUpdates: this.notifControls.systemUpdates.value ?? true,
      specialOffers: this.notifControls.specialOffers.value ?? false,
      emailNotifications: this.notifControls.emailNotifications.value ?? true,
      pushNotifications: this.notifControls.pushNotifications.value ?? false,
      smsNotifications: this.notifControls.smsNotifications.value ?? false,
    };

    this.notificationApiService.updateNotificationSettings(settings).pipe(
      finalize(() => this.notifSaving.set(false)),
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open('Настройки уведомлений сохранены', '', { duration: 3000 });
        } else {
          this.snackBar.open('Ошибка сохранения', '', { duration: 3000 });
        }
      },
      error: () => this.snackBar.open('Ошибка сохранения настроек', '', { duration: 3000 }),
    });
  }

  toggleNotificationControl(control: FormControl<boolean | null>, disabled = false): void {
    if (disabled || control.disabled) return;
    control.setValue(!(control.value ?? false));
  }

  // ===== Channels =====

  getLinkedChannel(channelId: string): LinkedChannel | undefined {
    return this.linkedMap().get(channelId);
  }

  linkChannel(channelId: string): void {
    if (channelId === 'max') {
      window.open('https://ok.ru/magnus_photo', '_blank', 'noopener');
      this.snackBar.open('Напишите в наш чат МАКС для привязки', 'OK', { duration: 5000 });
      return;
    }

    if (channelId === 'instagram') {
      window.open('https://instagram.com/magnus_photo', '_blank', 'noopener');
      this.snackBar.open('Напишите в наш Instagram для привязки', 'OK', { duration: 5000 });
      return;
    }

    if (!this.hasAccountPhone()) {
      this.snackBar.open('Сначала укажите номер телефона в личных данных', 'OK', { duration: 5000 });
      return;
    }

    this.channelLinking.set(channelId);

    if (channelId === 'telegram') {
      this.http.post<ChannelLinkResponse>('/api/account/channels/link/telegram', {}).subscribe({
        next: (res) => {
          this.channelLinking.set(null);
          if (res.linked || res.channel) {
            this.telegramDeepLink.set(null);
            if (res.channel) this.upsertLinkedChannel(res.channel);
            this.loadChannels();
            this.snackBar.open('Telegram привязан!', '', { duration: 3000 });
          } else if (res.deepLink) {
            this.telegramDeepLink.set(res.deepLink);
            this.startTelegramExpiry(res.expiresInSeconds);
          }
        },
        error: (err) => {
          this.channelLinking.set(null);
          this.snackBar.open(readErrorMessage(err, 'Ошибка привязки Telegram'), '', { duration: 5000 });
        },
      });
    } else {
      this.http.post<ChannelLinkResponse>(`/api/account/channels/link/${channelId}`, {}).subscribe({
        next: (res) => {
          this.channelLinking.set(null);
          if (res.linked || res.channel) {
            if (res.channel) this.upsertLinkedChannel(res.channel);
            this.loadChannels();
            this.snackBar.open('Канал привязан', '', { duration: 3000 });
          } else {
            this.snackBar.open(res.message || 'Не удалось привязать', 'OK', { duration: 5000 });
          }
        },
        error: (err) => {
          this.channelLinking.set(null);
          this.snackBar.open(readErrorMessage(err, 'Ошибка привязки'), '', { duration: 5000 });
        },
      });
    }
  }

  unlinkChannel(channelId: string): void {
    this.channelLinking.set(channelId);
    this.http.delete(`/api/account/channels/${channelId}`).subscribe({
      next: () => {
        this.channelLinking.set(null);
        this.channels.update(list => list.filter(c => c.channel !== channelId));
        if (channelId === 'telegram') this.telegramDeepLink.set(null);
        this.snackBar.open('Канал отвязан', '', { duration: 3000 });
      },
      error: () => {
        this.channelLinking.set(null);
        this.snackBar.open('Ошибка при отвязке', '', { duration: 3000 });
      },
    });
  }

  checkTelegramLink(): void {
    this.telegramCheckCooldown.set(true);
    this.refreshChannels();
    setTimeout(() => this.telegramCheckCooldown.set(false), 10000);
  }

  refreshChannels(): void {
    this.channelLinking.set('telegram');
    this.loadChannels(() => {
      this.channelLinking.set(null);
      const tg = this.linkedMap().get('telegram');
      if (tg) {
        this.telegramDeepLink.set(null);
        this.snackBar.open('Telegram привязан!', '', { duration: 3000 });
      } else {
        this.snackBar.open('Пока не привязано. Нажмите Start в боте и попробуйте снова.', 'OK', { duration: 5000 });
      }
    });
  }

  formatExpiry(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ===== Private =====

  private telegramExpiryInterval: ReturnType<typeof setInterval> | null = null;
  private phoneCodeInterval: ReturnType<typeof setInterval> | null = null;

  ngOnDestroy(): void {
    if (this.telegramExpiryInterval) clearInterval(this.telegramExpiryInterval);
    if (this.phoneCodeInterval) clearInterval(this.phoneCodeInterval);
  }

  private startTelegramExpiry(seconds = 600): void {
    if (this.telegramExpiryInterval) clearInterval(this.telegramExpiryInterval);
    this.telegramLinkExpiry.set(seconds);
    this.telegramExpiryInterval = setInterval(() => {
      const current = this.telegramLinkExpiry();
      if (current <= 0) {
        clearInterval(this.telegramExpiryInterval!);
        this.telegramExpiryInterval = null;
        return;
      }
      this.telegramLinkExpiry.set(current - 1);
    }, 1000);
  }

  private startPhoneCodeCooldown(): void {
    if (this.phoneCodeInterval) clearInterval(this.phoneCodeInterval);
    this.phoneCodeCooldown.set(true);
    this.phoneCodeTimer.set(60);
    this.phoneCodeInterval = setInterval(() => {
      const t = this.phoneCodeTimer();
      if (t <= 0) {
        clearInterval(this.phoneCodeInterval!);
        this.phoneCodeInterval = null;
        this.phoneCodeCooldown.set(false);
        return;
      }
      this.phoneCodeTimer.set(t - 1);
    }, 1000);
  }

  private loadChannels(onDone?: () => void): void {
    this.http.get<ChannelsResponse>('/api/account/channels').subscribe({
      next: (res) => {
        this.channels.set(res.channels);
        this.channelsLoading.set(false);
        onDone?.();
      },
      error: () => {
        this.channelsLoading.set(false);
        this.snackBar.open('Не удалось загрузить мессенджеры', '', { duration: 4000 });
        onDone?.();
      },
    });
  }

  private upsertLinkedChannel(channel: LinkedChannel): void {
    this.channels.update(list => [
      ...list.filter(item => item.channel !== channel.channel),
      channel,
    ]);
  }

  private loadNotificationSettings(): void {
    this.notificationApiService.getNotificationSettings().subscribe({
      next: (response) => {
        if (response.data) {
          const d = response.data;
          this.notifControls.orderStatus.setValue(d.orderStatus ?? true);
          this.notifControls.printReady.setValue(d.printReady ?? true);
          this.notifControls.bookingConfirmation.setValue(d.bookingConfirmation ?? true);
          this.notifControls.bookingReminders.setValue(d.bookingReminders ?? true);
          this.notifControls.systemUpdates.setValue(d.systemUpdates ?? true);
          this.notifControls.specialOffers.setValue(d.specialOffers ?? false);
          this.notifControls.emailNotifications.setValue(d.emailNotifications ?? true);
          this.notifControls.pushNotifications.setValue(d.pushNotifications ?? false);
          this.notifControls.smsNotifications.setValue(d.smsNotifications ?? false);
        }
      },
    });
  }

  private handleAvatarAction(action: AvatarAction): void {
    switch (action) {
      case 'camera':
      case 'gallery': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (action === 'camera') input.capture = 'user';
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) this.uploadAvatarFile(file);
        };
        input.click();
        break;
      }
      case 'remove':
        this.removeAvatar();
        break;
    }
  }

  private uploadAvatarFile(file: File): void {
    if (file.size > 5 * 1024 * 1024) {
      this.snackBar.open('Файл слишком большой (максимум 5 МБ)', 'OK', { duration: 3000 });
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.snackBar.open('Допустимы только изображения', 'OK', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);
    const user = this.authService.getCurrentUser();
    const userId = user?.id || user?.uid;
    if (!userId) { this.isLoading.set(false); return; }

    const path = `avatars/${userId}/${file.name}`;
    this.fileStorageService.uploadFile(path, file).subscribe({
      next: (downloadURL) => {
        if (downloadURL) {
          this.authService.updateProfilePhoto(downloadURL).subscribe({
            next: () => {
              this.snackBar.open('Фото обновлено', '', { duration: 3000 });
              this.isLoading.set(false);
            },
            error: () => this.isLoading.set(false),
          });
        }
      },
      error: () => this.isLoading.set(false),
    });
  }

  private removeAvatar(): void {
    this.isLoading.set(true);
    this.authService.updateProfilePhoto('').subscribe({
      next: () => {
        this.snackBar.open('Фото удалено', '', { duration: 3000 });
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  private readUpdatedFieldValue(fieldKey: string, profile: UserProfile, fallback: unknown): unknown {
    switch (fieldKey) {
      case 'displayName':
        return profile.displayName || profile.display_name || fallback;
      case 'phoneNumber':
        return profile.phone || fallback;
      case 'firstName':
        return profile.personal_data?.firstName || profile.first_name || fallback;
      case 'lastName':
        return profile.personal_data?.lastName || profile.last_name || fallback;
      case 'dateOfBirth':
        return profile.personal_data?.dateOfBirth ? new Date(profile.personal_data.dateOfBirth) : fallback;
      default:
        return fallback;
    }
  }

  private buildPersonalData(patch: Partial<ProfilePersonalData>): ProfilePersonalData {
    const currentUser = this.authService.currentUser();
    return {
      firstName: currentUser?.personal_data?.firstName || currentUser?.first_name || '',
      lastName: currentUser?.personal_data?.lastName || currentUser?.last_name || '',
      dateOfBirth: currentUser?.personal_data?.dateOfBirth,
      preferences: currentUser?.personal_data?.preferences || {},
      ...patch,
    };
  }

  private buildFieldPayload(fieldKey: string, value: unknown): Partial<UserProfile> {
    const currentUser = this.authService.currentUser();
    const valueString = typeof value === 'string' ? value.trim() : '';
    const currentDisplayName = currentUser?.displayName || currentUser?.display_name;

    switch (fieldKey) {
      case 'displayName':
        return { displayName: valueString };
      case 'phoneNumber':
        return { phone: valueString };
      case 'firstName':
        return {
          ...(currentDisplayName ? { displayName: currentDisplayName } : {}),
          first_name: valueString,
          personal_data: this.buildPersonalData({ firstName: valueString }),
        };
      case 'lastName':
        return {
          ...(currentDisplayName ? { displayName: currentDisplayName } : {}),
          last_name: valueString,
          personal_data: this.buildPersonalData({ lastName: valueString }),
        };
      case 'dateOfBirth':
        return {
          personal_data: this.buildPersonalData({
            dateOfBirth: value instanceof Date ? value.toISOString() : undefined,
          }),
        };
      default:
        return {};
    }
  }

  private handleError(error: unknown, defaultMessage: string): void {
    const msg = readErrorMessage(error, defaultMessage);
    this.snackBar.open(msg, '', { duration: 5000 });
    this.isLoading.set(false);
  }
}
