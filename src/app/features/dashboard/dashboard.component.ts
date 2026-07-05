import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {
  private authService = inject(AuthService);
  // Signals from auth service
  user = this.authService.user;
  profile = this.authService.profile;
  isLoading = this.authService.loading;

  /**
   * Handle user logout
   */
  async onLogout(): Promise<void> {
    try {
      await this.authService.signOut();
    } catch {
      // logout failed, ignore
    }
  }

  /**
   * Get user display name
   */
  getUserDisplayName(): string {
    const user = this.user();
    if (user?.displayName) {
      return user.displayName;
    } else if (user?.email) {
      return user.email.split('@')[0];
    }
    return 'Пользователь';
  }

  /**
   * Get user avatar URL
   */
  getUserAvatarUrl(): string | null {
    return this.user()?.photoURL || null;
  }
}
