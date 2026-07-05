import { Component, ChangeDetectionStrategy, inject, input, output, OnInit, signal, ElementRef, viewChild } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { trigger, transition, style, animate, query, stagger } from '@angular/animations';

// Angular Material
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatBadgeModule } from '@angular/material/badge';

// Local components
import { ImagePreviewDialogComponent } from '../image-preview-dialog/image-preview-dialog.component';
import { LoggerService } from '../../../../core/services/logger.service';
import { ProfileUpdateRequest } from '../../models/photographer-profile.models';

/** Shape of the extended fields data passed to this component */
type ExtendedFieldsInputData = Partial<Pick<ProfileUpdateRequest,
  'education' | 'professionalCertifications' | 'achievements' | 'languages' |
  'travelRadius' | 'signatureStyle' | 'workStyle' | 'collaborationPreferences'
>>;

@Component({
  selector: 'app-profile-extended-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatExpansionModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatDialogModule,
    MatBadgeModule
],
  animations: [
    trigger('slideInOut', [
      transition(':enter', [
        style({ transform: 'translateY(-20px)', opacity: 0 }),
        animate('300ms ease-in-out', style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms ease-in-out', style({ transform: 'translateY(-20px)', opacity: 0 }))
      ])
    ]),
    trigger('staggerIn', [
      transition('* => *', [
        query(':enter', [
          style({ opacity: 0, transform: 'translateY(20px)' }),
          stagger(100, animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })))
        ], { optional: true })
      ])
    ]),
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-in', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms ease-out', style({ opacity: 0 }))
      ])
    ])
  ],  template: `
    <!-- Подсказка -->
    <div class="help-text">
      <mat-icon>info</mat-icon>
      <span>Заполните разделы ниже, это повысит доверие клиентов и поможет им лучше понять ваш опыт</span>
    </div>

    <form [formGroup]="extendedForm" class="extended-fields-form">

      <!-- Образование -->
      <mat-expansion-panel class="section-panel" [expanded]="true">
        <mat-expansion-panel-header>
          <mat-panel-title>
            <mat-icon>school</mat-icon>
            Образование
          </mat-panel-title>
        </mat-expansion-panel-header>        <!-- Высшее образование -->
        <div class="education-subsection">
          <h3>Высшее образование</h3>
          <div formArrayName="universities">
            @for (university of universitiesArray.controls; track $index; let i = $index) {
              <div
                 [formGroupName]="i"
                 class="education-card">

              <div class="card-header">
                <div class="card-info">
                  <h4>{{university.get('name')?.value || 'Новый университет'}}</h4>
                  <p>{{university.get('degree')?.value || 'Степень'}} • {{university.get('year')?.value || 'Год'}}</p>
                </div>
                <button mat-icon-button color="warn" (click)="removeUniversity(i)" matTooltip="Удалить">
                  <mat-icon>delete</mat-icon>
                </button>
              </div>

              <div class="card-content">
                <div class="education-fields">
                  <mat-form-field appearance="outline">
                    <mat-label>Университет</mat-label>
                    <input matInput formControlName="name" placeholder="Название университета">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Степень</mat-label>
                    <input matInput formControlName="degree" placeholder="Бакалавр, Магистр">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Год окончания</mat-label>
                    <input matInput formControlName="year" type="number" min="1950" [max]="currentYear">
                  </mat-form-field>
                </div>

                <!-- Миниатюра диплома -->
                @if (getDiplomaImageUrl(i)) {
                  <div class="document-thumbnail">
                    <img [src]="getDiplomaImageUrl(i)" alt="Диплом" class="thumbnail-image">
                    <div class="thumbnail-actions">
                      <button mat-icon-button matTooltip="Увеличить" (click)="openImagePreview(getDiplomaImageUrl(i), 'Диплом')">
                        <mat-icon>zoom_in</mat-icon>
                      </button>
                      <button mat-icon-button matTooltip="Заменить" (click)="selectDiplomaImage(i)">
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button mat-icon-button matTooltip="Удалить" color="warn" (click)="removeDiplomaImage(i, $event)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </div>
                }

                @if (!getDiplomaImageUrl(i)) {
                  <div class="upload-placeholder" tabindex="0" (click)="selectDiplomaImage(i)" (keydown.enter)="selectDiplomaImage(i)">
                    <mat-icon>add_photo_alternate</mat-icon>
                    <span>Загрузить диплом</span>
                  </div>
                }
              </div>
              </div>
            }
          </div>

          <button mat-stroked-button color="primary" (click)="addUniversity()" class="add-button">
            <mat-icon>add</mat-icon>
            Добавить университет
          </button>
        </div>

        <!-- Курсы и сертификаты -->
        <div class="education-subsection">
          <h3>Курсы и сертификаты</h3>
          <div formArrayName="courses">
            @for (course of coursesArray.controls; track $index; let i = $index) {
              <div
                 [formGroupName]="i"
                 class="education-card">

              <div class="card-header">
                <div class="card-info">
                  <h4>{{course.get('name')?.value || 'Новый курс'}}</h4>
                  <p>{{course.get('provider')?.value || 'Провайдер'}} • {{course.get('year')?.value || 'Год'}}</p>
                </div>
                <button mat-icon-button color="warn" (click)="removeCourse(i)" matTooltip="Удалить">
                  <mat-icon>delete</mat-icon>
                </button>
              </div>

              <div class="card-content">
                <div class="education-fields">
                  <mat-form-field appearance="outline">
                    <mat-label>Название курса</mat-label>
                    <input matInput formControlName="name" placeholder="Название курса">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Провайдер</mat-label>
                    <input matInput formControlName="provider" placeholder="Организация">
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Год получения</mat-label>
                    <input matInput formControlName="year" type="number" min="1950" [max]="currentYear">
                  </mat-form-field>
                </div>

                <!-- Миниатюра сертификата -->
                @if (getCertificateImageUrl(i)) {
                  <div class="document-thumbnail">
                    <img [src]="getCertificateImageUrl(i)" alt="Сертификат" class="thumbnail-image">
                    <div class="thumbnail-actions">
                      <button mat-icon-button matTooltip="Увеличить" (click)="openImagePreview(getCertificateImageUrl(i), 'Сертификат')">
                        <mat-icon>zoom_in</mat-icon>
                      </button>
                      <button mat-icon-button matTooltip="Заменить" (click)="selectCertificateImage(i)">
                        <mat-icon>edit</mat-icon>
                      </button>
                      <button mat-icon-button matTooltip="Удалить" color="warn" (click)="removeCertificateImage(i, $event)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </div>
                }

                @if (!getCertificateImageUrl(i)) {
                  <div class="upload-placeholder" tabindex="0" (click)="selectCertificateImage(i)" (keydown.enter)="selectCertificateImage(i)">
                    <mat-icon>add_photo_alternate</mat-icon>
                    <span>Загрузить сертификат</span>
                  </div>
                }
              </div>
              </div>
            }
          </div>

          <button mat-stroked-button color="primary" (click)="addCourse()" class="add-button">
            <mat-icon>add</mat-icon>
            Добавить курс
          </button>
        </div>      </mat-expansion-panel>

      <!-- Скрытые input'ы для загрузки файлов -->
      <input #diplomaFileInput type="file" accept="image/*" style="display: none" (change)="onDiplomaImageSelected($event, currentDiplomaIndex)">
      <input #certificateFileInput type="file" accept="image/*" style="display: none" (change)="onCertificateImageSelected($event, currentCertificateIndex)">      <input #profCertificateFileInput type="file" accept="image/*" style="display: none" (change)="onProfCertificateImageSelected($event, currentCertificateIndex)">
    </form>
    <!-- Индикатор загрузки с прогресс-баром -->
    @if (isUploading()) {
      <div class="loading-overlay" [@fadeInOut]>
        <div class="loading-content">
          <mat-progress-bar mode="determinate"
            [value]="uploadProgress()"
            class="upload-progress" />
          @if (uploadProgress() < 100) {
            <mat-spinner diameter="40" />
          }
          @if (uploadProgress() === 100) {
            <mat-icon class="success-icon">check_circle</mat-icon>
          }
          <p>{{uploadProgress() < 100 ? 'Загружаем...' : 'Готово!'}} {{uploadProgress()}}%</p>
        </div>
      </div>
    }
  `,  styles: [`
    /* Шапка страницы */
    .page-header {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: stretch;
      gap: 16px;
      padding: 24px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      margin-bottom: 24px;
    }

    .page-header h1 {
      margin: 0;
      font-size: 1.75rem;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
    }

    .header-actions {
      display: flex;
      gap: 12px;
    }

    /* Навигационные вкладки */
    .profile-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      padding-bottom: 0;
    }

    .tab-button {
      padding: 8px 12px;
      font-size: 0.75rem;
      border-radius: 8px 8px 0 0;
      color: #666;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      transition: all 0.2s ease;
    }

    .tab-button:hover {
      background: var(--mat-sys-surface-container-high);
      color: #333;
    }

    .tab-button.active {
      color: #1976d2;
      border-bottom-color: #1976d2;
      background: #1e3a5f;
    }

    /* Подсказка */
    .help-text {
      background: #1e3a5f;
      border: 1px solid #bbdefb;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
      color: #1565c0;
      font-size: 0.875rem;
    }

    /* Основная форма */
    .extended-fields-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Панели секций */
    .section-panel {
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      border: 1px solid var(--mat-sys-outline-variant);
    }

    /* Образование */
    .education-subsection {
      margin: 20px 0;
    }

    .education-subsection h3 {
      margin: 0 0 16px 0;
      font-size: 1.125rem;
      font-weight: 600;
      color: #333;
    }

    .education-card {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      background: var(--mat-sys-surface-container-high);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }

    .card-info h4 {
      margin: 0 0 4px 0;
      font-size: 1rem;
      font-weight: 500;
      color: #333;
    }

    .card-info p {
      margin: 0;
      font-size: 0.875rem;
      color: #666;
    }

    .card-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      align-items: flex-start;
    }

    .education-fields {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }

    /* Миниатюры документов */
    .document-thumbnail {
      position: relative;
      width: 160px;
      height: 120px;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-high);
    }

    .thumbnail-image {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .thumbnail-actions {
      position: absolute;
      top: 4px;
      right: 4px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .document-thumbnail:hover .thumbnail-actions {
      opacity: 1;
    }

    .thumbnail-actions button {
      width: 24px;
      height: 24px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
    }

    .upload-placeholder {
      width: 160px;
      height: 120px;
      border: 2px dashed #ccc;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #666;
      background: var(--mat-sys-surface-container-high);
      transition: all 0.2s ease;
    }

    .upload-placeholder:hover {
      border-color: #1976d2;
      background: #1e3a5f;
      color: #1976d2;
    }

    .upload-placeholder mat-icon {
      font-size: 24px;
      margin-bottom: 4px;
    }

    .upload-placeholder span {
      font-size: 0.75rem;
      text-align: center;
    }

    /* Секция добавления документа */
    .add-document-section {
      padding: 20px;
      text-align: center;
      border-top: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-high);
    }    .add-button {
      margin: 16px 0;
    }

    /* Языки и достижения */
    .languages-section,
    .achievements-section {
      margin: 20px 0;
    }

    .languages-section h3,
    .achievements-section h3 {
      margin: 0 0 12px 0;
      font-size: 1rem;
      font-weight: 500;
      color: #333;
    }

    .achievements-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .achievements-chips mat-chip {
      background: #1e3a5f;
      color: #1565c0;    }

    /* Плавающая кнопка добавления */
    .fab-add-document {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
    }

    /* Индикатор загрузки */
    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }    .loading-content {
      background: var(--mat-sys-surface-container);
      padding: 24px;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      min-width: 250px;
    }

    .upload-progress {
      width: 200px;
      height: 8px;
      border-radius: 4px;
    }

    .success-icon {
      color: #4caf50;
      font-size: 40px;
      width: 40px;
      height: 40px;
    }

    .loading-content p {
      margin: 0;
      color: #666;
      font-weight: 500;
    }

    /* Mobile-first: base styles */
    .page-header {
      flex-direction: column;
      gap: 16px;
      align-items: stretch;
    }

    .header-actions {
      justify-content: flex-end;
    }

    .profile-tabs {
      flex-wrap: wrap;
      gap: 2px;
    }

    .tab-button {
      font-size: 0.75rem;
      padding: 8px 12px;
    }

    .education-fields {
      grid-template-columns: 1fr;
    }

    .card-content {
      flex-direction: column;
    }

    .work-style-grid,
    .collaboration-grid {
      grid-template-columns: 1fr;
    }

    .fab-add-document {
      bottom: 16px;
      right: 16px;
    }

    /* Desktop styles */
    @media (min-width: 840px) {
      .page-header {
        flex-direction: row;
        gap: initial;
        align-items: center;
      }

      .header-actions {
        justify-content: initial;
      }

      .profile-tabs {
        flex-wrap: nowrap;
        gap: 4px;
      }

      .tab-button {
        font-size: initial;
        padding: 12px 16px;
      }

      .education-fields {
        grid-template-columns: 2fr 1fr 100px;
      }

      .card-content {
        flex-direction: row;
      }

      .work-style-grid,
      .collaboration-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .fab-add-document {
        bottom: 24px;
        right: 24px;
      }
    }
  `]
})
export class ProfileExtendedFieldsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  private log = inject(LoggerService);
  initialData = input<ExtendedFieldsInputData>({});
  dataChange = output<ExtendedFieldsInputData>();
  readonly diplomaFileInput = viewChild.required<ElementRef<HTMLInputElement>>('diplomaFileInput');
  readonly certificateFileInput = viewChild.required<ElementRef<HTMLInputElement>>('certificateFileInput');
  readonly profCertificateFileInput = viewChild.required<ElementRef<HTMLInputElement>>('profCertificateFileInput');

  // Сигналы
  readonly isUploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly achievements = signal<string[]>([]);
  readonly currentYear = new Date().getFullYear();
  readonly isDragOver = signal(false);

  // Форма
  extendedForm!: FormGroup;
  // Текущие индексы для загрузки
  currentDiplomaIndex = -1;
  currentCertificateIndex = -1;  ngOnInit() {
    this.initializeForm();
    this.loadInitialData();
  }  private initializeForm() {
    this.extendedForm = this.fb.group({
      universities: this.fb.array([]),
      courses: this.fb.array([]),
      certifications: this.fb.array([]),
      languages: [[]],
      signatureStyle: [''],
      travelRadius: [0],
      workStyle: this.fb.group({
        pace: ['moderate'],
        approach: ['creative'],
        planning: ['flexible'],
        communication: ['friendly'],
        signatureStyle: ['']
      }),
      collaborationPreferences: this.fb.group({
        team_size: ['small'],
        preparation_time: ['2_weeks'],
        backup_photographer: [false],
        client_communication: ['regular']
      })
    });

    // Подписываемся на изменения формы
    this.extendedForm.valueChanges.subscribe(_value => {
      this.emitDataChange();
    });
  }  private loadInitialData() {
    if (!this.extendedForm) {
      this.log.warn('Form not initialized yet');
      return;
    }

    const initialDataValue = this.initialData();
    if (initialDataValue) {
      this.log.debug('🔍 Loading initial data:', initialDataValue);
      this.log.debug('🔍 professionalCertifications from initialData:', initialDataValue.professionalCertifications);

      // Загружаем университеты с безопасными проверками
      if (initialDataValue.education?.universities && Array.isArray(initialDataValue.education.universities)) {
        this.log.debug('🎓 Loading universities:', initialDataValue.education.universities);
        initialDataValue.education.universities.forEach((uni) => {
          if (uni && typeof uni === 'object') {
            this.addUniversity();
            const lastIndex = this.universitiesArray.length - 1;
            const control = this.universitiesArray.at(lastIndex);
            if (control) {
              control.patchValue({
                name: uni.name || '',
                degree: uni.degree || '',
                year: uni.year || this.currentYear,
                diplomaImageUrl: uni.diplomaImageUrl || ''
              });
            }
          }
        });
      }

      // Загружаем курсы с безопасными проверками
      if (initialDataValue.education?.courses && Array.isArray(initialDataValue.education.courses)) {
        this.log.debug('📚 Loading courses:', initialDataValue.education.courses);
        initialDataValue.education.courses.forEach((course) => {
          if (course && typeof course === 'object') {
            this.addCourse();
            const lastIndex = this.coursesArray.length - 1;
            const control = this.coursesArray.at(lastIndex);
            if (control) {
              control.patchValue({
                name: course.name || '',
                provider: course.provider || '',
                year: course.year || this.currentYear,
                certificateImageUrl: course.certificateImageUrl || ''
              });
            }
          }
        });
      }

      // Загружаем профессиональные сертификаты с безопасными проверками
      if (initialDataValue.professionalCertifications && Array.isArray(initialDataValue.professionalCertifications)) {
        this.log.debug('🏆 Loading professional certifications:', initialDataValue.professionalCertifications);
        initialDataValue.professionalCertifications.forEach((cert) => {
          if (cert && typeof cert === 'object') {
            this.addCertification();
            const lastIndex = this.certificationsArray.length - 1;
            const control = this.certificationsArray.at(lastIndex);
            if (control) {
              this.log.debug('🏆 Setting certification data:', cert);
              control.patchValue({
                name: cert.name || '',
                organization: cert.organization || '',
                year: cert.year || this.currentYear,
                imageUrl: cert.imageUrl || ''
              });
            }
          }
        });
      } else {
        this.log.warn('⚠️ No professionalCertifications found or not an array:', initialDataValue.professionalCertifications);
      }

      // Загружаем остальные данные с безопасными проверками
      try {
        this.extendedForm.patchValue({
          languages: Array.isArray(initialDataValue.languages) ? initialDataValue.languages : [],
          signatureStyle: initialDataValue.signatureStyle || '',
          travelRadius: typeof initialDataValue.travelRadius === 'number' ? initialDataValue.travelRadius : 0,
          workStyle: {
            pace: initialDataValue.workStyle?.pace || 'moderate',
            approach: initialDataValue.workStyle?.approach || 'creative',
            planning: initialDataValue.workStyle?.planning || 'flexible',
            communication: initialDataValue.workStyle?.communication || 'friendly'
          },
          collaborationPreferences: {
            team_size: initialDataValue.collaborationPreferences?.team_size || 'small',
            preparation_time: initialDataValue.collaborationPreferences?.preparation_time || '2_weeks',
            backup_photographer: Boolean(initialDataValue.collaborationPreferences?.backup_photographer),
            client_communication: initialDataValue.collaborationPreferences?.client_communication || 'regular'
          }
        });
      } catch (error) {
        this.log.error('Error patching form values:', error);
      }

      // Загружаем достижения
      const achievements = Array.isArray(initialDataValue.achievements) ? initialDataValue.achievements : [];
      this.achievements.set(achievements);

      this.log.debug('🔍 Final form state after loading:', {
        universitiesCount: this.universitiesArray.length,
        coursesCount: this.coursesArray.length,
        certificationsCount: this.certificationsArray.length,
        achievements: this.achievements(),
        formValue: this.extendedForm.value
      });

      // Эмитируем начальные данные после небольшой задержки
      setTimeout(() => {
        this.emitDataChange();
      }, 100);
    }
  }// Геттеры для FormArray с null-проверками
  get universitiesArray(): FormArray {
    if (!this.extendedForm) {
      return this.fb.array([]);
    }
    const control = this.extendedForm.get('universities') as FormArray;
    return control || this.fb.array([]);
  }

  get coursesArray(): FormArray {
    if (!this.extendedForm) {
      return this.fb.array([]);
    }
    const control = this.extendedForm.get('courses') as FormArray;
    return control || this.fb.array([]);
  }

  get certificationsArray(): FormArray {
    if (!this.extendedForm) {
      return this.fb.array([]);
    }
    const control = this.extendedForm.get('certifications') as FormArray;
    return control || this.fb.array([]);
  }
  // Методы для университетов
  addUniversity() {
    if (!this.extendedForm) return;

    const universityGroup = this.fb.group({
      name: ['', Validators.required],
      degree: ['', Validators.required],
      year: [this.currentYear, [Validators.required, Validators.min(1950), Validators.max(this.currentYear)]],
      diplomaImageUrl: ['']
    });

    this.universitiesArray.push(universityGroup);
    this.emitDataChange();
  }

  removeUniversity(index: number) {
    if (!this.extendedForm || index < 0 || index >= this.universitiesArray.length) return;

    this.universitiesArray.removeAt(index);
    this.emitDataChange();
  }
  // Методы для курсов
  addCourse() {
    if (!this.extendedForm) return;

    const courseGroup = this.fb.group({
      name: ['', Validators.required],
      provider: ['', Validators.required],
      year: [this.currentYear, [Validators.required, Validators.min(1950), Validators.max(this.currentYear)]],
      certificateImageUrl: ['']
    });

    this.coursesArray.push(courseGroup);
    this.emitDataChange();
  }

  removeCourse(index: number) {
    if (!this.extendedForm || index < 0 || index >= this.coursesArray.length) return;

    this.coursesArray.removeAt(index);
    this.emitDataChange();
  }  // Методы для профессиональных сертификатов
  addCertification() {
    if (!this.extendedForm) return;

    const certificationGroup = this.fb.group({
      name: ['', Validators.required],
      organization: ['', Validators.required],
      year: [this.currentYear, [Validators.required, Validators.min(1950), Validators.max(this.currentYear)]],
      imageUrl: ['']
    });

    this.certificationsArray.push(certificationGroup);
    this.emitDataChange();
  }

  removeCertification(index: number) {
    if (!this.extendedForm || index < 0 || index >= this.certificationsArray.length) return;

    this.certificationsArray.removeAt(index);
    this.emitDataChange();
  }
  // Методы для достижений
  addAchievement(event: MatChipInputEvent) {
    const value = event.value?.trim();
    if (value) {
      this.achievements.update(achievements => [...achievements, value]);
      event.chipInput.clear();
      this.emitDataChange();
    }
  }

  addAchievementFromInput(input: HTMLInputElement) {
    const value = input.value?.trim();
    if (value) {
      this.achievements.update(achievements => [...achievements, value]);
      input.value = '';
      this.emitDataChange();
    }
  }

  removeAchievement(index: number) {
    this.achievements.update(achievements => {
      const newAchievements = [...achievements];
      newAchievements.splice(index, 1);
      return newAchievements;
    });
    this.emitDataChange();
  }

  editAchievement(index: number, event: { value?: string }) {
    const value = event.value?.trim();
    if (value) {
      this.achievements.update(achievements => {
        const newAchievements = [...achievements];
        newAchievements[index] = value;
        return newAchievements;
      });
      this.emitDataChange();
    }
  }

  // Методы для загрузки изображений дипломов
  selectDiplomaImage(index: number) {
    this.currentDiplomaIndex = index;
    this.diplomaFileInput().nativeElement.click();
  }  async onDiplomaImageSelected(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    if (!this.validateImageFile(file)) {
      return;
    }

    this.isUploading.set(true);

    try {
      // Читаем файл как ArrayBuffer
      const fileBuffer = await file.arrayBuffer();

      // Отправляем файл как raw buffer
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; url: string; filename?: string; size?: number }>('/api/photographers/me/documents/upload', fileBuffer, {
          headers: {
            'Content-Type': file.type,
            'X-Filename': encodeURIComponent(file.name),
            'X-Document-Type': 'diploma'
          }
        })
      );

      // Используем URL, возвращенный сервером
      const imageUrl = response.url || `/uploads/documents/${response.filename}`;

      // Обновляем URL в форме
      const universityControl = this.universitiesArray.at(index);
      if (universityControl) {
        universityControl.patchValue({ diplomaImageUrl: imageUrl });
        this.emitDataChange();
      }

      this.showSuccess(`✅ Диплом успешно загружен! (${Math.round((response.size || 0) / 1024)} KB)`);
    } catch (error) {
      this.log.error('Error uploading diploma:', error);
      this.showError('❌ Ошибка загрузки диплома');
    } finally {
      this.isUploading.set(false);
      input.value = '';
    }
  }

  removeDiplomaImage(index: number, event: Event) {
    event.stopPropagation();
    const universityControl = this.universitiesArray.at(index);
    universityControl?.patchValue({ diplomaImageUrl: '' });
  }
  getDiplomaImageUrl(index: number): string {
    if (!this.extendedForm || index < 0 || index >= this.universitiesArray.length) {
      return '';
    }
    return this.universitiesArray.at(index)?.get('diplomaImageUrl')?.value || '';
  }

  // Методы для загрузки изображений сертификатов
  selectCertificateImage(index: number) {
    this.currentCertificateIndex = index;
    this.certificateFileInput().nativeElement.click();
  }  async onCertificateImageSelected(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    if (!this.validateImageFile(file)) {
      return;
    }

    this.isUploading.set(true);

    try {
      // Читаем файл как ArrayBuffer
      const fileBuffer = await file.arrayBuffer();

      // Отправляем файл как raw buffer
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; url: string; filename?: string; size?: number }>('/api/photographers/me/documents/upload', fileBuffer, {
          headers: {
            'Content-Type': file.type,
            'X-Filename': encodeURIComponent(file.name),
            'X-Document-Type': 'certificate'
          }
        })
      );

      // Используем URL, возвращенный сервером
      const imageUrl = response.url || `/uploads/documents/${response.filename}`;

      // Обновляем URL в форме
      const courseControl = this.coursesArray.at(index);
      if (courseControl) {
        courseControl.patchValue({ certificateImageUrl: imageUrl });
        this.emitDataChange();
      }

      this.showSuccess(`✅ Сертификат успешно загружен! (${Math.round((response.size || 0) / 1024)} KB)`);
    } catch (error) {
      this.log.error('Error uploading certificate:', error);
      this.showError('❌ Ошибка загрузки сертификата');
    } finally {
      this.isUploading.set(false);
      input.value = '';
    }
  }

  removeCertificateImage(index: number, event: Event) {
    event.stopPropagation();
    const courseControl = this.coursesArray.at(index);
    courseControl?.patchValue({ certificateImageUrl: '' });
  }  getCertificateImageUrl(index: number): string {
    if (!this.extendedForm || index < 0 || index >= this.coursesArray.length) {
      return '';
    }
    return this.coursesArray.at(index)?.get('certificateImageUrl')?.value || '';
  }
  // Методы для загрузки изображений профессиональных сертификатов
  selectProfCertificateImage(index: number) {
    this.currentCertificateIndex = index;
    this.profCertificateFileInput().nativeElement.click();
  }

  async onProfCertificateImageSelected(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    await this.uploadProfCertificateImage(file, index);
    input.value = '';
  }

  // Drag & Drop методы
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

  async onDrop(event: DragEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      await this.uploadProfCertificateImage(file, index);
    }
  }  // Универсальный метод загрузки с прогресс-баром
  private async uploadProfCertificateImage(file: File, index: number) {
    if (!this.validateImageFile(file)) {
      return;
    }

    this.log.debug('🔍 uploadProfCertificateImage started:', { index, fileName: file.name });

    this.isUploading.set(true);
    this.uploadProgress.set(0);

    try {
      // Читаем файл как ArrayBuffer для отправки raw buffer
      const fileBuffer = await file.arrayBuffer();

      // Симулируем прогресс загрузки
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 15;
        this.uploadProgress.set(Math.min(progress, 90));
        if (progress >= 90) {
          clearInterval(progressInterval);
        }
      }, 100);

      // Отправляем файл как raw buffer с правильными заголовками
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; url: string; filename?: string; size?: number }>('/api/photographers/me/documents/upload', fileBuffer, {
          headers: {
            'Content-Type': file.type,
            'X-Filename': encodeURIComponent(file.name),
            'X-Document-Type': 'professional-certificate'
          }
        })
      );

      clearInterval(progressInterval);
      this.uploadProgress.set(100);

      // Используем URL, возвращенный сервером
      const imageUrl = response.url || `/uploads/documents/${response.filename}`;

      // Обновляем URL в форме
      const certControl = this.certificationsArray.at(index);
      if (certControl) {
        certControl.patchValue({ imageUrl });

        this.log.debug('🔍 Updated certificate control:', certControl.value);
        this.log.debug('🔍 Server response:', response);

        // Принудительно обновляем форму
        this.certificationsArray.markAsDirty();
        this.extendedForm.markAsDirty();

        // Эмитируем изменения
        this.emitDataChange();
      }

      this.showSuccess(`✅ Сертификат успешно загружен! (${Math.round((response.size || 0) / 1024)} KB)`);

    } catch (error) {
      this.log.error('Error uploading professional certificate:', error);
      this.showError('❌ Ошибка загрузки сертификата');
    } finally {
      setTimeout(() => {
        this.isUploading.set(false);
        this.uploadProgress.set(0);
      }, 500);
    }
  }

  // Предпросмотр изображения в модальном окне
  openImagePreview(imageUrl: string, title: string) {
    this.dialog.open(ImagePreviewDialogComponent, {
      data: { imageUrl, title },
      maxWidth: '90vw',
      maxHeight: '90vh',
      panelClass: 'image-preview-dialog'
    }).afterClosed().subscribe(result => {
      if (result === 'delete') {
        // Логика удаления изображения        this.showSuccess('🗑️ Изображение удалено');
      }
    });
  }

  removeProfCertificateImage(index: number, event: Event) {
    event.stopPropagation();
    const certControl = this.certificationsArray.at(index);
    certControl?.patchValue({ imageUrl: '' });
    this.emitDataChange();
    this.showSuccess('🗑️ Изображение удалено');
  }
  getProfCertificateImageUrl(index: number): string {
    if (!this.extendedForm || index < 0 || index >= this.certificationsArray.length) {
      return '';
    }
    return this.certificationsArray.at(index)?.get('imageUrl')?.value || '';
  }

  // Утилиты
  private validateImageFile(file: File): boolean {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedTypes.includes(file.type)) {
      this.showError('Поддерживаются только форматы: JPEG, PNG, WebP');
      return false;
    }

    if (file.size > maxSize) {
      this.showError('Размер файла не должен превышать 10MB');
      return false;
    }

    return true;
  }    // Публичный метод для эмиссии изменений
  emitDataChange() {
    const formValue = this.extendedForm.value;

    const dataToEmit = {
      education: {
        universities: formValue.universities || [],
        courses: formValue.courses || []
      },
      professionalCertifications: formValue.certifications || [],
      languages: formValue.languages || [],
      achievements: this.achievements(),
      signatureStyle: formValue.signatureStyle || '',
      travelRadius: formValue.travelRadius || 0,
      workStyle: formValue.workStyle || {},
      collaborationPreferences: formValue.collaborationPreferences || {}
    };

    this.log.debug('🔍 profile-extended-fields emitDataChange:', {
      formCertifications: formValue.certifications,
      emittedProfessionalCertifications: dataToEmit.professionalCertifications,
      dataToEmit
    });

    this.dataChange.emit(dataToEmit);
  }

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
  // Вспомогательные методы для получения данных сертификата
  getCertificateName(index: number): string {
    if (!this.extendedForm || index < 0 || index >= this.certificationsArray.length) {
      return '';
    }
    return this.certificationsArray.at(index)?.get('name')?.value || '';
  }

  getCertificateOrganization(index: number): string {
    if (!this.extendedForm || index < 0 || index >= this.certificationsArray.length) {
      return '';
    }
    return this.certificationsArray.at(index)?.get('organization')?.value || '';
  }

  // Методы для кнопок в шапке
  saveData() {
    this.emitDataChange();
    this.showSuccess('✅ Данные отправлены на сохранение');
  }

  resetForm() {
    this.loadInitialData();
    this.showSuccess('🔄 Форма сброшена');
  }
}
