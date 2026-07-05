// Общие типы для системы бронирования, используемые в разных модулях

// Типы услуг
export enum ServiceType {
  STUDIO = 'studio',        // Студийные услуги (в Своё Фото)
  ON_LOCATION = 'onLocation'  // Выездные услуги (на локации клиента)
}

// Категории услуг
export enum ServiceCategory {
  DOCUMENTS = 'documents',           // Фото на документы
  PORTRAIT = 'portrait',             // Портретная фотосъёмка
  FAMILY = 'family',                 // Семейная фотосъёмка
  WEDDING = 'wedding',               // Свадебная фотосъёмка
  LOVE_STORY = 'love_story',         // Love Story
  COUPLE = 'couple',                 // Парная фотосъёмка
  COMMERCIAL = 'commercial',         // Коммерческая съёмка
  EVENT = 'event',                   // Событийная съёмка
  NEWBORN = 'newborn',              // Фотосъёмка новорождённых
  KIDS = 'kids',                    // Детская фотосъёмка
  MATERNITY = 'maternity',          // Фотосъёмка беременности
  BUSINESS = 'business',            // Бизнес-портреты
  BEAUTY = 'beauty',                // Beauty-портреты
  FASHION = 'fashion',              // Fashion-съёмка
  PRODUCT = 'product',              // Предметная съёмка
  RESTORATION = 'restoration',      // Реставрация фотографий
  COLORIZATION = 'colorization',    // Колоризация фотографий
  RETOUCHING = 'retouching',        // Ретушь фотографий
  MONTAGE = 'montage',              // Фотомонтаж
  PRINTING = 'printing',            // Печать фотографий
  CANVAS = 'canvas',                // Печать на холсте
  PHOTOBOOK = 'photobook',          // Создание фотокниг
  DOCUMENT_SERVICES = 'document_services', // Услуги с документами
  REPORT = 'report',                // Репортажная съёмка
  CORPORATE = 'corporate',          // Корпоративная съёмка
  BIRTHDAY = 'birthday',            // Фотосъёмка дня рождения
  ENGAGEMENT = 'engagement',        // Фотосъёмка помолвки
  OTHER = 'other'                   // Другие услуги
}

// Специализация сотрудника
export enum StaffSpecialization {
  PHOTOGRAPHER = 'photographer',     // Фотограф
  ARTIST = 'artist',                // Художник
  RETOUCHER = 'retoucher',          // Ретушер
  ADMIN = 'admin'                   // Администратор
}
