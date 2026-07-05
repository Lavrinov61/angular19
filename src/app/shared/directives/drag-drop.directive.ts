import { Directive, output, signal } from '@angular/core';

/**
 * Директива для реализации функциональности перетаскивания файлов.
 * Используется для добавления drag & drop функциональности на любой элемент.
 */
@Directive({
  selector: '[appDragDrop]',
  
  host: {
    '[class.file-over]': 'fileOver()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)'
  }
})
export class DragDropDirective {
  fileOver = signal<boolean>(false);
  readonly fileDropped = output<FileList>();

  /**
   * Слушатель события dragover
   */
  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.fileOver.set(true);
  }

  /**
   * Слушатель события dragleave
   */
  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.fileOver.set(false);
  }

  /**
   * Слушатель события drop - когда файл сброшен в область
   */
  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.fileOver.set(false);
    
    if (event.dataTransfer?.files.length) {
      this.fileDropped.emit(event.dataTransfer.files);
    }
  }
}
