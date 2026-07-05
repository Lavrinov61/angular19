import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';

import { StudioScheduleService } from '../../services/studio-schedule.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { Studio, StudioEmployee, EmployeeWorkStats } from '../../models/studio-schedule.models';

@Component({
  selector: 'app-photographer-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    RouterModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTabsModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatSelectModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule
  ],  template: `
    <div class="dashboard-container">
      <!-- Loading State -->
      @if (isLoading()) {
        <div class="loading-container">
          <mat-progress-spinner mode="indeterminate"></mat-progress-spinner>
          <p>Загрузка данных...</p>
        </div>
      }

      <!-- Studio Header -->
      @if (!isLoading() && currentStudio()) {
        <div class="studio-header">
        <div class="studio-info">
          <h1>{{ currentStudio()?.name }}</h1>
          <p class="studio-address">{{ currentStudio()?.address }}</p>
          <p class="studio-contact">{{ currentStudio()?.phone }}</p>
        </div>
        
        <div class="studio-actions">
          <button mat-raised-button color="primary" routerLink="schedule">
            <mat-icon>schedule</mat-icon>
            Управление расписанием
          </button>
          <button mat-raised-button routerLink="employees">
            <mat-icon>people</mat-icon>
            Сотрудники
          </button>
        </div>
        </div>
      }

      <!-- Quick Stats -->
      <div class="quick-stats">
        <mat-card class="stat-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>people</mat-icon>
            <mat-card-title>Сотрудники</mat-card-title>
          </mat-card-header>          <mat-card-content>
            <div class="stat-number">{{ employees().length }}</div>
            <div class="stat-label">активных сотрудников</div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>schedule</mat-icon>
            <mat-card-title>Смены сегодня</mat-card-title>
          </mat-card-header>          <mat-card-content>
            <div class="stat-number">{{ todayShifts() }}</div>
            <div class="stat-label">запланированных смен</div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>assignment</mat-icon>
            <mat-card-title>Открытые смены</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="stat-number">{{ openShifts() }}</div>
            <div class="stat-label">требуют назначения</div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card">
          <mat-card-header>
            <mat-icon mat-card-avatar>trending_up</mat-icon>
            <mat-card-title>Часы этого месяца</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="stat-number">{{ totalHoursThisMonth() }}</div>
            <div class="stat-label">рабочих часов</div>
          </mat-card-content>
        </mat-card>
      </div>

      <!-- Tabs -->
      <mat-tab-group class="main-tabs">
        <!-- Employees Tab -->
        <mat-tab label="Сотрудники">
          <div class="tab-content">
            <div class="employees-grid">
              @for (employee of employees(); track employee.id || employee.name || $index) {
                <mat-card class="employee-card">
                  <mat-card-header>
                    <div mat-card-avatar class="employee-avatar">
                      {{ employee.name.charAt(0) }}
                    </div>
                    <mat-card-title>{{ employee.name }}</mat-card-title>
                    <mat-card-subtitle>{{ getRoleLabel(employee.role) }}</mat-card-subtitle>
                  </mat-card-header>
                  
                  <mat-card-content>
                    <div class="employee-skills">
                      <mat-chip-set>
                        @for (skill of employee.skills; track skill || $index) {
                          <mat-chip selected>
                            {{ skill }}
                          </mat-chip>
                        }
                      </mat-chip-set>
                    </div>
                    @if (employeeStats()[employee.id]) {
                      <div class="employee-stats">
                        <div class="stat-row">
                          <span>Часы в месяце:</span>
                          <span>{{ employeeStats()[employee.id].totalHours }}ч</span>
                        </div>
                        <div class="stat-row">
                          <span>Смены:</span>
                          <span>{{ employeeStats()[employee.id].totalShifts }}</span>
                        </div>
                        @if (employee.hourlyRate) {
                          <div class="stat-row">
                            <span>Заработок:</span>
                            <span>{{ employeeStats()[employee.id].totalEarnings | currency:'RUB':'symbol':'1.0-0' }}</span>
                          </div>
                        }
                      </div>
                    }
                  </mat-card-content>
                  
                  <mat-card-actions>
                    <button mat-button (click)="viewEmployeeSchedule(employee.id)">
                      <mat-icon>schedule</mat-icon>
                      Расписание
                    </button>
                    <button mat-button (click)="viewEmployeeStats(employee.id)">
                      <mat-icon>analytics</mat-icon>
                      Статистика
                    </button>
                  </mat-card-actions>
                </mat-card>
              }
            </div>
          </div>
        </mat-tab>

        <!-- Schedule Overview Tab -->
        <mat-tab label="Обзор расписания">
          <div class="tab-content">
            <div class="schedule-overview">
              <div class="schedule-controls">                <mat-form-field>
                  <mat-label>Месяц</mat-label>
                  <input matInput [matDatepicker]="picker" [(ngModel)]="selectedMonthValue" (dateChange)="onMonthChange()">
                  <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
                  <mat-datepicker #picker startView="year" (monthSelected)="chooseMonthHandler($event, picker)"></mat-datepicker>
                </mat-form-field>
                
                <button mat-raised-button color="primary" routerLink="schedule">
                  <mat-icon>edit</mat-icon>
                  Редактировать расписание
                </button>
              </div>

              <div class="schedule-summary">
                <mat-card>
                  <mat-card-header>
                    <mat-card-title>Сводка по месяцу</mat-card-title>
                  </mat-card-header>
                  <mat-card-content>                    <div class="summary-grid">
                      <div class="summary-item">
                        <div class="summary-number">{{ monthlyStats().totalShifts }}</div>
                        <div class="summary-label">Всего смен</div>
                      </div>
                      <div class="summary-item">
                        <div class="summary-number">{{ monthlyStats().assignedShifts }}</div>
                        <div class="summary-label">Назначено</div>
                      </div>
                      <div class="summary-item">
                        <div class="summary-number">{{ monthlyStats().openShifts }}</div>
                        <div class="summary-label">Открыто</div>
                      </div>
                      <div class="summary-item">
                        <div class="summary-number">{{ monthlyStats().totalHours }}</div>
                        <div class="summary-label">Всего часов</div>
                      </div>
                    </div>
                  </mat-card-content>
                </mat-card>
              </div>
            </div>
          </div>        </mat-tab>

        <!-- Services Management Tab -->
        <mat-tab label="Управление услугами">
          <div class="tab-content">
            <div class="services-management-container">
              <p>Перейдите к полной версии управления услугами:</p>
              <button mat-raised-button color="primary" routerLink="services">
                <mat-icon>build</mat-icon>
                Управление услугами
              </button>
            </div>
          </div>
        </mat-tab>

        <!-- Quick Actions Tab -->
        <mat-tab label="Быстрые действия">
          <div class="tab-content">
            <div class="quick-actions-grid">
              <mat-card class="action-card" (click)="applyStandardTemplate()">
                <mat-card-header>
                  <mat-icon mat-card-avatar>schedule</mat-icon>
                  <mat-card-title>Применить стандартное расписание</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  Применить шаблон расписания на выбранный месяц
                </mat-card-content>
              </mat-card>

              <mat-card class="action-card" (click)="generateReport()">
                <mat-card-header>
                  <mat-icon mat-card-avatar>assessment</mat-icon>
                  <mat-card-title>Сгенерировать отчет</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  Создать отчет по работе сотрудников за период
                </mat-card-content>
              </mat-card>

              <mat-card class="action-card" routerLink="employees">
                <mat-card-header>
                  <mat-icon mat-card-avatar>person_add</mat-icon>
                  <mat-card-title>Управление сотрудниками</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  Добавить, редактировать или удалить сотрудников
                </mat-card-content>
              </mat-card>              <mat-card class="action-card" routerLink="schedule">
                <mat-card-header>
                  <mat-icon mat-card-avatar>edit_calendar</mat-icon>
                  <mat-card-title>Редактировать расписание</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  Назначить сотрудников на смены, изменить время работы
                </mat-card-content>
              </mat-card>

              <mat-card class="action-card" routerLink="services">
                <mat-card-header>
                  <mat-icon mat-card-avatar>build</mat-icon>
                  <mat-card-title>Управление услугами</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  Выберите услуги, которые вы предоставляете, и установите цены
                </mat-card-content>
              </mat-card>
            </div>
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .dashboard-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .studio-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding: 20px;
      background: #f5f5f5;
      border-radius: 8px;
    }

    .studio-info h1 {
      margin: 0 0 10px 0;
      color: #333;
    }

    .studio-info p {
      margin: 5px 0;
      color: #666;
    }

    .studio-actions {
      display: flex;
      gap: 10px;
    }

    .quick-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      text-align: center;
    }

    .stat-number {
      font-size: 2.5em;
      font-weight: bold;
      color: #1976d2;
    }

    .stat-label {
      color: #666;
      margin-top: 5px;
    }

    .main-tabs {
      margin-top: 20px;
    }

    .tab-content {
      padding: 20px 0;
    }

    .employees-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 20px;
    }

    .employee-card {
      min-height: 250px;
    }

    .employee-avatar {
      background: #1976d2;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }

    .employee-skills {
      margin: 15px 0;
    }

    .employee-stats {
      margin-top: 15px;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      margin: 5px 0;
      font-size: 0.9em;
    }

    .schedule-overview {
      max-width: 800px;
    }

    .schedule-controls {
      display: flex;
      gap: 20px;
      align-items: center;
      margin-bottom: 20px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      text-align: center;
    }

    .summary-number {
      font-size: 2em;
      font-weight: bold;
      color: #1976d2;
    }

    .summary-label {
      color: #666;
      margin-top: 5px;
    }

    .quick-actions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }

    .action-card {
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .action-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
  `]
})
export class PhotographerDashboardComponent implements OnInit {
  private studioScheduleService = inject(StudioScheduleService);
  private log = inject(LoggerService);
  
  // Signals для данных
  currentStudio = signal<Studio | null>(null);
  employees = signal<StudioEmployee[]>([]);
  employeeStats = signal<Record<string, EmployeeWorkStats>>({});
  selectedMonth = signal<Date>(new Date());
  isLoading = signal<boolean>(false);
  
  // Quick stats signals
  todayShifts = signal<number>(0);
  openShifts = signal<number>(0);
  totalHoursThisMonth = signal<number>(0);
    // Monthly stats computed signal
  protected monthlyStats = computed(() => {
    const stats = this.employeeStats();
    const employees = this.employees();
    
    let totalShifts = 0;
    let assignedShifts = 0;
    let openShifts = 0;
    let totalHours = 0;
    
    employees.forEach(employee => {
      const empStats = stats[employee.id];
      if (empStats) {
        totalShifts += empStats.totalShifts || 0;
        assignedShifts += empStats.completedShifts || 0; // используем completedShifts вместо assignedShifts
        totalHours += empStats.totalHours || 0;
      }
    });
    
    openShifts = totalShifts - assignedShifts;
    
    return {
      totalShifts,
      assignedShifts,
      openShifts,
      totalHours
    };
  });

  // Getter и setter для работы selectedMonth с ngModel
  get selectedMonthValue(): Date {
    return this.selectedMonth();
  }

  set selectedMonthValue(value: Date) {
    this.selectedMonth.set(value);
  }

  ngOnInit() {
    this.loadDashboardData();
  }  async loadDashboardData() {
    this.log.debug('Loading dashboard data...');
    this.isLoading.set(true);
    
    try {      // Load current studio - convert Observable to Promise using firstValueFrom
      const studio = await firstValueFrom(this.studioScheduleService.getCurrentStudio());
      this.log.debug('Current studio:', studio);
      this.currentStudio.set(studio || null);
      
      if (studio?.id) {
        this.log.debug('Studio found, loading employees...');
        
        // Load employees - convert Observable to Promise using firstValueFrom
        const employees = await firstValueFrom(this.studioScheduleService.getStudioEmployees(studio.id));
        this.log.debug('Employees loaded:', employees);
        this.employees.set(employees || []);
        
        // Load stats for each employee
        await this.loadEmployeeStats();
        
        // Load monthly stats
        this.loadMonthlyStats();
      } else {
        this.log.error('No studio available!');
      }
    } catch (error) {
      this.log.error('Error loading dashboard data:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadEmployeeStats() {
    const currentStudio = this.currentStudio();
    if (!currentStudio) return;
    
    const selectedDate = this.selectedMonth();
    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    
    const employees = this.employees();
    const statsPromises = employees.map(async (employee) => {
      try {        const stats = await firstValueFrom(this.studioScheduleService.getEmployeeWorkStats(
          employee.id,
          startOfMonth.toISOString().split('T')[0],
          endOfMonth.toISOString().split('T')[0]
        ));
        return { employeeId: employee.id, stats };
      } catch (error) {
        this.log.error(`Error loading stats for employee ${employee.id}:`, error);
        return { employeeId: employee.id, stats: null };
      }
    });
    
    const results = await Promise.all(statsPromises);
    const newStats: Record<string, EmployeeWorkStats> = {};
    
    results.forEach(({ employeeId, stats }) => {
      if (stats) {
        newStats[employeeId] = stats;
      }
    });
    
    this.employeeStats.set(newStats);
  }

  private loadMonthlyStats() {
    const currentStudio = this.currentStudio();
    if (!currentStudio) return;
    
    // Mock stats - in real app would calculate from actual schedule
    this.todayShifts.set(4);
    this.openShifts.set(12);    this.totalHoursThisMonth.set(320);
  }

  onMonthChange() {
    this.loadEmployeeStats();
    this.loadMonthlyStats();
  }

  chooseMonthHandler(normalizedMonth: Date, datepicker: { close(): void }) {
    this.selectedMonth.set(normalizedMonth);
    datepicker.close();
    this.onMonthChange();
  }

  getRoleLabel(role: string): string {
    const roles: Record<string, string> = {
      'photographer': 'Фотограф',
      'administrator': 'Администратор',
      'assistant': 'Ассистент'
    };
    return roles[role] || role;
  }

  viewEmployeeSchedule(employeeId: string) {
    // Navigate to employee schedule view
    this.log.debug('View schedule for employee:', employeeId);
  }

  viewEmployeeStats(employeeId: string) {
    // Show detailed employee statistics
    this.log.debug('View stats for employee:', employeeId);
  }
  applyStandardTemplate() {
    const currentStudio = this.currentStudio();
    if (!currentStudio) return;
    
    const selectedDate = this.selectedMonth();
    this.studioScheduleService.applyTemplateToSchedule(
      currentStudio.id,
      `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`,
      'standard-weekdays'
    ).subscribe(success => {
      if (success) {
        this.log.debug('Template applied successfully');
        this.loadMonthlyStats();
      }
    });
  }

  generateReport() {
    const selectedDate = this.selectedMonth();
    this.log.debug('Generate report for month:', selectedDate);
    // Implement report generation
  }
}
