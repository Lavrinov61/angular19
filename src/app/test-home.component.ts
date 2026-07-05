import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-test-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <h1>SSR Test Page</h1>
      <p>Если вы видите этот текст, значит SSR работает!</p>
      <p>Время рендеринга: {{ renderTime }}</p>
    </div>
  `,
  styles: [`
    div {
      padding: 20px;
      text-align: center;
    }
    h1 {
      color: #0066cc;
    }
  `]
})
export class TestHomeComponent {
  renderTime = new Date().toISOString();
}
