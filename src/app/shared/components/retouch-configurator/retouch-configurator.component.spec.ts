import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RetouchConfiguratorComponent,
  RetouchConfigEvent,
} from './retouch-configurator.component';
import {
  RetouchChecklistApiService,
  RetouchChecklistGroup,
} from '../../../features/employee/services/retouch-checklist-api.service';

// Мини-каталог: одна multi-группа (макияж: дефолт + только-женский/только-мужской) + notes.
const CHECKLIST: RetouchChecklistGroup[] = [
  {
    group_slug: 'makeup',
    group_name: 'Макияж',
    selection_type: 'multi',
    sort_order: 1,
    items: [
      { slug: 'mk-base', name: 'База', hint: null, gender: 'any', icon: null, is_default: true, addon_price: 0 },
      { slug: 'mk-lips', name: 'Губы', hint: null, gender: 'female', icon: null, is_default: false, addon_price: 0 },
      { slug: 'mk-beard', name: 'Борода', hint: null, gender: 'male', icon: null, is_default: false, addon_price: 0 },
    ],
  },
  {
    group_slug: 'notes',
    group_name: 'Заметки',
    selection_type: 'notes',
    sort_order: 99,
    items: [],
  },
];

/**
 * NB: публичный input/output-контракт ([active]/[initial]/(configChange)) в order-creation-form
 * проверяется в S2 (интеграция). Здесь — внутренняя логика конфигуратора (загрузка каталога,
 * дефолты, toggle, gender-фильтр, снимок emitConfig). В текущем Vitest+jsdom-окружении
 * componentRef.setInput для signal-input не работает (NG0303 — инфраструктурное ограничение,
 * тот же эффект у about-preview.spec), поэтому effect-путь воспроизводим прямым вызовом
 * приватных шагов (loadRetouchChecklist/applyRetouchDefaults), которые этот effect и дёргает.
 */
describe('RetouchConfiguratorComponent', () => {
  let component: RetouchConfiguratorComponent;
  let getRetouchChecklist: ReturnType<typeof vi.fn>;
  let events: (RetouchConfigEvent | null)[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = () => component as any;

  beforeEach(() => {
    getRetouchChecklist = vi.fn(() => of(CHECKLIST));

    TestBed.configureTestingModule({
      providers: [
        { provide: RetouchChecklistApiService, useValue: { getRetouchChecklist } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new RetouchConfiguratorComponent());
    events = [];
    component.configChange.subscribe(e => events.push(e));
  });

  /** Воспроизводит то, что делает effect при active false→true. */
  function activate(): void {
    priv().loadRetouchChecklist();
    priv().emitConfig();
  }

  it('создаётся', () => {
    expect(component).toBeTruthy();
  });

  it('loadRetouchChecklist: грузит каталог и применяет дефолты (mk-base)', () => {
    activate();
    expect(getRetouchChecklist).toHaveBeenCalledTimes(1);
    expect(component.isRetouchItemSelected('makeup', 'mk-base')).toBe(true);
    const last = events.at(-1)!;
    expect(last.groups['makeup']).toEqual(['mk-base']);
    expect(last.gender).toBe('any');
  });

  it('toggleRetouchItem: снимает/добавляет галочку и эмитит обновлённый снимок', () => {
    activate();
    events.length = 0;

    const makeupGroup = CHECKLIST[0];
    component.toggleRetouchItem(makeupGroup, 'mk-base'); // снять дефолт
    expect(events.at(-1)!.groups['makeup']).toBeUndefined(); // пустая группа выпала из снимка

    component.toggleRetouchItem(makeupGroup, 'mk-base'); // добавить заново
    expect(events.at(-1)!.groups['makeup']).toEqual(['mk-base']);
  });

  it('emitConfig: notes попадает в снимок (trim, undefined при пустых)', () => {
    activate();
    events.length = 0;

    component.onRetouchNotesInput('  убрать блики  ');
    expect(events.at(-1)!.notes).toBe('убрать блики');

    component.onRetouchNotesInput('   ');
    expect(events.at(-1)!.notes).toBeUndefined();
  });

  it('gender-фильтр: М-вариант скрыт при female и виден при male', () => {
    activate();

    component.setRetouchGender('female');
    let makeup = component.visibleRetouchGroups().find(g => g.group_slug === 'makeup')!;
    expect(makeup.items.map(i => i.slug)).toEqual(['mk-base', 'mk-lips']); // борода скрыта

    component.setRetouchGender('male');
    makeup = component.visibleRetouchGroups().find(g => g.group_slug === 'makeup')!;
    expect(makeup.items.map(i => i.slug)).toEqual(['mk-base', 'mk-beard']); // губы скрыты
  });

  it('setRetouchGender вычищает выбор противоположного пола и эмитит', () => {
    activate();

    const makeupGroup = CHECKLIST[0];
    component.setRetouchGender('female');
    component.toggleRetouchItem(makeupGroup, 'mk-lips'); // женский вариант выбран
    expect(component.isRetouchItemSelected('makeup', 'mk-lips')).toBe(true);

    events.length = 0;
    component.setRetouchGender('male'); // mk-lips недопустим при male → вычищается
    expect(component.isRetouchItemSelected('makeup', 'mk-lips')).toBe(false);
    expect(events.at(-1)!.gender).toBe('male');
  });

  it('гидрация из initial: восстанавливает выбор черновика вместо дефолтов', () => {
    // initial — signal-input; в обход сломанного setInput подменяем его на инстансе.
    priv().initial = () => ({
      gender: 'male' as const,
      groups: { makeup: ['mk-beard'] },
      notes: 'аккуратно с бородой',
    });

    priv().loadRetouchChecklist();
    priv().emitConfig();

    const last = events.at(-1)!;
    expect(last.gender).toBe('male');
    expect(last.groups['makeup']).toEqual(['mk-beard']);
    expect(last.notes).toBe('аккуратно с бородой');
    // Дефолт mk-base НЕ применён (гидрация перебивает дефолты)
    expect(component.isRetouchItemSelected('makeup', 'mk-base')).toBe(false);
  });

  it('reset: обнуление сигналов даёт пустой снимок', () => {
    activate();
    expect(component.retouchGroupSelectedCount('makeup')).toBe(1);

    // Шаг сброса из ветки active→false
    priv()._retouchSelections.set({});
    priv()._retouchNotes.set('');
    priv()._retouchDefaultsApplied.set(false);
    priv()._retouchCollapsed.set({});

    expect(component.retouchGroupSelectedCount('makeup')).toBe(0);
  });
});
