import { Component, OnInit, inject, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { LoggerService } from '../../../../core/services/logger.service';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule, isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-legacy-debug',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div style="padding: 20px; font-family: monospace;">
      <h2>Legacy URL Debug Component</h2>
      <p><strong>URL:</strong> {{ currentUrl }}</p>
      <p><strong>Route params:</strong> {{ routeParams | json }}</p>
      <p><strong>URL segments:</strong> {{ urlSegments | json }}</p>
      <p><strong>Extracted code:</strong> {{ photoCode }}</p>
      <button (click)="goToPhoto()">Go to /photo/{{ photoCode }}</button>
    </div>
  `
})
export class LegacyDebugComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);

  currentUrl = '';
  routeParams: Record<string, string> = {};
  urlSegments: string[] = [];
  photoCode = '';

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.currentUrl = window.location.pathname;
    }
    this.routeParams = this.route.snapshot.params;
    this.urlSegments = this.route.snapshot.url.map(segment => segment.path);
    
    // Пробуем получить код из параметров
    this.photoCode = this.route.snapshot.paramMap.get('code') || '';
    
    this.log.debug('Legacy Debug Component initialized');
    this.log.debug('Current URL:', this.currentUrl);
    this.log.debug('Route params:', this.routeParams);
    this.log.debug('URL segments:', this.urlSegments);
    this.log.debug('Photo code:', this.photoCode);
  }
  
  goToPhoto(): void {
    if (this.photoCode) {
      this.router.navigate(['/photo', this.photoCode]);
    }
  }
}
