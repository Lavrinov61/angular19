import { Component, OnInit, inject, signal, ElementRef, ChangeDetectionStrategy, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatSliderModule } from '@angular/material/slider';

import { PhotoApprovalService } from '../../../../core/services/photo-approval.service';
import { PhotoApproval, PhotoForApproval, PhotoAnnotation, ApprovalStatus } from '../../../../core/models/photo-approval.model';

@Component({
  selector: 'app-photo-approval-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(click)': 'onClick($event)'
  },
  imports: [
    DatePipe,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatDividerModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
    MatSnackBarModule,
    MatDialogModule,
    MatChipsModule,
    MatSliderModule,
    DatePipe
  ],
  template: `
    <div class="approval-detail-container">
      @if (isLoading()) {
        <div class="loading-container">
          <mat-spinner diameter="40" />
          <p>Загрузка данных...</p>
        </div>
      }

      @if (error()) {
        <div class="error-message">
          <mat-icon color="warn">error</mat-icon>
          <p>{{ error() }}</p>
          <button mat-button color="primary" (click)="loadApproval()">Повторить</button>
        </div>
      }

      @if (!isLoading() && !error() && approval()) {
        <ng-container>
        <div class="approval-header">
          <div class="back-button">
            <button mat-icon-button (click)="goBack()">
              <mat-icon>arrow_back</mat-icon>
            </button>
          </div>

          <h2 class="page-title">{{ getOrderTitle() }}</h2>

          <div class="status-badge">
            <mat-chip [class]="getStatusClass()">
              {{ getStatusText() }}
            </mat-chip>
          </div>
        </div>

        <div class="approval-info">
          <div class="info-item">
            <span class="info-label">Создан:</span>
            <span class="info-value">{{ approval()?.createdAt | date:'dd.MM.yyyy' }}</span>
          </div>

          @if (approval()?.requestDeadline) {
            <div class="info-item">
            <span class="info-label">Срок проверки:</span>
              <span class="info-value" [class.deadline-warning]="isDeadlineApproaching()">
                {{ approval()?.requestDeadline | date:'dd.MM.yyyy' }}
              </span>
            </div>
          }

          <div class="info-item">
            <span class="info-label">Прогресс:</span>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill" [style.width.%]="getApprovalProgress()"></div>
              </div>
              <span class="progress-text">{{ getApprovalProgress() }}%</span>
            </div>
          </div>
        </div>

        <mat-divider />
          <div class="photos-container">
          <div class="photos-sidebar">            <div class="sidebar-header">
              <h3>Фотографии ({{ approval()?.photos?.length || 0 }})</h3>
            </div>

            <div class="photos-thumbnails">
              @for (photo of approval()?.photos || []; track photo.id || photo.retouchedPhotoUrl || $index; let i = $index) {
                <div
                  class="thumbnail-item"
                  [class.active]="selectedPhotoIndex() === i"
                  [class.approved]="photo.approved"
                  [class.has-annotations]="photo.annotations.length > 0"
                  (click)="selectPhoto(i)"
                  (keydown.enter)="selectPhoto(i)"
                  tabindex="0"
                >
                  <img [src]="photo.retouchedPhotoUrl" alt="Фото {{ i + 1 }}">
                  <div class="thumbnail-status">
                    @if (photo.approved) {
                      <mat-icon class="status-icon approved">check_circle</mat-icon>
                    }
                    @if (!photo.approved && photo.annotations.length > 0) {
                      <mat-icon class="status-icon annotated">comment</mat-icon>
                    }
                  </div>
                  <div class="thumbnail-number">{{ i + 1 }}</div>
                </div>
              }
            </div>
          </div>

          <div class="photo-main-content">
            <div class="photo-comparison-container">
              <div class="comparison-header">
                <div class="view-controls">
                  <button mat-button [class.active]="viewMode() === 'side-by-side'" (click)="setViewMode('side-by-side')">
                    <mat-icon>view_week</mat-icon>
                    Рядом
                  </button>

                  <button mat-button [class.active]="viewMode() === 'slider'" (click)="setViewMode('slider')">
                    <mat-icon>compare</mat-icon>
                    Слайдер
                  </button>

                  <button mat-button [class.active]="viewMode() === 'toggle'" (click)="setViewMode('toggle')">
                    <mat-icon>flip</mat-icon>
                    Переключение
                  </button>
                </div>

                <div class="zoom-controls">
                  <button mat-icon-button (click)="zoomOut()" [disabled]="zoom() <= 50">
                    <mat-icon>zoom_out</mat-icon>
                  </button>

                  <span class="zoom-text">{{ zoom() }}%</span>

                  <button mat-icon-button (click)="zoomIn()" [disabled]="zoom() >= 200">
                    <mat-icon>zoom_in</mat-icon>
                  </button>

                  <button mat-icon-button (click)="resetZoom()">
                    <mat-icon>zoom_in_map</mat-icon>
                  </button>
                </div>
              </div>

              <!-- Режим просмотра: Рядом -->
              @if (viewMode() === 'side-by-side' && currentPhoto()) {
                <div class="comparison-view side-by-side">
                  <div class="photo-container original">
                    <h4>Исходное фото</h4>
                    <div class="photo-wrapper" [style.transform]="'scale(' + zoom()/100 + ')'">
                      <img [src]="currentPhoto()?.originalPhotoUrl" alt="Исходное фото" #originalImg>
                    </div>
                  </div>

                  <div class="photo-container retouched">
                    <h4>Обработанное фото</h4>
                    <div class="photo-wrapper" [style.transform]="'scale(' + zoom()/100 + ')'">
                      <img [src]="currentPhoto()?.retouchedPhotoUrl" alt="Обработанное фото" #retouchedImg>

                      <!-- Аннотации -->
                      @for (annotation of currentPhoto()?.annotations || []; track annotation.id || annotation.x || $index) {
                        <div
                          class="annotation-marker"
                          [style.left.%]="annotation.x"
                          [style.top.%]="annotation.y"
                          [class.client-annotation]="annotation.createdBy === 'client'"
                          [class.photographer-annotation]="annotation.createdBy === 'photographer'"
                          matTooltip="{{ annotation.text }}"
                        >
                          <mat-icon>comment</mat-icon>
                        </div>
                      }
                    </div>
                  </div>
                </div>
              }
              <!-- Режим просмотра: Слайдер -->
              @if (viewMode() === 'slider' && currentPhoto()) {
                <div class="comparison-view slider">
                  <div class="slider-container" [style.transform]="'scale(' + zoom()/100 + ')'">
                    <div class="slider-image-container">
                      <img [src]="currentPhoto()?.originalPhotoUrl" alt="Исходное фото" class="slider-image original">
                      <img [src]="currentPhoto()?.retouchedPhotoUrl" alt="Обработанное фото" class="slider-image retouched" [style.width.%]="sliderPosition()">

                      <!-- Аннотации -->
                      @for (annotation of currentPhoto()?.annotations || []; track annotation.id || annotation.x || $index) {
                        <div
                          class="annotation-marker"
                          [style.left.%]="annotation.x"
                          [style.top.%]="annotation.y"
                      [class.client-annotation]="annotation.createdBy === 'client'"
                      [class.photographer-annotation]="annotation.createdBy === 'photographer'"
                      [class.hidden]="isAnnotationHidden(annotation)"
                      matTooltip="{{ annotation.text }}">
                        <mat-icon>comment</mat-icon>
                      </div>
                    }

                    <div class="slider-line" [style.left.%]="sliderPosition()">
                      <div class="slider-handle"></div>
                    </div>
                  </div>
                  </div>

                  <mat-slider class="slider-control"
                    min="0"
                    max="100"
                    step="1"
                    [(ngModel)]="sliderPositionValue"
                    (input)="onSliderChange($event)"
                   />

                  <div class="slider-labels">
                    <span>Исходное</span>
                    <span>Обработанное</span>
                  </div>
                </div>
              }
              <!-- Режим просмотра: Переключение -->
              @if (viewMode() === 'toggle' && currentPhoto()) {
                <div class="comparison-view toggle">
                  <div class="toggle-container" [style.transform]="'scale(' + zoom()/100 + ')'" (click)="toggleImage()" (keydown.enter)="toggleImage()" tabindex="0">
                    <img
                      [src]="showRetouched() ? currentPhoto()?.retouchedPhotoUrl : currentPhoto()?.originalPhotoUrl"
                      alt="Фото"
                      class="toggle-image"
                    >

                    <!-- Аннотации -->
                    @for (annotation of currentPhoto()?.annotations || []; track annotation.id || annotation.x || $index) {
                      <div
                        class="annotation-marker"
                        [style.left.%]="annotation.x"
                        [style.top.%]="annotation.y"
                        [class.client-annotation]="annotation.createdBy === 'client'"
                        [class.photographer-annotation]="annotation.createdBy === 'photographer'"
                        [class.hidden]="!showRetouched()"
                        matTooltip="{{ annotation.text }}"
                      >
                        <mat-icon>comment</mat-icon>
                      </div>
                    }

                    <div class="toggle-indicator">
                      <span>{{ showRetouched() ? 'Обработанное' : 'Исходное' }}</span>
                      <mat-icon>touch_app</mat-icon>
                    </div>
                  </div>

                  <div class="toggle-buttons">
                    <button mat-stroked-button (click)="setShowRetouched(false)" [class.active]="!showRetouched()">
                      Исходное
                    </button>
                    <button mat-stroked-button (click)="setShowRetouched(true)" [class.active]="showRetouched()">
                      Обработанное
                    </button>
                  </div>
                </div>
              }
            </div>

            <!-- Аннотирование фотографий -->
            @if (currentPhoto()) {
              <div class="annotation-mode-toggle">
                <button
                  mat-button
                  color="accent"
                  (click)="toggleAnnotationMode()"
                  [class.active]="annotationMode()"
                >
                  <mat-icon>{{ annotationMode() ? 'edit_off' : 'edit' }}</mat-icon>
                  {{ annotationMode() ? 'Выключить режим аннотирования' : 'Добавить комментарий к фото' }}
                </button>
              </div>

              <!-- Форма для новой аннотации -->
              @if (annotationMode() && annotationPosition().x !== null) {
                <div class="annotation-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Комментарий к фотографии</mat-label>
                    <textarea
                      matInput
                      [(ngModel)]="annotationText"
                      placeholder="Опишите, что нужно исправить..."
                      rows="3"
                    ></textarea>
                  </mat-form-field>

                  <div class="annotation-actions">
                    <button mat-button (click)="cancelAnnotation()">Отмена</button>
                    <button
                      mat-raised-button
                      color="primary"
                      [disabled]="!annotationText.trim()"
                      (click)="saveAnnotation()"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              }

              <mat-divider />

              <div class="comments-section">
              <h3>
                Комментарии
                @if ((currentPhoto()?.annotations?.length || 0) > 0) {
                  <span>({{ currentPhoto()?.annotations?.length || 0 }})</span>
                }
              </h3>

              @if ((currentPhoto()?.annotations?.length || 0) > 0) {
                <div class="comments-list">
                  @for (annotation of currentPhoto()?.annotations || []; track annotation.id || annotation.createdAt || $index) {
                    <div
                      class="comment-item"
                      [class.client-comment]="annotation.createdBy === 'client'"
                      [class.photographer-comment]="annotation.createdBy === 'photographer'"
                    >
                      <div class="comment-header">
                        <div class="comment-author">
                          <mat-icon>{{ annotation.createdBy === 'client' ? 'person' : 'camera_alt' }}</mat-icon>
                          <span>{{ annotation.createdBy === 'client' ? 'Вы' : 'Фотограф' }}</span>
                        </div>
                        <div class="comment-date">
                          {{ annotation.createdAt | date:'dd.MM.yyyy HH:mm' }}
                        </div>
                        @if (annotation.createdBy === 'client') {
                          <button
                            mat-icon-button
                            class="delete-comment"
                            (click)="deleteAnnotation(annotation.id)"
                          >
                            <mat-icon>delete</mat-icon>
                          </button>
                        }
                      </div>

                      <div class="comment-text">
                        {{ annotation.text }}
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <div class="no-comments">
                  <p>Нет комментариев к этой фотографии</p>
                </div>
              }

              @if (!annotationMode()) {
                <div class="add-comment-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Добавить комментарий</mat-label>
                    <textarea
                      matInput
                      [(ngModel)]="generalComment"
                      placeholder="Напишите общий комментарий к фотографии..."
                      rows="2"
                    ></textarea>
                  </mat-form-field>

                  <button
                    mat-raised-button
                    color="primary"
                    [disabled]="!generalComment.trim()"
                    (click)="addGeneralComment()"
                  >
                    Добавить
                  </button>
                </div>
              }
            </div>
            }

            <mat-divider />

            <div class="photo-actions">
              <div class="navigation-buttons">
                <button
                  mat-icon-button
                  (click)="previousPhoto()"
                  [disabled]="selectedPhotoIndex() === 0"
                >
                  <mat-icon>chevron_left</mat-icon>
                </button>
                  <span class="photo-counter">{{ selectedPhotoIndex() + 1 }} / {{ approval()?.photos?.length || 0 }}</span>

                <button
                  mat-icon-button
                  (click)="nextPhoto()"
                  [disabled]="selectedPhotoIndex() === (approval()?.photos?.length || 1) - 1"
                >
                  <mat-icon>chevron_right</mat-icon>
                </button>
              </div>

              <div class="approval-buttons">
                <button
                  mat-raised-button
                  color="primary"
                  (click)="approvePhoto()"
                  [disabled]="currentPhoto()?.approved"
                >
                  <mat-icon>check_circle</mat-icon>
                  Одобрить
                </button>
                  <button
                  mat-stroked-button
                  color="warn"
                  (click)="rejectPhoto()"
                  [disabled]="(currentPhoto()?.annotations?.length || 0) > 0"
                >
                  <mat-icon>cancel</mat-icon>
                  Отклонить
                </button>
              </div>
            </div>
          </div>
        </div>

        @if (downloadPhotos().length > 0) {
          <mat-divider />
          <div class="download-section">
            <h3>Скачать фотографии</h3>
            @if (downloadLoading()) {
              <mat-spinner diameter="24" />
            } @else {
              <div class="download-actions">
                <button mat-raised-button color="primary" (click)="downloadAll()">
                  <mat-icon>download</mat-icon>
                  Скачать все ({{ downloadPhotos().length }})
                </button>
              </div>
              <div class="download-grid">
                @for (photo of downloadPhotos(); track photo.id) {
                  <div class="download-item">
                    @if (photo.thumbnailUrl) {
                      <img [src]="photo.thumbnailUrl" alt="Фото">
                    }
                    <button mat-icon-button (click)="downloadPhoto(photo.url)" matTooltip="Скачать">
                      <mat-icon>download</mat-icon>
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        }

        <mat-divider />

        <div class="final-actions">
          <button mat-stroked-button (click)="goBack()">
            <mat-icon>arrow_back</mat-icon>
            Назад
          </button>

          <div class="action-buttons">
            <button
              mat-raised-button
              color="warn"
              (click)="rejectAll()"
            >
              <mat-icon>cancel</mat-icon>
              Отклонить все
            </button>

            <button
              mat-raised-button
              color="primary"
              [disabled]="!canApproveAll()"
              (click)="approveAll()"
            >
              <mat-icon>check_circle</mat-icon>
              Одобрить все
            </button>
          </div>
        </div>
        </ng-container>
      }
    </div>
  `,
  styles: `
    .approval-detail-container {
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }

    .loading-container, .error-message {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      text-align: center;
      gap: 16px;
    }

    .error-message {
      background-color: #7f1d1d;
      border-radius: 4px;
    }

    .approval-header {
      display: flex;
      align-items: center;
      margin-bottom: 16px;
      gap: 16px;
    }

    .page-title {
      font-size: 24px;
      font-weight: 500;
      margin: 0;
      flex-grow: 1;
    }

    .approval-info {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      margin-bottom: 16px;
    }

    .info-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .info-label {
      font-weight: 500;
      color: rgba(0, 0, 0, 0.6);
    }

    .deadline-warning {
      color: #f44336;
    }

    .progress-container {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 200px;
    }

    .progress-bar {
      flex: 1;
      height: 8px;
      background-color: var(--ed-surface-container-high, #222);
      border-radius: 4px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background-color: #4caf50;
      border-radius: 4px;
    }

    .photos-container {
      display: flex;
      gap: 20px;
      margin: 20px 0;
      min-height: 500px;
    }

    .photos-sidebar {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 4px;
      overflow: hidden;
    }

    .sidebar-header {
      padding: 12px;
      background-color: var(--ed-surface-container-high, #222);
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .sidebar-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 500;
    }

    .photos-thumbnails {
      flex: 1;
      padding: 8px;
      display: flex;
      gap: 8px;
    }

    .thumbnail-item {
      position: relative;
      height: 120px;
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      border: 2px solid transparent;
      transition: all 0.2s ease;
    }

    .thumbnail-item:hover {
      border-color: #bbdefb;
    }

    .thumbnail-item.active {
      border-color: #2196f3;
    }

    .thumbnail-item.approved {
      border-color: #4caf50;
    }

    .thumbnail-item.has-annotations {
      border-color: #ff9800;
    }

    .thumbnail-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .thumbnail-status {
      position: absolute;
      top: 4px;
      right: 4px;
      z-index: 2;
    }

    .status-icon {
      font-size: 20px;
      height: 20px;
      width: 20px;
      background-color: var(--ed-surface-container, #1a1a1a);
      border-radius: 50%;
      padding: 2px;
    }

    .status-icon.approved {
      color: #4caf50;
    }

    .status-icon.annotated {
      color: #ff9800;
    }

    .thumbnail-number {
      position: absolute;
      bottom: 4px;
      left: 4px;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 10px;
    }

    .photo-main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 4px;
      overflow: hidden;
    }

    .photo-comparison-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    .comparison-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      background-color: var(--ed-surface-container-high, #222);
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .view-controls, .zoom-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .view-controls button.active {
      background-color: #1e3a5f;
      color: #1976d2;
    }

    .zoom-text {
      min-width: 50px;
      text-align: center;
    }

    .comparison-view {
      flex: 1;
      overflow: hidden;
      display: flex;
    }

    .side-by-side {
      flex-direction: row;
    }

    .photo-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 16px;
    }

    .photo-container h4 {
      margin: 0 0 8px;
      text-align: center;
    }

    .photo-wrapper {
      position: relative;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: center;
    }

    .photo-wrapper img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .slider {
      justify-content: center;
      align-items: center;
    }

    .slider-container {
      position: relative;
      width: 80%;
      max-width: 800px;
      transform-origin: center;
    }

    .slider-image-container {
      position: relative;
      width: 100%;
      overflow: hidden;
    }

    .slider-image {
      display: block;
      width: 100%;
      max-height: 70vh;
      object-fit: contain;
    }

    .slider-image.original {
      position: relative;
    }

    .slider-image.retouched {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      object-fit: cover;
      object-position: left;
    }

    .slider-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background-color: white;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
    }

    .slider-handle {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 24px;
      height: 24px;
      background-color: white;
      border-radius: 50%;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
      cursor: ew-resize;
    }

    .slider-control {
      width: 100%;
      margin-top: 16px;
    }

    .slider-labels {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      color: rgba(0, 0, 0, 0.6);
    }

    .toggle {
      justify-content: center;
      align-items: center;
      flex-direction: column;
    }

    .toggle-container {
      position: relative;
      width: 80%;
      max-width: 800px;
      cursor: pointer;
      transform-origin: center;
    }

    .toggle-image {
      display: block;
      width: 100%;
      max-height: 70vh;
      object-fit: contain;
    }

    .toggle-indicator {
      position: absolute;
      bottom: 16px;
      right: 16px;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 4px 8px;
      border-radius: 16px;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .toggle-buttons {
      display: flex;
      gap: 16px;
      margin-top: 16px;
    }

    .toggle-buttons button.active {
      background-color: #1e3a5f;
      color: #1976d2;
    }

    .annotation-marker {
      position: absolute;
      transform: translate(-50%, -50%);
      color: #ff9800;
      cursor: pointer;
      z-index: 10;
    }

    .annotation-marker.client-annotation {
      color: #ff9800;
    }

    .annotation-marker.photographer-annotation {
      color: #2196f3;
    }

    .annotation-marker.hidden {
      display: none;
    }

    .annotation-marker mat-icon {
      font-size: 24px;
      height: 24px;
      width: 24px;
      background-color: var(--ed-surface-container, #1a1a1a);
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .annotation-mode-toggle {
      padding: 8px 16px;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .annotation-mode-toggle button.active {
      background-color: #14532d;
      color: #388e3c;
    }

    .annotation-form {
      position: absolute;
      bottom: 16px;
      left: 16px;
      right: 16px;
      background-color: var(--ed-surface-container, #1a1a1a);
      padding: 16px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      z-index: 100;
    }

    .annotation-form mat-form-field {
      width: 100%;
    }

    .annotation-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .photo-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
    }

    .navigation-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .photo-counter {
      min-width: 60px;
      text-align: center;
    }

    .approval-buttons {
      display: flex;
      gap: 16px;
    }

    .comments-section {
      padding: 16px;
    }

    .comments-section h3 {
      margin-top: 0;
      font-size: 18px;
      font-weight: 500;
    }

    .comments-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }

    .comment-item {
      border-radius: 4px;
      padding: 12px;
      background-color: var(--ed-surface-container-high, #222);
    }

    .comment-item.client-comment {
      background-color: #451a03;
    }

    .comment-item.photographer-comment {
      background-color: #1e3a5f;
    }

    .comment-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .comment-author {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
    }

    .comment-date {
      color: rgba(0, 0, 0, 0.6);
      font-size: 12px;
    }

    .delete-comment {
      color: #f44336;
      width: 28px;
      height: 28px;
      line-height: 28px;
    }

    .delete-comment mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .comment-text {
      white-space: pre-line;
    }

    .no-comments {
      color: rgba(0, 0, 0, 0.5);
      text-align: center;
      padding: 20px;
    }

    .add-comment-form {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }

    .add-comment-form mat-form-field {
      flex: 1;
    }

    .final-actions {
      display: flex;
      justify-content: space-between;
      padding: 20px 0;
    }

    .action-buttons {
      display: flex;
      gap: 16px;
    }

    /* Статусы */
    .status-pending {
      background-color: #ff9800;
      color: white;
    }

    .status-partial {
      background-color: #2196f3;
      color: white;
    }

    .status-approved {
      background-color: #4caf50;
      color: white;
    }

    .status-rejected {
      background-color: #f44336;
      color: white;
    }

    .status-revision {
      background-color: #9c27b0;
      color: white;
    }

    .download-section {
      padding: 20px;
    }

    .download-section h3 {
      margin-top: 0;
      font-size: 18px;
      font-weight: 500;
    }

    .download-actions {
      margin-bottom: 16px;
    }

    .download-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .download-item {
      position: relative;
      width: 100px;
      height: 100px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .download-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .download-item button {
      position: absolute;
      bottom: 4px;
      right: 4px;
      background-color: rgba(0, 0, 0, 0.6);
      color: white;
    }

    .photos-container {
      flex-direction: column;
      height: auto;
    }

    .photos-sidebar {
      width: 100%;
      height: 160px;
    }

    .photos-thumbnails {
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .thumbnail-item {
      width: 100px;
      flex-shrink: 0;
    }

    .side-by-side {
      flex-direction: column;
    }

    .photo-actions {
      flex-direction: column;
      gap: 16px;
    }

    .add-comment-form {
      flex-direction: column;
    }

    .final-actions {
      flex-direction: column;
      gap: 16px;
    }

    .action-buttons {
      flex-direction: column;
      width: 100%;
    }

    @media (min-width: 840px) {
      .photos-container {
        flex-direction: row;
        height: calc(100vh - 280px);
      }

      .photos-sidebar {
        width: 200px;
        height: auto;
      }

      .photos-thumbnails {
        flex-direction: column;
        overflow-x: hidden;
        overflow-y: auto;
      }

      .thumbnail-item {
        width: auto;
        flex-shrink: 1;
      }

      .side-by-side {
        flex-direction: row;
      }

      .photo-actions {
        flex-direction: row;
        gap: 8px;
      }

      .add-comment-form {
        flex-direction: row;
      }

      .final-actions {
        flex-direction: row;
        gap: 0;
      }

      .action-buttons {
        flex-direction: row;
        width: auto;
      }
    }
  `
})
export class PhotoApprovalDetailComponent implements OnInit {
  private photoApprovalService = inject(PhotoApprovalService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  // Элементы для взаимодействия с DOM
  readonly retouchedImg = viewChild<ElementRef<HTMLImageElement>>('retouchedImg');

  // Сигналы
  isLoading = this.photoApprovalService.isLoading;
  error = this.photoApprovalService.error;
  approval = signal<PhotoApproval | null>(null);
  selectedPhotoIndex = signal<number>(0);
  viewMode = signal<'side-by-side' | 'slider' | 'toggle'>('side-by-side');
  zoom = signal<number>(100);
  showRetouched = signal<boolean>(true);
  sliderPosition = signal<number>(50);
  annotationMode = signal<boolean>(false);
  annotationPosition = signal<{x: number | null, y: number | null}>({x: null, y: null});
  downloadPhotos = signal<{ id: string; url: string; thumbnailUrl?: string }[]>([]);
  downloadLoading = signal(false);

  // Обычные свойства
  approvalId = '';
  sliderPositionValue = 50;
  annotationText = '';
  generalComment = '';

  ngOnInit() {
    this.approvalId = this.route.snapshot.paramMap.get('id') || '';
    if (this.approvalId) {
      this.loadApproval();
    } else {
      this.router.navigate(['/user-profile/photo-approvals']);
    }
  }

  /**
   * Загрузить детали запроса на одобрение
   */
  loadApproval() {
    if (!this.approvalId) return;
      this.photoApprovalService.getApprovalById(this.approvalId).subscribe({
      next: (data) => {
        this.approval.set(data);
        // Если фотографий нет, вернуться к списку
        if (data && data.photos.length === 0) {
          this.snackBar.open('В запросе нет фотографий для проверки', 'Закрыть', {
            duration: 3000
          });
          this.router.navigate(['/user-profile/photo-approvals']);
        }
        // Загрузить ссылки скачивания для approved/partially_approved
        if (data && (data.status === ApprovalStatus.APPROVED || data.status === ApprovalStatus.PARTIALLY_APPROVED)) {
          this.loadDownloadLinks();
        }
      },
      error: () => {
        this.snackBar.open('Не удалось загрузить детали запроса', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Получить текущую фотографию
   */
  currentPhoto(): PhotoForApproval | null {
    const approval = this.approval();
    if (!approval) return null;

    const index = this.selectedPhotoIndex();
    if (index < 0 || index >= approval.photos.length) return null;

    return approval.photos[index];
  }

  /**
   * Получить заголовок заказа
   */
  getOrderTitle(): string {
    const approval = this.approval();
    if (!approval) return 'Детали заказа';

    return 'Проверка фотографий';
  }

  /**
   * Получить класс для статуса
   */
  getStatusClass(): string {
    const approval = this.approval();
    if (!approval) return '';

    switch (approval.status) {
      case ApprovalStatus.PENDING:
        return 'status-pending';
      case ApprovalStatus.PARTIALLY_APPROVED:
        return 'status-partial';
      case ApprovalStatus.APPROVED:
        return 'status-approved';
      case ApprovalStatus.REJECTED:
        return 'status-rejected';
      case ApprovalStatus.NEEDS_REVISION:
        return 'status-revision';
      default:
        return '';
    }
  }

  /**
   * Получить текст статуса
   */
  getStatusText(): string {
    const approval = this.approval();
    if (!approval) return '';

    switch (approval.status) {
      case ApprovalStatus.PENDING:
        return 'Ожидает подтверждения';
      case ApprovalStatus.PARTIALLY_APPROVED:
        return 'Частично одобрено';
      case ApprovalStatus.APPROVED:
        return 'Одобрено';
      case ApprovalStatus.REJECTED:
        return 'Отклонено';
      case ApprovalStatus.NEEDS_REVISION:
        return 'Требуется доработка';
      default:
        return 'Неизвестный статус';
    }
  }

  /**
   * Получить прогресс одобрения в процентах
   */
  getApprovalProgress(): number {
    const approval = this.approval();
    if (!approval || approval.photos.length === 0) return 0;

    const reviewed = approval.photos.filter(p => p.approved || p.annotations.length > 0).length;
    return Math.round((reviewed / approval.photos.length) * 100);
  }

  /**
   * Проверить, скоро ли истекает срок одобрения
   */
  isDeadlineApproaching(): boolean {
    const approval = this.approval();
    if (!approval || !approval.requestDeadline) return false;

    const now = new Date();
    const deadline = new Date(approval.requestDeadline);
    const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return diffDays <= 2;
  }

  /**
   * Выбрать фотографию для просмотра
   */
  selectPhoto(index: number) {
    this.selectedPhotoIndex.set(index);
    this.resetAnnotation();
  }

  /**
   * Перейти к предыдущей фотографии
   */
  previousPhoto() {
    const index = this.selectedPhotoIndex();
    if (index > 0) {
      this.selectedPhotoIndex.set(index - 1);
      this.resetAnnotation();
    }
  }

  /**
   * Перейти к следующей фотографии
   */
  nextPhoto() {
    const approval = this.approval();
    if (!approval) return;

    const index = this.selectedPhotoIndex();
    if (index < approval.photos.length - 1) {
      this.selectedPhotoIndex.set(index + 1);
      this.resetAnnotation();
    }
  }

  /**
   * Установить режим просмотра
   */
  setViewMode(mode: 'side-by-side' | 'slider' | 'toggle') {
    this.viewMode.set(mode);
    this.resetAnnotation();
  }

  /**
   * Увеличить масштаб
   */
  zoomIn() {
    const currentZoom = this.zoom();
    if (currentZoom < 200) {
      this.zoom.set(currentZoom + 10);
    }
  }

  /**
   * Уменьшить масштаб
   */
  zoomOut() {
    const currentZoom = this.zoom();
    if (currentZoom > 50) {
      this.zoom.set(currentZoom - 10);
    }
  }

  /**
   * Сбросить масштаб
   */
  resetZoom() {
    this.zoom.set(100);
  }

  /**
   * Обработать изменение положения слайдера
   */
  onSliderChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.sliderPosition.set(Number(target.value));
  }

  /**
   * Переключить между исходным и обработанным изображением
   */
  toggleImage() {
    this.showRetouched.update(value => !value);
  }

  /**
   * Установить отображение обработанного изображения
   */
  setShowRetouched(value: boolean) {
    this.showRetouched.set(value);
  }

  /**
   * Проверить, скрыта ли аннотация в режиме слайдера
   */
  isAnnotationHidden(annotation: PhotoAnnotation): boolean {
    // В режиме слайдера аннотация скрыта, если она находится в области, которая сейчас скрыта слайдером
    if (this.viewMode() === 'slider') {
      return annotation.x > this.sliderPosition();
    }
    return false;
  }

  /**
   * Включить/выключить режим аннотирования
   */
  toggleAnnotationMode() {
    this.annotationMode.update(value => !value);
    if (!this.annotationMode()) {
      this.resetAnnotation();
    }
  }

  /**
   * Сбросить аннотацию
   */
  resetAnnotation() {
    this.annotationPosition.set({x: null, y: null});
    this.annotationText = '';
    this.annotationMode.set(false);
  }

  /**
   * Отслеживать клики на изображении для добавления аннотаций
   */
  onClick(event: MouseEvent) {
    const retouchedImg = this.retouchedImg();
    if (!this.annotationMode() || !retouchedImg) return;

    const img = retouchedImg.nativeElement;
    const rect = img.getBoundingClientRect();

    // Проверить, что клик был на изображении
    if (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    ) {
      // Рассчитать относительные координаты в процентах
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;

      this.annotationPosition.set({x, y});
    }
  }

  /**
   * Отменить добавление аннотации
   */
  cancelAnnotation() {
    this.annotationPosition.set({x: null, y: null});
    this.annotationText = '';
  }

  /**
   * Сохранить аннотацию
   */
  saveAnnotation() {
    const photo = this.currentPhoto();
    const position = this.annotationPosition();

    if (!photo || position.x === null || position.y === null || !this.annotationText.trim()) {
      return;
    }    this.photoApprovalService.addAnnotation(
      photo.id,
      {
        x: position.x,
        y: position.y,
        text: this.annotationText.trim()
      }
    ).subscribe({
      next: () => {
        this.snackBar.open('Комментарий добавлен', 'Закрыть', {
          duration: 3000
        });
        this.resetAnnotation();
      },
      error: () => {
        this.snackBar.open('Не удалось добавить комментарий', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Добавить общий комментарий к фотографии
   */
  addGeneralComment() {
    const photo = this.currentPhoto();
    if (!photo || !this.generalComment.trim()) return;
      // Добавить аннотацию в центр изображения
    this.photoApprovalService.addAnnotation(
      photo.id,
      {
        x: 50,
        y: 50,
        text: this.generalComment.trim()
      }
    ).subscribe({
      next: () => {
        this.snackBar.open('Комментарий добавлен', 'Закрыть', {
          duration: 3000
        });
        this.generalComment = '';
      },
      error: () => {
        this.snackBar.open('Не удалось добавить комментарий', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Удалить аннотацию
   */
  deleteAnnotation(annotationId: string) {
    const photo = this.currentPhoto();
    if (!photo) return;
      this.photoApprovalService.removeAnnotation(
      photo.id,
      annotationId
    ).subscribe({
      next: () => {
        this.snackBar.open('Комментарий удален', 'Закрыть', {
          duration: 3000
        });
      },
      error: () => {
        this.snackBar.open('Не удалось удалить комментарий', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Одобрить текущую фотографию
   */
  approvePhoto() {
    const photo = this.currentPhoto();
    if (!photo) return;    this.photoApprovalService.updatePhotoStatus(
      photo.id,
      ApprovalStatus.APPROVED
    ).subscribe({
      next: () => {
        this.snackBar.open('Фотография одобрена', 'Закрыть', {
          duration: 3000
        });

        // Перейти к следующей фотографии, если она есть
        const approval = this.approval();
        if (approval && this.selectedPhotoIndex() < approval.photos.length - 1) {
          this.nextPhoto();
        }
      },
      error: () => {
        this.snackBar.open('Не удалось одобрить фотографию', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Отклонить текущую фотографию
   */
  rejectPhoto() {
    const photo = this.currentPhoto();
    if (!photo) return;

    // Если нет комментариев, запросить комментарий
    if (photo.annotations.length === 0) {
      this.snackBar.open('Пожалуйста, добавьте комментарий с пояснением', 'Закрыть', {
        duration: 3000
      });
      this.annotationMode.set(true);
      return;
    }
      this.photoApprovalService.updatePhotoStatus(
      photo.id,
      ApprovalStatus.REJECTED
    ).subscribe({
      next: () => {
        this.snackBar.open('Фотография отклонена', 'Закрыть', {
          duration: 3000
        });

        // Перейти к следующей фотографии, если она есть
        const approval = this.approval();
        if (approval && this.selectedPhotoIndex() < approval.photos.length - 1) {
          this.nextPhoto();
        }
      },
      error: () => {
        this.snackBar.open('Не удалось отклонить фотографию', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Проверить, можно ли одобрить все фотографии
   */
  canApproveAll(): boolean {
    const approval = this.approval();
    if (!approval) return false;

    // Можно одобрить все, если все фотографии проверены (одобрены или имеют аннотации)
    return approval.photos.every(p => p.approved || p.annotations.length > 0);
  }

  /**
   * Одобрить все фотографии
   */
  approveAll() {
    this.photoApprovalService.approveAll(this.approvalId).subscribe({
      next: () => {
        this.snackBar.open('Все фотографии одобрены', 'Закрыть', {
          duration: 3000
        });

        // Вернуться к списку
        this.router.navigate(['/user-profile/photo-approvals']);
      },
      error: () => {
        this.snackBar.open('Не удалось одобрить все фотографии', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Отклонить все фотографии
   */
  rejectAll() {
    // Проверить, есть ли хотя бы один комментарий
    const approval = this.approval();
    if (!approval) return;

    const hasAnyAnnotation = approval.photos.some(p => p.annotations.length > 0);
    if (!hasAnyAnnotation) {
      this.snackBar.open('Пожалуйста, добавьте хотя бы один комментарий с пояснением', 'Закрыть', {
        duration: 3000
      });
      return;
    }

    this.photoApprovalService.rejectAll(this.approvalId, 'Отклонено пользователем').subscribe({
      next: () => {
        this.snackBar.open('Все фотографии отклонены', 'Закрыть', {
          duration: 3000
        });

        // Вернуться к списку
        this.router.navigate(['/user-profile/photo-approvals']);
      },
      error: () => {
        this.snackBar.open('Не удалось отклонить все фотографии', 'Закрыть', {
          duration: 5000,
          panelClass: 'error-snackbar'
        });
      }
    });
  }

  /**
   * Загрузить ссылки скачивания
   */
  loadDownloadLinks() {
    this.downloadLoading.set(true);
    this.photoApprovalService.getSessionDownloadLinks(this.approvalId).subscribe({
      next: (res) => {
        this.downloadPhotos.set(res.photos);
        this.downloadLoading.set(false);
      },
      error: () => {
        this.downloadLoading.set(false);
      }
    });
  }

  /**
   * Скачать одно фото
   */
  downloadPhoto(url: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.click();
  }

  /**
   * Скачать все фото
   */
  downloadAll() {
    for (const photo of this.downloadPhotos()) {
      this.downloadPhoto(photo.url);
    }
  }

  /**
   * Вернуться к списку
   */
  goBack() {
    this.router.navigate(['/user-profile/photo-approvals']);
  }
}
