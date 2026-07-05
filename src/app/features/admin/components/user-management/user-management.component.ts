import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthService, UserProfile } from '../../../../core/services/auth.service';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-user-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="user-management-container">
      <h2>Управление пользователями</h2>
      @if (users(); as usersList) {
        <table>
          <thead>
            <tr>
              <th>ID пользователя</th>
              <th>Email</th>
              <th>Роль</th>
              <th>Изменить роль</th>
            </tr>
          </thead>
          <tbody>
            @for (user of usersList; track user.uid || user.id || $index) {
              <tr>
                <td>{{ user.uid }}</td>
                <td>{{ user.email }}</td>
                <td>{{ user.role }}</td>
                <td>
                  <select (change)="onRoleChange($event, user)">
                    <option [value]="'client'" [selected]="user.role === 'client'">client</option>
                    <option [value]="'photographer'" [selected]="user.role === 'photographer'">photographer</option>
                    <option [value]="'admin'" [selected]="user.role === 'admin'">admin</option>
                  </select>
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p>Загрузка пользователей...</p>
      }
    </div>
  `,
  styles: [`
    .user-management-container {
      padding: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid var(--crm-border);
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: var(--crm-surface-raised);
    }
  `]
})
export class UserManagementComponent {
  private authService = inject(AuthService);
  private log = inject(LoggerService);

  // Конвертируем Observable в signal
  readonly users = toSignal(this.authService.getAllUsers(), { initialValue: [] as UserProfile[] });

  onRoleChange(event: Event, user: UserProfile): void {
    const target = event.target as HTMLSelectElement;
    const newRole = target.value as 'admin' | 'employee' | 'client' | 'photographer';
    const userId = user.id || user.uid;
    if (!userId) {
      this.log.error('User ID is missing');
      return;
    }
    this.authService.updateUserRole(userId, newRole).subscribe({
      next: () => this.log.debug(`Role for user ${userId} updated to ${newRole}`),
      error: (err) => this.log.error(`Failed to update role for user ${userId}`, err)
    });
  }
}
