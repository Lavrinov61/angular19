import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

// Production: глушим console.log/debug для посетителей.
// LoggerService использует сохранённые native-методы для контролируемого вывода.
// Отладка на проде: localStorage.setItem('debug', 'true') + F5
if (environment.production && typeof window !== 'undefined') {
  const win = window as unknown as Record<string, unknown>;
  win['__nativeLog'] = console.log.bind(console);
  win['__nativeDebug'] = console.debug.bind(console);

  if (localStorage.getItem('debug') !== 'true') {
    const noop = () => { /* noop */ };
    console.log = noop;
    console.debug = noop;
  }
}

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
