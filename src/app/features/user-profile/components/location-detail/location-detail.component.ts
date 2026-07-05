import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';

import {
  PhotoLocation,
  LocationCategoryType as LocationCategory,
  LocationDifficultyType as LocationDifficulty,
  TimeOfDayType as TimeOfDay
} from '../../../../core/models/photo-location.model';
import { PhotoLocationsApiService } from '../../../../core/services/photo-locations-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { LoggerService } from '../../../../core/services/logger.service';

interface LocationReview {
  id?: string;
  userName?: string;
  rating: number;
  date?: string | Date;
  text?: string;
  photos?: string[];
}

@Component({
  selector: 'app-location-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule,
    MatTabsModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
    MatBadgeModule
  ],
  templateUrl: './location-detail.component.html',
  styleUrls: ['./location-detail.component.scss']
})
export class LocationDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private authService = inject(AuthService);
  private photoLocationsApiService = inject(PhotoLocationsApiService);
  private log = inject(LoggerService);

  // Signals
  location = signal<PhotoLocation | null>(null);
  protected loading = signal(false);
  error = signal<string | null>(null);
  reviews = signal<LocationReview[]>([]);
  nearbyLocations = signal<PhotoLocation[]>([]);
  similarLocations = signal<PhotoLocation[]>([]);
  protected selectedImageIndex = signal(0);
  
  // Computed
  protected hasLocation = computed(() => !!this.location());
  protected averageRating = computed(() => {
    const loc = this.location();
    return loc ? loc.rating : 0;
  });
  protected isFavorite = computed(() => false); // TODO: implement favorites
  
  categoryIcons: Record<string, string> = {
    'nature': 'nature',
    'urban': 'location_city', 
    'historical': 'account_balance',
    'studio': 'photo_camera',
    'beach': 'beach_access',
    'park': 'park',
    'rooftop': 'roofing',
    'interior': 'home',
    'street': 'traffic',
    'industrial': 'factory'
  };

  constructor() {
    this.route.params.pipe(
      takeUntilDestroyed()
    ).subscribe(params => {
      const id = params['id'];
      if (id) {
        this.loadLocation(id);
      }
    });
  }


  private loadLocation(id: string) {
    this.loading.set(true);
    
    this.photoLocationsApiService.getLocationById(id)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (response) => {
          if (response.data) {
            this.location.set(response.data);
            this.loadRelatedData(response.data);
          }
          this.loading.set(false);
        },
        error: (error) => {
          this.log.error('Error loading location:', error);
          this.snackBar.open('Ошибка загрузки локации', 'Закрыть', { duration: 3000 });
          this.loading.set(false);
        }
      });
  }

  private loadRelatedData(location: PhotoLocation) {
    // Загружаем похожие локации по категории
    this.photoLocationsApiService.getLocationsByCategory(location.category)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (response) => {
          if (response.data) {
            const filtered = response.data.filter(loc => loc.id !== location.id).slice(0, 3);
            this.similarLocations.set(filtered);
          }
        },
        error: (error) => this.log.error('Error loading similar locations:', error)
      });

    // Загружаем локации поблизости
    this.photoLocationsApiService.getNearbyLocations(
      location.coordinates.lat, 
      location.coordinates.lng, 
      10
    )
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (response) => {
          if (response.data) {
            const filtered = response.data.filter(loc => loc.id !== location.id).slice(0, 3);
            this.nearbyLocations.set(filtered);
          }
        },
        error: (error) => this.log.error('Error loading nearby locations:', error)
      });
  }

  getCategoryLabel(category: LocationCategory): string {
    const categoryLabels: Record<string, string> = {
      'nature': 'Природа',
      'urban': 'Городские локации',
      'historical': 'Исторические места',
      'studio': 'Студии',
      'beach': 'Пляжи',
      'park': 'Парки',
      'rooftop': 'Крыши',
      'interior': 'Интерьеры',
      'street': 'Уличные локации',
      'industrial': 'Индустриальные'
    };
    return categoryLabels[category] || category;
  }

  getDifficultyLabel(difficulty: LocationDifficulty): string {
    const difficultyLabels: Record<string, string> = {
      'easy': 'Легко',
      'moderate': 'Умеренно',
      'hard': 'Сложно',
      'expert': 'Экспертный'
    };
    return difficultyLabels[difficulty] || difficulty;
  }

  getDifficultyColor(difficulty: LocationDifficulty): string {
    const colors: Record<string, string> = {
      'easy': 'green',
      'moderate': 'orange',
      'hard': 'red',
      'expert': 'purple'
    };
    return colors[difficulty] || 'gray';
  }

  getTimeOfDayText(timeSlots: TimeOfDay[]): string {
    if (!timeSlots || timeSlots.length === 0) return 'Не указано';
    
    const timeLabels: Record<string, string> = {
      'dawn': 'Рассвет',
      'morning': 'Утром',
      'noon': 'Днем',
      'afternoon': 'После обеда',
      'evening': 'Вечером',
      'dusk': 'Закат',
      'night': 'Ночью'
    };
    
    return timeSlots.map(time => timeLabels[time] || time).join(', ');
  }

  onBookLocation() {
    const location = this.location();
    if (location) {
      this.router.navigate(['/booking', location.id]);
    }
  }

  onShareLocation() {
    const location = this.location();
    if (location && navigator.share) {
      navigator.share({
        title: location.name,
        text: location.description,
        url: window.location.href
      });
    } else {
      // Fallback - копируем в буфер обмена
      navigator.clipboard.writeText(window.location.href);
      this.snackBar.open('Ссылка скопирована в буфер обмена', 'Закрыть', { duration: 2000 });
    }
  }

  onLocationClick(locationId: string) {
    this.router.navigate(['/locations', locationId]);
  }

  // Недостающие методы для шаблона
  goBack() {
    this.router.navigate(['/locations']);
  }

  toggleFavorite() {
    // TODO: implement favorites functionality
    this.log.debug('Toggle favorite');
  }

  shareLocation() {
    this.onShareLocation();
  }

  getStarArray(rating: number): boolean[] {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(i <= rating);
    }
    return stars;
  }

  openMap() {
    const location = this.location();
    if (location) {
      const url = `https://maps.google.com/?q=${location.coordinates.lat},${location.coordinates.lng}`;
      window.open(url, '_blank');
    }
  }

  selectImage(index: number) {
    const location = this.location();
    if (location && index >= 0 && index < location.images.length) {
      this.selectedImageIndex.set(index);
    }
  }

  getTimeOfDayLabel(timeSlot: string): string {
    const timeLabels: Record<string, string> = {
      'dawn': 'Рассвет',
      'morning': 'Утром',
      'noon': 'Днем',
      'afternoon': 'После обеда',
      'evening': 'Вечером',
      'dusk': 'Закат',
      'night': 'Ночью'
    };
    return timeLabels[timeSlot] || timeSlot;
  }

  formatDate(date: string | Date): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('ru-RU');
  }

  bookLocation() {
    this.onBookLocation();
  }

  contactPhotographer() {
    const location = this.location();
    if (location?.photographer) {
      // TODO: implement photographer contact
      this.snackBar.open('Функция связи с фотографом будет добавлена позже', 'Закрыть', { duration: 3000 });
    }
  }
}
