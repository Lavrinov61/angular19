import {
  Component, ChangeDetectionStrategy, output, signal,
  viewChild, ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-pos-search-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule],
  host: { class: 'pos-search-bar' },
  template: `
    <mat-form-field appearance="outline" class="full-width search-field">
      <mat-icon matPrefix>search</mat-icon>
      <input matInput [ngModel]="query()" (ngModelChange)="onInput($event)"
             placeholder="Поиск или штрихкод..." #searchInput>
      @if (query()) {
        <button matSuffix mat-icon-button (click)="clear()">
          <mat-icon>close</mat-icon>
        </button>
      }
    </mat-form-field>
  `,
  styles: [`
    :host {
      display: block;
      padding: 8px 12px 0;
    }
    .full-width { width: 100%; }
    .search-field {
      :host ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    }
  `],
})
export class PosSearchBarComponent {
  readonly searchChanged = output<string>();
  readonly barcodeScanned = output<string>();

  readonly query = signal('');
  readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  onInput(value: string): void {
    this.query.set(value);
    this.searchChanged.emit(value);

    if (value.length >= 8 && /^\d+$/.test(value)) {
      this.barcodeScanned.emit(value);
    }
  }

  clear(): void {
    this.query.set('');
    this.searchChanged.emit('');
    this.inputRef()?.nativeElement?.focus();
  }

  focus(): void {
    this.inputRef()?.nativeElement?.focus();
  }
}
