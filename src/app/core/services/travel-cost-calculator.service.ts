import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { LocationOption } from '../models/enhanced-booking.model';

export interface TravelCostCalculation {
  baseCost: number;
  distanceKm: number;
  costPerKm: number;
  zoneMultiplier: number;
  totalCost: number;
  zone: 'inside_mkad' | 'outside_mkad' | 'far';
}

@Injectable({
  providedIn: 'root'
})
export class TravelCostCalculatorService {
  // Базовая стоимость выезда
  private readonly BASE_TRAVEL_COST = 500; // 500₽ базовая стоимость
  
  // Стоимость за километр
  private readonly COST_PER_KM = 30; // 30₽ за км
  
  // Координаты студии (базовая точка)
  private readonly STUDIO_COORDINATES = {
    lat: 47.219706,
    lng: 39.7107641
  };
  
  // Радиус МКАД (примерно 20 км от центра)
  private readonly MKAD_RADIUS_KM = 20;
  
  // Радиус дальних зон (более 50 км)
  private readonly FAR_ZONE_RADIUS_KM = 50;

  /**
   * Рассчитывает стоимость выезда по координатам
   */
  calculateTravelCost(location: LocationOption): Observable<TravelCostCalculation> {
    if (!location.coordinates) {
      // Если нет координат, используем фиксированную стоимость
      return of({
        baseCost: this.BASE_TRAVEL_COST,
        distanceKm: 0,
        costPerKm: 0,
        zoneMultiplier: 1,
        totalCost: this.BASE_TRAVEL_COST,
        zone: 'inside_mkad'
      });
    }

    const distance = this.calculateDistance(
      this.STUDIO_COORDINATES.lat,
      this.STUDIO_COORDINATES.lng,
      location.coordinates.lat,
      location.coordinates.lng
    );

    const zone = this.determineZone(distance);
    const zoneMultiplier = this.getZoneMultiplier(zone);
    const distanceCost = distance * this.COST_PER_KM;
    const totalCost = Math.round(this.BASE_TRAVEL_COST + distanceCost * zoneMultiplier);

    return of({
      baseCost: this.BASE_TRAVEL_COST,
      distanceKm: Math.round(distance * 10) / 10, // Округляем до 0.1 км
      costPerKm: this.COST_PER_KM,
      zoneMultiplier,
      totalCost,
      zone
    });
  }

  /**
   * Рассчитывает расстояние между двумя точками по формуле Haversine (в км)
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Радиус Земли в км
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance;
  }

  /**
   * Преобразует градусы в радианы
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Определяет зону по расстоянию
   */
  private determineZone(distance: number): 'inside_mkad' | 'outside_mkad' | 'far' {
    if (distance <= this.MKAD_RADIUS_KM) {
      return 'inside_mkad';
    } else if (distance <= this.FAR_ZONE_RADIUS_KM) {
      return 'outside_mkad';
    } else {
      return 'far';
    }
  }

  /**
   * Получает множитель для зоны
   */
  private getZoneMultiplier(zone: 'inside_mkad' | 'outside_mkad' | 'far'): number {
    switch (zone) {
      case 'inside_mkad':
        return 1.0; // Без доплаты
      case 'outside_mkad':
        return 1.5; // +50% за выезд за МКАД
      case 'far':
        return 2.0; // +100% за дальние зоны
      default:
        return 1.0;
    }
  }

  /**
   * Получает название зоны для отображения
   */
  getZoneLabel(zone: 'inside_mkad' | 'outside_mkad' | 'far'): string {
    switch (zone) {
      case 'inside_mkad':
        return 'В пределах города';
      case 'outside_mkad':
        return 'За пределами города';
      case 'far':
        return 'Дальние зоны';
      default:
        return '';
    }
  }
}






