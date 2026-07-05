import { Component, inject, PLATFORM_ID, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-test-redirect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="padding: 20px;">
      <h1>Test Redirect Component</h1>
      <p>Current URL: {{ currentUrl }}</p>
      <p>Should redirect to: /photo/{{ code }}</p>
      <button (click)="doRedirect()">Manual Redirect</button>
    </div>
  `,
  
})
export class TestRedirectComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  currentUrl = '';
  code = 'BjRr6';

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.currentUrl = window.location.pathname;
    }
  }

  doRedirect() {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `/photo/${this.code}`;
    }
  }
}
