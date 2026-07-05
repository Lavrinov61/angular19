import { groupRetouchOptions } from './retouch-options.util';

describe('groupRetouchOptions', () => {
  it('группирует объектный формат по group_name', () => {
    const groups = groupRetouchOptions([
      { group: 'makeup', group_name: 'Макияж', slug: 'mk-tone', label: 'Тон' },
      { group: 'makeup', group_name: 'Макияж', slug: 'mk-lips', label: 'Губы' },
      { group: 'hair', group_name: 'Волосы', slug: 'hair-volume', label: 'Объём' },
    ]);

    expect(groups.length).toBe(2);
    expect(groups[0].name).toBe('Макияж');
    expect(groups[0].items.map(i => i.label)).toEqual(['Тон', 'Губы']);
    expect(groups[0].items.map(i => i.key)).toEqual(['mk-tone', 'mk-lips']);
    expect(groups[1].name).toBe('Волосы');
    expect(groups[1].items.map(i => i.label)).toEqual(['Объём']);
  });

  it('строковый (исторический) формат → одна группа без заголовка', () => {
    const groups = groupRetouchOptions(['Отбеливание зубов', 'Удаление прыщей']);

    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe('');
    expect(groups[0].key).toBe('flat');
    expect(groups[0].items.map(i => i.label)).toEqual([
      'Отбеливание зубов',
      'Удаление прыщей',
    ]);
  });

  it('пустой массив → нет групп', () => {
    expect(groupRetouchOptions([])).toEqual([]);
  });

  it('объект без label падает на slug', () => {
    const groups = groupRetouchOptions([{ group_name: 'Кожа', slug: 'skin-smooth' }]);
    expect(groups[0].items[0].label).toBe('skin-smooth');
  });

  it('объект без group_name схлопывается в одну плоскую группу', () => {
    const groups = groupRetouchOptions([
      { slug: 'a', label: 'A' },
      { slug: 'b', label: 'B' },
    ]);
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe('');
    expect(groups[0].items.map(i => i.label)).toEqual(['A', 'B']);
  });
});
