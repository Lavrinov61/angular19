# Fallback изображения для Magnus Photo

## Структура папок:

### `/src/assets/static/services/`
Изображения для услуг (Services):
- `placeholder-service.webp` - общий placeholder для услуг
- `portrait-service.webp` - портретная съемка  
- `wedding-service.webp` - свадебная съемка
- `commercial-service.webp` - коммерческая съемка
- `event-service.webp` - событийная съемка
- `family-service.webp` - семейная съемка

### `/src/assets/static/gallery/`
Изображения для галереи:
- `placeholder.jpg` - общий placeholder для галереи
- `portrait/fallback-portrait-*.webp` - портретные фото
- `wedding/fallback-wedding-*.webp` - свадебные фото  
- `commercial/fallback-commercial-*.webp` - коммерческие фото
- `event/fallback-event-*.webp` - событийные фото

## Рекомендации:

1. **Размеры изображений:**
   - Услуги: 400x300px или 600x400px
   - Галерея: 800x600px или 1200x800px

2. **Формат:** 
   - WebP для лучшей оптимизации
   - JPG как fallback для совместимости

3. **Оптимизация:**
   - Сжимайте изображения для web
   - Используйте качество 80-85% для WebP
   - Добавляйте alt-тексты для доступности

4. **Именование:**
   - Используйте описательные имена
   - Разделяйте слова дефисами
   - Указывайте категорию в имени файла
