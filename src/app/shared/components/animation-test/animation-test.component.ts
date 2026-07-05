import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatTabsModule } from '@angular/material/tabs';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DevicePerformanceService, PerformanceLevel } from '../../../core/services/device-performance.service';

@Component({
  selector: 'app-animation-test',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSliderModule,
    MatTabsModule,
    MatBadgeModule,
    MatDividerModule,
    RouterLink,
    FormsModule
  ],
  template: `
    <div class="container">
      <div class="header-card">
        <h1 class="headline-large">Тест анимаций и производительности</h1>
        <p class="body-medium">Используйте этот инструмент для проверки адаптивности анимаций на различных устройствах</p>
      </div>
        <mat-tab-group>
        <mat-tab label="Тестирование анимаций">
          <mat-card class="test-card">
            <mat-card-header>
              <mat-card-title-group>
                <mat-card-title>Производительность устройства</mat-card-title>
                <mat-card-subtitle>
                  Обнаруженный уровень: 
                  <span [class]="getPerformanceLevelClass()">{{ getPerformanceLevelLabel() }}</span>
                </mat-card-subtitle>
                <div class="performance-badge" [class]="getPerformanceLevelClass()">
                  <mat-icon>{{ getPerformanceLevelIcon() }}</mat-icon>
                </div>
              </mat-card-title-group>
            </mat-card-header>
            
            <mat-card-content>
              <div class="animation-test-container">
                <!-- Тестовые анимации -->
                <div class="test-section">
                  <h3>Плавающие частицы</h3>
                  <div class="test-animation particles-test">
                    @for (i of [1,2,3,4,5]; track i) {
                      <div class="test-particle" [class]="'p' + i"></div>
                    }
                  </div>
                </div>
                
                <div class="test-section">
                  <h3>Эффект ряби</h3>
                  <div class="test-animation ripple-test">
                    <button mat-raised-button color="primary" class="ripple-button"
                            (click)="testRippleEffect($event)">
                      Тест эффекта ряби
                    </button>
                  </div>
                </div>
                
                <div class="test-section">
                  <h3>Градиентная анимация</h3>
                  <div class="test-animation gradient-test"></div>
                </div>
                
                <div class="test-section">
                  <h3>3D эффекты</h3>
                  <div class="test-animation rotate-3d-test">
                    <div class="rotate-cube"></div>
                  </div>
                </div>
              </div>
              
              <!-- Ручное управление производительностью -->
              <div class="performance-controls">
                <h3>Ручная настройка производительности</h3>
                <div class="slider-container">
                  <span>Низкая</span>
                  <mat-slider min="0" max="2" step="1" discrete [displayWith]="formatLabel">
                    <input matSliderThumb [(ngModel)]="manualPerformanceLevel"
                           (valueChange)="setPerformanceLevel($event)">
                  </mat-slider>
                  <span>Высокая</span>
                </div>
                
                <div class="controls-info">
                  <p>
                    <mat-icon>info</mat-icon>
                    Используйте ползунок для симуляции разных уровней производительности и проверки
                    адаптации анимаций.
                  </p>
                </div>
              </div>
            </mat-card-content>
            
            <mat-card-actions align="end">
              <button mat-button color="accent" (click)="resetToAuto()">Сбросить</button>
              <button mat-button routerLink="/home">Вернуться на главную</button>
            </mat-card-actions>
          </mat-card>
        </mat-tab>
        
        <mat-tab label="Документация">
          <mat-card class="docs-card">
            <mat-card-content>
              <h2 class="headline-medium">Оптимизации производительности анимаций</h2>
              
              <mat-divider></mat-divider>
              
              <div class="docs-section">
                <h3 class="headline-small">Автоматическая адаптация</h3>
                <p class="body-medium">
                  Система автоматически определяет уровень производительности устройства и 
                  адаптирует сложность анимаций для обеспечения плавного пользовательского опыта.
                </p>
                <ul class="body-medium feature-list">
                  <li>
                    <mat-icon>battery_saver</mat-icon>
                    <span>Анализ аппаратных возможностей устройства</span>
                  </li>
                  <li>
                    <mat-icon>tune</mat-icon>
                    <span>Динамическая настройка интенсивности анимаций</span>
                  </li>
                  <li>
                    <mat-icon>visibility</mat-icon>
                    <span>Контроль количества видимых декоративных элементов</span>
                  </li>
                </ul>
              </div>
              
              <mat-divider></mat-divider>
              
              <div class="docs-section">
                <h3 class="headline-small">Доступность и предпочтения пользователя</h3>
                <p class="body-medium">
                  Реализована поддержка пользовательских настроек и предпочтений в операционной системе:
                </p>
                <ul class="body-medium feature-list">
                  <li>
                    <mat-icon>settings_accessibility</mat-icon>
                    <span>Поддержка prefers-reduced-motion для уменьшения анимаций</span>
                  </li>
                  <li>
                    <mat-icon>contrast</mat-icon>
                    <span>Работа с высоким контрастом и другими настройками доступности</span>
                  </li>
                </ul>
              </div>
              
              <mat-divider></mat-divider>
              
              <div class="docs-section">
                <h3 class="headline-small">Технические оптимизации</h3>
                <p class="body-medium">
                  Для повышения производительности используются современные технические решения:
                </p>
                <ul class="body-medium feature-list">
                  <li>
                    <mat-icon>hardware</mat-icon>
                    <span>GPU-ускоряемые CSS свойства (transform, opacity)</span>
                  </li>
                  <li>
                    <mat-icon>memory</mat-icon>
                    <span>Оптимизация для предотвращения reflow и repaint</span>
                  </li>
                  <li>
                    <mat-icon>fast_forward</mat-icon>
                    <span>Использование will-change для подсказок браузеру</span>
                  </li>
                </ul>
              </div>
            </mat-card-content>
            
            <mat-card-actions align="end">
              <a mat-button color="primary" routerLink="/home">Вернуться на главную</a>
            </mat-card-actions>
          </mat-card>        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .container {
      padding: 24px;
      max-width: 960px;
      margin: 0 auto;
    }
    
    .header-card {
      margin-bottom: 24px;
      padding: 24px;
      background-color: var(--ed-surface-container, #1a1a1a);
      border-radius: 16px;
      text-align: center;
    }
    
    .test-card, .docs-card {
      margin-bottom: 24px;
      margin-top: 16px;
    }
    
    .animation-test-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
    }
    
    .test-section {
      h3 {
        margin-bottom: 12px;
        color: var(--ed-accent, #f59e0b);
      }
    }
    
    .test-animation {
      height: 200px;
      background-color: var(--ed-surface, #0a0a0a);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }
    
    .test-particle {
      position: absolute;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--ed-accent, #f59e0b);
      opacity: 0.6;
      
      &.p1 {
        top: 20%;
        left: 30%;
        animation: particle-float 20s infinite linear;
      }
      
      &.p2 {
        top: 60%;
        right: 25%;
        background-color: var(--ed-secondary, #8b8b8b);
        animation: particle-float 25s infinite linear 2s reverse;
      }
      
      &.p3 {
        bottom: 30%;
        left: 45%;
        background-color: var(--ed-accent, #f59e0b);
        animation: particle-float 18s infinite linear 5s;
      }
      
      &.p4 {
        top: 45%;
        right: 35%;
        width: 6px;
        height: 6px;
        animation: particle-float 22s infinite linear 3s;
      }
      
      &.p5 {
        bottom: 20%;
        left: 30%;
        width: 8px;
        height: 8px;
        background-color: var(--ed-secondary, #8b8b8b);
        animation: particle-float 15s infinite linear 1s reverse;
      }
    }
    
    .ripple-button {
      position: relative;
      overflow: hidden;
    }
    
    .gradient-test {
      background-image: 
        radial-gradient(circle at 30% 30%, var(--ed-accent-container, #451a03) 0%, transparent 30%),
        radial-gradient(circle at 70% 70%, var(--ed-accent-container, #451a03) 0%, transparent 30%);
      animation: enhanced-gradient-move 20s ease-in-out infinite alternate;
    }
    
    .rotate-cube {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, var(--ed-accent, #f59e0b) 0%, var(--ed-accent, #f59e0b) 100%);
      border-radius: 12px;
      animation: rotate-3d 10s ease-in-out infinite;
      transform-style: preserve-3d;
      box-shadow: 0 10px 20px rgba(0,0,0,0.1);
    }
    
    .performance-controls {
      margin-top: 32px;
      padding: 16px;
      background-color: var(--ed-surface-container, #1a1a1a);
      border-radius: 12px;
      
      h3 {
        margin-bottom: 16px;
        color: var(--ed-on-surface, #f5f5f5);
      }
    }
    
    .slider-container {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 16px;
      
      mat-slider {
        flex: 1;
      }
    }
    
    .controls-info {
      p {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        font-size: 14px;
        
        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
      }
    }
    
    .performance-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      
      &.performance-low {
        background-color: rgba(239, 68, 68, 0.1);
        color: var(--ed-error, #ef4444);
      }
      
      &.performance-medium {
        background-color: rgba(245, 158, 11, 0.1);
        color: var(--ed-accent, #f59e0b);
      }
      
      &.performance-high {
        background-color: rgba(245, 158, 11, 0.1);
        color: var(--ed-accent, #f59e0b);
      }
    }
    
    .performance-low {
      color: var(--ed-error, #ef4444);
      font-weight: 500;
    }
    
    .performance-medium {
      color: var(--ed-accent, #f59e0b);
      font-weight: 500;
    }
    
    .performance-high {
      color: var(--ed-accent, #f59e0b);
      font-weight: 500;
    }
    
    .docs-section {
      margin: 24px 0;
      
      h3 {
        margin-bottom: 12px;
        color: var(--ed-accent, #f59e0b);
      }
    }
    
    .feature-list {
      list-style-type: none;
      padding: 0;
      margin: 16px 0;
      
      li {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
        padding: 8px 12px;
        background-color: var(--ed-surface, #0a0a0a);
        border-radius: 8px;
        
        mat-icon {
          color: var(--ed-accent, #f59e0b);
        }
      }
    }
    
    // Анимации для тестирования
    @keyframes particle-float {
      0% {
        transform: translate(0, 0) rotate(0deg);
      }
      25% {
        transform: translate(30px, 20px) rotate(90deg);
      }
      50% {
        transform: translate(0, 40px) rotate(180deg);
      }
      75% {
        transform: translate(-30px, 20px) rotate(270deg);
      }
      100% {
        transform: translate(0, 0) rotate(360deg);
      }
    }
    
    @keyframes enhanced-gradient-move {
      0% {
        background-position: 0% 0%;
      }
      50% {
        background-position: 100% 50%;
      }
      100% {
        background-position: 0% 100%;
      }
    }
    
    @keyframes rotate-3d {
      0% {
        transform: perspective(500px) rotateX(0) rotateY(0);
      }
      25% {
        transform: perspective(500px) rotateX(15deg) rotateY(15deg);
      }
      50% {
        transform: perspective(500px) rotateX(0) rotateY(30deg);
      }
      75% {
        transform: perspective(500px) rotateX(-15deg) rotateY(15deg);
      }
      100% {
        transform: perspective(500px) rotateX(0) rotateY(0);
      }
    }
  `]
})
export class AnimationTestComponent implements OnInit {
  private performanceService = inject(DevicePerformanceService);
  private platformId = inject(PLATFORM_ID);
  
  // Текущий уровень производительности
  performanceLevel = PerformanceLevel.HIGH;
  
  // Ручная настройка уровня производительности через UI
  manualPerformanceLevel = 2; // По умолчанию высокая производительность
  
  ngOnInit(): void {
    // Получаем начальный уровень производительности
    this.performanceLevel = this.performanceService.getCurrentPerformanceLevel();
    
    // Устанавливаем значение слайдера в соответствии с уровнем
    this.manualPerformanceLevel = this.performanceLevelToSliderValue(this.performanceLevel);
  }
  
  /**
   * Преобразует уровень производительности в значение для слайдера
   */
  private performanceLevelToSliderValue(level: PerformanceLevel): number {
    switch (level) {
      case PerformanceLevel.LOW: return 0;
      case PerformanceLevel.MEDIUM: return 1;
      case PerformanceLevel.HIGH: return 2;
      default: return 2;
    }
  }
  
  /**
   * Преобразует значение слайдера в уровень производительности
   */
  private sliderValueToPerformanceLevel(value: number): PerformanceLevel {
    switch (value) {
      case 0: return PerformanceLevel.LOW;
      case 1: return PerformanceLevel.MEDIUM;
      case 2: 
      default: return PerformanceLevel.HIGH;
    }
  }
  
  /**
   * Форматирует значение слайдера для отображения
   */
  formatLabel(value: number): string {
    switch (value) {
      case 0: return 'Низкая';
      case 1: return 'Средняя';
      case 2: return 'Высокая';
      default: return '';
    }
  }
  
  /**
   * Устанавливает уровень производительности через DOM и CSS переменные
   */  setPerformanceLevel(value: number): void {
    // Проверка платформы - DOM доступен только в браузере
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    const level = this.sliderValueToPerformanceLevel(value);
    this.performanceLevel = level;
    
    // Устанавливаем классы для разных уровней производительности
    document.body.classList.remove('low-performance', 'medium-performance', 'high-performance');
    
    switch (level) {
      case PerformanceLevel.LOW:
        document.body.classList.add('low-performance');
        document.documentElement.style.setProperty('--animation-intensity', '0.3');
        break;
      case PerformanceLevel.MEDIUM:
        document.body.classList.add('medium-performance');
        document.documentElement.style.setProperty('--animation-intensity', '0.7');
        break;
      case PerformanceLevel.HIGH:
        document.body.classList.add('high-performance');
        document.documentElement.style.setProperty('--animation-intensity', '1');
        break;
    }
  }
  
  /**
   * Возвращает текстовую метку для уровня производительности
   */
  getPerformanceLevelLabel(): string {
    switch (this.performanceLevel) {
      case PerformanceLevel.LOW: return 'Низкая';
      case PerformanceLevel.MEDIUM: return 'Средняя';
      case PerformanceLevel.HIGH: return 'Высокая';
      default: return 'Неизвестно';
    }
  }
  
  /**
   * Возвращает CSS класс для текущего уровня производительности
   */
  getPerformanceLevelClass(): string {
    switch (this.performanceLevel) {
      case PerformanceLevel.LOW: return 'performance-low';
      case PerformanceLevel.MEDIUM: return 'performance-medium';
      case PerformanceLevel.HIGH: return 'performance-high';
      default: return '';
    }
  }
  
  /**
   * Возвращает иконку для текущего уровня производительности
   */
  getPerformanceLevelIcon(): string {
    switch (this.performanceLevel) {
      case PerformanceLevel.LOW: return 'battery_alert';
      case PerformanceLevel.MEDIUM: return 'battery_charging_50';
      case PerformanceLevel.HIGH: return 'battery_charging_full';
      default: return 'help_outline';
    }
  }
  
  /**
   * Тестирует эффект ряби на кнопке
   */
  testRippleEffect(event: MouseEvent): void {
    const button = event.currentTarget as HTMLElement;
    
    // Разные эффекты для разных уровней производительности
    if (this.performanceLevel === PerformanceLevel.LOW) {
      button.classList.add('ripple-simple');
      setTimeout(() => button.classList.remove('ripple-simple'), 300);
    } else {
      button.classList.add('ripple-active');
      setTimeout(() => button.classList.remove('ripple-active'), 700);
    }
  }
  
  /**
   * Сбрасывает настройки производительности на автоматические
   */
  resetToAuto(): void {
    // Получаем автоматически определенный уровень
    const autoLevel = this.performanceService.getCurrentPerformanceLevel();
    this.performanceLevel = autoLevel;
    this.manualPerformanceLevel = this.performanceLevelToSliderValue(autoLevel);
    
    // Применяем настройки
    this.setPerformanceLevel(this.manualPerformanceLevel);
  }
}







