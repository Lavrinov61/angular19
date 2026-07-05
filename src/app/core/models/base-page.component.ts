import { Directive, OnInit, OnDestroy, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { GoalTrackingService } from '../services/goal-tracking.service';
import { Subscription, filter } from 'rxjs';

/**
 * Базовый компонент для всех страниц
 * Автоматически отслеживает просмотры страниц через GoalTrackingService
 */
@Directive()
export abstract class BasePageComponent implements OnInit, OnDestroy {
  protected router = inject(Router);
  protected goalTrackingService = inject(GoalTrackingService);
  
  protected baseSubscriptions: Subscription[] = [];
  
  // Имя страницы для аналитики, должно быть переопределено в дочерних компонентах
  abstract get pageName(): string;
  
  ngOnInit(): void {
    // Отслеживаем просмотр страницы при первой загрузке
    this.trackPageView();
    
    // Отслеживаем последующие навигации на эту же страницу (с разными параметрами)
    this.baseSubscriptions.push(
      this.router.events.pipe(
        filter(event => event instanceof NavigationEnd)
      ).subscribe(() => {
        this.trackPageView();
      })
    );
    
    // Вызываем инициализацию дочернего компонента, если он её определяет
    this.initializePageComponent();
  }
  
  ngOnDestroy(): void {
    // Отписываемся от всех подписок
    this.baseSubscriptions.forEach(sub => sub.unsubscribe());
    
    // Вызываем деструктор дочернего компонента, если он его определяет
    this.destroyPageComponent();
  }
  
  /**
   * Метод для инициализации в дочернем компоненте
   * По умолчанию ничего не делает, но может быть переопределен
   */
  protected initializePageComponent(): void { void 0; }
  
  /**
   * Метод для очистки ресурсов в дочернем компоненте
   * По умолчанию ничего не делает, но может быть переопределен
   */
  protected destroyPageComponent(): void { void 0; }
    /**
   * Отслеживает просмотр текущей страницы
   */
  protected trackPageView(): void {
    // ВРЕМЕННО ОТКЛЮЧЕНО - вернёмся к этому позже
    // this.goalTrackingService.trackPageView(this.pageName);
  }
    /**
   * Отслеживает клик по кнопке контакта
   */
  protected trackContactClick(_contactType: string): void {
    // ВРЕМЕННО ОТКЛЮЧЕНО - вернёмся к этому позже
    /*
    if (contactType.toLowerCase().includes('вконтакте')) {
      this.goalTrackingService.trackContactButtonClick('vk');
    } else if (contactType.toLowerCase().includes('telegram')) {
      this.goalTrackingService.trackContactButtonClick('telegram');
    } else if (contactType.toLowerCase().includes('связаться')) {
      this.goalTrackingService.trackContactButtonClick('contact_form');
    } else {
      // Для прочих типов контактов используем 'contact_form' вместо 'generic'
      this.goalTrackingService.trackContactButtonClick('contact_form');
    }
    */
  }
  
  /**
   * Отслеживает клик по кнопке бронирования
   */
  protected trackBookingClick(_platform = 'bitrix24'): void {
    // ВРЕМЕННО ОТКЛЮЧЕНО - вернёмся к этому позже
    // this.goalTrackingService.trackBookingClick(platform as any);
  }
}
