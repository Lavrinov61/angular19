import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';

import { ReactiveFormsModule, FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { AuthService } from '../../../../core/services/auth.service';
import { LoggerService } from '../../../../core/services/logger.service';
import {
  PhotographerApiService
} from '../../../../core/services/photographer-api.service';

// Локальные типы для адаптации данных
interface LocalServiceForManagement {
  id: string;
  serviceKey: string;
  name: string;  
  description?: string;
  categoryName: string; // это display_category для отображения
  mainCategory: string; // это основная category из БД
  sortOrder: number;
  isEnabled: boolean;
  currentPrice?: number;
  canSetPrice: boolean;
}

interface ServicesManagementResponse {
  photographer_id: string;
  photographer_name: string;
  studio_id: string;
  studio_name: string;
  total_services: number;
  enabled_services_count: number;
  services: LocalServiceForManagement[];
  available_categories: string[];
}

interface UpdateServicesRequest {
  services: {
    serviceId: string;
    price?: number;
  }[];
}

/** Shape of the raw API response for services management */
interface ServiceApiResponse {
  photographerId?: string | number;
  photographerName?: string;
  studioId?: string | number;
  studioName?: string;
  totalServices?: number;
  enabledServicesCount?: number;
  availableCategories?: string[];
  servicesByCategory?: Record<string, ServiceApiItem[]>;
}

interface ServiceApiItem {
  id: string | number;
  serviceKey?: string;
  name?: string;
  description?: string;
  category?: string;
  mainCategory?: string;
  sortOrder?: number;
  isEnabled?: boolean;
  currentPrice?: number;
  canSetPrice?: boolean;
}

/** Extract ServiceApiResponse from possibly wrapped API response */
function isWrappedResponse(val: unknown): val is { data: ServiceApiResponse } {
  return val !== null && typeof val === 'object' && 'data' in val;
}

function extractServiceApiResponse(response: unknown): ServiceApiResponse {
  if (isWrappedResponse(response)) {
    return response.data;
  }
  return response as ServiceApiResponse;
}

@Component({
  selector: 'app-services-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterModule,
    MatCardModule,
    MatCheckboxModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatIconModule,
    MatChipsModule
],
  templateUrl: './services-management.component.html',
  styleUrls: ['./services-management.component.scss']
})
export class ServicesManagementComponent {  private fb = inject(FormBuilder);
  private photographerApiService = inject(PhotographerApiService);
  private snackBar = inject(MatSnackBar);
  private authService = inject(AuthService);
  private log = inject(LoggerService);  // Signals для состояния компонента
  private readonly servicesData = signal<ServicesManagementResponse | null>(null);
  private readonly isLoading = signal(false);
  private readonly isSaving = signal(false);
  // Computed сигналы для представления
  readonly isLoadingState = computed(() => this.isLoading());
  readonly isSavingState = computed(() => this.isSaving());
  readonly isAuthorized = computed(() => {
    const user = this.authService.getCurrentUser();
    return user?.role === 'photographer' && user.uid;
  });
  readonly photographerInfo = computed(() => {
    const data = this.servicesData();
    return data ? {
      id: data.photographer_id,
      name: data.photographer_name,
      studioName: data.studio_name,
      totalServices: data.total_services,
      enabledCount: data.enabled_services_count
    } : null;
  });readonly serviceCategories = computed(() => {
    const data = this.servicesData();
    return data?.available_categories || [];
  });  // Словарь для перевода display_category на русский (только для категории 'event')
  private readonly categoryTranslations: Record<string, string> = {
    // Фотосъемка (category = 'event') - все эти услуги фотограф может редактировать
    'artistic': 'Художественная фотосъемка',
    'events': 'Событийная фотосъемка', 
    'family': 'Семейная фотосъемка',
    'portraits': 'Портретная съемка',
    'wedding': 'Свадебная фотосъемка'
  };

  // Категории основного типа (category) для группировки
  private readonly mainCategoryTranslations: Record<string, string> = {
    'event': 'Фотосъемка',
    'studio': 'Студийные услуги',
    'service': 'Дополнительные услуги',
    'combined': 'Комплексные пакеты'
  };

  // Computed для русских названий категорий
  readonly serviceCategoriesRussian = computed(() => {
    const categories = this.serviceCategories();
    return categories.map(category => ({
      key: category,
      name: this.categoryTranslations[category] || category
    }));
  });
  readonly allServices = computed(() => {
    const data = this.servicesData();
    if (!data?.services) return [];
    
    return data.services.sort((a, b) => a.sortOrder - b.sortOrder);
  });

  // Computed для услуг по категориям для использования в шаблоне
  readonly servicesByCategory = computed(() => {
    const services = this.allServices();
    const categories = this.serviceCategories();
    
    const result: Record<string, LocalServiceForManagement[]> = {};    categories.forEach(category => {
      result[category] = services.filter(service => service.categoryName === category);
    });
    
    return result;
  });

  // Форма для управления услугами  
  readonly servicesForm = signal<FormGroup | null>(null);
  // Получаем FormArray для удобства
  get servicesFormArray(): FormArray {
    return this.servicesForm()?.get('services') as FormArray;
  }

  constructor() {
    // Инициализация при создании компонента
    this.initializeComponent();
  }
  private async initializeComponent() {
    try {
      this.isLoading.set(true);
      
      // Теперь используем безопасные /me endpoints
      await this.loadServices();
    } catch (error) {
      this.log.error('[ServicesManagement] Initialization error:', error);
      this.snackBar.open('Ошибка при загрузке данных', 'Закрыть', { 
        duration: 3000,
        panelClass: ['error-snackbar']
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadServices() {
    try {
      this.log.debug('[ServicesManagement] Loading services for current photographer');
      
      // The API returns the data wrapped in ApiResponse, so we need to handle it properly
      const response = await this.photographerApiService.getPhotographerServicesForManagement().toPromise();
      
      if (response) {
        this.log.debug('API Response:', response); // Debug log
        
        // Check if response has the expected structure from backend
        const apiData: ServiceApiResponse = extractServiceApiResponse(response);

        // Convert the backend's servicesByCategory structure to a flat services array
        // Показываем только услуги категории 'event' (фотосъемка), которые фотограф может редактировать
        const allServices: LocalServiceForManagement[] = [];

        if (apiData.servicesByCategory) {
          Object.keys(apiData.servicesByCategory).forEach(category => {
            const categoryServices = apiData.servicesByCategory![category];
            categoryServices.forEach((service) => {
              const mainCategory = service.mainCategory || 'service';

              this.log.debug(`Service: ${service.name}, mainCategory: ${mainCategory}, display_category: ${service.category}`);

              // Показываем только услуги категории 'event' (фотосъемка)
              if (mainCategory === 'event') {
                allServices.push({
                  id: service.id.toString(),
                  serviceKey: service.serviceKey || '',
                  name: service.name || '',
                  description: service.description,
                  categoryName: service.category || category, // display_category для отображения
                  mainCategory: mainCategory, // основная category из БД
                  sortOrder: service.sortOrder || 0,
                  isEnabled: service.isEnabled || false,
                  currentPrice: service.currentPrice,
                  canSetPrice: service.canSetPrice || false
                });
              } else {
                this.log.debug(`Skipping service ${service.name} - not event category`);
              }
            });
          });
        }
        // Преобразуем ответ API в нужный формат
        const adaptedResponse: ServicesManagementResponse = {
          photographer_id: apiData.photographerId?.toString() || 'current',
          photographer_name: apiData.photographerName || 'Текущий фотограф',
          studio_id: apiData.studioId?.toString() || 'unknown',
          studio_name: apiData.studioName || 'unknown',
          total_services: apiData.totalServices || allServices.length,
          enabled_services_count: apiData.enabledServicesCount || allServices.filter(s => s.isEnabled).length,
          services: allServices,
          available_categories: apiData.availableCategories || [...new Set(allServices.map(s => s.categoryName))]
        };
        
        this.log.debug('Adapted Response:', adaptedResponse); // Debug log
        
        this.servicesData.set(adaptedResponse);
        this.createForm();
      }
    } catch (error) {
      this.log.error('Ошибка загрузки услуг:', error);
      this.snackBar.open('Ошибка загрузки услуг', 'Закрыть', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }
  private createForm() {
    const services = this.allServices();
    const servicesFormArray = this.fb.array(
      services.map((service: LocalServiceForManagement) => {
        const canEdit = this.canEditServicePrice(service);
        const priceControl = this.fb.control(
          service.currentPrice || null, 
          canEdit ? [Validators.min(0)] : []
        );
        
        // Отключаем контрол цены для read-only категорий
        if (!canEdit) {
          priceControl.disable();
        }

        return this.fb.group({
          serviceId: [service.id, Validators.required],
          isEnabled: [service.isEnabled || false],
          price: priceControl
        });
      })
    );

    const newForm = this.fb.group({
      services: servicesFormArray
    });

    this.servicesForm.set(newForm);
  }
  getServiceByIndex(index: number): LocalServiceForManagement | undefined {
    return this.allServices()[index];
  }  async onSave() {
    const form = this.servicesForm();
    if (!form?.valid) {
      return;
    }    try {
      this.isSaving.set(true);
      
      const formValue = form.value;
      const updateRequest: UpdateServicesRequest = {
        services: formValue.services
          .filter((service: Record<string, unknown>) => service['isEnabled'])
          .map((service: Record<string, unknown>) => ({
            serviceId: service['serviceId'],
            price: service['price'] || null
          }))
      };

      await this.photographerApiService.updatePhotographerServices(updateRequest).toPromise();      
      this.snackBar.open('Услуги успешно обновлены!', 'Закрыть', { 
        duration: 3000,
        panelClass: ['success-snackbar']
      });      // Перезагружаем данные после сохранения
      await this.loadServices();
      
    } catch (error) {
      this.log.error('Ошибка сохранения услуг:', error);
      this.snackBar.open('Ошибка сохранения услуг', 'Закрыть', { 
        duration: 3000,
        panelClass: ['error-snackbar']
      });
    } finally {
      this.isSaving.set(false);
    }
  }  onReset() {
    this.loadServices();
  }getServicesByCategory(categoryId: string): LocalServiceForManagement[] {
    return this.allServices().filter((service: LocalServiceForManagement) => service.categoryName === categoryId);
  }

  // Явно типизированный метод для использования в шаблоне
  getTypedServicesByCategory(categoryId: string): LocalServiceForManagement[] {
    return this.getServicesByCategory(categoryId);
  }

  getServiceControl(serviceId: string): FormGroup | null {
    const services = this.allServices();
    const index = services.findIndex((s: LocalServiceForManagement) => s.id === serviceId);
    if (index !== -1) {
      return this.servicesFormArray.at(index) as FormGroup;
    }
    return null;
  }

  onServiceToggle(serviceId: string, isEnabled: boolean) {
    const serviceControl = this.getServiceControl(serviceId);
    if (serviceControl && !isEnabled) {
      // Если услуга отключена, очищаем цену
      serviceControl.get('price')?.setValue(null);
    }
  }

  onServiceToggleByIndex(index: number) {
    const serviceControl = this.servicesFormArray.at(index);
    const isEnabled = serviceControl.get('isEnabled')?.value;
    
    if (!isEnabled) {
      // Если услуга отключена, очищаем цену
      serviceControl.get('price')?.setValue(null);
    }
  }

  // Вспомогательные методы для шаблона
  getServiceIndexInForm(serviceId: string): number {
    const services = this.allServices();
    return services.findIndex((s: LocalServiceForManagement) => s.id === serviceId);
  }

  isServiceEnabled(serviceId: string): boolean {
    const serviceControl = this.getServiceControl(serviceId);
    return serviceControl?.get('isEnabled')?.value || false;
  }
  trackByServiceId(_index: number, service: LocalServiceForManagement): string {
    return service.id;
  }  // Проверяет, можно ли фотографу редактировать цену услуги
  canEditServicePrice(_service: LocalServiceForManagement): boolean {
    // Мы показываем только услуги категории 'event', поэтому все отображаемые услуги можно редактировать
    return true;
  }  // Получить русское название категории
  getCategoryDisplayName(categoryKey: string): string {
    return this.categoryTranslations[categoryKey] || categoryKey;
  }

  // Получить иконку для категории
  getCategoryIcon(categoryKey: string): string {
    const iconMap: Record<string, string> = {
      'artistic': 'palette',
      'events': 'event',
      'family': 'family_restroom',
      'portraits': 'person',      'wedding': 'favorite'
    };
    return iconMap[categoryKey] || 'camera_alt';
  }
}
