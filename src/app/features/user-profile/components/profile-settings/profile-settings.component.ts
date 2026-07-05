import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';

import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatBadgeModule } from '@angular/material/badge';

import { AuthService } from '../../../../core/services/auth.service';
import { UserApiService } from '../../../../core/services/user-api.service';
import { FileStorageService } from '../../../../core/services/file-storage.service';
import { AvatarUploadDialogComponent } from '../avatar-upload-dialog/avatar-upload-dialog.component';
import { AvatarBottomSheetComponent, AvatarAction } from '../avatar-bottom-sheet/avatar-bottom-sheet.component';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-profile-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatTabsModule,
    MatExpansionModule,
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
    MatSlideToggleModule,
    MatSelectModule,
    MatBadgeModule,
  ],
  template: `
    <div class="profile-settings">

      @if (!profileLoaded()) {
        <!-- Skeleton loading -->
        <div class="skeleton-header">
          <div class="skeleton-avatar skeleton-pulse"></div>
          <div class="skeleton-heading">
            <div class="skeleton-line skeleton-pulse" style="width: 60%; height: 20px;"></div>
            <div class="skeleton-line skeleton-pulse" style="width: 40%; height: 14px; margin-top: 8px;"></div>
          </div>
        </div>
        <div class="skeleton-card">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <div class="skeleton-field skeleton-pulse"></div>
          }
        </div>
      } @else {
        @let userProfile = authService.currentUser();
        @if (userProfile) {

        <!-- Avatar + heading row -->
        <div class="settings-header">
          <div class="avatar-wrap" (click)="openAvatarUpload()" (keydown.enter)="openAvatarUpload()" tabindex="0" matTooltip="Сменить фото">
            @if (userProfile.photoURL || userProfile.photo_url) {
              <img
                [src]="userProfile.photoURL || userProfile.photo_url"
                alt="Фото профиля"
                class="avatar-img"
              />
            } @else {
              <div class="avatar-placeholder">
                <mat-icon>account_circle</mat-icon>
              </div>
            }
            <div class="avatar-overlay">
              <mat-icon>photo_camera</mat-icon>
            </div>
          </div>
          <div class="settings-heading">
            <h2 class="settings-title">Настройки профиля</h2>
            <p class="settings-subtitle">
              {{ userProfile.displayName || userProfile.display_name || userProfile.email }}
            </p>
          </div>
        </div>

        <!-- MOBILE: accordion -->
        @if (isMobile()) {
          <div class="accordion-wrap">
            <mat-accordion multi>

              <!-- Section 1: Личные данные (expanded by default) -->
              <mat-expansion-panel [expanded]="true" class="section-panel">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    <mat-icon class="panel-icon">person</mat-icon>
                    Личные данные
                  </mat-panel-title>
                </mat-expansion-panel-header>
                <ng-container *ngTemplateOutlet="profileContent" />
              </mat-expansion-panel>

              <!-- Section 2: Безопасность -->
              <mat-expansion-panel class="section-panel">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    <mat-icon class="panel-icon">lock</mat-icon>
                    Безопасность
                  </mat-panel-title>
                </mat-expansion-panel-header>
                <ng-container *ngTemplateOutlet="securityContent" />
              </mat-expansion-panel>

              <!-- Section 3: Верификация -->
              <mat-expansion-panel class="section-panel">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    <mat-icon class="panel-icon">verified_user</mat-icon>
                    Верификация
                    @if (hasUnverified()) {
                      <span class="verify-badge">!</span>
                    }
                  </mat-panel-title>
                </mat-expansion-panel-header>
                <ng-container *ngTemplateOutlet="verificationContent" />
              </mat-expansion-panel>

            </mat-accordion>
          </div>
        } @else {
          <!-- DESKTOP: tabs (original layout) -->
          <mat-card class="tabs-card" appearance="outlined">
            <mat-card-content>
              <mat-tab-group animationDuration="200ms" mat-stretch-tabs="false" mat-align-tabs="start">

                <mat-tab>
                  <ng-template mat-tab-label>
                    <mat-icon class="tab-icon">person</mat-icon>
                    Профиль
                  </ng-template>
                  <div class="tab-content">
                    <ng-container *ngTemplateOutlet="profileContent" />
                  </div>
                </mat-tab>

                <mat-tab>
                  <ng-template mat-tab-label>
                    <mat-icon class="tab-icon">lock</mat-icon>
                    Безопасность
                  </ng-template>
                  <div class="tab-content">
                    <ng-container *ngTemplateOutlet="securityContent" />
                  </div>
                </mat-tab>

                <mat-tab>
                  <ng-template mat-tab-label>
                    <mat-icon class="tab-icon">verified_user</mat-icon>
                    Верификация
                    @if (hasUnverified()) {
                      <span class="verify-badge-tab">!</span>
                    }
                  </ng-template>
                  <div class="tab-content">
                    <ng-container *ngTemplateOutlet="verificationContent" />
                  </div>
                </mat-tab>

              </mat-tab-group>
            </mat-card-content>
          </mat-card>
        }
        }

        <!-- ======== SHARED TEMPLATES ======== -->

        <!-- Profile fields: inline-edit -->
        <ng-template #profileContent>
          <div class="inline-fields">

            <!-- Имя -->
            <div class="field-row" [class.field-saving]="savingField() === 'firstName'">
              @if (editingField() === 'firstName') {
                <div class="field-edit">
                  <mat-form-field appearance="outline" class="field-input">
                    <mat-label>Имя</mat-label>
                    <input matInput [formControl]="editControls.firstName" placeholder="Иван" />
                  </mat-form-field>
                  <div class="field-actions">
                    <button mat-icon-button class="confirm-btn" (click)="confirmField('firstName')"
                      [disabled]="savingField() === 'firstName'">
                      @if (savingField() === 'firstName') {
                        <mat-spinner diameter="18" />
                      } @else {
                        <mat-icon>check</mat-icon>
                      }
                    </button>
                    <button mat-icon-button class="cancel-btn" (click)="cancelEdit()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                </div>
              } @else {
                <div class="field-display" tabindex="0" role="button" (click)="startEdit('firstName')" (keydown.enter)="startEdit('firstName')">
                  <div class="field-label">Имя</div>
                  <div class="field-value">{{ profileForm.get('firstName')?.value || 'Не указано' }}</div>
                </div>
                <button mat-icon-button class="edit-pencil" (click)="startEdit('firstName')">
                  <mat-icon>edit</mat-icon>
                </button>
              }
            </div>

            <mat-divider class="field-divider" />

            <!-- Фамилия -->
            <div class="field-row" [class.field-saving]="savingField() === 'lastName'">
              @if (editingField() === 'lastName') {
                <div class="field-edit">
                  <mat-form-field appearance="outline" class="field-input">
                    <mat-label>Фамилия</mat-label>
                    <input matInput [formControl]="editControls.lastName" placeholder="Иванов" />
                  </mat-form-field>
                  <div class="field-actions">
                    <button mat-icon-button class="confirm-btn" (click)="confirmField('lastName')"
                      [disabled]="savingField() === 'lastName'">
                      @if (savingField() === 'lastName') {
                        <mat-spinner diameter="18" />
                      } @else {
                        <mat-icon>check</mat-icon>
                      }
                    </button>
                    <button mat-icon-button class="cancel-btn" (click)="cancelEdit()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                </div>
              } @else {
                <div class="field-display" tabindex="0" role="button" (click)="startEdit('lastName')" (keydown.enter)="startEdit('lastName')">
                  <div class="field-label">Фамилия</div>
                  <div class="field-value">{{ profileForm.get('lastName')?.value || 'Не указано' }}</div>
                </div>
                <button mat-icon-button class="edit-pencil" (click)="startEdit('lastName')">
                  <mat-icon>edit</mat-icon>
                </button>
              }
            </div>

            <mat-divider class="field-divider" />

            <!-- Отображаемое имя -->
            <div class="field-row" [class.field-saving]="savingField() === 'displayName'">
              @if (editingField() === 'displayName') {
                <div class="field-edit">
                  <mat-form-field appearance="outline" class="field-input">
                    <mat-label>Отображаемое имя</mat-label>
                    <input matInput [formControl]="editControls.displayName" placeholder="Как отображать ваше имя" />
                  </mat-form-field>
                  <div class="field-actions">
                    <button mat-icon-button class="confirm-btn" (click)="confirmField('displayName')"
                      [disabled]="savingField() === 'displayName'">
                      @if (savingField() === 'displayName') {
                        <mat-spinner diameter="18" />
                      } @else {
                        <mat-icon>check</mat-icon>
                      }
                    </button>
                    <button mat-icon-button class="cancel-btn" (click)="cancelEdit()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                </div>
              } @else {
                <div class="field-display" tabindex="0" role="button" (click)="startEdit('displayName')" (keydown.enter)="startEdit('displayName')">
                  <div class="field-label">Отображаемое имя</div>
                  <div class="field-value">{{ profileForm.get('displayName')?.value || 'Не указано' }}</div>
                </div>
                <button mat-icon-button class="edit-pencil" (click)="startEdit('displayName')">
                  <mat-icon>edit</mat-icon>
                </button>
              }
            </div>

            <mat-divider class="field-divider" />

            <!-- Email (readonly) -->
            <div class="field-row">
              <div class="field-display">
                <div class="field-label">Email</div>
                <div class="field-value">{{ profileForm.getRawValue().email || 'Не указан' }}</div>
                <div class="field-hint">Email нельзя изменить</div>
              </div>
            </div>

            <mat-divider class="field-divider" />

            <!-- Телефон -->
            <div class="field-row" [class.field-saving]="savingField() === 'phoneNumber'">
              @if (editingField() === 'phoneNumber') {
                <div class="field-edit">
                  <mat-form-field appearance="outline" class="field-input">
                    <mat-label>Номер телефона</mat-label>
                    <input matInput [formControl]="editControls.phoneNumber"
                      placeholder="+7 (999) 123-45-67" inputmode="tel" />
                  </mat-form-field>
                  <div class="field-actions">
                    <button mat-icon-button class="confirm-btn" (click)="confirmField('phoneNumber')"
                      [disabled]="savingField() === 'phoneNumber'">
                      @if (savingField() === 'phoneNumber') {
                        <mat-spinner diameter="18" />
                      } @else {
                        <mat-icon>check</mat-icon>
                      }
                    </button>
                    <button mat-icon-button class="cancel-btn" (click)="cancelEdit()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                </div>
              } @else {
                <div class="field-display" tabindex="0" role="button" (click)="startEdit('phoneNumber')" (keydown.enter)="startEdit('phoneNumber')">
                  <div class="field-label">Номер телефона</div>
                  <div class="field-value">{{ profileForm.get('phoneNumber')?.value || 'Не указан' }}</div>
                </div>
                <button mat-icon-button class="edit-pencil" (click)="startEdit('phoneNumber')">
                  <mat-icon>edit</mat-icon>
                </button>
              }
            </div>

            <mat-divider class="field-divider" />

            <!-- Дата рождения -->
            <div class="field-row" [class.field-saving]="savingField() === 'dateOfBirth'">
              @if (editingField() === 'dateOfBirth') {
                <div class="field-edit">
                  <mat-form-field appearance="outline" class="field-input">
                    <mat-label>Дата рождения</mat-label>
                    <input matInput [matDatepicker]="inlinePicker" [formControl]="editControls.dateOfBirth" />
                    <mat-datepicker-toggle matSuffix [for]="inlinePicker" />
                    <mat-datepicker #inlinePicker />
                  </mat-form-field>
                  <div class="field-actions">
                    <button mat-icon-button class="confirm-btn" (click)="confirmField('dateOfBirth')"
                      [disabled]="savingField() === 'dateOfBirth'">
                      @if (savingField() === 'dateOfBirth') {
                        <mat-spinner diameter="18" />
                      } @else {
                        <mat-icon>check</mat-icon>
                      }
                    </button>
                    <button mat-icon-button class="cancel-btn" (click)="cancelEdit()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                </div>
              } @else {
                <div class="field-display" tabindex="0" role="button" (click)="startEdit('dateOfBirth')" (keydown.enter)="startEdit('dateOfBirth')">
                  <div class="field-label">Дата рождения</div>
                  <div class="field-value">{{ formatDate(profileForm.get('dateOfBirth')?.value) }}</div>
                </div>
                <button mat-icon-button class="edit-pencil" (click)="startEdit('dateOfBirth')">
                  <mat-icon>edit</mat-icon>
                </button>
              }
            </div>

          </div>
        </ng-template>

        <!-- Security content -->
        <ng-template #securityContent>
          <div class="security-section">
            <div class="security-item">
              <div class="security-item-info">
                <mat-icon class="sec-icon">lock_reset</mat-icon>
                <div>
                  <div class="sec-title">Изменить пароль</div>
                  <div class="sec-desc">Ссылка для смены пароля будет отправлена на ваш email</div>
                </div>
              </div>
              <button mat-stroked-button class="sec-btn" (click)="changePassword()">
                Изменить
              </button>
            </div>

            <mat-divider class="sec-divider" />

            <div class="security-item">
              <div class="security-item-info">
                <mat-icon class="sec-icon active-sessions-icon">devices</mat-icon>
                <div>
                  <div class="sec-title">Активные сессии</div>
                  <div class="sec-desc">Управление активными сессиями на устройствах</div>
                </div>
              </div>
              <button mat-stroked-button class="sec-btn" disabled>
                Скоро
              </button>
            </div>

            <mat-divider class="sec-divider" />

            <!-- 2FA -->
            <div class="security-item">
              <div class="security-item-info">
                <mat-icon class="sec-icon" [class.amber-icon]="is2FAEnabled()">verified_user</mat-icon>
                <div>
                  <div class="sec-title">Двухфакторная аутентификация</div>
                  <div class="sec-desc">
                    @if (!authService.isPhoneVerified()) {
                      Сначала укажите телефон в секции «Личные данные»
                    } @else if (is2FAEnabled()) {
                      Включена · SMS-код при каждом входе
                    } @else {
                      Дополнительная защита аккаунта через SMS
                    }
                  </div>
                </div>
              </div>
              <mat-slide-toggle
                [checked]="is2FAEnabled()"
                [disabled]="!authService.isPhoneVerified() || twoFactorLoading()"
                color="accent"
                (change)="toggle2FA($event.checked)" />
            </div>

            <mat-divider class="sec-divider" />

            <div class="security-item danger-zone">
              <div class="security-item-info">
                <mat-icon class="sec-icon danger-icon">delete_forever</mat-icon>
                <div>
                  <div class="sec-title danger-text">Удалить аккаунт</div>
                  <div class="sec-desc">Все ваши данные будут безвозвратно удалены</div>
                </div>
              </div>
              <button mat-stroked-button class="sec-btn danger-btn" (click)="deleteAccount()">
                Удалить
              </button>
            </div>
          </div>
        </ng-template>

        <!-- Verification content -->
        <ng-template #verificationContent>
          @if (userProfile) {
          <div class="verify-list">
            <!-- Email verification -->
            <div class="verify-item">
              <div class="verify-status-icon">
                @if (userProfile.emailVerified || userProfile.email_verified) {
                  <mat-icon class="verified-icon">check_circle</mat-icon>
                } @else {
                  <mat-icon class="unverified-icon">cancel</mat-icon>
                }
              </div>
              <div class="verify-info">
                <div class="verify-label">Email</div>
                <div class="verify-value">{{ userProfile.email }}</div>
                <div class="verify-state">
                  @if (userProfile.emailVerified || userProfile.email_verified) {
                    <span class="state-verified">Подтверждён</span>
                  } @else {
                    <span class="state-pending">Не подтверждён</span>
                  }
                </div>
              </div>
              @if (!(userProfile.emailVerified || userProfile.email_verified)) {
                <button mat-stroked-button class="verify-btn" (click)="sendEmailVerification()">
                  <mat-icon>send</mat-icon>
                  Подтвердить
                </button>
              }
            </div>

            <mat-divider class="verify-divider" />

            <!-- Phone verification -->
            <div class="verify-item">
              <div class="verify-status-icon">
                @if (authService.isPhoneVerified()) {
                  <mat-icon class="verified-icon">check_circle</mat-icon>
                } @else {
                  <mat-icon class="unverified-icon">cancel</mat-icon>
                }
              </div>
              <div class="verify-info">
                <div class="verify-label">Телефон</div>
                <div class="verify-value">
                  {{ userProfile.phone || 'Не указан' }}
                </div>
                <div class="verify-state">
                  @if (authService.isPhoneVerified()) {
                    <span class="state-verified">Привязан</span>
                  } @else {
                    <span class="state-missing">Укажите телефон в секции «Личные данные»</span>
                  }
                </div>
              </div>
            </div>

            <!-- Ввод кода подтверждения -->
            @if (phoneVerifyStep() === 'code_sent') {
              <div class="phone-code-block">
                <p class="phone-code-hint">
                  <mat-icon>smartphone</mat-icon>
                  Код отправлен на {{ userProfile.phone }}
                </p>
                <div class="phone-code-row">
                  <mat-form-field appearance="outline" class="code-field">
                    <mat-label>Код из SMS</mat-label>
                    <input matInput
                      [formControl]="phoneCodeControl"
                      placeholder="123456"
                      maxlength="6"
                      inputmode="numeric"
                      autocomplete="one-time-code" />
                    <mat-icon matSuffix>dialpad</mat-icon>
                  </mat-form-field>
                  <button mat-flat-button class="save-btn"
                    [disabled]="phoneCodeControl.invalid || phoneVerifyLoading()"
                    (click)="verifyPhoneCode()">
                    @if (phoneVerifyLoading()) {
                      <mat-spinner diameter="16" class="btn-spinner" />
                    } @else {
                      <mat-icon>check</mat-icon>
                    }
                    Подтвердить
                  </button>
                </div>
                <button mat-button class="resend-btn" (click)="phoneVerifyStep.set('idle')">
                  Отмена
                </button>
              </div>
            }
          </div>

          <div class="verify-note">
            <mat-icon>info_outline</mat-icon>
            Верификация аккаунта открывает доступ ко всем функциям сервиса
          </div>
          }
        </ng-template>

        @if (isLoading()) {
          <div class="loading-overlay">
            <mat-spinner diameter="36" />
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      --amber: #f59e0b;
      --amber-dim: rgba(245,158,11,0.12);
      --amber-glow: rgba(245,158,11,0.3);
      --surface: #1a1a1a;
      --surface-card: #1e1e1e;
      --border: rgba(255,255,255,0.08);
      --text: #f0f0f0;
      --text-muted: #888;
      --error: #ef4444;
      --m3e-corner-xl: 28px;
    }

    .profile-settings {
      max-width: 640px;
      color: var(--text);
      position: relative;
    }

    /* ===== Skeleton loading ===== */
    @keyframes skeleton-pulse {
      0%, 100% { opacity: 0.15; }
      50% { opacity: 0.3; }
    }

    .skeleton-pulse {
      animation: skeleton-pulse 1.5s ease-in-out infinite;
      background: var(--amber-dim);
      border-radius: 6px;
    }

    .skeleton-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }

    .skeleton-avatar {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .skeleton-heading {
      flex: 1;
    }

    .skeleton-line {
      border-radius: 4px;
    }

    .skeleton-card {
      padding: 20px;
      border-radius: var(--m3e-corner-xl);
      border: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.03);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .skeleton-field {
      height: 48px;
      border-radius: 8px;
    }

    /* ===== Header ===== */
    .settings-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }

    .avatar-wrap {
      position: relative;
      width: 100px;
      height: 100px;
      border-radius: 50%;
      overflow: hidden;
      cursor: pointer;
      flex-shrink: 0;
      border: 2px solid var(--border);
      transition: border-color 0.2s;

      &:hover {
        border-color: var(--amber);
        .avatar-overlay { opacity: 1; }
      }
    }

    .avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .avatar-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface);

      mat-icon {
        font-size: 56px;
        width: 56px;
        height: 56px;
        color: var(--text-muted);
      }
    }

    .avatar-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s;

      mat-icon { color: #fff; font-size: 24px; }
    }

    .settings-heading {
      flex: 1;
      min-width: 0;
    }

    .settings-title {
      margin: 0 0 4px;
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--text);
    }

    .settings-subtitle {
      margin: 0;
      font-size: 0.875rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ===== Tabs card (desktop), iOS Settings grouped style ===== */
    .tabs-card {
      background: rgba(255,255,255,0.03) !important;
      border: 1px solid rgba(255,255,255,0.06) !important;
      border-radius: var(--m3e-corner-xl) !important;
      backdrop-filter: blur(8px);
    }

    .tab-icon {
      font-size: 18px;
      margin-right: 6px;
      vertical-align: middle;
    }

    .tab-content {
      padding: 20px 0 4px;
    }

    /* ===== Accordion (mobile), grouped sections ===== */
    .accordion-wrap {
      mat-accordion {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
    }

    .section-panel {
      background: rgba(255,255,255,0.03) !important;
      border: 1px solid rgba(255,255,255,0.06) !important;
      border-radius: var(--m3e-corner-xl) !important;
      box-shadow: none !important;
      backdrop-filter: blur(8px);

      &::ng-deep .mat-expansion-panel-body {
        padding: 0 16px 16px;
      }
    }

    .panel-icon {
      font-size: 20px;
      margin-right: 8px;
      color: var(--amber);
    }

    .verify-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--amber);
      color: #111;
      font-size: 12px;
      font-weight: 700;
      margin-left: 8px;
    }

    .verify-badge-tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--amber);
      color: #111;
      font-size: 11px;
      font-weight: 700;
      margin-left: 6px;
    }

    /* ===== Inline-edit fields ===== */
    .inline-fields {
      display: flex;
      flex-direction: column;
    }

    .field-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 4px;
      min-height: 52px;
      transition: background 0.2s;

      &:hover {
        background: rgba(255,255,255,0.02);
      }
    }

    .field-saving {
      opacity: 0.7;
    }

    @keyframes field-saved {
      0% { background: rgba(245,158,11,0.15); }
      100% { background: transparent; }
    }

    .field-saved-flash {
      animation: field-saved 0.6s ease-out;
    }

    .field-display {
      flex: 1;
      min-width: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }

    .field-label {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
      letter-spacing: 0.02em;
      margin-bottom: 4px;
    }

    .field-value {
      font-size: 0.92rem;
      color: var(--text);
      font-weight: 500;
      word-break: break-word;
    }

    .field-hint {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .edit-pencil {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      color: var(--text-muted);

      &:hover { color: var(--amber); }

      mat-icon { font-size: 18px; }
    }

    .field-edit {
      flex: 1;
      display: flex;
      align-items: flex-start;
      gap: 4px;
    }

    .field-input {
      flex: 1;
    }

    .field-actions {
      display: flex;
      gap: 0;
      flex-shrink: 0;
      padding-top: 4px;
    }

    .confirm-btn {
      color: #22c55e;
      width: 44px;
      height: 44px;
    }

    .cancel-btn {
      color: var(--text-muted);
      width: 44px;
      height: 44px;
    }

    .field-divider {
      border-color: rgba(255,255,255,0.04) !important;
    }

    /* ===== Form (kept for fallback) ===== */
    .save-btn {
      background: var(--amber) !important;
      color: #111 !important;
      font-weight: 700;
      min-width: 140px;
      display: flex;
      align-items: center;
      gap: 6px;
      border-radius: 12px;
      position: sticky;
      bottom: 0;
      box-shadow: 0 -4px 16px rgba(0,0,0,0.2);
    }

    .btn-spinner {
      display: inline-block;
    }

    /* ===== Security, iOS grouped list ===== */
    .security-section {
      display: flex;
      flex-direction: column;
    }

    .security-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      transition: background 0.2s;

      &:last-child {
        border-bottom: none;
      }

      &:hover {
        background: rgba(255,255,255,0.03);
      }
    }

    .security-item-info {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .sec-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--amber);
      flex-shrink: 0;
      margin-top: 2px;
    }

    .active-sessions-icon { color: #60a5fa; }
    .danger-icon { color: var(--error); }

    .sec-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 2px;
    }

    .sec-desc {
      font-size: 0.78rem;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .sec-btn {
      border-color: var(--border) !important;
      color: var(--text-muted) !important;
      white-space: nowrap;
      flex-shrink: 0;
      font-size: 0.82rem;
      min-height: 44px;

      &:hover:not([disabled]) {
        border-color: var(--amber) !important;
        color: var(--amber) !important;
      }
    }

    .sec-divider {
      display: none;
    }

    .danger-text { color: var(--error); }

    .danger-btn:hover:not([disabled]) {
      border-color: var(--error) !important;
      color: var(--error) !important;
    }

    /* ===== Verification ===== */
    .verify-list {
      display: flex;
      flex-direction: column;
    }

    .verify-item {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);

      &:last-child {
        border-bottom: none;
      }
    }

    .verify-status-icon {
      flex-shrink: 0;
      margin-top: 2px;
    }

    .verified-icon {
      color: #22c55e;
      font-size: 24px;
    }

    .unverified-icon {
      color: var(--text-muted);
      font-size: 24px;
    }

    .verify-info {
      flex: 1;
      min-width: 0;
    }

    .verify-label {
      font-size: 12px;
      color: var(--amber);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }

    .verify-value {
      font-size: 0.9rem;
      color: var(--text);
      font-weight: 500;
      margin-bottom: 4px;
    }

    .verify-state { font-size: 0.8rem; }

    .state-verified { color: #22c55e; }
    .state-pending { color: var(--amber); }
    .state-missing { color: var(--text-muted); }

    .verify-btn {
      border-color: var(--border) !important;
      color: var(--text-muted) !important;
      font-size: 0.82rem;
      flex-shrink: 0;
      min-height: 44px;

      mat-icon { font-size: 16px; margin-right: 4px; }

      &:hover:not([disabled]) {
        border-color: var(--amber) !important;
        color: var(--amber) !important;
      }
    }

    .verify-divider {
      display: none;
    }

    .verify-note {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding: 10px 14px;
      background: rgba(245,158,11,0.07);
      border-radius: 12px;
      border: 1px solid rgba(245,158,11,0.2);
      font-size: 0.8rem;
      color: var(--text-muted);

      mat-icon {
        font-size: 18px;
        color: var(--amber);
        flex-shrink: 0;
      }
    }

    /* Phone verification code flow */
    .phone-code-block {
      margin-top: 12px;
      padding: 16px;
      background: rgba(245,158,11,0.04);
      border: 1px solid rgba(245,158,11,0.15);
      border-radius: 16px;
    }

    .phone-code-hint {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
      font-size: 0.85rem;
      margin: 0 0 12px;

      mat-icon { font-size: 16px; color: var(--amber); }
    }

    .phone-code-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;

      .code-field { width: 160px; flex-shrink: 0; }
    }

    .resend-btn {
      margin-top: 8px;
      font-size: 0.8rem;
      color: var(--text-muted) !important;
      min-height: 44px;
    }

    /* 2FA icon accent */
    .amber-icon { color: var(--amber) !important; }

    /* Loading overlay */
    .loading-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.4);
      z-index: 100;
    }

    /* ===== Amber glow on focus + M3E form field corners ===== */
    ::ng-deep .profile-settings {
      .mat-mdc-form-field {
        --mdc-outlined-text-field-outline-color: var(--border);
        --mdc-outlined-text-field-hover-outline-color: rgba(255,255,255,0.2);
        --mdc-outlined-text-field-focus-outline-color: var(--amber);
        --mdc-outlined-text-field-label-text-color: var(--text-muted);
        --mdc-outlined-text-field-input-text-color: var(--text);
      }

      .mat-mdc-form-field .mdc-notched-outline > * {
        border-radius: 16px;
      }

      .mat-mdc-form-field.mat-focused .mdc-notched-outline {
        box-shadow: 0 0 0 2px rgba(245,158,11,0.15);
        border-radius: 16px;
      }

      .mat-mdc-tab-group {
        --mat-tab-header-active-label-text-color: var(--amber);
        --mat-tab-header-active-indicator-color: var(--amber);
        --mat-tab-header-inactive-label-text-color: var(--text-muted);
      }

      .mat-expansion-panel-header {
        --mat-expansion-header-text-color: var(--text);
      }

      /* mat-slide-toggle amber ON state */
      .mat-mdc-slide-toggle {
        --mdc-switch-selected-handle-color: var(--amber);
        --mdc-switch-selected-track-color: rgba(245,158,11,0.38);
        --mdc-switch-selected-hover-handle-color: #fbbf24;
        --mdc-switch-selected-hover-track-color: rgba(245,158,11,0.45);
        --mdc-switch-selected-focus-handle-color: var(--amber);
        --mdc-switch-selected-focus-track-color: rgba(245,158,11,0.38);
        --mdc-switch-selected-pressed-handle-color: #d97706;
        --mdc-switch-selected-pressed-track-color: rgba(245,158,11,0.45);
      }
    }

    /* ===== Mobile responsive ===== */
    @media (max-width: 767px) {
      .settings-header {
        gap: 12px;
      }

      .settings-title {
        font-size: 1.1rem;
      }

      .avatar-wrap {
        width: 80px;
        height: 80px;
      }

      .phone-code-row {
        flex-direction: column;

        .code-field { width: 100%; }
      }

      .security-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;

        .sec-btn {
          align-self: flex-end;
        }
      }

      .verify-item {
        flex-wrap: wrap;

        .verify-btn {
          margin-left: 38px;
        }
      }
    }
  `],
})
export class ProfileSettingsComponent {
  protected readonly authService = inject(AuthService);
  private readonly userApiService = inject(UserApiService);
  private readonly fileStorageService = inject(FileStorageService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isLoading = signal(false);
  protected readonly isMobile = signal(false);
  protected readonly profileLoaded = signal(false);

  // Inline-edit state
  protected readonly editingField = signal<string | null>(null);
  protected readonly savingField = signal<string | null>(null);

  // Верификация телефона
  protected readonly phoneVerifyStep = signal<'idle' | 'code_sent'>('idle');
  protected readonly phoneVerifyLoading = signal(false);
  readonly phoneCodeControl = new FormControl('', [
    Validators.required,
    Validators.minLength(6),
    Validators.maxLength(6),
    Validators.pattern(/^\d{6}$/),
  ]);

  // 2FA
  protected readonly is2FAEnabled = signal(false);
  protected readonly twoFactorLoading = signal(false);

  // Verification badge
  protected readonly hasUnverified = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return false;
    const emailOk = user.emailVerified || user.email_verified;
    const phoneOk = this.authService.isPhoneVerified();
    return !emailOk || !phoneOk;
  });

  readonly profileForm: FormGroup = this.fb.group({
    displayName: [''],
    email: [{ value: '', disabled: true }],
    phoneNumber: ['', [Validators.pattern(/^\+?[0-9\s\-()]{10,15}$/)]],
    firstName: [''],
    lastName: [''],
    dateOfBirth: [null as Date | null],
  });

  // Inline-edit controls (separate from form to avoid interference)
  readonly editControls = {
    firstName: new FormControl(''),
    lastName: new FormControl(''),
    displayName: new FormControl(''),
    phoneNumber: new FormControl('', [Validators.pattern(/^\+?[0-9\s\-()]{10,15}$/)]),
    dateOfBirth: new FormControl<Date | null>(null),
  };

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.breakpointObserver.observe('(max-width: 767px)')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(result => {
          this.isMobile.set(result.matches);
        });
    }

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
  }

  // ===== Inline-edit =====

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

    // No change, just close
    if (newValue === oldValue) {
      this.editingField.set(null);
      return;
    }

    this.savingField.set(fieldKey);

    // Build partial update payload
    const payload = this.buildFieldPayload(fieldKey, newValue);

    this.userApiService.updateCurrentUserProfile(payload).subscribe({
      next: (response) => {
        if (response.success) {
          this.profileForm.get(fieldKey)?.setValue(newValue);
          this.profileForm.get(fieldKey)?.markAsPristine();
          this.editingField.set(null);
          this.snackBar.open('Сохранено', 'Закрыть', { duration: 2000 });
          // Flash animation on the field row
          this.flashSavedField(fieldKey);
        } else {
          this.snackBar.open(response.message || 'Ошибка сохранения', 'Закрыть', { duration: 5000 });
        }
      },
      error: (error) => this.handleError(error, 'Ошибка сохранения'),
      complete: () => this.savingField.set(null),
    });
  }

  private buildFieldPayload(fieldKey: string, value: unknown): Record<string, unknown> {
    const currentUser = this.authService.currentUser();

    switch (fieldKey) {
      case 'displayName':
        return { displayName: value };
      case 'phoneNumber':
        return { phoneNumber: value };
      case 'firstName':
        return {
          personalData: {
            firstName: value,
            lastName: currentUser?.personal_data?.lastName || currentUser?.last_name || '',
            dateOfBirth: currentUser?.personal_data?.dateOfBirth,
            preferences: currentUser?.personal_data?.preferences || {},
          },
        };
      case 'lastName':
        return {
          personalData: {
            firstName: currentUser?.personal_data?.firstName || currentUser?.first_name || '',
            lastName: value,
            dateOfBirth: currentUser?.personal_data?.dateOfBirth,
            preferences: currentUser?.personal_data?.preferences || {},
          },
        };
      case 'dateOfBirth':
        return {
          personalData: {
            firstName: currentUser?.personal_data?.firstName || currentUser?.first_name || '',
            lastName: currentUser?.personal_data?.lastName || currentUser?.last_name || '',
            dateOfBirth: value instanceof Date ? value.toISOString() : undefined,
            preferences: currentUser?.personal_data?.preferences || {},
          },
        };
      default:
        return {};
    }
  }

  private flashSavedField(fieldKey: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Find the field-row element by iterating and apply animation
    setTimeout(() => {
      const rows = document.querySelectorAll('.field-row');
      const fieldKeys = ['firstName', 'lastName', 'displayName', 'email', 'phoneNumber', 'dateOfBirth'];
      const index = fieldKeys.indexOf(fieldKey);
      if (index >= 0 && rows[index]) {
        rows[index].classList.add('field-saved-flash');
        setTimeout(() => rows[index].classList.remove('field-saved-flash'), 600);
      }
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

    if (this.isMobile()) {
      const sheetRef = this.bottomSheet.open(AvatarBottomSheetComponent);
      sheetRef.afterDismissed().subscribe((action: AvatarAction | undefined) => {
        if (!action) return;
        this.handleAvatarAction(action);
      });
    } else {
      const dialogRef = this.dialog.open(AvatarUploadDialogComponent, {
        width: '500px',
        data: { userId: this.authService.currentUser()?.id || this.authService.currentUser()?.uid },
      });
      dialogRef.afterClosed().subscribe((result) => {
        if (result) {
          this.snackBar.open('Фото профиля успешно обновлено', 'Закрыть', { duration: 3000 });
        }
      });
    }
  }

  private handleAvatarAction(action: AvatarAction): void {
    switch (action) {
      case 'camera':
      case 'gallery': {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (action === 'camera') {
          input.capture = 'user';
        }
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
    this.isLoading.set(true);
    const user = this.authService.getCurrentUser();
    const userId = user?.id || user?.uid;
    if (!userId) {
      this.isLoading.set(false);
      return;
    }

    const path = `avatars/${userId}/${file.name}`;
    this.fileStorageService.uploadFile(path, file).subscribe({
      next: (downloadURL) => {
        if (downloadURL) {
          this.authService.updateProfilePhoto(downloadURL).subscribe({
            next: () => {
              this.snackBar.open('Фото профиля обновлено', 'Закрыть', { duration: 3000 });
              this.isLoading.set(false);
            },
            error: (err) => {
              this.handleError(err, 'Ошибка обновления фото');
              this.isLoading.set(false);
            },
          });
        }
      },
      error: (err) => {
        this.handleError(err, 'Ошибка загрузки файла');
        this.isLoading.set(false);
      },
    });
  }

  private removeAvatar(): void {
    this.isLoading.set(true);
    this.authService.updateProfilePhoto('').subscribe({
      next: () => {
        this.snackBar.open('Фото профиля удалено', 'Закрыть', { duration: 3000 });
        this.isLoading.set(false);
      },
      error: (err) => {
        this.handleError(err, 'Ошибка удаления фото');
        this.isLoading.set(false);
      },
    });
  }

  // ===== Legacy form save (kept for desktop compatibility) =====

  saveProfile(): void {
    if (!this.profileForm.valid) return;

    this.isLoading.set(true);
    const formData = this.profileForm.getRawValue();
    const currentUser = this.authService.currentUser();

    this.userApiService.updateCurrentUserProfile({
      displayName: formData.displayName,
      phoneNumber: formData.phoneNumber,
      personalData: {
        firstName: formData.firstName,
        lastName: formData.lastName,
        dateOfBirth: formData.dateOfBirth
          ? (formData.dateOfBirth as Date).toISOString()
          : undefined,
        preferences: currentUser?.personal_data?.preferences || {},
      },
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open('Профиль успешно обновлён', 'Закрыть', { duration: 3000 });
          this.profileForm.markAsPristine();
        } else {
          this.snackBar.open(response.message || 'Ошибка при обновлении профиля', 'Закрыть', { duration: 5000 });
        }
      },
      error: (error) => this.handleError(error, 'Ошибка при обновлении профиля'),
      complete: () => this.isLoading.set(false),
    });
  }

  // ===== Verification =====

  sendEmailVerification(): void {
    this.isLoading.set(true);
    this.authService.sendEmailVerification().subscribe({
      next: () =>
        this.snackBar.open(
          'Письмо с подтверждением отправлено на ваш email',
          'Закрыть',
          { duration: 5000 }
        ),
      error: (err) => this.handleError(err, 'Ошибка при отправке подтверждения'),
      complete: () => this.isLoading.set(false),
    });
  }

  changePassword(): void {
    const email = this.authService.currentUser()?.email;
    if (!email) return;

    this.isLoading.set(true);
    this.authService.sendPasswordResetEmail(email).subscribe({
      next: () =>
        this.snackBar.open(
          'Ссылка для смены пароля отправлена на ваш email',
          'Закрыть',
          { duration: 5000 }
        ),
      error: (err) => this.handleError(err, 'Ошибка при отправке ссылки'),
      complete: () => this.isLoading.set(false),
    });
  }

  deleteAccount(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Удаление аккаунта',
        message:
          'Вы уверены, что хотите удалить свой аккаунт? <strong>Это действие нельзя отменить.</strong>',
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
            this.snackBar.open('Аккаунт успешно удалён', 'Закрыть', { duration: 3000 });
            this.router.navigate(['/']);
          },
          error: (err) => this.handleError(err, 'Ошибка при удалении аккаунта'),
          complete: () => this.isLoading.set(false),
        });
      }
    });
  }

  sendPhoneCode(): void {
    const phone = this.authService.currentUser()?.phone;
    if (!phone) return;

    this.phoneVerifyLoading.set(true);
    this.authService.sendPhoneCode(phone, 'phone_verify').subscribe({
      next: () => {
        this.phoneVerifyStep.set('code_sent');
        this.phoneCodeControl.reset();
        this.snackBar.open(`Код отправлен на ${phone}`, 'Закрыть', { duration: 4000 });
      },
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Ошибка отправки кода';
        this.snackBar.open(msg, 'Закрыть', { duration: 5000 });
      },
      complete: () => this.phoneVerifyLoading.set(false),
    });
  }

  verifyPhoneCode(): void {
    const phone = this.authService.currentUser()?.phone;
    const code = this.phoneCodeControl.value?.trim();
    if (!phone || !code) return;

    this.phoneVerifyLoading.set(true);
    this.authService.verifyPhone(phone, code).subscribe({
      next: () => {
        this.phoneVerifyStep.set('idle');
        this.phoneCodeControl.reset();
        this.snackBar.open('Телефон успешно подтверждён!', 'Закрыть', { duration: 4000 });
      },
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Неверный код';
        this.snackBar.open(msg, 'Закрыть', { duration: 5000 });
        this.phoneVerifyLoading.set(false);
      },
      complete: () => this.phoneVerifyLoading.set(false),
    });
  }

  toggle2FA(enabled: boolean): void {
    this.twoFactorLoading.set(true);
    const action = enabled
      ? this.authService.enable2FA('sms')
      : this.authService.disable2FA();

    action.subscribe({
      next: () => {
        this.is2FAEnabled.set(enabled);
        this.snackBar.open(
          enabled ? 'Двухфакторная аутентификация включена' : '2FA отключена',
          'Закрыть',
          { duration: 3000 }
        );
      },
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Ошибка изменения 2FA';
        this.snackBar.open(msg, 'Закрыть', { duration: 5000 });
      },
      complete: () => this.twoFactorLoading.set(false),
    });
  }

  private handleError(error: unknown, defaultMessage: string): void {
    const msg = error instanceof Error ? error.message : defaultMessage;
    this.snackBar.open(msg, 'Закрыть', { duration: 5000 });
    this.isLoading.set(false);
  }
}
