import { Pipe, type PipeTransform, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { maskPhonesInText } from '../utils/phone-mask';

@Pipe({ name: 'maskPhonesInText', standalone: true })
export class MaskPhonesInTextPipe implements PipeTransform {
  private readonly auth = inject(AuthService);

  transform(text: string | null | undefined): string {
    if (!text) return '';
    if (this.auth.isAdmin()) return text;
    return maskPhonesInText(text);
  }
}
