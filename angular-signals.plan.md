<!-- 15af3dc4-6938-426e-b8ea-5c7dc8694963 33af22aa-b311-4d2f-9a3d-4b8fb75ec09a -->
# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

# План миграции Angular на современные паттерны - Фаза 2

## Анализ текущего состояния

После первой фазы миграции выполнено:

- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals в сервисах
- ✅ Замена takeUntil(this.destroy$) на takeUntilDestroyed()
- ✅ Конвертация Observable в signals с toSignal()
- ✅ Обновление шаблонов для использования сигналов

Осталось мигрировать:

- 🔄 Старый control flow (*ngIf, *ngFor, *ngSwitch) → новый (@if, @for, @switch) - ~700+ вхождений в 80+ файлах
- 🔄 ngClass/ngStyle → нативные class/style bindings
- 🔄 Упрощение lifecycle hooks (держать простыми, использовать интерфейсы) - 147 вхождений в 65 файлах
- 🔄 Оставшиеся @Input/@Output декораторы - 17 файлов
- ✅ SSR совместимость проверена

## Задачи миграции (сверено с официальной инструкцией Angular)

### 1. Миграция Control Flow (приоритет: высокий)

**Согласно инструкции Angular:**

- Использовать `@if`, `@for`, `@switch` вместо `*ngIf`, `*ngFor`, `*ngSwitch`
- **Обязательно использовать `track` в `@for`** с уникальным идентификатором (id, uuid) или `$index` для статических коллекций
- Использовать `@empty` блок для пустых коллекций
- Использовать контекстные переменные: `$index`, `$first`, `$last`, `$even`, `$odd`

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div *ngIf="condition">Content</div>
<div *ngFor="let item of items; let i = index">{{ item }}</div>
<div [ngSwitch]="value">
  <div *ngSwitchCase="'case1'">Case 1</div>
  <div *ngSwitchDefault>Default</div>
</div>

<!-- Новый синтаксис (согласно инструкции) -->
@if (condition()) {
  <div>Content</div>
}
@for (item of items(); track item.id || $index; let i = $index) {
  <div>{{ item }}</div>
} @empty {
  <div>No items</div>
}
@switch (value()) {
  @case ('case1') {
    <div>Case 1</div>
  }
  @default {
    <div>Default</div>
  }
}
```

**Важные моменты из инструкции:**

- `track` обязателен для производительности
- Использовать уникальный идентификатор (id, uuid) если доступен
- Для статических коллекций можно использовать `$index`
- Избегать `identity` (только если нет других вариантов)
- Использовать `@empty` для пустых коллекций

### 2. Замена ngClass/ngStyle на нативные bindings

**Согласно инструкции Angular:**

- Предпочитать нативные `class` и `style` bindings
- `NgClass` и `NgStyle` имеют дополнительную стоимость производительности

**Паттерны замены:**

```html
<!-- Старый синтаксис -->
<div [ngClass]="{'active': isActive, 'disabled': isDisabled}"></div>
<div [ngStyle]="{'font-size': fontSize + 'px', 'color': textColor}"></div>

<!-- Новый синтаксис (согласно инструкции) -->
<div [class.active]="isActive()" [class.disabled]="isDisabled()"></div>
<!-- ИЛИ -->
<div [class]="{'active': isActive(), 'disabled': isDisabled()}"></div>
<div [style.font-size.px]="fontSize()" [style.color]="textColor()"></div>
<!-- ИЛИ -->
<div [style]="{'font-size': fontSize() + 'px', 'color': textColor()}"></div>
```

### 3. Упрощение lifecycle hooks

**Согласно инструкции Angular:**

- **НЕ убирать полностью** `OnInit`/`OnDestroy` интерфейсы
- Держать методы простыми - выносить логику в отдельные методы
- Использовать интерфейсы (`implements OnInit`, `implements OnDestroy`) для проверки типов
- Предпочитать `inject()` над constructor injection

**Паттерн:**

```typescript
// Согласно инструкции - ПРАВИЛЬНО
export class MyComponent implements OnInit {
  private service = inject(MyService);
  
  ngOnInit() {
    this.startLogging();
    this.runBackgroundTask();
  }
  
  private startLogging(): void {
    // логика
  }
  
  private runBackgroundTask(): void {
    // логика
  }
}

// НЕПРАВИЛЬНО - слишком сложная логика в ngOnInit
export class MyComponent implements OnInit {
  ngOnInit() {
    this.logger.setMode('info');
    this.logger.monitorErrors();
    // ...много кода...
  }
}
```

**Для OnDestroy:**

```typescript
// Согласно инструкции
export class MyComponent implements OnDestroy {
  private destroyRef = inject(DestroyRef);
  
  constructor() {
    this.destroyRef.onDestroy(() => {
      // cleanup
    });
  }
  
  ngOnDestroy() {
    // дополнительная логика если нужна
  }
}
```

### 4. Миграция оставшихся @Input/@Output

**Файлы для проверки:**

- `src/app/features/photograph/components/` - portfolio-gallery, attention-section, photographer-rating, desire-section, action-section
- `src/app/core/components/navigation-rail/`
- `src/app/core/components/mobile-drawer/`
- `src/app/shared/directives/` - track-click, drag-drop

### 5. Финальная проверка SSR совместимости

**Проверить:**

- Все компоненты используют `isPlatformBrowser()` для browser-only API
- `toSignal()` используется правильно в injection context
- Нет прямого использования `window`, `document`, `localStorage` без проверки платформы
- Все Observable правильно конвертированы в signals

## Порядок выполнения

1. **Миграция control flow** - начать с shared компонентов, затем core, затем features
   - ✅ Использовать правильный `track` в каждом `@for`
   - ✅ Добавить `@empty` блоки где уместно
   - ✅ Использовать контекстные переменные ($index, $first, $last, $even, $odd)
2. **Замена ngClass/ngStyle** - параллельно с control flow
3. **Упрощение lifecycle hooks** - после миграции шаблонов
   - ⚠️ НЕ убирать интерфейсы, а упрощать методы
4. **Миграция оставшихся декораторов** - финальная проверка
5. **SSR проверка** - финальная валидация

## Критерии успеха

- ✅ Все шаблоны используют новый control flow (@if, @for, @switch)
- ✅ Все `@for` используют правильный `track` (id/uuid или $index)
- ✅ Используются `@empty` блоки где уместно
- ✅ Нет использования ngClass/ngStyle
- ✅ Lifecycle hooks простые, используют интерфейсы
- ✅ Все компоненты используют input()/output()
- ✅ Сборка проходит без ошибок
- ✅ SSR работает корректно

## Прогресс миграции

### Выполнено:
- ✅ Миграция @Input/@Output на input()/output()
- ✅ Миграция BehaviorSubject на signals
- ✅ Замена takeUntil на takeUntilDestroyed()
- ✅ Конвертация Observable в signals
- ✅ Миграция control flow в shared/components (services-section, gallery-section, advantages-section, service-process, service-pricing, service-cta, process-slider, contacts-section, about-preview, base-service-page)
- ✅ Миграция control flow в core/components (header, user-menu, mobile-drawer, navigation-rail, bottom-nav)

### В процессе:
- 🔄 Миграция control flow в остальных компонентах (features/, остальные shared/)

### Осталось:
- ⏳ Замена ngClass/ngStyle
- ⏳ Упрощение lifecycle hooks (с сохранением интерфейсов)
- ⏳ Миграция оставшихся @Input/@Output
- ⏳ Финальная SSR проверка

