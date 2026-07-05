import {
  Component, ChangeDetectionStrategy, inject, input, output, effect,
} from '@angular/core';
import { NgTemplateOutlet, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { OrderCreationFormStore } from './order-creation-form.store';
import type { PaymentMethod } from '../order-wizard/order-wizard.types';
import { FileDropzoneComponent } from '../order-wizard/shared/file-dropzone.component';
import { ProcessingSubOptionsComponent } from '../shared';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../shared/confirm-dialog.component';
import { RetouchConfiguratorComponent } from '../../../../shared/components/retouch-configurator/retouch-configurator.component';
import { channelIcon, channelLabel, channelColor } from '../../utils/crm-helpers';

@Component({
  selector: 'app-order-creation-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [OrderCreationFormStore],
  imports: [
    NgTemplateOutlet,
    FormsModule,
    MatIconModule, MatButtonModule, MatCheckboxModule,
    MatSelectModule, MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule, FileDropzoneComponent,
    ProcessingSubOptionsComponent,
    RetouchConfiguratorComponent,
    DatePipe,
  ],
  template: `
    <!-- Header -->
    <div class="ocf-header">
      <button class="ocf-back" (click)="closed.emit()">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <h2 class="ocf-title">Новый заказ</h2>
      @if (store.draftStatus() === 'saved' || store.draftStatus() === 'restored') {
        <span class="ocf-draft-indicator">Черновик · {{ store.draftTime() }}</span>
      } @else if (store.draftStatus() === 'saving') {
        <span class="ocf-draft-indicator ocf-draft-indicator--saving">Сохранение...</span>
      }
      <div class="ocf-header-spacer"></div>
      <button class="ocf-reset" (click)="store.resetForm()">
        <mat-icon>restart_alt</mat-icon> Сбросить
      </button>
    </div>

    @if (store.draftStale()) {
      <div class="ocf-draft-warning">
        <mat-icon>warning</mat-icon>
        <span>Черновик сохранён давно. Цены могли измениться.</span>
        <button class="ocf-draft-warning-btn" (click)="store.clearDraft(); store.resetForm()">Сбросить</button>
      </div>
    }

    <div class="ocf-body">
      <!-- ═══ LEFT: CONFIGURATOR ═══ -->
      <div class="ocf-left">

        <!-- Add service button -->
        <button class="ocf-add-service" (click)="store.showCategoryPicker.set(true)">
          <mat-icon>add_circle_outline</mat-icon>
          Добавить услугу
        </button>

        <!-- Service blocks -->
        @for (block of store.serviceBlocks(); track block.id) {
          <section class="ocf-block">
            <div class="ocf-block-header">
              <mat-icon>{{ block.categoryIcon }}</mat-icon>
              <span class="ocf-block-title">{{ block.categoryName }}</span>
              <button class="ocf-block-remove" (click)="store.removeBlock(block.id)">
                <mat-icon>close</mat-icon>
              </button>
            </div>

            @if (block.categorySlug === 'photo-docs') {
              <!-- ═══ PHOTO-DOCS SPECIAL UI ═══ -->

              <!-- Document list -->
              <div class="ocf-label">Документы <span class="ocf-label-hint">можно несколько</span></div>
              <div class="ocf-doc-list">
                @for (doc of store.documentTypeOptions(); track doc.slug) {
                  <div class="ocf-doc-row" [class.ocf-doc-row--active]="store.isDocumentSelected(doc.slug)">
                    <label class="ocf-doc-check">
                      <input type="checkbox" [checked]="store.isDocumentSelected(doc.slug)" (change)="store.toggleDocument(doc)">
                      <mat-icon class="ocf-doc-icon">{{ doc.icon }}</mat-icon>
                      <span class="ocf-doc-name">{{ doc.name }}</span>
                      @if (doc.defaultSize && !doc.customSize) {
                        <span class="ocf-doc-size">{{ doc.defaultSize }}</span>
                      }
                    </label>
                    @if (store.isDocumentSelected(doc.slug)) {
                      @if (!doc.customSize) {
                        <div class="ocf-qty-row">
                          <span class="ocf-qty-label">Комплектов:</span>
                          <div class="ocf-qty-stepper">
                            <button class="ocf-qty-btn" (click)="store.setSizeQuantity(doc.slug, doc.defaultSize, store.getSizeQty(doc.slug, doc.defaultSize) - 1)">-</button>
                            <span class="ocf-qty-value">{{ store.getSizeQty(doc.slug, doc.defaultSize) }}</span>
                            <button class="ocf-qty-btn" (click)="store.setSizeQuantity(doc.slug, doc.defaultSize, store.getSizeQty(doc.slug, doc.defaultSize) + 1)">+</button>
                          </div>
                        </div>
                      } @else {
                        <div class="ocf-size-row">
                          @for (size of store.photoSizes(); track size) {
                            <button class="ocf-size-chip" [class.ocf-size-chip--active]="store.getDocSizes(doc.slug).includes(size)"
                                    (click)="store.toggleDocumentSize(doc.slug, size)">{{ size }}</button>
                          }
                          <input class="ocf-size-custom" placeholder="Свой..." [ngModel]="store.getDocCustomSize(doc.slug)" (ngModelChange)="store.setCustomDocSize(doc.slug, $event)">
                        </div>
                        @for (ss of store.getDocSizeSets(doc.slug); track ss.size) {
                          <div class="ocf-qty-row">
                            <span class="ocf-qty-label">{{ ss.size }}:</span>
                            <div class="ocf-qty-stepper">
                              <button class="ocf-qty-btn" (click)="store.setSizeQuantity(doc.slug, ss.size, ss.quantity - 1)">-</button>
                              <span class="ocf-qty-value">{{ ss.quantity }}</span>
                              <button class="ocf-qty-btn" (click)="store.setSizeQuantity(doc.slug, ss.size, ss.quantity + 1)">+</button>
                            </div>
                            <span class="ocf-qty-hint">компл.</span>
                          </div>
                        }
                      }
                    }
                    @if (doc.requiresCountry && store.isDocumentSelected(doc.slug)) {
                      <select class="ocf-country-select" (change)="store.setVisaCountry(asVal($event))">
                        <option value="" disabled selected>Страна визы</option>
                        @for (c of store.visaCountryOptions(); track c.code) {
                          <option [value]="c.code">{{ c.name }} ({{ c.photoSize }})</option>
                        }
                      </select>
                    }
                  </div>
                }
              </div>

              @if (store.showZagranAlert()) {
                <div class="ocf-alert"><mat-icon>info</mat-icon><span>Уточните у клиента: загранпаспорт или виза? Страна?</span></div>
              }
              @if (store.hasGreenCard()) {
                <div class="ocf-alert ocf-alert--warning">
                  <mat-icon>warning</mat-icon>
                  <div class="ocf-alert-content">
                    <strong>Гринкарта — особые требования:</strong>
                    <ul class="ocf-alert-list">
                      <li>Сбросить всю фотосъёмку целиком</li>
                      <li>Фон подсвечен равномерно</li>
                      <li>Белый фон вокруг головы > ширины плеч</li>
                    </ul>
                  </div>
                </div>
              }

              <!-- Уровни обработки + «Супер»-конфигуратор — общий шаблон (см. processingLevelTpl) -->
              @for (group of block.groups; track group.slug) {
                @if (group.slug === 'processing-level') {
                  <ng-container [ngTemplateOutlet]="processingLevelTpl"
                                [ngTemplateOutletContext]="{ block, group }" />
                }
              }

              <!-- Дополнительно: DB extras + hardcoded options (single unified section) -->
              <div class="ocf-label" style="margin-top: 12px">Дополнительно</div>
              <div class="ocf-addons">
                <!-- DB-driven extras (убрать бороду, печать+доставка etc.) -->
                @for (group of block.groups; track group.slug) {
                  @if (group.slug === 'extras') {
                    @for (opt of group.options; track opt.slug) {
                      @if (opt.slug !== 'uniform') {
                        <div class="ocf-addon" [class.ocf-addon--promo]="opt.basePrice > opt.priceStudio" tabindex="0" role="checkbox" [attr.aria-checked]="opt.quantity > 0"
                             (click)="store.toggleBlockOption(block.id, group.slug, opt.slug)"
                             (keydown.enter)="store.toggleBlockOption(block.id, group.slug, opt.slug)"
                             (keydown.space)="store.toggleBlockOption(block.id, group.slug, opt.slug); $event.preventDefault()">
                          <div class="ocf-addon-radio" [class.ocf-addon-radio--checked]="opt.quantity > 0"></div>
                          <div class="ocf-addon-info">
                            <span class="ocf-addon-name">{{ opt.name }}
                              @if (opt.basePrice > opt.priceStudio) {
                                <span class="ocf-addon-badge">Акция</span>
                              }
                            </span>
                            @if (opt.basePrice > opt.priceStudio) {
                              <span class="ocf-addon-hint">
                                <span class="ocf-addon-price--old">{{ opt.basePrice }}\u20BD</span>
                                {{ opt.priceStudio }}\u20BD
                                <span class="ocf-addon-saving">\u2212{{ opt.basePrice - opt.priceStudio }}\u20BD</span>
                              </span>
                            } @else {
                              <span class="ocf-addon-hint">{{ opt.priceStudio > 0 ? opt.priceStudio + '\u20BD' : 'включено' }}</span>
                            }
                            @if (opt.description) {
                              <span class="ocf-addon-desc">{{ opt.description }}</span>
                            }
                          </div>
                        </div>
                      }
                    }
                  }
                }
                <!-- Подставка формы (with file upload) -->
                <label class="ocf-addon">
                  <input type="checkbox" [checked]="store.hasFormOverlay()" (change)="store.toggleFormOverlay(block.id)">
                  <div class="ocf-addon-info"><span class="ocf-addon-name">Подстановка формы</span><span class="ocf-addon-hint">{{ store.uniformPrice() }}\u20BD · обработка до 1 часа</span></div>
                </label>
                @if (store.hasFormOverlay()) {
                  <div class="ocf-addon-detail">
                    <textarea class="ocf-textarea ocf-textarea--sm"
                      placeholder="Название/описание формы (например: парадная ВМФ, полиция МВД, МЧС)..."
                      [ngModel]="store.uniformDescription()"
                      (ngModelChange)="store.uniformDescription.set($event)"></textarea>
                    <div class="ocf-addon-detail-label">Образец формы от клиента</div>
                    <app-file-dropzone [files]="store.formExampleFiles()" accept="image/*,.pdf"
                      (filesAdded)="store.addFormExampleFiles($event)" (fileRemoved)="store.removeFormExampleFile($event)" />
                  </div>
                }
                <!-- Подставка костюма -->
                <label class="ocf-addon">
                  <input type="checkbox" [checked]="store.hasSuitOverlay()" (change)="store.hasSuitOverlay.set(!store.hasSuitOverlay())">
                  <div class="ocf-addon-info"><span class="ocf-addon-name">Подставка костюма / одежды</span><span class="ocf-addon-hint">Не добавляет времени</span></div>
                </label>
                @if (store.hasSuitOverlay()) {
                  <div class="ocf-addon-detail">
                    <textarea class="ocf-textarea ocf-textarea--sm" placeholder="Пожелания по костюму / одежде..."
                      [ngModel]="store.suitWishes()" (ngModelChange)="store.suitWishes.set($event)"></textarea>
                  </div>
                }
                <!-- Медали и шевроны -->
                <label class="ocf-addon">
                  <input type="checkbox" [checked]="store.hasMedals()" (change)="store.hasMedals.set(!store.hasMedals())">
                  <div class="ocf-addon-info"><span class="ocf-addon-name">Медали и шевроны</span><span class="ocf-addon-hint">Перечень от клиента</span></div>
                </label>
                @if (store.hasMedals()) {
                  <div class="ocf-addon-detail">
                    <textarea class="ocf-textarea ocf-textarea--sm" placeholder="Перечень медалей..."
                      [ngModel]="store.medalsDescription()" (ngModelChange)="store.medalsDescription.set($event)"></textarea>
                  </div>
                }
              </div>

            } @else {
              <!-- ═══ GENERIC BLOCK UI ═══ -->
              @for (group of block.groups; track group.slug) {
                @if (group.slug === 'processing-level') {
                  <!-- Уровни обработки + «Супер»-конфигуратор — тот же общий шаблон, что в photo-docs -->
                  <ng-container [ngTemplateOutlet]="processingLevelTpl"
                                [ngTemplateOutletContext]="{ block, group }" />
                } @else {
                  @if (block.groups.length > 1) {
                    <div class="ocf-label">{{ group.name }}</div>
                  }
                  <div class="ocf-addons">
                    @for (opt of group.options; track opt.slug) {
                      <div class="ocf-addon" tabindex="0" role="checkbox" [attr.aria-checked]="opt.quantity > 0"
                           (click)="group.selectionType === 'single' ? store.setBlockOption(block.id, group.slug, opt.slug, 1) : store.toggleBlockOption(block.id, group.slug, opt.slug)"
                           (keydown.enter)="group.selectionType === 'single' ? store.setBlockOption(block.id, group.slug, opt.slug, 1) : store.toggleBlockOption(block.id, group.slug, opt.slug)">
                        <div class="ocf-addon-radio" [class.ocf-addon-radio--checked]="opt.quantity > 0"
                             [class.ocf-addon-radio--round]="group.selectionType === 'single'"></div>
                        <div class="ocf-addon-info">
                          <span class="ocf-addon-name">{{ opt.name }}
                            @if (opt.basePrice > opt.priceStudio && opt.priceStudio > 0) {
                              <span class="ocf-addon-badge">Акция</span>
                            }
                          </span>
                          @if (opt.basePrice > opt.priceStudio && opt.priceStudio > 0) {
                            <span class="ocf-addon-hint">
                              <span class="ocf-addon-price--old">{{ opt.basePrice }}\u20BD</span>
                              {{ opt.priceStudio }}\u20BD
                              <span class="ocf-addon-saving">\u2212{{ opt.basePrice - opt.priceStudio }}\u20BD</span>
                            </span>
                          } @else {
                            <span class="ocf-addon-hint">{{ opt.priceStudio > 0 ? opt.priceStudio + '\u20BD' : 'включено' }}</span>
                          }
                          @if (opt.description) {
                            <span class="ocf-addon-desc">{{ opt.description }}</span>
                          }
                        </div>
                        @if (opt.quantity > 0 && group.selectionType !== 'single') {
                          <div class="ocf-qty-stepper ocf-qty-stepper--inline">
                            <button class="ocf-qty-btn" (click)="store.setBlockOption(block.id, group.slug, opt.slug, opt.quantity - 1); $event.stopPropagation()">-</button>
                            <span class="ocf-qty-value">{{ opt.quantity }}</span>
                            <button class="ocf-qty-btn" (click)="store.setBlockOption(block.id, group.slug, opt.slug, opt.quantity + 1); $event.stopPropagation()">+</button>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              }
            }
          </section>
        }

        @if (store.serviceBlocks().length === 0) {
          <div class="ocf-category-grid">
            @for (cat of store.categories(); track cat.slug) {
              <button class="ocf-category-card" (click)="store.addBlock(cat.slug)">
                <mat-icon class="ocf-category-card-icon">{{ cat.icon }}</mat-icon>
                <span class="ocf-category-card-name">{{ cat.name }}</span>
              </button>
            }
            @if (store.categories().length === 0) {
              <div class="ocf-empty-state">
                <mat-icon>hourglass_empty</mat-icon>
                <span>Загрузка услуг...</span>
              </div>
            }
          </div>
        }

        <!-- Client photo -->
        @if (store.serviceBlocks().length > 0) {
          <section class="ocf-section">
            <div class="ocf-label">Фото клиента</div>
            <app-file-dropzone [files]="store.clientFiles()" accept="image/*,.heic,.heif,.pdf"
              (filesAdded)="store.addClientFiles($event)" (fileRemoved)="store.removeClientFile($event)" />
          </section>
          <section class="ocf-section">
            <div class="ocf-label">Комментарий</div>
            <textarea class="ocf-textarea" placeholder="Пожелания, особые требования..."
              [ngModel]="store.comment()" (ngModelChange)="store.comment.set($event)"></textarea>
          </section>
        }
      </div>

      <!-- ═══ RIGHT: ORDER PANEL ═══ -->
      <div class="ocf-right">
        <div class="ocf-panel">
          <div class="ocf-panel-title">Заказ</div>

          @for (block of store.serviceBlocks(); track block.id) {
            @if (block.categorySlug === 'photo-docs') {
              @for (doc of store.selectedDocuments(); track doc.option.slug) {
                @if (!doc.option.customSize) {
                  @let lineKey = store.documentLineKey(doc.option.slug, doc.option.defaultSize || 'default');
                  <div class="ocf-sum-line">
                    <span class="ocf-sum-name">{{ doc.option.name }} <span class="ocf-sum-size">{{ doc.option.defaultSize }}</span>
                      @if (store.documentTotalQty(doc) > 1) { <span class="ocf-sum-qty">\u00D7{{ store.documentTotalQty(doc) }}</span> }
                    </span>
                    @if (store.apiLinePrice(lineKey); as api) {
                      <span class="ocf-sum-price">
                        @if (api.discountAmount > 0) {
                          <span class="ocf-sum-price--old">{{ api.basePrice * store.documentTotalQty(doc) }}\u20BD</span>
                        }
                        {{ api.finalPrice }}\u20BD
                      </span>
                    } @else {
                      <span class="ocf-sum-price">{{ store.documentLineTotal(doc) }}\u20BD</span>
                    }
                  </div>
                  @if (store.apiLinePrice(lineKey); as api) {
                    @if (api.discountLabel) {
                      <div class="ocf-sum-discount">{{ api.discountLabel }}</div>
                    }
                  }
                } @else {
                  @if (doc.sizeSets.length === 0 && !doc.customSize.trim()) {
                    @let lineKey = store.documentLineKey(doc.option.slug, 'default');
                    <div class="ocf-sum-line">
                      <span class="ocf-sum-name">{{ doc.option.name }}</span>
                      @if (store.apiLinePrice(lineKey); as api) {
                        <span class="ocf-sum-price">{{ api.finalPrice }}\u20BD</span>
                      } @else {
                        <span class="ocf-sum-price">{{ store.setPrice(doc.option.slug) }}\u20BD</span>
                      }
                    </div>
                  }
                  @for (ss of doc.sizeSets; track ss.size) {
                    @let lineKey = store.documentLineKey(doc.option.slug, ss.size);
                    <div class="ocf-sum-line">
                      <span class="ocf-sum-name">{{ doc.option.name }} <span class="ocf-sum-size">{{ ss.size }}</span>
                        @if (ss.quantity > 1) { <span class="ocf-sum-qty">\u00D7{{ ss.quantity }}</span> }
                      </span>
                      @if (store.apiLinePrice(lineKey); as api) {
                        <span class="ocf-sum-price">
                          @if (api.discountAmount > 0) {
                            <span class="ocf-sum-price--old">{{ api.basePrice * ss.quantity }}\u20BD</span>
                          }
                          {{ api.finalPrice }}\u20BD
                        </span>
                      } @else {
                        <span class="ocf-sum-price">{{ store.setPrice(doc.option.slug) * ss.quantity }}\u20BD</span>
                      }
                    </div>
                    @if (store.apiLinePrice(lineKey); as api) {
                      @if (api.discountLabel) {
                        <div class="ocf-sum-discount">{{ api.discountLabel }}</div>
                      }
                    }
                  }
                  @if (doc.customSize.trim()) {
                    @let lineKey = store.documentLineKey(doc.option.slug, doc.customSize.trim());
                    <div class="ocf-sum-line">
                      <span class="ocf-sum-name">{{ doc.option.name }} <span class="ocf-sum-size">{{ doc.customSize.trim() }}</span></span>
                      @if (store.apiLinePrice(lineKey); as api) {
                        <span class="ocf-sum-price">{{ api.finalPrice }}\u20BD</span>
                      } @else {
                        <span class="ocf-sum-price">{{ store.setPrice(doc.option.slug) }}\u20BD</span>
                      }
                    </div>
                  }
                }
              }
              <!-- Processing/extras selected in block -->
              @for (g of block.groups; track g.slug) {
                @if (g.slug !== 'document-type' && g.slug !== 'speed') {
                  @for (o of g.options; track o.slug) {
                    @if (o.quantity > 0) {
                      @let lineKey = store.optionLineKey(block.id, g.slug, o.slug);
                      <div class="ocf-sum-line ocf-sum-line--service">
                        <span class="ocf-sum-name">{{ o.name }}
                          @if (o.quantity > 1) { <span class="ocf-sum-qty">\u00D7{{ o.quantity }}</span> }
                        </span>
                        @if (store.apiLinePrice(lineKey); as api) {
                          <span class="ocf-sum-price">{{ api.finalPrice }}\u20BD</span>
                        } @else {
                          <span class="ocf-sum-price">{{ o.priceStudio * o.quantity }}\u20BD</span>
                        }
                      </div>
                    }
                  }
                }
              }
              <!-- Urgent surcharge (flat) -->
              @if (store.isUrgent()) {
                <div class="ocf-sum-line ocf-sum-line--service">
                  <span class="ocf-sum-name">Срочно</span>
                  <span class="ocf-sum-price">+{{ store.speedSurcharge() }}\u20BD</span>
                </div>
              }
            } @else {
              @for (g of block.groups; track g.slug) {
                @for (o of g.options; track o.slug) {
                  @if (o.quantity > 0) {
                    @let lineKey = store.optionLineKey(block.id, g.slug, o.slug);
                    <div class="ocf-sum-line">
                      <span class="ocf-sum-name">{{ o.name }}
                        @if (o.quantity > 1) { <span class="ocf-sum-qty">\u00D7{{ o.quantity }}</span> }
                      </span>
                      @if (store.apiLinePrice(lineKey); as api) {
                        <span class="ocf-sum-price">
                          @if (api.discountAmount > 0) {
                            <span class="ocf-sum-price--old">{{ api.basePrice * o.quantity }}\u20BD</span>
                          }
                          {{ api.finalPrice }}\u20BD
                        </span>
                      } @else {
                        <span class="ocf-sum-price">
                          @if (o.basePrice > o.priceStudio) {
                            <span class="ocf-sum-price--old">{{ o.basePrice * o.quantity }}\u20BD</span>
                          }
                          {{ o.priceStudio * o.quantity }}\u20BD
                        </span>
                      }
                    </div>
                    @if (store.apiLinePrice(lineKey); as api) {
                      @if (api.discountLabel) {
                        <div class="ocf-sum-discount">{{ api.discountLabel }}</div>
                      }
                    }
                  }
                }
              }
            }
          }

          @if (store.serviceBlocks().length === 0) {
            <div class="ocf-sum-empty">Добавьте услугу</div>
          }

          @if (store.apiSavings() > 0) {
            <div class="ocf-sum-savings">Экономия: {{ store.apiSavings() }}\u20BD</div>
          }
          @if (store.comboHints().length > 0) {
            <div class="ocf-combo-hint">
              <mat-icon>local_offer</mat-icon>
              <span>Добавьте {{ store.comboHints()[0].missing }} и сэкономьте {{ store.comboHints()[0].savings }}\u20BD</span>
            </div>
          }

          <!-- Promo code -->
          @if (store.serviceBlocks().length > 0) {
            <div class="ocf-promo">
              <div class="ocf-promo-input-wrap">
                <mat-icon class="ocf-promo-icon">confirmation_number</mat-icon>
                <input class="ocf-promo-input" placeholder="Промокод"
                  [ngModel]="store.promoCode()" (ngModelChange)="store.onPromoInput($event)"
                  autocomplete="off" spellcheck="false">
                @if (store.promoValidating()) {
                  <mat-spinner class="ocf-promo-spinner" diameter="14"></mat-spinner>
                }
                @if (store.promoCode()) {
                  <button class="ocf-promo-clear" (click)="store.clearPromo()"><mat-icon>close</mat-icon></button>
                }
              </div>
              @if (store.promoValidation(); as v) {
                @if (v.valid) {
                  <div class="ocf-promo-result ocf-promo-result--valid">
                    <mat-icon>check_circle</mat-icon>
                    <span>{{ v.title }}
                      @if (v.discount_percent) { &mdash; {{ v.discount_percent }}% }
                      @else if (v.discount_amount) { &mdash; {{ v.discount_amount }}\u20BD }
                    </span>
                  </div>
                } @else {
                  <div class="ocf-promo-result ocf-promo-result--invalid">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{ v.error || 'Промокод не найден' }}</span>
                  </div>
                }
              }
              @if (store.promoDiscount(); as pd) {
                <div class="ocf-promo-applied">
                  <mat-icon>local_offer</mat-icon>
                  <span>{{ pd.title }}: &minus;{{ pd.amount }}\u20BD</span>
                </div>
              }
              @if (store.promoBlocked()) {
                <div class="ocf-promo-result ocf-promo-result--blocked">
                  <mat-icon>info</mat-icon>
                  <span>Промокод не применён — действует скидка за количество</span>
                </div>
              }
            </div>
          }

          <div class="ocf-sum-divider"></div>
          <div class="ocf-sum-total">
            <span>Итого</span>
            <span class="ocf-sum-total-value">
              @if (store.pricingLoading()) {
                <mat-spinner diameter="16"></mat-spinner>
              } @else {
                {{ store.grandTotal() }}\u20BD
              }
            </span>
          </div>
        </div>

        <!-- Priority (only when photo-docs block exists) -->
        @if (store.hasDocsBlock()) {
          <div class="ocf-panel">
            <div class="ocf-panel-title">Приоритет</div>
            <div class="ocf-priority-options">
              <label class="ocf-priority" [class.ocf-priority--active]="!store.isUrgent()">
                <input type="radio" name="priority" [checked]="!store.isUrgent()" (change)="store.isUrgent.set(false)">
                <div><div class="ocf-priority-name">Обычный</div><div class="ocf-priority-desc">{{ store.docNormalSetPrice() }}\u20BD/компл</div></div>
              </label>
              <label class="ocf-priority" [class.ocf-priority--active]="store.isUrgent()">
                <input type="radio" name="priority" [checked]="store.isUrgent()" (change)="store.isUrgent.set(true)">
                <div><div class="ocf-priority-name">Срочный</div><div class="ocf-priority-desc">+{{ store.speedSurcharge() }}\u20BD к заказу, без очереди</div></div>
              </label>
            </div>
          </div>
        }

        <!-- Client -->
        <div class="ocf-panel">
          <div class="ocf-panel-title">Клиент</div>
          <div class="ocf-field">
            <label class="ocf-field-label" for="ocf-phone">Телефон</label>
            <div class="ocf-phone-wrap">
              <span class="ocf-phone-prefix">+7</span>
              <input id="ocf-phone" class="ocf-input ocf-input--phone" type="tel" placeholder="(___) ___-__-__" maxlength="15"
                     [ngModel]="store.phoneDisplay()" (ngModelChange)="store.onPhoneInput($event)">
            </div>
            @if (store.customerLookup(); as lookup) {
              <div class="ocf-field-hint ocf-field-hint--found"><mat-icon>check_circle</mat-icon> {{ lookup.customer_name }} — {{ lookup.recent_receipts }} заказ(ов)</div>
            }
          </div>
          <div class="ocf-field">
            <label class="ocf-field-label" for="ocf-name">Имя</label>
            <input id="ocf-name" class="ocf-input" [ngModel]="store.clientName()" (ngModelChange)="store.clientName.set($event)">
          </div>
        </div>

        <!-- Chat -->
        <div class="ocf-panel">
          <div class="ocf-panel-title">Чат</div>
          @if (store.linkedSessionId()) {
            <div class="ocf-chat-linked">
              <mat-icon>chat_bubble</mat-icon>
              <div class="ocf-chat-linked-info">
                <span class="ocf-chat-linked-name">{{ store.linkedSessionName() ?? 'Чат клиента' }}</span>
                <span class="ocf-chat-linked-hint">Клиент получит срок готовности</span>
              </div>
              <button class="ocf-chat-unlink" (click)="store.unlinkChat()"><mat-icon>close</mat-icon></button>
            </div>
          } @else {
            <button class="ocf-link-chat-btn" (click)="store.openChatPicker()"><mat-icon>link</mat-icon> Привязать чат</button>
          }
        </div>

        <!-- Payment -->
        <div class="ocf-panel ocf-panel--last">
          <div class="ocf-panel-title">Оплата</div>
          <div class="ocf-pay-grid">
            <button class="ocf-pay ocf-pay--primary" [disabled]="!store.canSubmit() || store.submitting()" (click)="onPay('cash')">
              @if (store.submitting()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>payments</mat-icon> }
              Наличные {{ store.grandTotal() }}\u20BD
            </button>
            <button class="ocf-pay" [disabled]="!store.canSubmit()" (click)="onPay('card')"><mat-icon>credit_card</mat-icon> Картой</button>
            <button class="ocf-pay" [disabled]="!store.canSubmit()" (click)="onPay('sbp')"><mat-icon>qr_code_2</mat-icon> СБП</button>
            <button class="ocf-pay" [disabled]="!store.canSubmit()" (click)="onPay('online')"><mat-icon>language</mat-icon> Онлайн</button>
            <button class="ocf-pay" [disabled]="!store.canSubmit()" (click)="onPay('later')"><mat-icon>schedule</mat-icon> Позже</button>
          </div>
          <div class="ocf-auto-assign"><mat-icon>person_add</mat-icon> Ретушёр назначится автоматически · {{ store.estimatedTime() }}</div>
        </div>
      </div>
    </div>

    <!-- Category picker popup -->
    @if (store.showCategoryPicker()) {
      <div class="ocf-popup-backdrop" (click)="store.showCategoryPicker.set(false)" role="presentation"></div>
      <div class="ocf-popup">
        <div class="ocf-popup-header">
          <h3 class="ocf-popup-title">Добавить услугу</h3>
          <button class="ocf-popup-close" (click)="store.showCategoryPicker.set(false)"><mat-icon>close</mat-icon></button>
        </div>
        <div class="ocf-popup-list">
          @for (cat of store.categories(); track cat.slug) {
            <button class="ocf-popup-item" (click)="store.addBlock(cat.slug)">
              <mat-icon class="ocf-popup-item-icon">{{ cat.icon }}</mat-icon>
              <span class="ocf-popup-item-name">{{ cat.name }}</span>
            </button>
          }
        </div>
      </div>
    }

    <!-- Chat picker popup -->
    @if (store.showChatPickerPopup()) {
      <div class="ocf-popup-backdrop" (click)="store.closeChatPicker()" role="presentation"></div>
      <div class="ocf-popup">
        <div class="ocf-popup-header">
          <h3 class="ocf-popup-title">Привязать чат</h3>
          <button class="ocf-popup-close" (click)="store.closeChatPicker()"><mat-icon>close</mat-icon></button>
        </div>
        <div class="ocf-popup-search">
          <mat-icon>search</mat-icon>
          <input class="ocf-popup-search-input" placeholder="Поиск по имени или телефону..." (input)="store.searchChats(asVal($event))">
        </div>
        <div class="ocf-popup-list">
          @for (chat of store.chatSearchResults(); track chat.id) {
            <button class="ocf-popup-item" (click)="store.selectChatFromSearch(chat)">
              <mat-icon class="ocf-popup-item-icon"
                        [style.color]="channelColor(chat.channel)">{{ channelIcon(chat.channel) }}</mat-icon>
              <div class="ocf-popup-item-info">
                <div class="ocf-popup-item-top">
                  <span class="ocf-popup-item-name">{{ chat.clientName || chat.clientPhone || 'Без имени' }}</span>
                  @if (chat.sortTime) {
                    <span class="ocf-popup-item-time">{{ chat.sortTime | date:'dd.MM HH:mm' }}</span>
                  }
                </div>
                <div class="ocf-popup-item-sub">
                  @if (chat.channel) {
                    <span class="ocf-popup-item-badge"
                          [style.color]="channelColor(chat.channel)"
                          [style.border-color]="channelColor(chat.channel)">{{ channelLabel(chat.channel) }}</span>
                  }
                  @if (chat.clientPhone) {
                    <span class="ocf-popup-item-phone">{{ chat.clientPhone }}</span>
                  }
                </div>
                @if (chat.preview) {
                  <span class="ocf-popup-item-preview">{{ chat.preview }}</span>
                }
              </div>
            </button>
          }
          @if (store.chatSearchResults().length === 0) {
            <div class="ocf-popup-empty"><mat-icon>forum</mat-icon><span>Загрузка...</span></div>
          }
        </div>
      </div>
    }

      <!-- ════ Общий шаблон лесенки уровней обработки (photo-docs + portrait + любая категория с processing-level) ════ -->
      <ng-template #processingLevelTpl let-block="block" let-group="group">
        <div class="ocf-label" style="margin-top: 12px">{{ group.name }}</div>
        <div class="ocf-addons">
          @for (opt of group.options; track opt.slug) {
            <div class="ocf-addon" tabindex="0" role="radio" [attr.aria-checked]="opt.quantity > 0"
                 [class.ocf-addon--super]="opt.slug === 'processing-super'"
                 (click)="store.setBlockOption(block.id, group.slug, opt.slug, 1)"
                 (keydown.enter)="store.setBlockOption(block.id, group.slug, opt.slug, 1)"
                 (keydown.space)="store.setBlockOption(block.id, group.slug, opt.slug, 1); $event.preventDefault()">
              <div class="ocf-addon-radio ocf-addon-radio--round" [class.ocf-addon-radio--checked]="opt.quantity > 0"></div>
              <div class="ocf-addon-info">
                <span class="ocf-addon-name">
                  {{ opt.name }}
                  @if (opt.slug === 'processing-super') {
                    <span class="ocf-addon-badge ocf-addon-badge--super">💎 10 вариантов ретуши</span>
                  }
                </span>
                <span class="ocf-addon-hint">
                  @if (opt.quantity > 0 && opt.priceStudio > 0) {
                    {{ store.processingAdjustedPrice(block.id, opt.slug) }}\u20BD
                  } @else {
                    {{ opt.priceStudio > 0 ? opt.priceStudio + '\u20BD' : 'включено' }}
                  }
                  @if (opt.slug === 'processing-super') {
                    <span class="ocf-addon-super-note">клиент выбирает из 10 вариантов, правки до полного одобрения</span>
                  }
                </span>
              </div>
            </div>
            @if (opt.quantity > 0) {
              @if (opt.slug === 'processing-super') {
                <!-- «Супер обработка»: конфигуратор-чеклист (бесплатные галочки), вместо платных под-опций -->
                <app-retouch-configurator
                  [active]="true"
                  [initial]="store.retouchConfig()"
                  (configChange)="store.setRetouchConfig($event)" />
              } @else {
                @let subs = store.processingTierSubs().get(opt.slug);
                @if (subs && subs.length > 0) {
                  <app-processing-sub-options
                    [subs]="subs"
                    [isDisabled]="isSubOptionDisabledFn(block.id)"
                    (subToggle)="store.toggleSubOption(block.id, $event)" />
                }
              }
            }
          }
        </div>
      </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; background: var(--crm-surface-base, #0c0b09); color: var(--crm-text-primary, #ececec); overflow: hidden; }

    .ocf-header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--crm-border, rgba(255,255,255,0.06)); flex-shrink: 0; }
    .ocf-back { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--crm-border); border-radius: 6px; background: transparent; color: var(--crm-text-secondary); cursor: pointer; &:hover { background: rgba(255,255,255,0.04); color: var(--crm-text-primary); } }
    .ocf-title { margin: 0; font-family: var(--crm-font-display, 'Oswald', sans-serif); font-size: 17px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
    .ocf-header-spacer { flex: 1; }
    .ocf-reset { display: flex; align-items: center; gap: 4px; padding: 5px 10px; border: 1px solid var(--crm-border); border-radius: 6px; background: transparent; color: var(--crm-text-muted, #7a7a7a); font: inherit; font-size: 11px; cursor: pointer; &:hover { color: #ef4444; border-color: rgba(239,68,68,0.3); } mat-icon { font-size: 14px; width: 14px; height: 14px; } }

    .ocf-body { display: grid; grid-template-columns: 1fr 300px; flex: 1; min-height: 0; overflow: hidden; }
    .ocf-left { overflow-y: auto; padding: 14px 18px 24px; scrollbar-width: thin; }
    .ocf-right { border-left: 1px solid var(--crm-border); background: var(--crm-surface, #131210); overflow-y: auto; scrollbar-width: thin; }

    /* ── Add service button ── */
    .ocf-add-service { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 14px; margin-bottom: 12px; border: 1px dashed var(--crm-border); border-radius: 8px; background: transparent; color: var(--crm-accent, #f59e0b); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 120ms ease; mat-icon { font-size: 18px; width: 18px; height: 18px; } &:hover { background: rgba(245,158,11,0.06); border-color: var(--crm-accent); } }

    .ocf-empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 16px; color: var(--crm-text-muted); mat-icon { font-size: 32px; width: 32px; height: 32px; } span { font-size: 13px; } }

    .ocf-category-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; padding: 4px 0; }
    .ocf-category-card { display: flex; align-items: center; gap: 10px; padding: 14px 14px; border: 1px solid var(--crm-border); border-radius: 8px; background: var(--crm-surface, #131210); color: var(--crm-text-secondary); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 120ms ease; text-align: left; &:hover { border-color: var(--crm-accent); color: var(--crm-text-primary); background: rgba(245,158,11,0.06); } }
    .ocf-category-card-icon { font-size: 20px; width: 20px; height: 20px; color: var(--crm-accent); flex-shrink: 0; }
    .ocf-category-card-name { line-height: 1.3; }

    /* ── Combo hint in summary ── */
    .ocf-combo-hint {
      display: flex; align-items: flex-start; gap: 6px;
      padding: 8px 10px; margin: 6px 0;
      border-radius: 6px; background: rgba(245,158,11,0.06);
      border: 1px solid rgba(245,158,11,0.15);
      font-size: 11px; color: var(--crm-accent, #f59e0b);
      mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }
      span { line-height: 1.4; }
    }

    /* ── Service block ── */
    .ocf-block { margin-bottom: 12px; border: 1px solid var(--crm-border); border-radius: 8px; padding: 12px; background: var(--crm-surface, #131210); }
    .ocf-block-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent); } }
    .ocf-block-title { flex: 1; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .ocf-block-remove { width: 24px; height: 24px; border: none; border-radius: 4px; background: transparent; color: var(--crm-text-muted); cursor: pointer; display: grid; place-items: center; mat-icon { font-size: 16px; width: 16px; height: 16px; } &:hover { color: #ef4444; } }

    .ocf-section { margin-bottom: 18px; }
    .ocf-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--crm-text-muted); margin-bottom: 8px; }
    .ocf-label-hint { font-weight: 400; text-transform: none; letter-spacing: normal; opacity: 0.7; font-size: 10px; }

    /* ── Document list ── */
    .ocf-doc-list { display: flex; flex-direction: column; gap: 3px; }
    .ocf-doc-row { padding: 6px 10px; border-radius: 6px; border: 1px solid transparent; transition: all 120ms ease; }
    .ocf-doc-row--active { background: rgba(245,158,11,0.06); border-color: rgba(245,158,11,0.2); }
    .ocf-doc-check { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; font-weight: 500;
      input[type="checkbox"] { appearance: none; width: 16px; height: 16px; border: 1.5px solid var(--crm-text-muted); border-radius: 3px; background: transparent; cursor: pointer; flex-shrink: 0; display: grid; place-items: center; &:checked { background: var(--crm-accent); border-color: var(--crm-accent); &::after { content: '\\2713'; font-size: 11px; color: #0a0a0a; font-weight: 700; } } } }
    .ocf-doc-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); }
    .ocf-doc-row--active .ocf-doc-icon { color: var(--crm-accent); }
    .ocf-doc-name { flex: 1; }
    .ocf-doc-size { font-family: var(--crm-font-mono, monospace); font-size: 11px; color: var(--crm-text-muted); }

    .ocf-qty-row { display: flex; align-items: center; gap: 8px; margin: 4px 0 2px 32px; }
    .ocf-qty-label { font-size: 11px; color: var(--crm-text-muted); }
    .ocf-qty-stepper { display: flex; align-items: center; border: 1px solid var(--crm-border); border-radius: 4px; overflow: hidden; }
    .ocf-qty-stepper--inline { margin-left: auto; }
    .ocf-qty-btn { width: 24px; height: 22px; border: none; background: transparent; color: var(--crm-text-secondary); font: inherit; font-size: 13px; cursor: pointer; display: grid; place-items: center; &:hover { background: rgba(245,158,11,0.1); color: var(--crm-accent); } }
    .ocf-qty-value { width: 24px; text-align: center; font-family: var(--crm-font-mono, monospace); font-size: 12px; font-weight: 600; }
    .ocf-qty-hint { font-size: 10px; color: var(--crm-text-muted); }

    .ocf-size-row { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 2px 32px; align-items: center; }
    .ocf-size-chip { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--crm-border); background: transparent; color: var(--crm-text-secondary); font: inherit; font-size: 11px; font-weight: 500; font-family: var(--crm-font-mono, monospace); cursor: pointer; transition: all 100ms ease; &:hover { border-color: rgba(245,158,11,0.4); } }
    .ocf-size-chip--active { background: rgba(245,158,11,0.15); border-color: var(--crm-accent); color: var(--crm-accent); font-weight: 600; }
    .ocf-size-custom { padding: 2px 6px; border-radius: 4px; border: 1px solid var(--crm-border); background: transparent; color: var(--crm-text-primary); font: inherit; font-size: 11px; width: 68px; font-family: var(--crm-font-mono, monospace); &::placeholder { color: var(--crm-text-muted); } &:focus { outline: none; border-color: var(--crm-accent); } }
    .ocf-country-select { margin: 6px 0 0 32px; padding: 5px 8px; border-radius: 4px; border: 1px solid var(--crm-border); background: var(--crm-surface-base); color: var(--crm-text-primary); font: inherit; font-size: 12px; width: calc(100% - 32px); appearance: none; cursor: pointer; &:focus { outline: none; border-color: var(--crm-accent); } }

    .ocf-alert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 8px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); font-size: 12px; color: var(--crm-accent); margin: 10px 0; mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; } }
    .ocf-alert--warning { background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.25); color: #fca5a5; mat-icon { color: #ef4444; } }
    .ocf-alert-content { display: flex; flex-direction: column; gap: 4px; strong { color: #ef4444; font-size: 12px; } }
    .ocf-alert-list { margin: 2px 0 0; padding-left: 16px; li { margin-bottom: 2px; font-size: 11.5px; line-height: 1.4; } }

    .ocf-addons { display: flex; flex-direction: column; gap: 4px; }
    .ocf-addon { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--crm-border); cursor: pointer; transition: all 120ms ease; &:hover { border-color: rgba(255,255,255,0.1); }
      input[type="checkbox"], input[type="radio"] { appearance: none; width: 15px; height: 15px; border: 1.5px solid var(--crm-text-muted); border-radius: 3px; background: transparent; cursor: pointer; flex-shrink: 0; display: grid; place-items: center; &:checked { background: var(--crm-accent); border-color: var(--crm-accent); &::after { content: '\\2713'; font-size: 10px; color: #0a0a0a; font-weight: 700; } } }
      input[type="radio"] { border-radius: 50%; &:checked::after { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #0a0a0a; } }
    }
    .ocf-addon-radio { width: 15px; height: 15px; border: 1.5px solid var(--crm-text-muted); border-radius: 3px; flex-shrink: 0; display: grid; place-items: center; }
    .ocf-addon-radio--round { border-radius: 50%; }
    .ocf-addon-radio--checked { background: var(--crm-accent); border-color: var(--crm-accent); &::after { content: '\\2713'; font-size: 10px; color: #0a0a0a; font-weight: 700; } }
    .ocf-addon-radio--round.ocf-addon-radio--checked::after { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #0a0a0a; }
    .ocf-addon-info { flex: 1; display: flex; flex-direction: column; gap: 1px; }
    .ocf-addon-name { font-size: 12px; font-weight: 500; }
    .ocf-addon-hint { font-size: 10.5px; color: var(--crm-text-muted); }
    .ocf-addon--promo { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.04); }
    .ocf-addon--super { border-color: rgba(245,158,11,0.68); background: linear-gradient(135deg, rgba(245,158,11,0.16), rgba(245,158,11,0.05)); box-shadow: inset 0 0 0 1px rgba(245,158,11,0.22); padding: 10px 12px; }
    .ocf-addon--super:hover { border-color: var(--crm-accent, #f59e0b); }
    .ocf-addon--super .ocf-addon-name { font-size: 13px; font-weight: 650; }
    .ocf-addon-badge { font-size: 9px; font-weight: 700; color: #0a0a0a; background: var(--crm-accent, #f59e0b); padding: 1px 5px; border-radius: 3px; margin-left: 6px; text-transform: uppercase; }
    .ocf-addon-badge--super { font-size: 11.5px; font-weight: 800; background: linear-gradient(135deg, #fbbf24, #f59e0b); box-shadow: 0 0 0 1px rgba(245,158,11,0.45); padding: 3px 8px; border-radius: 4px; text-transform: none; white-space: nowrap; }
    .ocf-addon-super-note { display: block; margin-top: 4px; font-size: 12px; line-height: 1.35; color: #fbbf24; font-weight: 700; }
    .ocf-addon-price--old { text-decoration: line-through; opacity: 0.5; margin-right: 3px; }
    .ocf-addon-saving { color: #22c55e; font-weight: 600; margin-left: 4px; }

    /* ── Processing sub-options: extracted to <app-processing-sub-options> ── */
    .ocf-addon-desc { font-size: 9.5px; color: var(--crm-text-muted); opacity: 0.7; }
    .ocf-addon-features { font-size: 9.5px; color: var(--crm-text-muted); opacity: 0.65; display: block; margin-top: 1px; }
    .ocf-addon-detail { margin-left: 32px; padding: 8px 0; display: flex; flex-direction: column; gap: 6px; }
    .ocf-addon-detail-label { font-size: 11px; color: var(--crm-text-secondary); font-weight: 500; }

    .ocf-textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--crm-border); border-radius: 6px; background: var(--crm-surface, #131210); color: var(--crm-text-primary); font: inherit; font-size: 12.5px; resize: vertical; min-height: 48px; &:focus { outline: none; border-color: var(--crm-accent); } &::placeholder { color: var(--crm-text-muted); } }
    .ocf-textarea--sm { min-height: 36px; }

    /* ── Right panels ── */
    .ocf-panel { padding: 12px 14px; border-bottom: 1px solid var(--crm-border); }
    .ocf-panel--last { border-bottom: none; }
    .ocf-panel-title { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--crm-text-muted); margin-bottom: 8px; }

    .ocf-sum-line { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; margin-bottom: 3px; }
    .ocf-sum-name { color: var(--crm-text-secondary); }
    .ocf-sum-size { font-family: var(--crm-font-mono, monospace); font-size: 10px; color: var(--crm-text-muted); margin-left: 4px; }
    .ocf-sum-qty { font-family: var(--crm-font-mono, monospace); font-size: 10px; color: var(--crm-accent); margin-left: 3px; font-weight: 600; }
    .ocf-sum-price { font-family: var(--crm-font-mono, monospace); font-size: 12px; font-weight: 500; white-space: nowrap; }
    .ocf-sum-line--service { opacity: 0.7; font-style: italic; }
    .ocf-sum-empty { font-size: 12px; color: var(--crm-text-muted); font-style: italic; }
    .ocf-sum-divider { height: 1px; background: var(--crm-border); margin: 8px 0; }
    .ocf-sum-total { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; font-weight: 600; }
    .ocf-sum-total-value { font-family: var(--crm-font-display, 'Oswald'); font-size: 22px; color: var(--crm-accent, #f59e0b); display: flex; align-items: center; gap: 6px; }
    .ocf-sum-price--old { text-decoration: line-through; opacity: 0.5; font-size: 10px; margin-right: 4px; }
    .ocf-sum-discount { font-size: 10px; color: #22c55e; margin: -1px 0 4px; padding-left: 4px; }
    .ocf-sum-savings { display: flex; justify-content: space-between; font-size: 11px; color: #22c55e; font-weight: 500; padding: 4px 0; }

    /* ── Promo code ── */
    .ocf-promo { margin: 8px 0; }
    .ocf-promo-input-wrap { display: flex; align-items: center; gap: 6px; border: 1px solid var(--crm-border, rgba(255,255,255,0.06)); border-radius: 6px; padding: 5px 8px; transition: border-color 120ms ease; &:focus-within { border-color: var(--crm-accent, #f59e0b); } }
    .ocf-promo-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted, #7a7a7a); flex-shrink: 0; }
    .ocf-promo-input { flex: 1; border: none; background: transparent; color: var(--crm-text-primary, #ececec); font: inherit; font-size: 12px; outline: none; text-transform: uppercase; &::placeholder { color: var(--crm-text-muted, #7a7a7a); text-transform: none; } }
    .ocf-promo-spinner { flex-shrink: 0; }
    .ocf-promo-clear { display: grid; place-items: center; width: 20px; height: 20px; border: none; background: transparent; color: var(--crm-text-muted); cursor: pointer; padding: 0; mat-icon { font-size: 14px; width: 14px; height: 14px; } &:hover { color: var(--crm-text-primary); } }
    .ocf-promo-result { display: flex; align-items: flex-start; gap: 4px; margin-top: 4px; font-size: 11px; line-height: 1.3; mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; } }
    .ocf-promo-result--valid { color: #22c55e; }
    .ocf-promo-result--invalid { color: #ef4444; }
    .ocf-promo-result--blocked { color: var(--crm-accent, #f59e0b); }
    .ocf-promo-applied { display: flex; align-items: center; gap: 4px; margin-top: 4px; font-size: 11px; font-weight: 500; color: #22c55e; mat-icon { font-size: 14px; width: 14px; height: 14px; } }

    .ocf-priority-options { display: flex; flex-direction: column; gap: 4px; }
    .ocf-priority { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--crm-border); cursor: pointer; transition: all 120ms ease;
      input[type="radio"] { appearance: none; width: 14px; height: 14px; border: 1.5px solid var(--crm-text-muted); border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; &:checked { border-color: var(--crm-accent); &::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--crm-accent); } } } }
    .ocf-priority--active { border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.06); }
    .ocf-priority-name { font-size: 12.5px; font-weight: 500; }
    .ocf-priority-desc { font-size: 11px; color: var(--crm-text-muted); }

    .ocf-field { margin-bottom: 8px; &:last-child { margin-bottom: 0; } }
    .ocf-field-label { font-size: 10.5px; color: var(--crm-text-muted); margin-bottom: 3px; font-weight: 500; }
    .ocf-input { width: 100%; padding: 7px 10px; border: 1px solid var(--crm-border); border-radius: 6px; background: var(--crm-surface-base); color: var(--crm-text-primary); font: inherit; font-size: 13px; &:focus { outline: none; border-color: var(--crm-accent); box-shadow: 0 0 0 2px rgba(245,158,11,0.12); } &::placeholder { color: var(--crm-text-muted); } }
    .ocf-phone-wrap { display: flex; align-items: center; border: 1px solid var(--crm-border); border-radius: 6px; background: var(--crm-surface-base); overflow: hidden; &:focus-within { border-color: var(--crm-accent); box-shadow: 0 0 0 2px rgba(245,158,11,0.12); } }
    .ocf-phone-prefix { padding: 7px 0 7px 10px; font-size: 13px; font-weight: 600; color: var(--crm-text-secondary); user-select: none; flex-shrink: 0; }
    .ocf-input--phone { border: none; background: transparent; padding-left: 4px; &:focus { outline: none; box-shadow: none; } }
    .ocf-field-hint { display: flex; align-items: center; gap: 4px; font-size: 10.5px; margin-top: 3px; mat-icon { font-size: 13px; width: 13px; height: 13px; } }
    .ocf-field-hint--found { color: #22c55e; }

    .ocf-chat-linked { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2); mat-icon { font-size: 18px; color: var(--crm-accent); } }
    .ocf-chat-linked-info { flex: 1; }
    .ocf-chat-linked-name { font-size: 12px; font-weight: 500; display: block; }
    .ocf-chat-linked-hint { font-size: 10.5px; color: var(--crm-text-muted); }
    .ocf-chat-unlink { width: 24px; height: 24px; border: none; border-radius: 4px; background: transparent; color: var(--crm-text-muted); cursor: pointer; display: grid; place-items: center; mat-icon { font-size: 16px; width: 16px; height: 16px; } &:hover { color: #ef4444; } }
    .ocf-link-chat-btn { display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 10px; border: 1px dashed var(--crm-border); border-radius: 6px; background: transparent; color: var(--crm-text-secondary); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 120ms ease; mat-icon { font-size: 16px; width: 16px; height: 16px; } &:hover { border-color: var(--crm-accent); color: var(--crm-accent); background: rgba(245,158,11,0.04); } }

    .ocf-pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    .ocf-pay { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 9px; border-radius: 6px; border: 1px solid var(--crm-border); background: var(--crm-surface-base); color: var(--crm-text-secondary); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 120ms ease; mat-icon { font-size: 16px; width: 16px; height: 16px; } &:hover:not(:disabled) { border-color: var(--crm-accent); color: var(--crm-accent); } &:disabled { opacity: 0.35; cursor: not-allowed; } }
    .ocf-pay--primary { grid-column: 1 / -1; background: var(--crm-accent, #f59e0b); color: #0a0a0a; border-color: var(--crm-accent); font-size: 13px; font-weight: 600; padding: 11px; &:hover:not(:disabled) { background: #fbbf24; color: #0a0a0a; } }
    .ocf-auto-assign { display: flex; align-items: center; gap: 7px; margin-top: 10px; font-size: 12.5px; line-height: 1.35; color: var(--crm-text-secondary); mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--crm-accent, #f59e0b); } }

    /* ── Popup overlay ── */
    .ocf-popup-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; }
    .ocf-popup { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 440px; max-height: 520px; background: var(--crm-surface, #131210); border: 1px solid var(--crm-border); border-radius: 12px; z-index: 1001; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    .ocf-popup-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--crm-border); }
    .ocf-popup-title { margin: 0; font-family: var(--crm-font-display, 'Oswald', sans-serif); font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .ocf-popup-close { width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent; color: var(--crm-text-muted); cursor: pointer; display: grid; place-items: center; mat-icon { font-size: 18px; width: 18px; height: 18px; } &:hover { background: rgba(255,255,255,0.06); color: var(--crm-text-primary); } }
    .ocf-popup-search { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--crm-border); mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); flex-shrink: 0; } }
    .ocf-popup-search-input { flex: 1; border: none; background: transparent; color: var(--crm-text-primary); font: inherit; font-size: 13px; outline: none; &::placeholder { color: var(--crm-text-muted); } }
    .ocf-popup-list { flex: 1; overflow-y: auto; scrollbar-width: thin; }
    .ocf-popup-item { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 10px 16px; border: none; border-bottom: 1px solid rgba(255,255,255,0.04); background: transparent; color: var(--crm-text-secondary); font: inherit; font-size: 13px; cursor: pointer; text-align: left; transition: background 80ms ease; &:hover { background: rgba(245,158,11,0.06); color: var(--crm-text-primary); } &:last-child { border-bottom: none; } }
    .ocf-popup-item-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    .ocf-popup-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .ocf-popup-item-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .ocf-popup-item-name { font-weight: 600; font-size: 13px; color: var(--crm-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ocf-popup-item-time { font-size: 10px; color: var(--crm-text-muted); flex-shrink: 0; }
    .ocf-popup-item-sub { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ocf-popup-item-badge { font-size: 10px; font-weight: 600; line-height: 1; padding: 2px 6px; border: 1px solid; border-radius: 4px; opacity: 0.9; white-space: nowrap; }
    .ocf-popup-item-phone { font-size: 11px; color: var(--crm-text-muted); font-variant-numeric: tabular-nums; }
    .ocf-popup-item-preview { font-size: 11px; color: var(--crm-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; }
    .ocf-popup-empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 32px 16px; font-size: 13px; color: var(--crm-text-muted); mat-icon { font-size: 20px; width: 20px; height: 20px; } }

    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }

    /* ── Draft indicator ── */
    .ocf-draft-indicator { font-size: 10px; color: var(--crm-text-muted, #7a7a7a); margin-left: 8px; white-space: nowrap; }
    .ocf-draft-indicator--saving { opacity: 0.6; }
    .ocf-draft-warning { display: flex; align-items: center; gap: 8px; padding: 6px 16px; background: rgba(239,68,68,0.08); border-bottom: 1px solid rgba(239,68,68,0.2); font-size: 11px; color: #fca5a5; flex-shrink: 0; mat-icon { font-size: 15px; width: 15px; height: 15px; color: #ef4444; flex-shrink: 0; } span { flex: 1; } }
    .ocf-draft-warning-btn { padding: 2px 8px; border: 1px solid rgba(239,68,68,0.3); border-radius: 4px; background: transparent; color: #fca5a5; font: inherit; font-size: 10px; cursor: pointer; white-space: nowrap; &:hover { background: rgba(239,68,68,0.15); } }
  `],
})
export class OrderCreationFormComponent {
  readonly dialogClientName = input('');
  readonly dialogPhone = input('');
  readonly dialogSessionId = input('');

  readonly closed = output<void>();
  readonly orderCreated = output<{ orderId: string; orderNumber: string }>();

  protected readonly store = inject(OrderCreationFormStore);

  protected readonly channelIcon = channelIcon;
  protected readonly channelLabel = channelLabel;
  protected readonly channelColor = channelColor;
  private readonly dialog = inject(MatDialog);

  constructor() {
    effect(() => {
      const phone = this.dialogPhone();
      const name = this.dialogClientName();
      const sessionId = this.dialogSessionId();
      if (phone || name || sessionId) this.store.initFromContext(phone, name, sessionId);
    });
  }

  asVal(event: Event): string { return (event.target as HTMLInputElement).value; }

  /** Adapter callback для ProcessingSubOptionsComponent (captures blockId). */
  isSubOptionDisabledFn(blockId: string): (label: string) => boolean {
    return (label: string) => this.store.isSubOptionDisabled(blockId, label);
  }

  async onPay(method: PaymentMethod): Promise<void> {
    if (!this.store.canSubmit()) return;
    this.store.warnIfLaterPaymentWithoutChat(method);

    const confirmed = await this.confirmWarningsBeforeSubmit();
    if (!confirmed) return;

    const result = await this.store.submitPayment(method);
    if (result) { this.orderCreated.emit(result); this.closed.emit(); }
  }

  private async confirmWarningsBeforeSubmit(): Promise<boolean> {
    if (this.store.linkedSessionId()) {
      const chatName = this.store.linkedSessionName() || 'выбранный чат';
      const keepChat = await this.openWarningConfirm({
        title: 'Проверьте чат клиента',
        message: `Привязать к задаче чат «${chatName}»? Если выбран не тот чат, смените привязку перед созданием заказа.`,
        confirmLabel: 'Да, этот чат',
        cancelLabel: 'Сменить чат',
        icon: 'warning',
        warn: true,
      });

      if (!keepChat) {
        this.store.openChatPicker();
        return false;
      }
    }

    if (this.store.clientFiles().length === 0) {
      const continueWithoutPhoto = await this.openWarningConfirm({
        title: 'Нет фото клиента',
        message: 'Вы не загрузили фотографию клиента. Точно продолжить без фотографии?',
        confirmLabel: 'Продолжить без фото',
        cancelLabel: 'Вернуться',
        icon: 'warning',
        warn: true,
      });

      if (!continueWithoutPhoto) return false;
    }

    return true;
  }

  private async openWarningConfirm(data: ConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data,
        width: '420px',
      },
    );

    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
