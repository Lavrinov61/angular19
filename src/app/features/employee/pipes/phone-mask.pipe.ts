import { Pipe, type PipeTransform, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { maskPhone } from '../utils/phone-mask';

@Pipe({ name: 'phoneMask', standalone: true })
export class PhoneMaskPipe implements PipeTransform {
  private readonly auth = inject(AuthService);

  transform(phone: string | null | undefined): string | null {
    if (!phone) return null;
    if (this.auth.isAdmin()) return phone;
    return maskPhone(phone);
  }
}
