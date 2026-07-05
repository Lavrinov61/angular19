import { Injectable, signal } from '@angular/core';
import { PrinterDetail } from '../models/fleet.models';

/**
 * Shared state for FleetDetailComponent и его child-tabs.
 * Родитель пушит детали, таб-компоненты читают без дублирования запросов.
 * Scoped через providers: [...] на уровне fleet-detail route в fleet.routes.ts.
 */
@Injectable()
export class FleetDetailStateService {
  readonly detail = signal<PrinterDetail | null>(null);
  readonly printerId = signal<string | null>(null);
}
