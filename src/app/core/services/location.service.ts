import { Injectable, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map } from 'rxjs';
import { Location } from '../models/enhanced-booking.model';

@Injectable({
  providedIn: 'root'
})
export class LocationService {
  // Signal для состояния
  private _locations = signal<Location[]>([]);
  
  // Публичный readonly signal
  readonly locations = this._locations.asReadonly();
  
  // Computed signals
  readonly hasLocations = computed(() => this._locations().length > 0);
  readonly locationsCount = computed(() => this._locations().length);
  
  // Legacy Observable API для обратной совместимости
  public locations$ = toObservable(this.locations);

  constructor() {
    this.initializeLocations();
  }

  private initializeLocations(): void {
    const locations: Location[] = [      {
        id: 'park-revolution',
        name: 'Парк Революции',
        description: 'Красивый городской парк с живописными аллеями, прудами и уютными уголками для фотосессий',
        address: 'проспект Кировский, 87',
        coordinates: { lat: 47.2230, lng: 39.7203 },
        type: 'park',
        features: ['Романтичные аллеи', 'Живописные пруды', 'Декоративные мостики', 'Зелёные зоны'],
        isPopular: true,
        season: ['spring', 'summer', 'autumn'],
        photos: [
          'assets/locations/park-revolution/main.webp',
          'assets/locations/park-revolution/pond.webp',
          'assets/locations/park-revolution/alley.webp'
        ],
        priceModifier: 0,
        travelTime: 15,
        rating: 4.6,
        reviewsCount: 98,
        bestTime: 'Утром (9:00-11:00) и вечером (17:00-19:00)',
        parkingInfo: 'Бесплатная парковка у главного входа',
        accessibility: 'Доступно для людей с ограниченными возможностями',
        images: []
      },
      {
        id: 'park-izmailovo',
        name: 'Измайловский парк',
        description: 'Живописный парк с историческими объектами и прекрасными видами',
        address: 'Измайловское шоссе, 73Ж',
        coordinates: { lat: 55.7877, lng: 37.7560 },
        type: 'park',
        features: ['Исторические здания', 'Лебединые пруды', 'Старинные мостики', 'Зелёные лужайки'],
        isPopular: true,
        season: ['spring', 'summer', 'autumn'],
        photos: [
          'assets/locations/izmailovo/main.webp',
          'assets/locations/izmailovo/building.webp',
          'assets/locations/izmailovo/pond.webp'
        ],
        priceModifier: 500,
        travelTime: 25,
        rating: 4.7,
        bestTime: 'Весь день (кроме выходных - много людей)',
        parkingInfo: 'Платная парковка 100 руб/час',
        accessibility: 'Частично доступно',
        images: []
      },
      {
        id: 'park-kolomenskoye',
        name: 'Парк Коломенское',
        description: 'Музей-заповедник с древней архитектурой и яблоневыми садами',
        address: 'пр-т Андропова, 39',
        coordinates: { lat: 55.6667, lng: 37.6667 },
        type: 'historical',
        features: ['Церковь Вознесения (UNESCO)', 'Царская резиденция', 'Яблоневые сады', 'Деревянный дворец'],
        isPopular: true,
        season: ['spring', 'summer', 'autumn'],
        photos: [
          'assets/locations/kolomenskoye/church.webp',
          'assets/locations/kolomenskoye/palace.webp',
          'assets/locations/kolomenskoye/garden.webp'
        ],        priceModifier: 1000,
        travelTime: 35,
        rating: 5.0,
        reviewsCount: 178,
        bestTime: 'Весна (цветение яблонь) и осень (золотые листья)',
        parkingInfo: 'Бесплатная парковка рядом с музеем',
        accessibility: 'Доступно для людей с ограниченными возможностями',
        specialRequirements: 'Требуется соблюдение правил музея-заповедника',
        images: []
        },      {
        id: 'rostov-embankment',
        name: 'Набережная Ростова-на-Дону',
        description: 'Живописная набережная с видом на Дон и современные достопримечательности',
        address: 'Набережная им. Ф.Э. Дзержинского',
        coordinates: { lat: 47.2357, lng: 39.7015 },
        type: 'waterfront',
        features: ['Вид на Дон', 'Пешеходная зона', 'Современная архитектура', 'Зелёные насаждения'],
        isPopular: true,
        season: ['all'],
        photos: [
          'assets/locations/rostov-embankment/main.webp',
          'assets/locations/rostov-embankment/don-view.webp',
          'assets/locations/rostov-embankment/walking-area.webp'
        ],
        priceModifier: 1000,
        travelTime: 10,
        rating: 4.7,
        reviewsCount: 189,
        bestTime: 'Раннее утро (до 8:00) или закат (18:00-20:00)',
        parkingInfo: 'Платная парковка рядом с набережной',
        accessibility: 'Доступно для людей с ограниченными возможностями',
        specialRequirements: 'Требуется разрешение на коммерческую съёмку. Запрещены штативы.',
        images: []
      },      {
        id: 'don-river',
        name: 'Дон',
        description: 'Набережные с живописными видами на реку Дон и город',
        address: 'Береговая улица',
        coordinates: { lat: 47.2324, lng: 39.7011 },
        type: 'waterfront',
        features: ['Панорамный вид на Дон', 'Речной порт', 'Прогулочная зона', 'Исторические места'],
        isPopular: false,
        season: ['spring', 'summer', 'autumn'],
        photos: [
          'assets/locations/don-river/main.webp',
          'assets/locations/don-river/port.webp',
          'assets/locations/don-river/sunset.webp'
        ],
        priceModifier: 800,
        travelTime: 15,
        rating: 4.6,
        reviewsCount: 98,
        bestTime: 'Золотой час (за час до заката)',
        parkingInfo: 'Платная парковка вдоль набережной',
        accessibility: 'Доступно для людей с ограниченными возможностями',
        images: []
      },
        {
        id: 'vdnkh',
        name: 'ВДНХ',
        description: 'Выставочный комплекс с фонтанами и павильонами',
        address: 'проспект Мира, 119',
        coordinates: { lat: 55.8215, lng: 37.6402 },
        type: 'exhibition',
        features: ['Фонтан "Дружба народов"', 'Ракета "Восток"', 'Павильоны', 'Аллеи'],
        photos: [
          'assets/locations/vdnkh/fountain.webp',
          'assets/locations/vdnkh/rocket.webp',
          'assets/locations/vdnkh/pavilion.webp'
        ],
        priceModifier: 800,
        travelTime: 30,
        rating: 4.7,
        reviewsCount: 123,
        bestTime: 'Будни утром или вечером',
        parkingInfo: 'Большая платная парковка',
        accessibility: 'Полностью доступно',
        images: []
      },
    {
        id: 'gorky-park',
        name: 'Парк Горького',
        description: 'Современный парк культуры и отдыха в центре Москвы',
        address: 'ул. Крымский Вал, 9',
        coordinates: { lat: 55.7311, lng: 37.6018 },
        type: 'park',
        features: ['Современные арт-объекты', 'Набережная', 'Розарий', 'Пушкинская набережная'],
        photos: [
          'assets/locations/gorky-park/main.webp',
          'assets/locations/gorky-park/art.webp',
          'assets/locations/gorky-park/riverfront.webp'
        ],
        priceModifier: 600,
        travelTime: 15,
        rating: 4.8,
        reviewsCount: 189,
        bestTime: 'Раннее утро в будни',
        parkingInfo: 'Платная парковка рядом с входом',
        accessibility: 'Доступно для людей с ограниченными возможностями',
        images: []
      }
    ];

    this._locations.set(locations);
  }

  // Получение всех локаций
  getAllLocations(): Observable<Location[]> {
    return this.locations$;
  }

  // Получение популярных локаций
  getPopularLocations(): Observable<Location[]> {
    return this.locations$.pipe(
      map(locations => locations.filter(location => location.isPopular))
    );
  }

  // Получение локаций по типу
  getLocationsByType(type: string): Observable<Location[]> {
    return this.locations$.pipe(
      map(locations => locations.filter(location => location.type === type))
    );
  }

  // Получение локации по ID
  getLocationById(id: string): Observable<Location | undefined> {
    return this.locations$.pipe(
      map(locations => locations.find(location => location.id === id))
    );
  }  // Получение локаций по сезону
  getLocationsBySeason(season: string): Observable<Location[]> {
    return this.locations$.pipe(
      map(locations => 
        locations.filter(location => 
          location.season?.includes(season) || location.season?.includes('all')
        )
      )
    );
  }

  // Поиск локаций
  searchLocations(query: string): Observable<Location[]> {
    const searchTerm = query.toLowerCase();
    return this.locations$.pipe(
      map(locations => 
        locations.filter(location =>
          location.name.toLowerCase().includes(searchTerm) ||
          location.description.toLowerCase().includes(searchTerm) ||
          location.features.some(feature => feature.toLowerCase().includes(searchTerm)) ||
          location.address.toLowerCase().includes(searchTerm)
        )
      )
    );
  }
  // Получение рекомендованных локаций для категории услуги
  getRecommendedLocations(serviceCategory: string): Observable<Location[]> {
    return this.locations$.pipe(
      map(locations => {
        // Фильтрация локаций по категории услуги
        switch (serviceCategory) {
          case 'WEDDING':
            return locations.filter(loc => 
              ['park', 'historical', 'waterfront'].includes(loc.type) && 
              (loc.rating || 0) >= 4.5
            );
          case 'FAMILY':
            return locations.filter(loc => 
              ['park', 'exhibition'].includes(loc.type) && 
              loc.accessibility === 'Доступно для людей с ограниченными возможностями'
            );
          case 'COUPLE':
            return locations.filter(loc => 
              ['park', 'waterfront', 'urban'].includes(loc.type) && 
              loc.isPopular
            );
          case 'PORTRAIT':
            return locations.filter(loc => 
              ['urban', 'park'].includes(loc.type)
            );
          default:
            return locations.filter(loc => loc.isPopular);
        }
      })
    );
  }

  // Расчёт времени в пути от студии
  calculateTravelTime(locationId: string): Observable<number> {
    return this.getLocationById(locationId).pipe(
      map(location => location?.travelTime || 0)
    );
  }

  // Получение доплаты за локацию
  getLocationPriceModifier(locationId: string): Observable<number> {
    return this.getLocationById(locationId).pipe(
      map(location => location?.priceModifier || 0)
    );
  }
  // Проверка доступности локации в определённый сезон
  isLocationAvailableInSeason(locationId: string, season: string): Observable<boolean> {
    return this.getLocationById(locationId).pipe(
      map(location => {
        if (!location) return false;
        return location.season?.includes(season) || location.season?.includes('all') || false;
      })
    );
  }
  // Получение локаций с сортировкой
  getLocationsSorted(sortBy: 'name' | 'rating' | 'price' | 'distance' = 'rating'): Observable<Location[]> {
    return this.locations$.pipe(
      map(locations => {
        const sortedLocations = [...locations];
        
        switch (sortBy) {
          case 'name':
            return sortedLocations.sort((a, b) => a.name.localeCompare(b.name));
          case 'rating':
            return sortedLocations.sort((a, b) => (b.rating || 0) - (a.rating || 0));
          case 'price':
            return sortedLocations.sort((a, b) => (a.priceModifier || 0) - (b.priceModifier || 0));
          case 'distance':
            return sortedLocations.sort((a, b) => (a.travelTime || 0) - (b.travelTime || 0));
          default:
            return sortedLocations;
        }
      })
    );
  }
}
