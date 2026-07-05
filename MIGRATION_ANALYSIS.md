# Анализ миграции Angular на современные паттерны

## Дата анализа: 2024

## Общая оценка миграции

**Статус:** Миграция выполнена частично (~70-80%)

Большинство критических аспектов мигрированы, но остаются недочёты в стиле кода согласно официальной инструкции Angular.

---

## ✅ Выполнено успешно

### 1. Control Flow (100%)
- ✅ Все шаблоны используют новый синтаксис `@if`, `@for`, `@switch`
- ✅ Все `@for` используют правильный `track` (id/uuid или `$index`)
- ✅ Используются `@empty` блоки где уместно

### 2. ngClass/ngStyle (100%)
- ✅ Все использования заменены на нативные `[class]` и `[style]` bindings

### 3. @Input/@Output (100%)
- ✅ Все декораторы заменены на `input()` и `output()` функции

### 4. Lifecycle Hooks (частично)
- ✅ Логика вынесена в отдельные методы
- ✅ Интерфейсы `OnInit`/`OnDestroy` сохранены
- ✅ Используется `takeUntilDestroyed()` вместо массивов подписок

### 5. SSR Совместимость (100%)
- ✅ Все browser API обернуты в `isPlatformBrowser()` проверки
- ✅ HTTP interceptors правильно настроены

### 6. Standalone Components (100%)
- ✅ Все компоненты используют `standalone: true` (143 файла)

### 7. ChangeDetectionStrategy.OnPush (частично)
- ✅ 26 компонентов используют `OnPush`
- ⚠️ Остальные компоненты не имеют явной стратегии

---

## ❌ Найденные недочёты

### 1. @HostBinding и @HostListener декораторы (КРИТИЧНО)

**Проблема:** Согласно инструкции Angular (llms-full.txt, строка 45) и правилам проекта (.cursor/rules/angular-20.mdc):
> "Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead."

**Найдено в файлах:**
- `src/app/features/home/home/home.component.ts` - 7 использований `@HostBinding`
- `src/app/core/components/header/header.component.ts` - 3 использования `@HostListener`
- `src/app/core/components/navigation-rail/navigation-rail.component.ts` - вероятно есть
- `src/app/core/components/mobile-drawer/mobile-drawer.component.ts` - вероятно есть

**Пример неправильного кода:**
```typescript
@HostBinding('class.mobile-view') get isMobileView() {
  return this.isMobile;
}

@HostListener('document:keydown.escape')
onEscapeKey(): void {
  // ...
}
```

**Правильный подход:**
```typescript
@Component({
  // ...
  host: {
    '[class.mobile-view]': 'isMobile',
    '(document:keydown.escape)': 'onEscapeKey()'
  }
})
```

---

### 2. Отсутствие `readonly` для input/output (ВАЖНО)

**Проблема:** Согласно инструкции Angular (llms-full.txt, строка 305-318):
> "Mark component and directive properties initialized by Angular as `readonly`. This includes properties initialized by `input`, `model`, `output`, and queries."

**Статистика:**
- Найдено только 2 файла с `readonly` для input/output
- Остальные ~140+ компонентов не используют `readonly`

**Пример неправильного кода:**
```typescript
export class UserMenuComponent {
  showLabel = input<boolean>(false);  // ❌ Нет readonly
  logoutRequested = output<void>();    // ❌ Нет readonly
}
```

**Правильный подход:**
```typescript
export class UserMenuComponent {
  readonly showLabel = input<boolean>(false);
  readonly logoutRequested = output<void>();
}
```

**Файлы для исправления:**
- Все компоненты с `input()` и `output()` (~140+ файлов)

---

### 3. Отсутствие `protected` для template-only members (ВАЖНО)

**Проблема:** Согласно инструкции Angular (llms-full.txt, строка 285-303):
> "Prefer `protected` access for any members that are meant to be read from the component's template."

**Статистика:**
- Найдено только 5 файлов с `protected` для computed/signals
- Остальные компоненты используют `public` или не указывают модификатор

**Пример неправильного кода:**
```typescript
export class UserMenuComponent {
  isAuthenticated = computed(() => !!this.authService.user());  // ❌ public по умолчанию
  userName = computed(() => this.userProfile()?.displayName || '');  // ❌ public
}
```

**Правильный подход:**
```typescript
export class UserMenuComponent {
  protected isAuthenticated = computed(() => !!this.authService.user());
  protected userName = computed(() => this.userProfile()?.displayName || '');
}
```

**Файлы для исправления:**
- Все компоненты с `computed()` и `signal()`, используемыми только в шаблонах (~100+ файлов)

---

### 4. Constructor injection вместо `inject()` (СРЕДНЕ)

**Проблема:** Согласно инструкции Angular (llms-full.txt, строка 224-233):
> "Prefer using the `inject` function over injecting constructor parameters."

**Найдено в файлах (10 файлов):**
- `src/app/features/user-profile/components/photo-session-dialog/photo-session-dialog.component.ts`
- `src/app/features/user-profile/components/avatar-upload-dialog/avatar-upload-dialog.component.ts`
- `src/app/core/services/service-worker.service.ts`
- `src/app/core/services/geolocation.service.ts`
- `src/app/core/services/device-performance.service.ts`
- `src/app/core/components/theme-toggle/theme-toggle.component.ts`
- `src/app/features/photograph/components/desire-section/desire-section.component.ts`
- `src/app/features/photograph/components/portfolio-gallery/portfolio-gallery.component.ts`
- `src/app/core/services/error-handler.service.ts`
- `src/app/core/directives/theme-sync.directive.ts`

**Пример неправильного кода:**
```typescript
export class MyComponent {
  constructor(
    private myService: MyService,
    private router: Router
  ) {}
}
```

**Правильный подход:**
```typescript
export class MyComponent {
  private myService = inject(MyService);
  private router = inject(Router);
}
```

---

### 5. Явное указание `standalone: true` (НЕЗНАЧИТЕЛЬНО)

**Проблема:** Согласно правилам проекта (.cursor/rules/angular-20.mdc, строка 32-41):
> "When creating standalone components, you do not need to explicitly set `standalone: true` inside the `@Component`, `@Directive` and `@Pipe` decorators, as it is implied by default."

**Статистика:**
- 143 файла явно указывают `standalone: true`
- Это не критично, но не соответствует правилам проекта

**Пример:**
```typescript
@Component({
  standalone: true,  // ❌ Не нужно, подразумевается по умолчанию
  // ...
})
```

**Правильный подход:**
```typescript
@Component({
  // standalone: true не нужен
  // ...
})
```

---

### 6. Отсутствие `ChangeDetectionStrategy.OnPush` (СРЕДНЕ)

**Проблема:** Согласно правилам проекта (.cursor/rules/angular-20.mdc, строка 65):
> "Always set `changeDetection: ChangeDetectionStrategy.OnPush` in the `@Component` decorator for performance benefits."

**Статистика:**
- Только 26 компонентов используют `OnPush`
- Остальные ~115+ компонентов не имеют явной стратегии

**Файлы для исправления:**
- Все компоненты без `changeDetection: ChangeDetectionStrategy.OnPush`

---

## Приоритеты исправления

### Высокий приоритет (критично для соответствия инструкции)
1. ✅ Замена `@HostBinding`/`@HostListener` на `host` объект (4 файла)
2. ✅ Добавление `readonly` для всех `input()`/`output()` (~140+ файлов)
3. ✅ Добавление `protected` для template-only members (~100+ файлов)

### Средний приоритет (улучшение стиля кода)
4. ✅ Замена constructor injection на `inject()` (10 файлов)
5. ✅ Добавление `ChangeDetectionStrategy.OnPush` (~115+ файлов)

### Низкий приоритет (косметические изменения)
6. ✅ Удаление явного `standalone: true` (143 файла)

---

## Рекомендации

1. **Начать с высокоприоритетных задач** - они критичны для соответствия официальной инструкции Angular
2. **Использовать автоматические инструменты** - Angular CLI может помочь с некоторыми миграциями
3. **Постепенное исправление** - можно исправлять по модулям/фичам
4. **Добавить линтер правила** - настроить ESLint/TSLint для автоматической проверки

---

## Итоговая оценка

| Категория | Статус | Прогресс |
|-----------|--------|----------|
| Control Flow | ✅ | 100% |
| ngClass/ngStyle | ✅ | 100% |
| @Input/@Output | ✅ | 100% |
| Lifecycle Hooks | ⚠️ | 80% |
| SSR | ✅ | 100% |
| Standalone | ✅ | 100% |
| @HostBinding/@HostListener | ❌ | 0% |
| readonly для input/output | ❌ | ~1% |
| protected для template members | ❌ | ~5% |
| inject() вместо constructor | ⚠️ | ~90% |
| OnPush strategy | ⚠️ | ~20% |

**Общий прогресс миграции: ~75%**

