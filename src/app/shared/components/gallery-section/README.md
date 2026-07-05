# Gallery Section Component

Переиспользуемый компонент галереи для отображения фотографий с современным дизайном и интерактивными элементами.

## Описание

Компонент `GallerySectionComponent` отображает секцию галереи с:
- Анимированными фоновыми элементами (floating камеры, градиентные мешы)
- Статистикой галереи с иконками
- Сеткой изображений в masonry-стиле
- Hover-эффектами и анимациями
- CTA-секцией с кнопками действий
- Адаптивным дизайном для мобильных устройств

## Использование

```html
<app-gallery-section 
  [galleryData]="galleryData"
  [config]="galleryConfig"
  [isMobile]="isMobile"
  [isTablet]="isTablet"
  [isDesktop]="isDesktop">
</app-gallery-section>
```

## Входные параметры

### galleryData: GalleryData (обязательный)
Объект с данными галереи:
```typescript
interface GalleryData {
  images: string[];     // Массив URL изображений
  stats: GalleryStat[]; // Статистика галереи
}

interface GalleryStat {
  icon: string;   // Имя Material Icon
  value: string;  // Значение (например, "500+")
  label: string;  // Подпись (например, "Фотографий")
}
```

### config: GalleryConfig (опциональный)
Конфигурация компонента:
```typescript
interface GalleryConfig {
  showStats?: boolean;   // Показывать статистику (по умолчанию: true)
  showCta?: boolean;     // Показывать CTA-секцию (по умолчанию: true)
  maxItems?: number;     // Максимальное количество изображений (по умолчанию: 6)
  compactMode?: boolean; // Компактный режим (по умолчанию: false)
}
```

### Responsive flags
- `isMobile: boolean` - Флаг мобильного устройства
- `isTablet: boolean` - Флаг планшета
- `isDesktop: boolean` - Флаг десктопа

## Пример данных

```typescript
// В компоненте
galleryData: GalleryData = {
  images: GALLERY_PREVIEW,
  stats: [
    { icon: 'photo_library', value: '500+', label: 'Фотографий' },
    { icon: 'people', value: '1000+', label: 'Клиентов' },
    { icon: 'star', value: '5.0', label: 'Рейтинг' },
    { icon: 'access_time', value: '20', label: 'Лет опыта' }
  ]
};

galleryConfig: GalleryConfig = {
  showStats: true,
  showCta: true,
  maxItems: 6,
  compactMode: false
};
```

## Функциональность

### Методы компонента
- `openGalleryModal(index: number)` - Открытие модального окна галереи
- `getImagePosition(index: number)` - Получение позиции изображения
- `getImageCategory(index: number)` - Получение категории изображения
- `getImageTitle(index: number)` - Получение заголовка изображения
- `getImageType(index: number)` - Получение типа изображения
- `getImageDate(index: number)` - Получение даты изображения
- `scrollToContacts()` - Прокрутка к секции контактов

### Особенности дизайна
- Современные CSS-анимации и transition-эффекты
- Адаптивная сетка с masonry-компоновкой
- Hover-эффекты с изменением прозрачности и масштаба
- Floating-элементы фона для создания глубины
- Градиентные overlays и световые эффекты

## Адаптивность

Компонент адаптируется под разные размеры экрана:
- **Mobile** (< 600px): Упрощенные анимации, скрытие декоративных элементов
- **Tablet** (600px - 839px): Средний размер элементов
- **Desktop** (> 840px): Полная функциональность и эффекты

## Зависимости

- Angular Material (MatButtonModule, MatIconModule)
- RouterLink для навигации
- CommonModule для директив Angular

## Стили

Компонент использует собственные SCSS-стили с:
- CSS Custom Properties для динамических значений
- Flexbox и CSS Grid для компоновки
- CSS-анимации с использованием keyframes
- Адаптивные медиа-запросы
