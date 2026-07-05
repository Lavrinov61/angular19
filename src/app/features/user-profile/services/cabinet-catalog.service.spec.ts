import { SERVICES } from '../../../core/data/services.data';
import {
  buildCabinetCatalogGroups,
  buildCabinetCatalogItems,
  buildCabinetFeaturedItems,
} from './cabinet-catalog.service';

describe('cabinet catalog normalization', () => {
  it('builds client-facing groups instead of raw POS categories', () => {
    const groups = buildCabinetCatalogGroups(buildCabinetCatalogItems(SERVICES));
    const titles = groups.map(group => group.title);

    expect(titles).toContain('Документы');
    expect(titles).toContain('Печать и офис');
    expect(titles).toContain('Обработка фото');
    expect(titles).toContain('Онлайн');
    expect(titles).toContain('Для бизнеса');
    expect(titles).not.toContain('Услуги');
    expect(titles).not.toContain('Фотобумага');
  });

  it('promotes useful service entry points for the cabinet hero cards', () => {
    const items = buildCabinetCatalogItems(SERVICES);
    const featuredTitles = buildCabinetFeaturedItems(items).map(item => item.title);

    expect(featuredTitles.slice(0, 4)).toEqual([
      'Фото на документы',
      'Печать фотографий',
      'Печать документов',
      'Ретушь фото онлайн',
    ]);
  });
});
