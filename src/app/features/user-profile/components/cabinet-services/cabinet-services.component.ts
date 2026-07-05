import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { CabinetCatalogService } from '../../services/cabinet-catalog.service';

@Component({
  selector: 'app-cabinet-services',
  imports: [RouterLink, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './cabinet-services.component.html',
  styleUrl: './cabinet-services.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CabinetServicesComponent {
  private readonly catalog = inject(CabinetCatalogService);

  protected readonly loading = this.catalog.loading;
  protected readonly error = this.catalog.error;
  protected readonly allGroups = this.catalog.groups;
  protected readonly searchQuery = signal('');
  protected readonly activeFilter = signal('Все');
  protected readonly heroCards = computed(() => this.catalog.featuredItems().slice(0, 4));
  protected readonly filters = computed(() => [
    'Все',
    ...this.allGroups()
      .map(group => group.title)
  ]);
  protected readonly groups = computed(() => {
    const activeFilter = this.activeFilter();
    const query = normalizeQuery(this.searchQuery());

    return this.allGroups()
      .filter(group => activeFilter === 'Все' || group.title === activeFilter)
      .map(group => ({
        ...group,
        items: query
          ? group.items.filter(item => matchesQuery(item.title, item.description, group.title, query))
          : group.items,
      }))
      .filter(group => group.items.length > 0);
  });

  protected setFilter(filter: string): void {
    this.activeFilter.set(filter);
  }

  protected onSearchInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.searchQuery.set(target.value);
    }
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
  }
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase('ru');
}

function matchesQuery(title: string, description: string, category: string, query: string): boolean {
  return `${title} ${description} ${category}`.toLocaleLowerCase('ru').includes(query);
}
