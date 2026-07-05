import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestimonialsComponent } from '../testimonials.component';
import { MatTabsModule } from '@angular/material/tabs';

@Component({
  selector: 'app-testimonials-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TestimonialsComponent, MatTabsModule],
  template: `
    <div class="demo-container">
      <h1 class="mat-headline-4">Варианты компонента отзывов</h1>
      
      <mat-tab-group animationDuration="300ms">
        <mat-tab label="Карточки">
          <div class="tab-content">
            <h2 class="mat-headline-6">Вариант 1: Карточки</h2>
            <p class="description">
              Классический дизайн с отзывами в виде карточек. Подходит для отображения 
              нескольких отзывов одновременно.
            </p>
            <app-testimonials variant="card"></app-testimonials>
          </div>
        </mat-tab>
        
        <mat-tab label="Слайдер">
          <div class="tab-content">
            <h2 class="mat-headline-6">Вариант 2: Слайдер</h2>
            <p class="description">
              Современный слайдер, который автоматически перелистывает отзывы. 
              Хорошо подходит для главной страницы.
            </p>
            <app-testimonials variant="slider"></app-testimonials>
          </div>
        </mat-tab>
        
        <mat-tab label="Минимализм">
          <div class="tab-content">
            <h2 class="mat-headline-6">Вариант 3: Минималистичный</h2>
            <p class="description">
              Элегантный и лаконичный дизайн с акцентом на текст отзывов. 
              Идеален для формальных и бизнес-ориентированных страниц.
            </p>
            <app-testimonials variant="minimal"></app-testimonials>
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .demo-container {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .tab-content {
      padding: 24px 0;
    }
    
    h1 {
      margin-bottom: 24px;
      color: var(--ed-on-surface, #f5f5f5);
    }

    h2 {
      margin-bottom: 8px;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .description {
      margin-bottom: 32px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }
  `]
})
export class TestimonialsDemoComponent {}
