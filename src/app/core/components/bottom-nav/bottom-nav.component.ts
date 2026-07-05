import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { NavItem } from '../../data/nav.data';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-bottom-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatRippleModule,
    RouterLink,
    RouterLinkActive
  ],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss'
})
export class BottomNavComponent {
  private router = inject(Router);
  readonly authService = inject(AuthService);

  navItems: NavItem[] = [
    { label: 'Главная', href: '/', icon: 'home', activeIcon: 'home' },
    { label: 'Услуги', href: '/services', icon: 'business_center', activeIcon: 'business_center' },
    { label: 'Запись', href: '/booking', icon: 'event', activeIcon: 'event' },
  ];

  isActive(itemHref: string): boolean {
    if (itemHref === '/' && this.router.url === '/') {
      return true;
    }
    return itemHref !== '/' && this.router.url.startsWith(itemHref);
  }

  trackByHref(_index: number, item: NavItem): string {
    return item.href;
  }
}
