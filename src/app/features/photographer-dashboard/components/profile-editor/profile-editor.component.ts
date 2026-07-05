import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, ElementRef, viewChild } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

// Angular Material
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { DragDropModule, moveItemInArray, CdkDragDrop } from '@angular/cdk/drag-drop';

// Сервисы и модели
import { PhotographerProfileService } from '../../services/photographer-profile.service';
import { AuthService } from '../../../../core/services/auth.service';
import { 
  PhotographerProfile,
  ProfileUpdateRequest,
  PortfolioItem
} from '../../models/photographer-profile.models';

// Компоненты
import { ProfileExtendedFieldsComponent } from '../profile-extended-fields/profile-extended-fields.component';
import { LoggerService } from '../../../../core/services/logger.service';

type ExtendedFieldsData = Partial<Pick<ProfileUpdateRequest,
  'education' | 'professionalCertifications' | 'achievements' | 'languages' |
  'travelRadius' | 'signatureStyle' | 'workStyle' | 'collaborationPreferences'
>>;

interface AvailableService {
  id: string;
  name: string;
  displayCategory: string;
  category: string;
}

@Component({
  selector: 'app-profile-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./profile-editor.component.css'],  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatToolbarModule,
    MatBadgeModule,
    MatTooltipModule,
    MatExpansionModule,
    MatDividerModule,
    MatDatepickerModule,
    MatNativeDateModule,
    DragDropModule,
    ProfileExtendedFieldsComponent
  ],  template: `
    <div class="profile-editor">
      <!-- Заголовок страницы -->
      <div class="page-header">
        <h1>Редактирование профиля</h1>
        <p>Управление информацией профиля, портфолио и настройками уведомлений</p>
      </div>

      <!-- Вкладки с настройками -->
      <mat-tab-group [selectedIndex]="selectedTabIndex()" (selectedTabChange)="onTabChange($event)">
          <!-- Основная информация -->
        <mat-tab label="Основная информация">
          <div class="tab-content">
            <!-- Основные данные профиля -->
            <mat-card class="profile-basic-card">
              <mat-card-header>                <mat-card-title>Личная информация</mat-card-title>
                <mat-card-subtitle>Основные данные профиля</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <!-- Загрузка изображений -->
                <div class="images-section">
                  <h3>Изображения профиля</h3>
                  <div class="form-row">                    <!-- Аватар -->
                    <div class="image-upload-section">
                      <span aria-label="Аватар">Аватар</span>
                      <div class="image-preview avatar-preview">
                        @if (profile()?.avatarUrl) {
                          <img 
                            [src]="profile()?.avatarUrl" 
                            [alt]="profile()?.name"
                            class="preview-image">
                        } @else {
                          <div class="preview-image placeholder-avatar">
                            <mat-icon>person</mat-icon>
                          </div>
                        }
                        <button mat-icon-button 
                                color="primary" 
                                class="change-image-btn"
                                (click)="selectAvatarImage()"
                                matTooltip="Изменить аватар">
                          <mat-icon>photo_camera</mat-icon>
                        </button>
                      </div>
                      <small>Рекомендуемый размер: 400x400px</small>
                      <input #avatarFileInput 
                             type="file" 
                             accept="image/*" 
                             style="display: none"
                             (change)="onAvatarImageSelected($event)">
                    </div>                    <!-- Обложка -->
                    <div class="image-upload-section">
                      <span aria-label="Обложка для публичной страницы">Обложка для публичной страницы</span>
                      <div class="image-preview cover-preview">
                        @if (coverImageUrl()) {
                          <img 
                            [src]="coverImageUrl()" 
                            alt="Обложка профиля"
                            class="preview-image">
                        } @else {
                          <div class="preview-image placeholder-cover">
                            <mat-icon>landscape</mat-icon>
                          </div>
                        }
                        <button mat-icon-button 
                                color="primary" 
                                class="change-image-btn"
                                (click)="selectCoverImage()"
                                matTooltip="Изменить обложку">
                          <mat-icon>photo_camera</mat-icon>
                        </button>
                      </div>
                      <small>Рекомендуемый размер: 1200x400px</small>
                      <input #coverFileInput 
                             type="file" 
                             accept="image/*" 
                             style="display: none"
                             (change)="onCoverImageSelected($event)">
                    </div>
                  </div>
                </div>

                <mat-divider style="margin: 24px 0;" />

                <form [formGroup]="profileForm" class="profile-form">
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>О себе</mat-label>
                    <textarea matInput 
                              formControlName="bio" 
                              rows="4" 
                              placeholder="Расскажите о своем опыте, стиле съемки и подходе к работе..."></textarea>
                    <mat-icon matSuffix>description</mat-icon>
                  </mat-form-field>                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Дата начала карьеры</mat-label>
                    <input matInput [matDatepicker]="careerStartPicker" formControlName="careerStartDate" placeholder="Выберите дату">
                    <mat-datepicker-toggle matIconSuffix [for]="careerStartPicker" />
                    <mat-datepicker #careerStartPicker startView="multi-year" />
                    <mat-hint>Опыт работы: {{ calculateExperience() }}</mat-hint>
                  </mat-form-field>

                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Специализации</mat-label>
                    <mat-select formControlName="specializations" multiple>
                      <mat-option value="portrait">Портретная съемка</mat-option>
                      <mat-option value="wedding">Свадебная съемка</mat-option>
                      <mat-option value="family">Семейная съемка</mat-option>
                      <mat-option value="children">Детская съемка</mat-option>
                      <mat-option value="corporate">Корпоративная съемка</mat-option>
                      <mat-option value="fashion">Fashion съемка</mat-option>
                      <mat-option value="event">Съемка мероприятий</mat-option>
                      <mat-option value="product">Предметная съемка</mat-option>
                    </mat-select>
                    <mat-icon matSuffix>camera_alt</mat-icon>
                    <mat-hint>Опыт работы: {{ calculateExperience() }}</mat-hint>
                  </mat-form-field>
                </form>
              </mat-card-content>
            </mat-card>            <!-- Расширенная информация -->
            <mat-card class="profile-extended-card">
              <mat-card-content>
                <app-profile-extended-fields [initialData]="extendedFieldsData()"
                  (dataChange)="onExtendedFieldsChange($event)" />
              </mat-card-content>
            </mat-card>

            <!-- Кнопки сохранения -->
            <div class="profile-actions">
              <button mat-raised-button 
                      color="primary" 
                      (click)="saveCompleteProfile()"
                      [disabled]="!profileForm.valid || isLoading()">
                <mat-icon>save</mat-icon>
                Сохранить всё
              </button>
              <button mat-button (click)="resetProfileForm()">
                <mat-icon>refresh</mat-icon>
                Отменить изменения
              </button>
            </div>
          </div>
        </mat-tab>

        <!-- Портфолио -->
        <mat-tab label="Портфолио">
          <div class="tab-content"><!-- Загрузка новых фото -->
            <mat-card class="upload-card">
              <mat-card-header>
                <mat-card-title>Добавить фотографии</mat-card-title>
                <mat-card-subtitle>Выберите услугу и загрузите фотографии для портфолио</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <!-- Выбор услуги -->
                <mat-form-field appearance="outline" class="service-select">
                  <mat-label>К какой услуге относятся фотографии?</mat-label>
                  <mat-select [value]="selectedServiceForUpload()" (selectionChange)="selectedServiceForUpload.set($event.value)">
                    <mat-option value="">Общее портфолио</mat-option>
                    @for (service of availableServices(); track service.id || $index) {
                      <mat-option [value]="service.id">
                        {{ service.name }} ({{ service.displayCategory }})
                      </mat-option>
                    }
                  </mat-select>
                  <mat-hint>Выберите услугу, к которой относятся загружаемые фотографии</mat-hint>
                </mat-form-field>

                <div class="upload-zone"
                     (click)="selectPortfolioImages()"
                     (keydown.enter)="selectPortfolioImages()"
                     tabindex="0"
                     (dragover)="onDragOver($event)"
                     (dragleave)="onDragLeave($event)"
                     (drop)="onDrop($event)"
                     [class.drag-over]="isDragOver()">
                  <mat-icon class="upload-icon">cloud_upload</mat-icon>
                  <p>Перетащите фотографии сюда или нажмите для выбора</p>
                  <small>Поддерживаются форматы: JPEG, PNG, WebP (до 10MB)</small>
                </div>
                <input #portfolioFileInput 
                       type="file" 
                       accept="image/*" 
                       multiple 
                       style="display: none"
                       (change)="onPortfolioImagesSelected($event)">
              </mat-card-content>
            </mat-card>

            <!-- Превью загружаемых фото -->
            @if (uploadPreviews().length > 0) {
              <mat-card class="preview-card">
                <mat-card-header>
                  <mat-card-title>Предварительный просмотр</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  <div class="upload-previews">
                    @for (preview of uploadPreviews(); track preview.url || $index; let i = $index) {
                      <div class="upload-preview">
                        <img [src]="preview.url" [alt]="preview.file.name">
                        <div class="preview-overlay">
                          <button mat-icon-button (click)="removeUploadPreview(i)">
                            <mat-icon>close</mat-icon>
                          </button>
                        </div>
                        <div class="preview-info">
                          <small>{{ preview.file.name }}</small>
                        </div>
                      </div>
                    }
                  </div>
                  <div class="upload-actions">
                    <button mat-raised-button 
                            color="primary" 
                            (click)="uploadPortfolioImages()"
                            [disabled]="isUploading()">
                      <mat-icon>upload</mat-icon>
                      Загрузить ({{ uploadPreviews().length }})
                    </button>
                    <button mat-button (click)="clearUploadPreviews()">
                      Очистить
                    </button>
                  </div>
                </mat-card-content>
              </mat-card>
            }

            <!-- Существующее портфолио -->
            <mat-card class="portfolio-card">
              <mat-card-header>                <mat-card-title>
                  Мое портфолио 
                  <mat-chip-set>
                    <mat-chip>{{ portfolio().length }} всего</mat-chip>
                    @if (selectedPortfolioFilter()) {
                      <mat-chip>{{ filteredPortfolio().length }} показано</mat-chip>
                    }
                  </mat-chip-set>
                </mat-card-title>
                <mat-card-subtitle>Управление вашими работами</mat-card-subtitle>
              </mat-card-header>              <mat-card-content>                <!-- Фильтр по услугам -->
                <div class="portfolio-filters" style="margin-bottom: 16px;">
                  <mat-form-field appearance="outline" style="width: 300px;">
                    <mat-label>Показать фото по услуге</mat-label>
                    <mat-select [value]="selectedPortfolioFilter()" (selectionChange)="selectedPortfolioFilter.set($event.value)">
                      <mat-option value="">Все фото</mat-option>
                      <mat-option value="general">Общее портфолио</mat-option>
                      @for (service of availableServices(); track service.id || $index) {
                        <mat-option [value]="service.id">
                          {{ service.name }}
                        </mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>

                <div class="portfolio-grid" 
                     cdkDropList 
                     (cdkDropListDropped)="onPortfolioReorder($event)">
                  @for (item of filteredPortfolio(); track item.id || $index) {
                    <div 
                      class="portfolio-item"
                      cdkDrag>                    <img [src]="item.thumbnailUrl || item.imageUrl" 
                         [alt]="item.title"
                         class="portfolio-image"
                         (error)="onImageError($event, item)">
                    <div class="portfolio-overlay">
                      <div class="portfolio-actions">
                        <button mat-icon-button (click)="editPortfolioItem(item)">
                          <mat-icon>edit</mat-icon>
                        </button>
                        <button mat-icon-button 
                                color="warn" 
                                (click)="deletePortfolioItem(item)">
                          <mat-icon>delete</mat-icon>
                        </button>
                      </div>                      <div class="portfolio-info">
                        <span class="portfolio-title">{{ item.title || 'Без названия' }}</span>
                        <span class="portfolio-category">{{ getServiceNameById(item.serviceId) || 'Общее портфолио' }}</span>
                      </div>
                    </div>
                    @if (item.featured) {
                      <mat-icon class="featured-badge">star</mat-icon>
                    }
                    </div>
                  }
                </div>
                @if (filteredPortfolio().length === 0) {
                  <div class="empty-portfolio">
                  <mat-icon>photo_library</mat-icon>
                    <h3>{{ selectedPortfolioFilter() ? 'Нет фото в этой категории' : 'Портфолио пустое' }}</h3>
                    <p>{{ selectedPortfolioFilter() ? 'Загрузите фотографии для этой услуги' : 'Добавьте свои лучшие работы, чтобы привлечь клиентов' }}</p>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>        <!-- Уведомления -->
        <mat-tab label="Уведомления">
          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-card-title>Настройки уведомлений</mat-card-title>
                <mat-card-subtitle>Подключите мессенджеры для получения уведомлений о новых записях</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <form [formGroup]="notificationsForm" class="notifications-form">
                  <div class="notification-section">
                    <h3>
                      <mat-icon>telegram</mat-icon>
                      Telegram уведомления
                    </h3>
                    <mat-slide-toggle formControlName="telegramEnabled">
                      Получать уведомления в Telegram
                    </mat-slide-toggle>
                    @if (notificationsForm.get('telegramEnabled')?.value) {
                      <mat-form-field appearance="outline">
                        <mat-label>Telegram ID или &#64;username</mat-label>
                      <input matInput formControlName="telegramId" placeholder="&#64;username или числовой ID">
                        <mat-icon matSuffix>alternate_email</mat-icon>
                        <mat-hint>Укажите ваш Telegram ID или username для получения уведомлений</mat-hint>
                      </mat-form-field>
                    }
                  </div>

                  <mat-divider />

                  <div class="notification-section">
                    <h3>
                      <mat-icon>chat</mat-icon>
                      WhatsApp уведомления
                    </h3>
                    <mat-slide-toggle formControlName="whatsappEnabled">
                      Получать уведомления в WhatsApp
                    </mat-slide-toggle>
                    @if (notificationsForm.get('whatsappEnabled')?.value) {
                      <mat-form-field appearance="outline">
                        <mat-label>Номер телефона</mat-label>
                      <input matInput formControlName="whatsappPhone" placeholder="+7 999 123 45 67">
                        <mat-icon matSuffix>phone</mat-icon>
                        <mat-hint>Номер телефона должен быть привязан к WhatsApp</mat-hint>
                      </mat-form-field>
                    }
                  </div>

                  <mat-divider />

                  <div class="notification-section">
                    <h3>
                      <mat-icon>notifications</mat-icon>
                      Типы уведомлений
                    </h3>
                    <mat-slide-toggle formControlName="newBookingNotifications">
                      Новые записи клиентов
                    </mat-slide-toggle>
                    <mat-slide-toggle formControlName="bookingUpdatesNotifications">
                      Изменения в записях
                    </mat-slide-toggle>
                    <mat-slide-toggle formControlName="cancellationNotifications">
                      Отмены записей
                    </mat-slide-toggle>
                    <mat-slide-toggle formControlName="paymentNotifications">
                      Уведомления об оплате
                    </mat-slide-toggle>
                    <mat-slide-toggle formControlName="reviewNotifications">
                      Новые отзывы
                    </mat-slide-toggle>
                  </div>

                  <mat-divider />

                  <div class="notification-section">
                    <h3>
                      <mat-icon>schedule</mat-icon>
                      Время уведомлений
                    </h3>
                    <div class="form-row">
                      <mat-form-field appearance="outline">
                        <mat-label>Не беспокоить с</mat-label>
                        <input matInput type="time" formControlName="doNotDisturbStart">
                        <mat-icon matSuffix>bedtime</mat-icon>
                      </mat-form-field>
                      <mat-form-field appearance="outline">
                        <mat-label>Не беспокоить до</mat-label>
                        <input matInput type="time" formControlName="doNotDisturbEnd">
                        <mat-icon matSuffix>wb_sunny</mat-icon>
                      </mat-form-field>
                    </div>
                  </div>
                </form>
              </mat-card-content>
              <mat-card-actions>
                <button mat-raised-button 
                        color="primary" 
                        (click)="saveNotificationSettings()"
                        [disabled]="!notificationsForm.valid || isLoading()">
                  <mat-icon>save</mat-icon>
                  Сохранить настройки
                </button>
                <button mat-button (click)="testNotifications()" [disabled]="isLoading()">
                  <mat-icon>send</mat-icon>
                  Тестовое уведомление
                </button>
              </mat-card-actions>
            </mat-card>
          </div>        </mat-tab>
      </mat-tab-group>

      <!-- Индикатор загрузки -->
      @if (isLoading()) {
        <div class="loading-overlay">
          <mat-progress-spinner mode="indeterminate" diameter="60" />
          <p>{{ loadingMessage() }}</p>
        </div>
      }
    </div>
  `
})
export class ProfileEditorComponent implements OnInit {
  // ViewChild ссылки на файловые инпуты
  readonly avatarFileInput = viewChild.required<ElementRef<HTMLInputElement>>('avatarFileInput');
  readonly coverFileInput = viewChild.required<ElementRef<HTMLInputElement>>('coverFileInput');
  readonly portfolioFileInput = viewChild.required<ElementRef<HTMLInputElement>>('portfolioFileInput');

  // Инжектированные сервисы
  private readonly profileService = inject(PhotographerProfileService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly http = inject(HttpClient);
  private log = inject(LoggerService);

  // Сигналы состояния
  readonly isLoading = signal(false);
  readonly isUploading = signal(false);
  readonly isDragOver = signal(false);
  readonly selectedTabIndex = signal(0);
  readonly loadingMessage = signal('');
  readonly uploadProgress = signal(0);
  // Данные профиля
  readonly profile = signal<PhotographerProfile | null>(null);
  readonly profileStats = signal<{ totalPhotos: number; totalBookings: number; averageRating: number; totalReviews: number } | null>(null);
  readonly portfolio = signal<PortfolioItem[]>([]);
  readonly coverImageUrl = signal<string | null>(null);
  
  // Расширенные поля профиля
  readonly extendedFieldsData = signal<ExtendedFieldsData>({});
  private extendedFieldsChanges: ExtendedFieldsData = {};

  // Превью загружаемых файлов
  readonly uploadPreviews = signal<{ file: File; url: string; category?: string; serviceId?: string }[]>([]);
  // Услуги и выбор услуги для загрузки
  readonly availableServices = signal<AvailableService[]>([]);
  readonly selectedServiceForUpload = signal<string>('');

  // Фильтрация портфолио
  readonly selectedPortfolioFilter = signal<string>('');
  readonly filteredPortfolio = computed(() => {
    const filter = this.selectedPortfolioFilter();
    const allPortfolio = this.portfolio();
    
    if (!filter) return allPortfolio; // Показать все
    if (filter === 'general') return allPortfolio.filter(item => !item.serviceId); // Общее портфолио
    return allPortfolio.filter(item => item.serviceId === filter); // Конкретная услуга
  });
  // Формы
  profileForm!: FormGroup;
  notificationsForm!: FormGroup;

  // Константы
  readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  readonly ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Отслеживание ошибок загрузки изображений
  imageErrorFlags: Record<string, boolean> = {};

  ngOnInit() {
    this.initializeForms();
    this.loadProfile();
    this.loadProfileStats();
    this.loadAvailableServices();  }  private initializeForms() {
    this.profileForm = this.fb.group({
      bio: ['', Validators.maxLength(1000)],
      careerStartDate: ['', Validators.required],
      specializations: [[]]
    });

    this.notificationsForm = this.fb.group({
      telegramEnabled: [false],
      telegramId: [''],
      whatsappEnabled: [false],
      whatsappPhone: [''],
      newBookingNotifications: [true],
      bookingUpdatesNotifications: [true],
      cancellationNotifications: [true],
      paymentNotifications: [true],
      reviewNotifications: [true],
      doNotDisturbStart: ['22:00'],
      doNotDisturbEnd: ['08:00']
    });
  }
  private async loadProfile() {
    this.isLoading.set(true);
    this.loadingMessage.set('Загружаем профиль...');

    try {
      const profile = await firstValueFrom(this.profileService.getProfile());
      
      if (!profile) {
        throw new Error('Profile data is empty');
      }      this.profile.set(profile);
      this.coverImageUrl.set(profile.coverImageUrl || null);

      // Загружаем портфолио отдельно из MinIO
      try {
        const portfolio = await firstValueFrom(this.profileService.getPortfolio());
        this.portfolio.set(portfolio || []);
      } catch (portfolioError) {
        this.log.error('Error loading portfolio:', portfolioError);
        this.portfolio.set([]);
      }// Заполняем форму основными данными
      this.profileForm.patchValue({
        bio: profile.bio,
        careerStartDate: profile.careerStartDate || '',
        specializations: profile.specializations || []
      });

      // Заполняем форму уведомлений
      this.notificationsForm.patchValue(profile.notificationSettings || {});// Загружаем расширенные поля в отдельный компонент
      const extendedData = {
        education: profile.education,
        professionalCertifications: profile.professionalCertifications,
        languages: profile.languages,
        achievements: profile.achievements,
        travelRadius: profile.travelRadius,
        signatureStyle: profile.signatureStyle,
        workStyle: profile.workStyle,
        collaborationPreferences: profile.collaborationPreferences
      };
      
      this.log.debug('🔍 Setting extendedFieldsData:', {
        profileProfessionalCertifications: profile.professionalCertifications,
        extendedData
      });
        this.extendedFieldsData.set(extendedData);

    } catch (error) {
      this.showError('Ошибка загрузки профиля');
      this.log.error('Error loading profile:', error);
    } finally {
      this.isLoading.set(false);
    }
  }


  // ============================================================
  // МЕТОДЫ ДЛЯ РАБОТЫ С ИЗОБРАЖЕНИЯМИ И ФАЙЛАМИ
  // ============================================================

  /**
   * Выбор аватара
   */
  selectAvatarImage() {
    this.avatarFileInput().nativeElement.click();
  }

  /**
   * Обработка выбора аватара
   */
  async onAvatarImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) return;
    
    if (!this.validateImageFile(file)) {
      input.value = '';
      return;
    }

    this.isUploading.set(true);
    this.loadingMessage.set('Загружаем аватар...');

    try {
      // The service now returns void, as the AuthService handles the profile update.
      await firstValueFrom(this.profileService.uploadAvatar(file));
      
      // After upload, we need to refresh the profile to get the new URL.
      await this.loadProfile();
      
      this.showSuccess('Аватар успешно загружен');
      
      input.value = '';
    } catch (error) {
      this.log.error('Error uploading avatar:', error);
      this.showError('Ошибка загрузки аватара');
      input.value = '';
    } finally {
      this.isUploading.set(false);
    }
  }

  /**
   * Выбор обложки
   */
  selectCoverImage() {
    this.coverFileInput().nativeElement.click();
  }

  /**
   * Обработка выбора обложки
   */
  async onCoverImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) return;
    
    if (!this.validateImageFile(file)) {
      input.value = '';
      return;
    }

    this.isUploading.set(true);
    this.loadingMessage.set('Загружаем обложку...');    try {
      await firstValueFrom(this.profileService.uploadCover(file));
      
      // After upload, we need to refresh the profile to get the new URL.
      await this.loadProfile();
      
      this.showSuccess('Обложка успешно загружена');
      
      input.value = '';
    } catch (error) {
      this.log.error('Error uploading cover:', error);
      this.showError('Ошибка загрузки обложки');
      input.value = '';
    } finally {
      this.isUploading.set(false);
    }
  }

  /**
   * Выбор фотографий для портфолио
   */
  selectPortfolioImages() {
    this.portfolioFileInput().nativeElement.click();
  }

  /**
   * Обработка выбора фотографий портфолио
   */
  async onPortfolioImagesSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    
    if (files.length === 0) return;

    this.processPortfolioFiles(files);
    input.value = '';
  }

  /**
   * Обработка drag & drop
   */
  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);

    const files = Array.from(event.dataTransfer?.files || []);
    this.processPortfolioFiles(files);
  }

  /**
   * Обработка файлов портфолио
   */
  private processPortfolioFiles(files: File[]) {
    const validFiles: File[] = [];
    
    for (const file of files) {
      if (this.validateImageFile(file)) {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) {
      this.showError('Не выбраны подходящие файлы');
      return;
    }    // Создаем превью
    const previews = validFiles.map(file => ({
      file,
      url: URL.createObjectURL(file),
      category: 'event' // автоматически в категорию фотосъемки
    }));

    this.uploadPreviews.set([...this.uploadPreviews(), ...previews]);
  }

  /**
   * Удаление превью
   */
  removePreview(index: number) {
    const previews = this.uploadPreviews();
    URL.revokeObjectURL(previews[index].url);
    previews.splice(index, 1);
    this.uploadPreviews.set([...previews]);
  }  /**
   * Загрузка фотографий портфолио
   */
  async uploadPortfolioImages() {
    const previews = this.uploadPreviews();
    if (previews.length === 0) return;

    const selectedService = this.selectedServiceForUpload();
    this.isUploading.set(true);
    this.loadingMessage.set('Загружаем фотографии...');

    try {
      const files = previews.map(p => p.file);
      await firstValueFrom(this.profileService.uploadPortfolioImagesWithService(files, selectedService || null));
      
      // Clear previews
      previews.forEach(preview => URL.revokeObjectURL(preview.url));
      this.uploadPreviews.set([]);

      // Refresh portfolio from the server
      await this.loadProfile(); // This reloads the portfolio as well
      
      this.showSuccess(`Загружено ${files.length} фотографий`);
      this.selectedServiceForUpload.set('');
    } catch (error) {
      this.showError('Ошибка загрузки фотографий');
      this.log.error('Error uploading portfolio images:', error);
    } finally {
      this.isUploading.set(false);
    }
  }

  /**
   * Удаление фотографии из портфолио
   */
  async deletePortfolioItem(itemToDelete: PortfolioItem) {
    try {
      this.isLoading.set(true);
      this.loadingMessage.set('Удаляем фотографию...');

      await firstValueFrom(this.profileService.deletePortfolioItem(itemToDelete));
      
      // Обновляем портфолио в состоянии
      const currentPortfolio = this.portfolio();
      const updatedPortfolio = currentPortfolio.filter(item => item.id !== itemToDelete.id);
      this.portfolio.set(updatedPortfolio);
      
      this.showSuccess('Фотография удалена из портфолио');
    } catch (error) {
      this.log.error('Error deleting portfolio item:', error);
      this.showError('Ошибка удаления фотографии');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Валидация файла изображения
   */
  private validateImageFile(file: File): boolean {
    // Проверка типа файла
    if (!this.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.showError('Неподдерживаемый формат файла. Используйте JPEG, PNG или WebP');
      return false;
    }

    // Проверка размера файла
    if (file.size > this.MAX_FILE_SIZE) {
      this.showError('Файл слишком большой. Максимальный размер: 10MB');
      return false;
    }

    return true;
  }

  /**
   * Переключение вкладок
   */
  onTabChange(event: { index: number }) {
    this.selectedTabIndex.set(event.index);
  }

  /**
   * Загрузка статистики профиля
   */
  private async loadProfileStats() {
    try {
      // TODO: Добавить реальный API endpoint для статистики
      const mockStats = {
        totalPhotos: this.portfolio().length,
        totalBookings: 42,
        averageRating: 4.8,
        totalReviews: 18
      };
      
      this.profileStats.set(mockStats);
    } catch (error) {
      this.log.error('Error loading profile stats:', error);
    }
  }

  /**
   * Загрузка доступных услуг для портфолио
   */
  private async loadAvailableServices() {
    try {
      // Используем тот же API что и для управления услугами
      interface ServiceApiItem { id: string; name: string; category: string; mainCategory: string }
      const response = await this.http.get<{ success: boolean; data: { servicesByCategory: Record<string, ServiceApiItem[]> } }>('/api/photographers/me/services/manage').toPromise();

      if (response?.success && response.data?.servicesByCategory) {
        const services: AvailableService[] = [];

        // Извлекаем все услуги из категорий
        Object.values(response.data.servicesByCategory).forEach((categoryServices) => {
          if (Array.isArray(categoryServices)) {
            services.push(...categoryServices.map((service) => ({
              id: service.id,
              name: service.name,
              displayCategory: service.category,
              category: service.mainCategory
            })));
          }
        });
        
        this.availableServices.set(services);
      }
    } catch (error) {
      this.log.error('Error loading available services:', error);
      // Если ошибка - используем пустой массив
      this.availableServices.set([]);
    }
  }

  /**
   * Сохранение профиля
   */
  async saveProfile() {
    if (!this.profileForm.valid) return;

    this.isLoading.set(true);
    this.loadingMessage.set('Сохраняем профиль...');

    try {
      const formData = this.profileForm.value;
      const updateRequest: ProfileUpdateRequest = {
        displayName: formData.displayName,
        bio: formData.bio,
        location: {
          city: formData.city
        },
        specializations: formData.specializations
      };

      await firstValueFrom(this.profileService.updateProfile(updateRequest));
      this.showSuccess('Профиль успешно обновлен');
    } catch (error) {
      this.showError('Ошибка сохранения профиля');
      this.log.error('Error saving profile:', error);
    } finally {
      this.isLoading.set(false);
    }
  }
  /**
   * Сохранение полного профиля (основные данные + расширенные поля)
   */
  async saveCompleteProfile() {
    if (!this.profileForm.valid) {
      this.showError('Пожалуйста, заполните все обязательные поля');
      return;
    }

    this.isLoading.set(true);
    this.loadingMessage.set('Сохраняем профиль...');

    try {      // Сохраняем основные данные профиля
      const formData = this.profileForm.value;
      const updateRequest: ProfileUpdateRequest = {
        bio: formData.bio,
        careerStartDate: formData.careerStartDate,
        specializations: formData.specializations,
        
        // Добавляем расширенные поля если они есть
        ...(this.extendedFieldsData() && {
          education: this.extendedFieldsData()?.education,
          professionalCertifications: this.extendedFieldsData()?.professionalCertifications,
          achievements: this.extendedFieldsData()?.achievements,
          languages: this.extendedFieldsData()?.languages
        })
      };

      this.log.debug('🔍 saveCompleteProfile - sending update request:', updateRequest);

      await firstValueFrom(this.profileService.updateProfile(updateRequest));
      this.showSuccess('Профиль полностью обновлен');
      
      // Перезагружаем данные для синхронизации
      await this.loadProfile();
      
    } catch (error) {
      this.showError('Ошибка сохранения профиля');
      this.log.error('Error saving complete profile:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Сброс формы профиля
   */
  resetProfileForm() {
    this.loadProfile(); // Перезагружаем данные
  }

  /**
   * Удаление превью загрузки
   */
  removeUploadPreview(index: number) {
    this.removePreview(index);
  }

  /**
   * Очистка всех превью
   */
  clearUploadPreviews() {
    const previews = this.uploadPreviews();
    previews.forEach(preview => URL.revokeObjectURL(preview.url));
    this.uploadPreviews.set([]);
  }  /**
   * Обработка изменения порядка портфолио
   */
  onPortfolioReorder(event: CdkDragDrop<PortfolioItem[]>) {
    this.log.debug('Portfolio reorder:', event);
    
    const currentPortfolio = [...this.portfolio()];
    moveItemInArray(currentPortfolio, event.previousIndex, event.currentIndex);
    
    this.portfolio.set(currentPortfolio);
    this.showSuccess('Порядок фотографий изменен');
  }/**
   * Получение названия услуги по ID
   */
  getServiceNameById(serviceId: string | null | undefined): string {
    if (!serviceId) return 'Общее портфолио';
    const service = this.availableServices().find(s => s.id === serviceId);
    return service?.name || 'Неизвестная услуга';
  }

  /**
   * Обработка изменения фильтра портфолио
   */
  onPortfolioFilterChange(): void {
    // Метод вызывается автоматически благодаря computed signal
    this.log.debug('Portfolio filter changed to:', this.selectedPortfolioFilter());
  }

  // Утилиты
  private showSuccess(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }
  private showError(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  // ============================================================
  // ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ ДЛЯ РАБОТЫ С ПОРТФОЛИО И НАСТРОЙКАМИ
  // ============================================================
  /**
   * Редактирование элемента портфолио
   */
  editPortfolioItem(item: PortfolioItem) {
    this.log.debug('Editing portfolio item:', item);
    
    // Простое редактирование через prompt (временное решение)
    const newTitle = prompt('Введите название фотографии:', item.title || '');
    if (newTitle !== null) {
      // Обновляем локально (пока без сохранения на сервер)
      const currentPortfolio = this.portfolio();
      const updatedPortfolio = currentPortfolio.map(p => 
        p.id === item.id ? { ...p, title: newTitle } : p
      );
      this.portfolio.set(updatedPortfolio);
      this.showSuccess('Название фотографии обновлено');
    }
  }


  /**
   * Сохранение настроек социальных сетей
   */
  async saveSocialMedia() {
    try {
      this.isLoading.set(true);
      this.loadingMessage.set('Сохраняем настройки соц. сетей...');

      const socialMediaData = {
        // TODO: Добавить реальные поля из формы
        instagram: '', // this.socialMediaForm.get('instagram')?.value || '',
        vk: '', // this.socialMediaForm.get('vk')?.value || '',
        telegram: '', // this.socialMediaForm.get('telegram')?.value || '',
      };

      await firstValueFrom(this.profileService.updateSocialMedia(socialMediaData));
      this.showSuccess('Настройки социальных сетей сохранены');
    } catch (error) {
      this.log.error('Error saving social media:', error);
      this.showError('Ошибка сохранения настроек соц. сетей');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Сохранение настроек приватности
   */
  async savePrivacySettings() {
    try {
      this.isLoading.set(true);
      this.loadingMessage.set('Сохраняем настройки приватности...');

      const privacyData = {
        // TODO: Добавить реальные поля из формы
        profileVisibility: 'public', // this.privacyForm.get('profileVisibility')?.value || 'public',
        showPhone: false, // this.privacyForm.get('showPhone')?.value || false,
        showEmail: false, // this.privacyForm.get('showEmail')?.value || false,
      };

      await firstValueFrom(this.profileService.updatePrivacySettings(privacyData));
      this.showSuccess('Настройки приватности сохранены');
    } catch (error) {
      this.log.error('Error saving privacy settings:', error);
      this.showError('Ошибка сохранения настроек приватности');
    } finally {
      this.isLoading.set(false);
    }
  }

  // ============================================================
  // МЕТОДЫ ДЛЯ РАБОТЫ С РАСШИРЕННЫМИ ПОЛЯМИ
  // ============================================================

  /**
   * Обработка изменений в расширенных полях
   */
  onExtendedFieldsChange(data: ExtendedFieldsData) {
    this.extendedFieldsChanges = data;
  }

  /**
   * Сохранение расширенных полей
   */  async saveExtendedFields() {
    try {
      this.isLoading.set(true);
      this.loadingMessage.set('Сохраняем профессиональную информацию...');

      const updateRequest: ProfileUpdateRequest = {
        ...this.extendedFieldsChanges
      };

      this.log.debug('🔍 saveExtendedFields - sending data:', {
        extendedFieldsChanges: this.extendedFieldsChanges,
        updateRequest
      });

      await firstValueFrom(this.profileService.updateProfile(updateRequest));
      this.showSuccess('Профессиональная информация сохранена');
      
      // Обновляем данные в профиле
      const currentProfile = this.profile();
      if (currentProfile) {
        this.profile.set({
          ...currentProfile,
          ...this.extendedFieldsChanges
        });
      }
      
    } catch (error) {
      this.log.error('Error saving extended fields:', error);
      this.showError('Ошибка сохранения профессиональной информации');
    } finally {
      this.isLoading.set(false);
    }
  }
  // ============================================================
  // УТИЛИТЫ
  // ============================================================
  /**
   * Вычисляет опыт работы на основе даты начала карьеры
   */
  calculateExperience(): string {
    const careerStartDate = this.profileForm.get('careerStartDate')?.value;
    
    if (!careerStartDate) {
      return '0 лет';
    }
    
    const startDate = new Date(careerStartDate);
    const currentDate = new Date();
    
    if (startDate > currentDate) {
      return '0 лет';
    }
    
    const diffInMs = currentDate.getTime() - startDate.getTime();
    const diffInYears = diffInMs / (1000 * 60 * 60 * 24 * 365.25);
    
    const years = Math.floor(diffInYears);
    const months = Math.floor((diffInYears - years) * 12);
    
    if (years === 0) {
      return months === 1 ? '1 месяц' : `${months} месяцев`;
    } else if (years === 1) {
      return months === 0 ? '1 год' : `1 год ${months} месяцев`;
    } else {
      return months === 0 ? `${years} лет` : `${years} лет ${months} месяцев`;
    }
  }

  /**
   * Сохранение настроек уведомлений
   */
  async saveNotificationSettings() {
    if (!this.notificationsForm.valid) {
      this.showError('Пожалуйста, заполните все обязательные поля');
      return;
    }

    this.isLoading.set(true);
    this.loadingMessage.set('Сохраняем настройки уведомлений...');

    try {
      const notificationSettings = this.notificationsForm.value;
      
      // Отправляем запрос на сервер
      await firstValueFrom(this.http.put('/api/photographers/me/notification-settings', notificationSettings));
      
      this.showSuccess('Настройки уведомлений сохранены');
    } catch (error) {
      this.log.error('Error saving notification settings:', error);
      this.showError('Ошибка сохранения настроек уведомлений');
    } finally {
      this.isLoading.set(false);
    }
  }
  /**
   * Отправка тестового уведомления
   */
  async testNotifications() {
    this.isLoading.set(true);
    this.loadingMessage.set('Отправляем тестовое уведомление...');

    try {
      await firstValueFrom(this.http.post('/api/photographers/me/test-notification', {}));
      this.showSuccess('Тестовое уведомление отправлено! Проверьте ваш мессенджер.');
    } catch (error) {
      this.log.error('Error sending test notification:', error);
      this.showError('Ошибка отправки тестового уведомления');
    } finally {
      this.isLoading.set(false);
    }
  }  // Обработка ошибок загрузки изображений
  onImageError(event: Event, item: PortfolioItem): void {
    const img = event.target as HTMLImageElement;
    const currentSrc = img.src;
    
    if (currentSrc.includes('thumbnail') && item.imageUrl !== item.thumbnailUrl) {
      // Если миниатюра не загрузилась, попробуем основное изображение
      this.log.debug('Thumbnail failed, trying main image:', item.imageUrl);
      img.src = item.imageUrl;
    } else {
      // Если и основное изображение не загрузилось, отмечаем ошибку
      this.log.warn('Image failed to load:', currentSrc);
      this.imageErrorFlags[item.id] = true;
      img.style.display = 'none'; // Скрываем битое изображение
    }
  }
}
