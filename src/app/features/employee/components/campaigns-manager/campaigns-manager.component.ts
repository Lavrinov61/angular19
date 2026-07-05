import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit,
} from '@angular/core';
import { isPlatformBrowser, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import {
  CampaignApiService,
  Campaign, CampaignDetail, CampaignStatus, CampaignType,
} from '../../services/campaign-api.service';
import { CreateCampaignDialogComponent } from './create-campaign-dialog.component';

@Component({
  selector: 'app-campaigns-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DatePipe,
    MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatChipsModule, MatDividerModule, MatProgressSpinnerModule,
    MatSnackBarModule, MatMenuModule, MatTooltipModule, MatDialogModule,
  ],
  templateUrl: './campaigns-manager.component.html',
  styleUrl: './campaigns-manager.component.scss',
  host: {
    class: 'campaigns-manager-host',
  },
})
export class CampaignsManagerComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly api = inject(CampaignApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  // ── State ──
  readonly campaigns = signal<Campaign[]>([]);
  readonly loading = signal(false);
  readonly selectedCampaign = signal<CampaignDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly statusUpdating = signal(false);

  // ── Filters ──
  readonly filterStatus = signal<CampaignStatus | ''>('');
  readonly filterType = signal<CampaignType | ''>('');
  readonly searchQuery = signal('');

  // ── Computed ──
  readonly filteredCampaigns = computed(() => {
    let list = this.campaigns();
    const status = this.filterStatus();
    const type = this.filterType();
    const query = this.searchQuery().toLowerCase().trim();

    if (status) list = list.filter(c => c.status === status);
    if (type) list = list.filter(c => c.type === type);
    if (query) list = list.filter(c => c.name.toLowerCase().includes(query));
    return list;
  });

  readonly statusOptions: { value: CampaignStatus | ''; label: string }[] = [
    { value: '', label: 'Все статусы' },
    { value: 'draft', label: 'Черновик' },
    { value: 'active', label: 'Активна' },
    { value: 'paused', label: 'Пауза' },
    { value: 'completed', label: 'Завершена' },
    { value: 'cancelled', label: 'Отменена' },
  ];

  readonly typeOptions: { value: CampaignType | ''; label: string }[] = [
    { value: '', label: 'Все типы' },
    { value: 'flyer', label: 'Флайер' },
    { value: 'email', label: 'Email' },
    { value: 'social', label: 'Соцсети' },
    { value: 'sms', label: 'SMS' },
    { value: 'other', label: 'Другое' },
  ];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadCampaigns();
    }
  }

  loadCampaigns(): void {
    this.loading.set(true);
    this.api.getCampaigns().subscribe({
      next: data => {
        this.campaigns.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.snack.open('Ошибка загрузки кампаний', 'OK', { duration: 3000 });
        this.loading.set(false);
      },
    });
  }

  selectCampaign(campaign: Campaign): void {
    // Toggle: if same campaign is already selected, deselect
    if (this.selectedCampaign()?.id === campaign.id) {
      this.selectedCampaign.set(null);
      return;
    }
    this.detailLoading.set(true);
    this.api.getCampaign(campaign.id).subscribe({
      next: detail => {
        this.selectedCampaign.set(detail);
        this.detailLoading.set(false);
      },
      error: () => {
        this.snack.open('Ошибка загрузки деталей', 'OK', { duration: 3000 });
        this.detailLoading.set(false);
      },
    });
  }

  openCreateDialog(): void {
    const ref = this.dialog.open(CreateCampaignDialogComponent, {
      width: '520px',
      autoFocus: true,
    });
    ref.afterClosed().subscribe(result => {
      if (result) this.loadCampaigns();
    });
  }

  updateStatus(id: number, status: CampaignStatus): void {
    this.statusUpdating.set(true);
    this.api.updateStatus(id, status).subscribe({
      next: () => {
        this.snack.open(this.statusLabel(status), 'OK', { duration: 2000 });
        this.loadCampaigns();
        // Refresh detail if open
        if (this.selectedCampaign()?.id === id) {
          this.api.getCampaign(id).subscribe({
            next: detail => this.selectedCampaign.set(detail),
          });
        }
        this.statusUpdating.set(false);
      },
      error: () => {
        this.snack.open('Ошибка смены статуса', 'OK', { duration: 3000 });
        this.statusUpdating.set(false);
      },
    });
  }

  closeDetail(): void {
    this.selectedCampaign.set(null);
  }

  // ── Helpers ──

  statusLabel(status: CampaignStatus | string): string {
    const map: Record<string, string> = {
      draft: 'Черновик',
      active: 'Активна',
      paused: 'Пауза',
      completed: 'Завершена',
      cancelled: 'Отменена',
    };
    return map[status] ?? status;
  }

  statusClass(status: string): string {
    return `status-${status}`;
  }

  typeLabel(type: CampaignType | string): string {
    const map: Record<string, string> = {
      flyer: 'Флайер',
      email: 'Email',
      social: 'Соцсети',
      sms: 'SMS',
      other: 'Другое',
    };
    return map[type] ?? type;
  }

  typeIcon(type: CampaignType | string): string {
    const map: Record<string, string> = {
      flyer: 'description',
      email: 'email',
      social: 'share',
      sms: 'sms',
      other: 'campaign',
    };
    return map[type] ?? 'campaign';
  }

  formatBudget(value: string | null): string {
    if (!value) return '—';
    return Number(value).toLocaleString('ru-RU') + ' \u20BD';
  }

  formatRoi(roi: number | null): string {
    if (roi === null || roi === undefined) return '—';
    return (roi >= 0 ? '+' : '') + roi.toFixed(0) + '%';
  }
}
