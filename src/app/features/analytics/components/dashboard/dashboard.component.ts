import { Component, ChangeDetectionStrategy, inject, computed, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';

import { AnalyticsApiService, TopSource, RoiReportItem, FunnelStep } from '../../services/analytics-api.service';
import { CampaignDetailDialogComponent, CampaignDetailDialogData } from '../campaign-detail-dialog/campaign-detail-dialog.component';
import { clearAnalyticsKey } from '../../guards/analytics.guard';

@Component({
  selector: 'app-analytics-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTableModule,
    MatTooltipModule,
    MatChipsModule,
    MatDividerModule,
    MatTabsModule,
    DecimalPipe,
    CurrencyPipe
  ],
  template: `
    <div class="dashboard-container">
      <!-- Header -->
      <header class="dashboard-header">
        <div class="header-left">
          <mat-icon class="logo-icon">analytics</mat-icon>
          <h1>Аналитика</h1>
        </div>
        <div class="header-right">
          <mat-form-field appearance="outline" class="period-select">
            <mat-label>Период</mat-label>
            <mat-select [(value)]="selectedPeriod" (selectionChange)="onPeriodChange()">
              <mat-option value="today">Сегодня</mat-option>
              <mat-option value="yesterday">Вчера</mat-option>
              <mat-option value="week">7 дней</mat-option>
              <mat-option value="month">30 дней</mat-option>
              <mat-option value="60">60 дней</mat-option>
              <mat-option value="90">90 дней</mat-option>
            </mat-select>
          </mat-form-field>
          
          <button mat-icon-button (click)="refresh()" [disabled]="api.loading()" matTooltip="Обновить">
            <mat-icon>refresh</mat-icon>
          </button>
          
          <button mat-icon-button (click)="logout()" matTooltip="Выйти">
            <mat-icon>logout</mat-icon>
          </button>
        </div>
      </header>
      
      @if (api.loading()) {
        <div class="loading-overlay">
          <mat-spinner diameter="48" />
          <span>Загрузка данных...</span>
        </div>
      }
      
      <!-- KPI Cards -->
      <section class="kpi-grid">
        <mat-card class="kpi-card clicks">
          <mat-card-content>
            <div class="kpi-icon">
              <mat-icon>ads_click</mat-icon>
            </div>
            <div class="kpi-data">
              <div class="kpi-value-row">
                <span class="kpi-value">{{ totalClicks() | number }}</span>
                @if (api.trends().clicks !== null) {
                  <span class="kpi-trend" [class.trend-up]="api.trends().clicks! > 0" [class.trend-down]="api.trends().clicks! < 0">
                    <mat-icon>{{ api.trends().clicks! >= 0 ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
                    {{ api.trends().clicks! >= 0 ? '+' : '' }}{{ api.trends().clicks! | number:'1.0-1' }}%
                  </span>
                }
              </div>
              <span class="kpi-label">Клики по рекламе</span>
              <span class="kpi-sub">{{ totalUniqueVisitors() }} уник. посетителей</span>
            </div>
          </mat-card-content>
        </mat-card>
        
        <mat-card class="kpi-card purchases">
          <mat-card-content>
            <div class="kpi-icon">
              <mat-icon>shopping_cart</mat-icon>
            </div>
            <div class="kpi-data">
              <div class="kpi-value-row">
                <span class="kpi-value">{{ api.purchasesCount() | number }}</span>
                @if (api.trends().purchases !== null) {
                  <span class="kpi-trend" [class.trend-up]="api.trends().purchases! > 0" [class.trend-down]="api.trends().purchases! < 0">
                    <mat-icon>{{ api.trends().purchases! >= 0 ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
                    {{ api.trends().purchases! >= 0 ? '+' : '' }}{{ api.trends().purchases! | number:'1.0-1' }}%
                  </span>
                }
              </div>
              <span class="kpi-label">Покупок</span>
              <span class="kpi-sub">{{ api.purchasesAttributed() }} атрибуцировано</span>
            </div>
          </mat-card-content>
        </mat-card>
        
        <mat-card class="kpi-card revenue">
          <mat-card-content>
            <div class="kpi-icon">
              <mat-icon>payments</mat-icon>
            </div>
            <div class="kpi-data">
              <div class="kpi-value-row">
                <span class="kpi-value">{{ api.revenue().total | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                @if (api.trends().revenue !== null) {
                  <span class="kpi-trend" [class.trend-up]="api.trends().revenue! > 0" [class.trend-down]="api.trends().revenue! < 0">
                    <mat-icon>{{ api.trends().revenue! >= 0 ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
                    {{ api.trends().revenue! >= 0 ? '+' : '' }}{{ api.trends().revenue! | number:'1.0-1' }}%
                  </span>
                }
              </div>
              <span class="kpi-label">Выручка</span>
              <span class="kpi-sub">Средний чек: {{ api.revenue().avg_check | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
          </mat-card-content>
        </mat-card>
        
        <mat-card class="kpi-card conversion" matTooltip="Для атрибуции покупок к рекламе нужна связь через мессенджеры">
          <mat-card-content>
            <div class="kpi-icon">
              <mat-icon>trending_up</mat-icon>
            </div>
            <div class="kpi-data">
              <span class="kpi-value">{{ attributionRate() | number:'1.1-1' }}%</span>
              <span class="kpi-label">Атрибуция</span>
              <span class="kpi-sub">Связь реклама → покупка</span>
            </div>
          </mat-card-content>
        </mat-card>
      </section>

      <!-- Alerts -->
      @if (api.alerts().length > 0) {
        <section class="alerts-section">
          @for (alert of api.alerts(); track alert.message) {
            <div class="alert-item" [class]="'alert-' + alert.level">
              <mat-icon>{{ alert.level === 'error' ? 'error' : 'warning' }}</mat-icon>
              <span>{{ alert.message }}</span>
            </div>
          }
        </section>
      }

      <!-- Статистика по точкам -->
      <section class="locations-section">
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>store</mat-icon>
            <mat-card-title>Статистика по точкам</mat-card-title>
            <mat-card-subtitle>Выручка и покупки по студиям</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="locations-grid">
              @for (loc of locationsList(); track loc.id) {
                <div class="location-card" [class]="loc.id">
                  <div class="location-header">
                    <mat-icon>photo_camera</mat-icon>
                    <span class="location-name">{{ loc.name }}</span>
                  </div>
                  <div class="location-stats">
                    <div class="stat">
                      <span class="stat-value">{{ loc.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                      <span class="stat-label">Выручка</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ loc.purchases }}</span>
                      <span class="stat-label">Покупок</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ loc.purchases > 0 ? (loc.revenue / loc.purchases | currency:'RUB':'symbol-narrow':'1.0-0') : '-' }}</span>
                      <span class="stat-label">Средний чек</span>
                    </div>
                  </div>
                </div>
              } @empty {
                <div class="no-data">
                  <mat-icon>info</mat-icon>
                  <span>Нет данных по точкам</span>
                </div>
              }
            </div>
          </mat-card-content>
        </mat-card>
      </section>
      
      <!-- Воронка конверсий -->
      <section class="funnel-section">
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>filter_alt</mat-icon>
            <mat-card-title>Воронка конверсий</mat-card-title>
            <mat-card-subtitle>Путь клиента от рекламы до покупки</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <div class="funnel-visual">
              <div class="funnel-step" [style.width.%]="100">
                <div class="funnel-bar clicks-bar">
                  <span class="funnel-label">Клики по рекламе</span>
                  <span class="funnel-count">{{ api.funnel().ad_clicks }}</span>
                </div>
              </div>
              <div class="funnel-arrow">
                <mat-icon>arrow_downward</mat-icon>
                <span>уникальные</span>
              </div>
              <div class="funnel-step" [style.width.%]="funnelVisitorsWidth()">
                <div class="funnel-bar visitors-bar">
                  <span class="funnel-label">Уникальные посетители</span>
                  <span class="funnel-count">{{ api.funnel().unique_visitors }}</span>
                </div>
              </div>
              <div class="funnel-arrow">
                <mat-icon>arrow_downward</mat-icon>
                <span>{{ conversionToMessenger() | number:'1.1-1' }}%</span>
              </div>
              <div class="funnel-step" [style.width.%]="funnelConversionsWidth()">
                <div class="funnel-bar conversions-bar">
                  <span class="funnel-label">Обращения в мессенджеры</span>
                  <span class="funnel-count">{{ api.funnel().conversions }}</span>
                </div>
              </div>
              <div class="funnel-arrow">
                <mat-icon>arrow_downward</mat-icon>
                <span>покупки</span>
              </div>
              <div class="funnel-step" [style.width.%]="funnelPurchasesWidth()">
                <div class="funnel-bar purchases-bar">
                  <span class="funnel-label">Покупки</span>
                  <span class="funnel-count">{{ api.funnel().purchases }}</span>
                </div>
              </div>
            </div>
          </mat-card-content>
        </mat-card>
      </section>
      
      <!-- Конверсии по каналам -->
      <section class="conversions-section">
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>message</mat-icon>
            <mat-card-title>Конверсии (обращения)</mat-card-title>
            <mat-card-subtitle>Обращения клиентов через мессенджеры</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            @if (api.conversions().by_channel.length > 0) {
              <div class="conversions-grid">
                @for (conv of api.conversions().by_channel; track conv.type) {
                  <div class="conversion-item">
                    <mat-icon>{{ getConversionIcon(conv.channel) }}</mat-icon>
                    <span class="conv-type">{{ formatConversionType(conv.type) }}</span>
                    <span class="conv-count">{{ conv.count }}</span>
                  </div>
                }
              </div>
              <div class="conversions-total">
                <strong>Всего обращений: {{ api.conversions().total }}</strong>
              </div>
            } @else {
              <div class="no-data">
                <mat-icon>info</mat-icon>
                <span>Нет обращений за выбранный период</span>
              </div>
            }
          </mat-card-content>
        </mat-card>
      </section>
      
      <!-- Tabs: Источники / ROI -->
      <mat-tab-group class="data-tabs" (selectedTabChange)="onTabChange($event)">
        <!-- Tab: Источники трафика -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>source</mat-icon>
            <span>Источники трафика</span>
          </ng-template>
          
          <div class="tab-content">
            <mat-card>
              <mat-card-content>
                @if (api.topSources().length > 0) {
                  <table mat-table [dataSource]="api.topSources()" class="sources-table">
                    <ng-container matColumnDef="source">
                      <th mat-header-cell *matHeaderCellDef>Источник</th>
                      <td mat-cell *matCellDef="let row">
                        <div class="source-cell">
                          <mat-icon [class]="getSourceClass(row.source)">{{ getSourceIcon(row.source) }}</mat-icon>
                          <span>{{ formatSourceName(row.source) }}</span>
                        </div>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="campaign">
                      <th mat-header-cell *matHeaderCellDef>Кампания</th>
                      <td mat-cell *matCellDef="let row">
                        <span class="campaign-name" [matTooltip]="row.campaign">{{ formatCampaignName(row.campaign) }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="clicks">
                      <th mat-header-cell *matHeaderCellDef>Клики</th>
                      <td mat-cell *matCellDef="let row">{{ row.clicks | number }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="cost">
                      <th mat-header-cell *matHeaderCellDef>Расход</th>
                      <td mat-cell *matCellDef="let row">
                        @if (row.cost > 0) {
                          <span class="cost-value">{{ row.cost | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                        } @else {
                          <span class="no-data-text">-</span>
                        }
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="purchases">
                      <th mat-header-cell *matHeaderCellDef>Покупки</th>
                      <td mat-cell *matCellDef="let row">
                        <span [class.has-value]="row.purchases > 0">{{ row.purchases || 0 }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="revenue">
                      <th mat-header-cell *matHeaderCellDef>Выручка</th>
                      <td mat-cell *matCellDef="let row">
                        @if (row.revenue > 0) {
                          <span class="revenue-value">{{ row.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                        } @else {
                          <span class="no-data-text">-</span>
                        }
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="roi">
                      <th mat-header-cell *matHeaderCellDef>ROI</th>
                      <td mat-cell *matCellDef="let row">
                        @if (row.roi !== null && row.roi !== undefined) {
                          <mat-chip [class.positive-roi]="row.roi > 0" [class.negative-roi]="row.roi <= 0">
                            {{ row.roi | number:'1.0-0' }}%
                          </mat-chip>
                        } @else {
                          <span class="no-data-text">-</span>
                        }
                      </td>
                    </ng-container>
                    
                    <tr mat-header-row *matHeaderRowDef="sourcesColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: sourcesColumns;"
                        class="clickable-row"
                        [class.has-purchases]="row.purchases > 0"
                        [class.negative-roi-row]="row.roi !== null && row.roi !== undefined && row.roi < 0"
                        (click)="onCampaignClick(row.source, row.campaign)"></tr>
                  </table>
                } @else {
                  <div class="no-data">
                    <mat-icon>info</mat-icon>
                    <span>Нет данных за выбранный период</span>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
        
        <!-- Tab: ROI -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>trending_up</mat-icon>
            <span>ROI по источникам</span>
          </ng-template>
          
          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-form-field appearance="outline" class="group-select">
                  <mat-label>Группировка</mat-label>
                  <mat-select [(value)]="roiGroupBy" (selectionChange)="onRoiGroupChange()">
                    <mat-option value="source">По источнику</mat-option>
                    <mat-option value="campaign">По кампании</mat-option>
                    <mat-option value="platform">По платформе</mat-option>
                  </mat-select>
                </mat-form-field>
              </mat-card-header>
              <mat-card-content>
                @if (roiData().length > 0) {
                  <table mat-table [dataSource]="roiData()" class="roi-table">
                    <ng-container matColumnDef="name">
                      <th mat-header-cell *matHeaderCellDef>{{ roiGroupLabel() }}</th>
                      <td mat-cell *matCellDef="let row">{{ getRoiName(row) }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="clicks">
                      <th mat-header-cell *matHeaderCellDef>Клики</th>
                      <td mat-cell *matCellDef="let row">{{ row.clicks | number }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="cost">
                      <th mat-header-cell *matHeaderCellDef>Расход</th>
                      <td mat-cell *matCellDef="let row">
                        @if (row.cost > 0) {
                          {{ row.cost | currency:'RUB':'symbol-narrow':'1.0-0' }}
                        } @else {
                          <span class="no-data-text">-</span>
                        }
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="purchases">
                      <th mat-header-cell *matHeaderCellDef>Покупки</th>
                      <td mat-cell *matCellDef="let row">{{ row.purchases | number }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="revenue">
                      <th mat-header-cell *matHeaderCellDef>Выручка</th>
                      <td mat-cell *matCellDef="let row">{{ row.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="roi">
                      <th mat-header-cell *matHeaderCellDef>ROI</th>
                      <td mat-cell *matCellDef="let row">
                        @if (row.roi !== null && row.roi !== undefined) {
                          <mat-chip [class.positive-roi]="row.roi > 0" [class.negative-roi]="row.roi <= 0">
                            {{ row.roi | number:'1.0-0' }}%
                          </mat-chip>
                        } @else {
                          <span class="no-data-text">-</span>
                        }
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="cpa">
                      <th mat-header-cell *matHeaderCellDef>CPA</th>
                      <td mat-cell *matCellDef="let row">
                        @if (row.cpa > 0) {
                          {{ row.cpa | currency:'RUB':'symbol-narrow':'1.0-0' }}
                        } @else {
                          <span class="no-data-text">-</span>
                        }
                      </td>
                    </ng-container>
                    
                    <tr mat-header-row *matHeaderRowDef="roiColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: roiColumns;"
                        [class.has-purchases]="row.purchases > 0"
                        [class.negative-roi-row]="row.roi !== null && row.roi !== undefined && row.roi < 0"></tr>
                  </table>
                  
                  <!-- Totals -->
                  <mat-divider />
                  <div class="roi-totals">
                    <div class="total-item">
                      <span class="total-label">Расход:</span>
                      <span class="total-value cost-value">{{ (roiTotals().cost ?? 0) | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                    </div>
                    <div class="total-item">
                      <span class="total-label">Выручка:</span>
                      <span class="total-value revenue-value">{{ roiTotals().revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                    </div>
                    <div class="total-item">
                      <span class="total-label">ROI:</span>
                      @if (roiTotals().roi !== null && roiTotals().roi !== undefined) {
                        <span class="total-value" [class.positive-roi]="roiTotals().roi! > 0" [class.negative-roi]="roiTotals().roi! <= 0">
                          {{ roiTotals().roi! | number:'1.0-0' }}%
                        </span>
                      } @else {
                        <span class="total-value">-</span>
                      }
                    </div>
                    <div class="total-item">
                      <span class="total-label">Покупок:</span>
                      <span class="total-value">{{ roiTotals().purchases | number }}</span>
                    </div>
                    <div class="total-item">
                      <span class="total-label">CPA:</span>
                      @if (roiTotals().cpa && roiTotals().cpa! > 0) {
                        <span class="total-value">{{ roiTotals().cpa! | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                      } @else {
                        <span class="total-value">-</span>
                      }
                    </div>
                  </div>
                } @else {
                  <div class="no-data">
                    <mat-icon>info</mat-icon>
                    <span>Нет данных за выбранный период</span>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
        
        <!-- Tab: Рекламные кампании -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>campaign</mat-icon>
            <span>Кампании</span>
          </ng-template>
          
          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-card-title>Детальная статистика по кампаниям</mat-card-title>
                <mat-card-subtitle>Клики и уникальные посетители по каждой рекламной кампании</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                @if (api.campaigns().length > 0) {
                  <table mat-table [dataSource]="api.campaigns()" class="campaigns-table">
                    <ng-container matColumnDef="source">
                      <th mat-header-cell *matHeaderCellDef>Источник</th>
                      <td mat-cell *matCellDef="let row">
                        <div class="source-cell">
                          <mat-icon [class]="getSourceClass(row.source)">{{ getSourceIcon(row.source) }}</mat-icon>
                          <span>{{ formatSourceName(row.source) }}</span>
                        </div>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="campaign">
                      <th mat-header-cell *matHeaderCellDef>Кампания</th>
                      <td mat-cell *matCellDef="let row">
                        <span class="campaign-name" [matTooltip]="row.campaign">{{ formatCampaignName(row.campaign) }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="ad_content">
                      <th mat-header-cell *matHeaderCellDef>Объявление</th>
                      <td mat-cell *matCellDef="let row">
                        <span class="ad-content" [matTooltip]="row.ad_content">{{ formatAdContent(row.ad_content) }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="clicks">
                      <th mat-header-cell *matHeaderCellDef>Клики</th>
                      <td mat-cell *matCellDef="let row">{{ row.clicks | number }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="unique_visitors">
                      <th mat-header-cell *matHeaderCellDef>Уникальные</th>
                      <td mat-cell *matCellDef="let row">{{ row.unique_visitors | number }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="conversions">
                      <th mat-header-cell *matHeaderCellDef>Конверсии</th>
                      <td mat-cell *matCellDef="let row">
                        <span [class.has-value]="row.conversions > 0">{{ row.conversions || 0 }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="purchases">
                      <th mat-header-cell *matHeaderCellDef>Покупки</th>
                      <td mat-cell *matCellDef="let row">
                        <span [class.has-value]="row.purchases > 0">{{ row.purchases || 0 }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="revenue">
                      <th mat-header-cell *matHeaderCellDef>Сумма</th>
                      <td mat-cell *matCellDef="let row">
                        <span [class.has-value]="row.revenue > 0">{{ row.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                      </td>
                    </ng-container>
                    
                    <tr mat-header-row *matHeaderRowDef="campaignsColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: campaignsColumns;"
                        class="clickable-row"
                        [class.has-purchases]="row.purchases > 0"
                        [class.has-conversions]="row.conversions > 0 && !(row.purchases > 0)"
                        (click)="onCampaignClick(row.source, row.campaign)"></tr>
                  </table>
                } @else {
                  <div class="no-data">
                    <mat-icon>info</mat-icon>
                    <span>Нет данных по кампаниям за выбранный период</span>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
        
        <!-- Tab: Мультиканальная аналитика -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>hub</mat-icon>
            <span>Мультиканал</span>
          </ng-template>
          
          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-card-title>Мультиканальная аналитика</mat-card-title>
                <mat-card-subtitle>Все касания клиентов до покупки. Показывает реальную ценность каждого канала.</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                @if (api.multichannelChannels().length > 0) {
                  <div class="multichannel-info">
                    <mat-icon>lightbulb</mat-icon>
                    <span>{{ api.multichannelInsights()?.tip }}</span>
                  </div>
                  
                  <table mat-table [dataSource]="api.multichannelChannels()" class="multichannel-table">
                    <ng-container matColumnDef="source">
                      <th mat-header-cell *matHeaderCellDef>Канал</th>
                      <td mat-cell *matCellDef="let row">
                        <div class="source-cell">
                          <mat-icon [class]="getSourceClass(row.source)">{{ getSourceIcon(row.source) }}</mat-icon>
                          <span>{{ row.source_name }}</span>
                        </div>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="total">
                      <th mat-header-cell *matHeaderCellDef>Всего</th>
                      <td mat-cell *matCellDef="let row">{{ row.total_touches }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="first">
                      <th mat-header-cell *matHeaderCellDef matTooltip="Первое знакомство с брендом">First Touch</th>
                      <td mat-cell *matCellDef="let row">
                        <span class="touch-value first">{{ row.first_touch }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="assist">
                      <th mat-header-cell *matHeaderCellDef matTooltip="Промежуточные касания">Assist</th>
                      <td mat-cell *matCellDef="let row">
                        <span class="touch-value assist">{{ row.assist_touch }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="last">
                      <th mat-header-cell *matHeaderCellDef matTooltip="Последнее касание перед покупкой">Last Touch</th>
                      <td mat-cell *matCellDef="let row">
                        <span class="touch-value last">{{ row.last_touch }}</span>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="customers">
                      <th mat-header-cell *matHeaderCellDef>Клиенты</th>
                      <td mat-cell *matCellDef="let row">{{ row.unique_customers }}</td>
                    </ng-container>
                    
                    <tr mat-header-row *matHeaderRowDef="multichannelColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: multichannelColumns;"></tr>
                  </table>
                  
                  <!-- Customer Journeys -->
                  @if (api.customerJourneys().length > 0) {
                    <mat-divider />
                    <h4>Примеры путей клиентов</h4>
                    <div class="journeys-list">
                      @for (journey of api.customerJourneys(); track journey.customer_id) {
                        <div class="journey-item">
                          <div class="journey-path">
                            @for (step of journey.journey; track $index; let last = $last) {
                              <span class="journey-step" [class]="getSourceClass(step.source)">
                                {{ formatSourceName(step.source) }}
                              </span>
                              @if (!last) {
                                <mat-icon class="journey-arrow">arrow_forward</mat-icon>
                              }
                            }
                            <mat-icon class="journey-arrow">arrow_forward</mat-icon>
                            <span class="journey-purchase">
                              <mat-icon>shopping_cart</mat-icon>
                              {{ journey.purchase_amount | currency:'RUB':'symbol-narrow':'1.0-0' }}
                            </span>
                          </div>
                        </div>
                      }
                    </div>
                  }
                } @else {
                  <div class="no-data">
                    <mat-icon>hub</mat-icon>
                    <div class="no-data-text">
                      <strong>Пока нет мультиканальных данных</strong>
                      <p>Данные появятся когда клиенты будут кликать по рекламе из разных каналов перед покупкой.</p>
                    </div>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
        
        <!-- Tab: Смены -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>schedule</mat-icon>
            <span>Смены</span>
          </ng-template>
          
          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-card-title>Статистика по сменам</mat-card-title>
                <mat-card-subtitle>Рабочие дни, выручка и количество чеков</mat-card-subtitle>
                
                <div class="shifts-filters">
                  <mat-form-field appearance="outline" class="month-select">
                    <mat-label>Месяц</mat-label>
                    <mat-select [(value)]="selectedMonth" (selectionChange)="onMonthChange()">
                      @for (m of availableMonths; track m.value) {
                        <mat-option [value]="m.value">{{ m.label }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  
                  <mat-form-field appearance="outline" class="location-select">
                    <mat-label>Точка</mat-label>
                    <mat-select [(value)]="shiftsLocationFilter" (selectionChange)="onMonthChange()">
                      <mat-option value="">Все</mat-option>
                      <mat-option value="studio1">Соборный</mat-option>
                      <mat-option value="studio2">2-ая Баррикадная</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>
              </mat-card-header>
              
              <mat-card-content>
                <!-- Totals -->
                @if (api.shiftsTotals()) {
                  <div class="shifts-totals">
                    <div class="shifts-total-item">
                      <mat-icon>event_available</mat-icon>
                      <div class="total-data">
                        <span class="total-value">{{ api.shiftsTotals()!.total_shifts }}</span>
                        <span class="total-label">Рабочих дней</span>
                      </div>
                    </div>
                    <div class="shifts-total-item">
                      <mat-icon>receipt</mat-icon>
                      <div class="total-data">
                        <span class="total-value">{{ api.shiftsTotals()!.total_cheques | number }}</span>
                        <span class="total-label">Всего чеков</span>
                      </div>
                    </div>
                    <div class="shifts-total-item">
                      <mat-icon>payments</mat-icon>
                      <div class="total-data">
                        <span class="total-value">{{ api.shiftsTotals()!.total_revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                        <span class="total-label">Выручка за месяц</span>
                      </div>
                    </div>
                    <div class="shifts-total-item">
                      <mat-icon>trending_up</mat-icon>
                      <div class="total-data">
                        <span class="total-value">{{ api.shiftsTotals()!.avg_revenue_per_shift | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                        <span class="total-label">Средняя выручка/смена</span>
                      </div>
                    </div>
                  </div>
                }
                
                <!-- Shifts Table -->
                @if (api.shifts().length > 0) {
                  <table mat-table [dataSource]="api.shifts()" class="shifts-table">
                    <ng-container matColumnDef="date">
                      <th mat-header-cell *matHeaderCellDef>Дата</th>
                      <td mat-cell *matCellDef="let row">
                        <div class="date-cell">
                          <span class="date-main">{{ formatShiftDate(row.date) }}</span>
                          <span class="date-weekday">{{ row.weekday_ru }}</span>
                        </div>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="location">
                      <th mat-header-cell *matHeaderCellDef>Точка</th>
                      <td mat-cell *matCellDef="let row">
                        <mat-chip [class]="row.location_id">{{ row.location_name }}</mat-chip>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="time">
                      <th mat-header-cell *matHeaderCellDef>Время работы</th>
                      <td mat-cell *matCellDef="let row">
                        <div class="time-cell">
                          <span class="time-range">{{ row.work_start }}, {{ row.work_end }}</span>
                          <span class="time-hours">{{ row.work_hours }}ч</span>
                        </div>
                      </td>
                    </ng-container>
                    
                    <ng-container matColumnDef="cheques">
                      <th mat-header-cell *matHeaderCellDef>Чеков</th>
                      <td mat-cell *matCellDef="let row">{{ row.cheques }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="revenue">
                      <th mat-header-cell *matHeaderCellDef>Выручка</th>
                      <td mat-cell *matCellDef="let row">{{ row.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
                    </ng-container>
                    
                    <ng-container matColumnDef="avg">
                      <th mat-header-cell *matHeaderCellDef>Средний чек</th>
                      <td mat-cell *matCellDef="let row">
                        {{ row.cheques > 0 ? (row.revenue / row.cheques | currency:'RUB':'symbol-narrow':'1.0-0') : '-' }}
                      </td>
                    </ng-container>
                    
                    <tr mat-header-row *matHeaderRowDef="shiftsColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: shiftsColumns;" 
                        [class.today]="isToday(row.date)"></tr>
                  </table>
                } @else {
                  <div class="no-data">
                    <mat-icon>info</mat-icon>
                    <span>Нет данных за выбранный месяц</span>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        <!-- Tab: Антифрод -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>security</mat-icon>
            <span>Антифрод</span>
          </ng-template>

          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-card-title>Обнаружение скликивания</mat-card-title>
                <mat-card-subtitle>Объявления с подозрительными паттернами кликов</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                @if (api.fraudItems().length > 0) {
                  <div class="fraud-summary">
                    <div class="fraud-stat">
                      <span class="fraud-stat-value">{{ api.fraudSummary().total_suspicious_ads }}</span>
                      <span class="fraud-stat-label">Подозрительных</span>
                    </div>
                    <div class="fraud-stat danger">
                      <span class="fraud-stat-value">{{ api.fraudSummary().high_risk_ads }}</span>
                      <span class="fraud-stat-label">Высокий риск</span>
                    </div>
                    <div class="fraud-stat">
                      <span class="fraud-stat-value">{{ api.fraudSummary().total_suspicious_clicks | number }}</span>
                      <span class="fraud-stat-label">Подозр. кликов</span>
                    </div>
                  </div>

                  <table mat-table [dataSource]="api.fraudItems()" class="fraud-table">
                    <ng-container matColumnDef="ad_id">
                      <th mat-header-cell *matHeaderCellDef>Объявление</th>
                      <td mat-cell *matCellDef="let row">{{ row.ad_id }}</td>
                    </ng-container>

                    <ng-container matColumnDef="platform">
                      <th mat-header-cell *matHeaderCellDef>Платформа</th>
                      <td mat-cell *matCellDef="let row">
                        <mat-chip>{{ row.platform }}</mat-chip>
                      </td>
                    </ng-container>

                    <ng-container matColumnDef="clicks">
                      <th mat-header-cell *matHeaderCellDef>Клики</th>
                      <td mat-cell *matCellDef="let row">{{ row.clicks | number }}</td>
                    </ng-container>

                    <ng-container matColumnDef="unique_visitors">
                      <th mat-header-cell *matHeaderCellDef>Уник.</th>
                      <td mat-cell *matCellDef="let row">{{ row.unique_visitors }}</td>
                    </ng-container>

                    <ng-container matColumnDef="conversions">
                      <th mat-header-cell *matHeaderCellDef>Конв.</th>
                      <td mat-cell *matCellDef="let row">{{ row.conversions }}</td>
                    </ng-container>

                    <ng-container matColumnDef="fraud_score">
                      <th mat-header-cell *matHeaderCellDef>Риск</th>
                      <td mat-cell *matCellDef="let row">
                        <mat-chip [class.fraud-high]="row.fraud_score >= 60" [class.fraud-medium]="row.fraud_score >= 30 && row.fraud_score < 60">
                          {{ row.fraud_score }}
                        </mat-chip>
                      </td>
                    </ng-container>

                    <ng-container matColumnDef="reasons">
                      <th mat-header-cell *matHeaderCellDef>Причины</th>
                      <td mat-cell *matCellDef="let row">
                        <span class="fraud-reasons">{{ row.reasons.join(', ') }}</span>
                      </td>
                    </ng-container>

                    <tr mat-header-row *matHeaderRowDef="fraudColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: fraudColumns;"
                        [class.fraud-row-high]="row.fraud_score >= 60"></tr>
                  </table>
                } @else {
                  <div class="no-data">
                    <mat-icon>verified_user</mat-icon>
                    <span>Подозрительных объявлений не обнаружено</span>
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        <!-- Tab: Когорты -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>group_work</mat-icon>
            <span>Когорты</span>
          </ng-template>

          <div class="tab-content">
            <mat-card>
              <mat-card-header>
                <mat-card-title>Когортный анализ (Retention)</mat-card-title>
                <mat-card-subtitle>% клиентов с повторной покупкой по неделям</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                @if (api.cohorts().length > 0) {
                  <div class="cohort-table-scroll">
                    <table class="cohort-table">
                      <thead>
                        <tr>
                          <th class="cohort-header-cell">Когорта</th>
                          <th class="cohort-header-cell">Размер</th>
                          @for (i of cohortWeekHeaders(); track i) {
                            <th class="cohort-header-cell">W{{ i }}</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (cohort of api.cohorts(); track cohort.cohort_date) {
                          <tr>
                            <td class="cohort-label-cell">{{ cohort.cohort_label }}</td>
                            <td class="cohort-size-cell">{{ cohort.size }}</td>
                            @for (i of cohortWeekHeaders(); track i) {
                              <td class="cohort-value-cell"
                                  [style.background-color]="getCohortColor(cohort.retention[i])"
                                  [style.color]="cohort.retention[i] > 50 ? 'white' : '#333'">
                                @if (i < cohort.retention.length) {
                                  {{ cohort.retention[i] | number:'1.0-1' }}%
                                }
                              </td>
                            }
                          </tr>
                        }
                        <tr class="cohort-avg-row">
                          <td class="cohort-label-cell"><strong>Среднее</strong></td>
                          <td class="cohort-size-cell">-</td>
                          @for (i of cohortWeekHeaders(); track i) {
                            <td class="cohort-value-cell cohort-avg-cell"
                                [style.background-color]="getCohortColor(api.avgRetention()[i])"
                                [style.color]="api.avgRetention()[i] > 50 ? 'white' : '#333'">
                              @if (i < api.avgRetention().length) {
                                {{ api.avgRetention()[i] | number:'1.0-1' }}%
                              }
                            </td>
                          }
                        </tr>
                      </tbody>
                    </table>
                  </div>
                } @else if (cohortLoaded) {
                  <div class="no-data">
                    <mat-icon>group_work</mat-icon>
                    <span>Нет данных для когортного анализа</span>
                  </div>
                } @else {
                  <div class="loading">
                    <mat-spinner diameter="40" />
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        <!-- Tab: Воронка продаж -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>filter_alt</mat-icon>
            <span>Воронка</span>
          </ng-template>

          <div class="tab-content">
            <mat-card>
              <mat-card-content>
                @if (api.funnelSteps().length > 0) {
                  <div class="funnel-container">
                    @for (step of api.funnelSteps(); track step.step; let i = $index) {
                      <div class="funnel-step">
                        <div class="funnel-bar" [style.width.%]="getFunnelWidth(step, i)">
                          <div class="funnel-bar-content">
                            <span class="funnel-label">{{ step.label }}</span>
                            <div class="funnel-metrics">
                              <span class="funnel-count">{{ step.count | number }}</span>
                              @if (step.rate !== undefined && step.rate !== null) {
                                <span class="funnel-rate">{{ step.rate }}%</span>
                              }
                              @if (step.value) {
                                <span class="funnel-value">{{ step.value | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                              }
                            </div>
                          </div>
                        </div>
                      </div>
                    }
                  </div>

                  @if (api.funnelAbandonment(); as ab) {
                    <mat-divider style="margin: 24px 0" />
                    <h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 500">Брошенные корзины</h3>
                    <div class="abandonment-grid">
                      <div class="ab-stat">
                        <span class="ab-value" style="color: #f44336">{{ ab.abandoned }}</span>
                        <span class="ab-label">Брошено заказов</span>
                      </div>
                      <div class="ab-stat">
                        <span class="ab-value" style="color: #f44336">{{ ab.abandoned_value | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                        <span class="ab-label">Потерянная выручка</span>
                      </div>
                      <div class="ab-stat">
                        <span class="ab-value" [style.color]="ab.abandonment_rate > 30 ? '#f44336' : '#ff9800'">{{ ab.abandonment_rate }}%</span>
                        <span class="ab-label">Процент брошенных</span>
                      </div>
                      <div class="ab-stat">
                        <span class="ab-value" style="color: #ff9800">{{ ab.payment_failures }}</span>
                        <span class="ab-label">Ошибки оплаты</span>
                      </div>
                    </div>
                  }
                } @else {
                  <div class="loading">
                    <mat-spinner diameter="40" />
                  </div>
                }
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
      </mat-tab-group>

      <!-- Покупки: до/после рекламы -->
      <section class="purchases-timing-section">
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>timeline</mat-icon>
            <mat-card-title>Покупки относительно рекламы</mat-card-title>
            <mat-card-subtitle>Когда клиент купил: до или после клика по рекламе</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            @if (api.purchasesByTiming()) {
              <div class="timing-grid">
                <div class="timing-card after-ads">
                  <div class="timing-icon">
                    <mat-icon>trending_up</mat-icon>
                  </div>
                  <div class="timing-data">
                    <span class="timing-value">{{ api.purchasesByTiming()!.after_ads.count }}</span>
                    <span class="timing-label">После рекламы</span>
                    <span class="timing-revenue">{{ api.purchasesByTiming()!.after_ads.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                  </div>
                </div>
                
                <div class="timing-card before-ads">
                  <div class="timing-icon">
                    <mat-icon>history</mat-icon>
                  </div>
                  <div class="timing-data">
                    <span class="timing-value">{{ api.purchasesByTiming()!.before_ads.count }}</span>
                    <span class="timing-label">До рекламы</span>
                    <span class="timing-revenue">{{ api.purchasesByTiming()!.before_ads.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                  </div>
                </div>
                
                <div class="timing-card no-ads">
                  <div class="timing-icon">
                    <mat-icon>person</mat-icon>
                  </div>
                  <div class="timing-data">
                    <span class="timing-value">{{ api.purchasesByTiming()!.no_ads.count }}</span>
                    <span class="timing-label">Без рекламы</span>
                    <span class="timing-revenue">{{ api.purchasesByTiming()!.no_ads.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
                  </div>
                </div>
              </div>
            }
          </mat-card-content>
        </mat-card>
      </section>
      
      <!-- Attribution Info -->
      <section class="attribution-info">
        <mat-card>
          <mat-card-content>
            <div class="info-row">
              <mat-icon>info</mat-icon>
              <span>
                Атрибуция покупок: <strong>{{ purchasesAttributed() }}</strong> из <strong>{{ purchasesTotal() }}</strong> 
                ({{ attributionRate() | number:'1.0-0' }}%)
              </span>
            </div>
          </mat-card-content>
        </mat-card>
      </section>
    </div>
  `,
  styles: [`
    .dashboard-container {
      min-height: 100vh;
      background: #f5f5f5;
      padding: 16px;
    }

    .dashboard-header {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
      padding: 16px 24px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .header-left h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 500;
    }
    
    .logo-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: #1976d2;
    }
    
    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    
    .period-select {
      width: 140px;
    }
    
    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255,255,255,0.8);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      z-index: 1000;
    }
    
    /* KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      margin-bottom: 24px;
    }
    
    .kpi-card {
      border-radius: 12px;
      overflow: hidden;
    }
    
    .kpi-card mat-card-content {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 24px;
    }
    
    .kpi-icon {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .kpi-icon mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: white;
    }
    
    .visitors .kpi-icon { background: linear-gradient(135deg, #42a5f5, #1976d2); }
    .leads .kpi-icon { background: linear-gradient(135deg, #66bb6a, #43a047); }
    .clients .kpi-icon { background: linear-gradient(135deg, #ab47bc, #7b1fa2); }
    .revenue .kpi-icon { background: linear-gradient(135deg, #ffa726, #f57c00); }
    
    .kpi-data {
      display: flex;
      flex-direction: column;
    }
    
    .kpi-value {
      font-size: 28px;
      font-weight: 600;
      line-height: 1.2;
    }
    
    .kpi-label {
      font-size: 14px;
      color: #666;
      margin-top: 4px;
    }
    
    .kpi-sub {
      font-size: 12px;
      color: #999;
      margin-top: 2px;
    }

    .kpi-value-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .kpi-trend {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 13px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .kpi-trend mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .kpi-trend.trend-up {
      color: #2e7d32;
      background: rgba(46, 125, 50, 0.1);
    }

    .kpi-trend.trend-down {
      color: #c62828;
      background: rgba(198, 40, 40, 0.1);
    }
    
    /* Locations */
    .locations-section {
      margin-bottom: 24px;
    }
    
    .locations-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      padding: 16px 0;
    }
    
    .location-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 12px;
      padding: 20px;
      color: white;
    }
    
    .location-card.studio1 {
      background: linear-gradient(135deg, #1a237e 0%, #3949ab 100%);
    }
    
    .location-card.studio2 {
      background: linear-gradient(135deg, #004d40 0%, #00897b 100%);
    }
    
    .location-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    
    .location-header mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
    }
    
    .location-name {
      font-size: 16px;
      font-weight: 500;
    }
    
    .location-stats {
      display: flex;
      gap: 24px;
    }
    
    .location-stats .stat {
      display: flex;
      flex-direction: column;
    }
    
    .location-stats .stat-value {
      font-size: 20px;
      font-weight: 600;
    }
    
    .location-stats .stat-label {
      font-size: 12px;
      opacity: 0.8;
    }
    
    /* Funnel */
    .funnel-section {
      margin-bottom: 24px;
    }
    
    .funnel-visual {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px;
    }
    
    .funnel-step {
      max-width: 100%;
      min-width: 30%;
      transition: width 0.3s ease;
    }
    
    .funnel-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
    }
    
    .visitors-bar { background: linear-gradient(135deg, #42a5f5, #1976d2); }
    .leads-bar { background: linear-gradient(135deg, #66bb6a, #43a047); }
    .clients-bar { background: linear-gradient(135deg, #ab47bc, #7b1fa2); }
    
    .funnel-arrow {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px;
      color: #666;
    }
    
    .funnel-arrow span {
      font-size: 12px;
      font-weight: 500;
    }
    
    /* Data Tabs */
    .data-tabs {
      margin-bottom: 24px;
    }
    
    .tab-content {
      padding-top: 16px;
    }
    
    .group-select {
      width: 180px;
    }
    
    /* Tables */
    .sources-table, .roi-table {
      width: 100%;
    }
    
    .source-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .source-cell mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    
    .source-yandex { color: #ffcc00; }
    .source-vk { color: #4a76a8; }
    .source-direct { color: #1976d2; }
    .source-other { color: #666; }
    
    .share-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 120px;
    }
    
    .share-fill {
      height: 8px;
      background: #1976d2;
      border-radius: 4px;
      flex-shrink: 0;
    }
    
    .share-bar span {
      font-size: 12px;
      color: #666;
      white-space: nowrap;
    }
    
    .roi-totals {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 0;
    }
    
    .total-item {
      display: flex;
      gap: 8px;
    }
    
    .total-label {
      color: #666;
    }
    
    .total-value {
      font-weight: 600;
    }
    
    .positive-roi {
      background-color: #c8e6c9 !important;
      color: #2e7d32 !important;
    }
    
    .negative-roi {
      background-color: #ffcdd2 !important;
      color: #c62828 !important;
    }
    
    .no-data-text {
      color: #999;
    }
    
    .cost-value {
      color: #f44336;
    }
    
    .revenue-value {
      color: #4caf50;
    }
    
    .no-data {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 48px;
      color: #999;
    }
    
    /* Attribution Info */
    .attribution-info {
      margin-bottom: 24px;
    }
    
    .info-row {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #666;
    }
    
    .info-row mat-icon {
      color: #1976d2;
    }
    
    /* Shifts Tab Styles */
    .shifts-filters {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-left: auto;
      width: 100%;
    }

    .month-select, .location-select {
      width: 100%;
    }
    
    .shifts-totals {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    
    .shifts-total-item {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .shifts-total-item mat-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: #1976d2;
    }
    
    .shifts-total-item .total-data {
      display: flex;
      flex-direction: column;
    }
    
    .shifts-total-item .total-value {
      font-size: 20px;
      font-weight: 600;
    }
    
    .shifts-total-item .total-label {
      font-size: 12px;
      color: #666;
    }
    
    .shifts-table {
      width: 100%;
    }
    
    .shifts-table .mat-mdc-row.today {
      background: rgba(25, 118, 210, 0.08);
    }
    
    .date-cell {
      display: flex;
      flex-direction: column;
    }
    
    .date-main {
      font-weight: 500;
    }
    
    .date-weekday {
      font-size: 12px;
      color: #666;
    }
    
    .time-cell {
      display: flex;
      flex-direction: column;
    }
    
    .time-range {
      font-weight: 500;
    }
    
    .time-hours {
      font-size: 12px;
      color: #666;
    }
    
    .shifts-table mat-chip.studio1 {
      --mdc-chip-elevated-container-color: #e3f2fd;
      --mdc-chip-label-text-color: #1565c0;
    }
    
    .shifts-table mat-chip.studio2 {
      --mdc-chip-elevated-container-color: #e0f2f1;
      --mdc-chip-label-text-color: #00695c;
    }
    
    /* New KPI styles */
    .clicks .kpi-icon { background: linear-gradient(135deg, #5c6bc0, #3f51b5); }
    .purchases .kpi-icon { background: linear-gradient(135deg, #26a69a, #00897b); }
    .conversion .kpi-icon { background: linear-gradient(135deg, #ec407a, #c2185b); }
    
    /* Funnel bar colors */
    .clicks-bar { background: linear-gradient(135deg, #5c6bc0, #3f51b5); }
    .conversions-bar { background: linear-gradient(135deg, #66bb6a, #43a047); }
    .purchases-bar { background: linear-gradient(135deg, #26a69a, #00897b); }
    
    /* Conversions section */
    .conversions-section {
      margin-bottom: 24px;
    }
    
    .conversions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 16px 0;
    }
    
    .conversion-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    
    .conversion-item mat-icon {
      color: #1976d2;
    }
    
    .conv-type {
      flex: 1;
    }
    
    .conv-count {
      font-weight: 600;
      font-size: 18px;
    }
    
    .conversions-total {
      padding: 12px 0;
      border-top: 1px solid #eee;
      text-align: center;
    }
    
    /* Campaigns table */
    .campaigns-table {
      width: 100%;
    }
    
    .campaign-name, .ad-content {
      font-size: 13px;
      cursor: help;
    }
    
    /* Purchases Timing */
    .purchases-timing-section {
      margin-bottom: 24px;
    }
    
    .timing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      padding: 16px 0;
    }
    
    .timing-card {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px;
      border-radius: 12px;
      color: white;
    }
    
    .timing-card.after-ads {
      background: linear-gradient(135deg, #2e7d32 0%, #43a047 100%);
    }
    
    .timing-card.before-ads {
      background: linear-gradient(135deg, #f57c00 0%, #ff9800 100%);
    }
    
    .timing-card.no-ads {
      background: linear-gradient(135deg, #616161 0%, #9e9e9e 100%);
    }
    
    .timing-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .timing-icon mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }
    
    .timing-data {
      display: flex;
      flex-direction: column;
    }
    
    .timing-value {
      font-size: 28px;
      font-weight: 600;
      line-height: 1.2;
    }
    
    .timing-label {
      font-size: 14px;
      opacity: 0.9;
    }
    
    .timing-revenue {
      font-size: 16px;
      font-weight: 500;
      margin-top: 4px;
    }
    
    /* Multichannel */
    .multichannel-info {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #e3f2fd;
      border-radius: 8px;
      margin-bottom: 16px;
      color: #1565c0;
    }
    
    .multichannel-table {
      width: 100%;
    }
    
    .touch-value {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 16px;
      font-weight: 500;
    }
    
    .touch-value.first {
      background: #e8f5e9;
      color: #2e7d32;
    }
    
    .touch-value.assist {
      background: #fff3e0;
      color: #e65100;
    }
    
    .touch-value.last {
      background: #e3f2fd;
      color: #1565c0;
    }
    
    .journeys-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }
    
    .journey-item {
      padding: 12px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    
    .journey-path {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    
    .journey-step {
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
    }
    
    .journey-step.source-yandex { background: #fff8e1; color: #f57f17; }
    .journey-step.source-vk { background: #e3f2fd; color: #1565c0; }
    .journey-step.source-other { background: #f5f5f5; color: #616161; }
    
    .journey-arrow {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #9e9e9e;
    }
    
    .journey-purchase {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      background: #e8f5e9;
      color: #2e7d32;
      border-radius: 4px;
      font-weight: 600;
    }
    
    .journey-purchase mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    
    .no-data-text {
      text-align: center;
    }
    
    .no-data-text p {
      color: #666;
      margin-top: 8px;
    }
    
    .has-value {
      color: #2e7d32;
      font-weight: 600;
    }
    
    .mat-mdc-row.has-purchases {
      background: rgba(46, 125, 50, 0.08);
    }

    .mat-mdc-row.has-conversions {
      background: rgba(255, 152, 0, 0.06);
    }

    .mat-mdc-row.negative-roi-row {
      background: rgba(198, 40, 40, 0.04);
    }
    
    .clickable-row {
      cursor: pointer;
    }

    .clickable-row:hover {
      background: rgba(25, 118, 210, 0.04);
    }

    .sources-table .mat-mdc-header-cell,
    .campaigns-table .mat-mdc-header-cell {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
    }
    
    .sources-table, .campaigns-table {
      overflow-x: auto;
    }
    
    /* Mobile-first: base styles */
    .dashboard-container {
      padding: 16px;
    }

    .dashboard-header {
      flex-direction: column;
      gap: 16px;
    }

    .kpi-grid {
      grid-template-columns: 1fr;
    }

    .roi-totals {
      flex-direction: column;
      gap: 8px;
    }

    .shifts-filters {
      flex-direction: column;
      width: 100%;
    }

    .month-select, .location-select {
      width: 100%;
    }

    /* Alerts */
    .alerts-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 24px;
    }

    .alert-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
    }

    .alert-item mat-icon {
      flex-shrink: 0;
    }

    .alert-error {
      background: #ffebee;
      color: #c62828;
      border-left: 4px solid #c62828;
    }

    .alert-warning {
      background: #fff8e1;
      color: #f57f17;
      border-left: 4px solid #f57f17;
    }

    /* Fraud tab */
    .fraud-summary {
      display: flex;
      gap: 24px;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 8px;
      margin-bottom: 16px;
    }

    .fraud-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .fraud-stat-value {
      font-size: 24px;
      font-weight: 600;
    }

    .fraud-stat-label {
      font-size: 12px;
      color: #666;
    }

    .fraud-stat.danger .fraud-stat-value {
      color: #c62828;
    }

    .fraud-table {
      width: 100%;
    }

    .fraud-high {
      background-color: #ffcdd2 !important;
      color: #c62828 !important;
    }

    .fraud-medium {
      background-color: #fff9c4 !important;
      color: #f57f17 !important;
    }

    .fraud-reasons {
      font-size: 12px;
      color: #666;
    }

    .fraud-table .mat-mdc-row.fraud-row-high {
      background: rgba(198, 40, 40, 0.05);
    }

    /* Cohort table */
    .cohort-table-scroll {
      overflow-x: auto;
    }

    .cohort-table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }

    .cohort-header-cell {
      padding: 8px 10px;
      text-align: center;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      border-bottom: 2px solid #e0e0e0;
      white-space: nowrap;
    }

    .cohort-label-cell {
      padding: 8px 12px;
      white-space: nowrap;
      font-weight: 500;
      border-right: 1px solid #eee;
    }

    .cohort-size-cell {
      padding: 8px 10px;
      text-align: center;
      font-weight: 600;
      border-right: 1px solid #eee;
    }

    .cohort-value-cell {
      padding: 6px 8px;
      text-align: center;
      min-width: 54px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid rgba(0,0,0,0.04);
      transition: background-color 0.2s;
    }

    .cohort-avg-row {
      border-top: 2px solid #bdbdbd;
    }

    .cohort-avg-cell {
      font-weight: 600;
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 48px;
    }

    /* Funnel styles */
    .funnel-container {
      padding: 16px 0;
    }

    .funnel-step {
      margin-bottom: 8px;
    }

    .funnel-bar {
      background: linear-gradient(90deg, #667eea, #764ba2);
      border-radius: 4px;
      padding: 12px 16px;
      min-width: 200px;
      transition: width 0.3s ease;
    }

    .funnel-bar-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #fff;
    }

    .funnel-label {
      font-weight: 500;
      font-size: 14px;
    }

    .funnel-metrics {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .funnel-count {
      font-size: 18px;
      font-weight: 700;
    }

    .funnel-rate {
      font-size: 13px;
      opacity: 0.85;
      background: rgba(255,255,255,0.2);
      padding: 2px 8px;
      border-radius: 12px;
    }

    .funnel-value {
      font-size: 13px;
      opacity: 0.85;
    }

    .abandonment-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }

    .ab-stat {
      text-align: center;
      padding: 12px;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .ab-value {
      font-size: 24px;
      font-weight: 600;
      display: block;
    }

    .ab-label {
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    }

    /* Desktop styles */
    @media (min-width: 840px) {
      .dashboard-container {
        padding: 24px;
      }

      .dashboard-header {
        flex-direction: row;
        gap: initial;
      }

      .kpi-grid {
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }

      .roi-totals {
        flex-direction: row;
        gap: 32px;
      }

      .shifts-filters {
        flex-direction: row;
        width: auto;
      }

      .month-select, .location-select {
        width: 140px;
      }

      .abandonment-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }
  `]
})
export class DashboardComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private dialog = inject(MatDialog);
  api = inject(AnalyticsApiService);
  
  selectedPeriod = 'month';  // today, yesterday, week, month, 60, 90
  roiGroupBy = 'source';
  
  // Shifts
  selectedMonth = '';  // Will be set in ngOnInit
  shiftsLocationFilter = '';
  availableMonths: { value: string; label: string }[] = [];
  
  sourcesColumns = ['source', 'campaign', 'clicks', 'cost', 'purchases', 'revenue', 'roi'];
  roiColumns = ['name', 'clicks', 'cost', 'purchases', 'revenue', 'roi', 'cpa'];
  campaignsColumns = ['source', 'campaign', 'ad_content', 'clicks', 'unique_visitors', 'conversions', 'purchases', 'revenue'];
  shiftsColumns = ['date', 'location', 'time', 'cheques', 'revenue', 'avg'];
  multichannelColumns = ['source', 'total', 'first', 'assist', 'last', 'customers'];
  fraudColumns = ['ad_id', 'platform', 'clicks', 'unique_visitors', 'conversions', 'fraud_score', 'reasons'];
  fraudLoaded = false;
  cohortLoaded = false;
  funnelLoaded = false;

  // Computed для воронки
  funnelVisitorsWidth = computed(() => {
    const f = this.api.funnel();
    const clicks = f.ad_clicks ?? 1;
    return clicks > 0 ? Math.max(30, ((f.unique_visitors ?? 0) / clicks * 100)) : 30;
  });
  
  funnelConversionsWidth = computed(() => {
    const f = this.api.funnel();
    const clicks = f.ad_clicks ?? 1;
    return clicks > 0 ? Math.max(20, ((f.conversions ?? 0) / clicks * 100)) : 20;
  });
  
  funnelPurchasesWidth = computed(() => {
    const f = this.api.funnel();
    const clicks = f.ad_clicks ?? 1;
    return clicks > 0 ? Math.max(15, ((f.purchases ?? 0) / clicks * 100)) : 15;
  });
  
  conversionToMessenger = computed(() => {
    const f = this.api.funnel();
    const visitors = f.unique_visitors ?? 0;
    const conversions = f.conversions ?? 0;
    return visitors > 0 ? (conversions / visitors * 100) : 0;
  });
  
  // ROI данные
  roiData = computed(() => this.api.roiReport()?.report ?? []);
  roiTotals = computed(() => this.api.roiReport()?.totals ?? { clicks: 0, purchases: 0, revenue: 0, cost: 0, roi: null, cpa: 0 });
  
  roiGroupLabel = computed(() => {
    switch (this.roiGroupBy) {
      case 'campaign': return 'Кампания';
      case 'platform': return 'Платформа';
      default: return 'Источник';
    }
  });
  
  // Покупки/атрибуция
  purchasesTotal = computed(() => this.api.dashboardMetrics()?.purchases.count ?? 0);
  purchasesAttributed = computed(() => this.api.dashboardMetrics()?.purchases.attributed ?? 0);
  attributionRate = computed(() => this.api.dashboardMetrics()?.purchases.attribution_rate ?? 0);
  
  // Клики по рекламе (из topSources)
  totalClicks = computed(() => {
    const sources = this.api.topSources();
    return sources.reduce((sum, s) => sum + (s.clicks || 0), 0);
  });
  
  totalUniqueVisitors = computed(() => {
    const sources = this.api.topSources();
    return sources.reduce((sum, s) => sum + (s.visitors || 0), 0);
  });
  
  // Точки (locations)
  private locationNames: Record<string, string> = {
    'studio1': 'Соборный, 21',
    'studio2': '2-ая Баррикадная, 4'
  };
  
  locationsList = computed(() => {
    const locations = this.api.locations();
    return Object.entries(locations).map(([id, stats]) => ({
      id,
      name: this.locationNames[id] || id,
      purchases: stats.purchases,
      revenue: stats.revenue
    }));
  });
  
  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.initAvailableMonths();
      this.loadData();
      this.loadShifts();
    }
  }
  
  initAvailableMonths(): void {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    // Generate last 12 months
    for (let i = 0; i < 12; i++) {
      let m = currentMonth - i;
      let y = currentYear;
      if (m < 0) {
        m += 12;
        y -= 1;
      }
      const value = `${y}-${String(m + 1).padStart(2, '0')}`;
      const label = `${months[m]} ${y}`;
      this.availableMonths.push({ value, label });
    }
    
    // Set current month as default
    this.selectedMonth = this.availableMonths[0].value;
  }
  
  loadData(): void {
    const range = this.getPeriodRange();
    this.api.fetchDashboardMetrics(range).subscribe();
    this.api.fetchRoiReport(range.days ?? 30, this.roiGroupBy).subscribe();
    this.api.fetchMultichannelReport(range.days ?? 30).subscribe();
  }
  
  loadShifts(): void {
    this.api.fetchShiftsReport(this.selectedMonth, this.shiftsLocationFilter || undefined).subscribe();
  }
  
  onMonthChange(): void {
    this.loadShifts();
  }
  
  formatShiftDate(date: string): string {
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  
  isToday(date: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    return date === today;
  }
  
  getPeriodRange(): { preset?: 'today' | 'yesterday' | 'week' | 'month' | 'custom'; days?: number } {
    if (this.selectedPeriod === 'today') return { preset: 'today' };
    if (this.selectedPeriod === 'yesterday') return { preset: 'yesterday' };
    if (this.selectedPeriod === 'week') return { preset: 'week' };
    if (this.selectedPeriod === 'month') return { preset: 'month' };
    return { days: parseInt(this.selectedPeriod, 10) };
  }
  
  onPeriodChange(): void {
    this.loadData();
  }
  
  onRoiGroupChange(): void {
    const range = this.getPeriodRange();
    this.api.fetchRoiReport(range.days ?? 30, this.roiGroupBy).subscribe();
  }
  
  refresh(): void {
    this.loadData();
  }

  onTabChange(event: { index: number }): void {
    // 0:Sources, 1:ROI, 2:Campaigns, 3:Multichannel, 4:Shifts, 5:Antifraud, 6:Cohorts, 7:Funnel
    if (event.index === 5) {
      this.onFraudTabSelected();
    } else if (event.index === 6) {
      this.onCohortTabSelected();
    } else if (event.index === 7) {
      this.onFunnelTabSelected();
    }
  }

  onFraudTabSelected(): void {
    if (!this.fraudLoaded) {
      this.fraudLoaded = true;
      const range = this.getPeriodRange();
      this.api.fetchFraudReport(range.days ?? 30).subscribe();
    }
  }
  
  onCohortTabSelected(): void {
    if (!this.cohortLoaded) {
      this.cohortLoaded = true;
      this.api.fetchCohortReport(3, 'week').subscribe();
    }
  }

  onFunnelTabSelected(): void {
    if (!this.funnelLoaded) {
      this.funnelLoaded = true;
      const range = this.getPeriodRange();
      this.api.fetchFunnelReport(range.days ?? 30).subscribe();
    }
  }

  getFunnelWidth(step: FunnelStep, index: number): number {
    const steps = this.api.funnelSteps();
    if (!steps.length || index === 0) return 100;
    const maxCount = steps[0].count || 1;
    return Math.max(20, Math.round((step.count / maxCount) * 100));
  }

  cohortWeekHeaders = computed(() => {
    const max = this.api.cohortMaxPeriods();
    return Array.from({ length: max + 1 }, (_, i) => i);
  });

  getCohortColor(value: number): string {
    if (value === undefined || value === null) return 'transparent';
    if (value === 0) return '#ffffff';
    // heatmap: 0% = white, 100% = rich green
    const intensity = Math.min(value / 100, 1);
    const r = Math.round(255 - intensity * 200);
    const g = Math.round(255 - intensity * 60);
    const b = Math.round(255 - intensity * 200);
    return `rgb(${r}, ${g}, ${b})`;
  }

  logout(): void {
    clearAnalyticsKey();
    window.location.href = '/analytics/login';
  }
  
  // Helpers для таблицы источников
  getSourceIcon(source: string): string {
    const s = source?.toLowerCase() ?? '';
    if (s.includes('yandex') || s.includes('direct')) return 'search';
    if (s.includes('vk')) return 'groups';
    return 'language';
  }
  
  getSourceClass(source: string): string {
    const s = source?.toLowerCase() ?? '';
    if (s.includes('yandex') || s.includes('direct')) return 'source-yandex';
    if (s.includes('vk')) return 'source-vk';
    return 'source-other';
  }
  
  formatSourceName(source: string): string {
    if (!source) return 'Прямой';
    const s = source.toLowerCase();
    if (s === 'yandex_direct') return 'Яндекс.Директ';
    if (s === 'vk_ads') return 'VK Ads';
    if (s === 'direct') return 'Прямой';
    return source;
  }
  
  getSourceShare(source: TopSource): number {
    const total = this.api.topSources().reduce((sum, s) => sum + s.clicks, 0);
    return total > 0 ? (source.clicks / total * 100) : 0;
  }
  
  getRoiName(row: RoiReportItem): string {
    return row.source || row.campaign || row.platform || 'unknown';
  }
  
  // Методы для конверсий
  getConversionIcon(channel: string): string {
    if (channel === 'telegram') return 'send';
    if (channel === 'whatsapp') return 'chat';
    if (channel === 'vk') return 'groups';
    return 'message';
  }
  
  formatConversionType(type: string): string {
    if (type === 'telegram_deep_link') return 'Переход в Telegram';
    if (type === 'phone_shared') return 'Отправка телефона';
    if (type === 'messenger_lead') return 'Лид из мессенджера';
    return type;
  }
  
  formatCampaignName(campaign: string): string {
    if (!campaign || campaign === 'без кампании') return '-';
    // Сокращаем длинные названия
    if (campaign.length > 25) {
      return campaign.substring(0, 22) + '...';
    }
    return campaign;
  }
  
  formatAdContent(content: string | undefined): string {
    if (!content) return '-';
    if (content.length > 15) {
      return content.substring(0, 12) + '...';
    }
    return content;
  }

  onCampaignClick(source: string, campaign: string): void {
    if (!source || !campaign) return;
    const range = this.getPeriodRange();
    this.dialog.open(CampaignDetailDialogComponent, {
      data: {
        source,
        campaign,
        days: range.days ?? 30,
      } as CampaignDetailDialogData,
      maxWidth: '90vw',
      width: '700px',
    });
  }
}

