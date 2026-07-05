import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { ServerHttpInterceptor } from './core/interceptors/server-http.interceptor';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // IMPORTANT: provideClientHydration() должен быть явно включен в server config
    // согласно документации Angular (llms-full.txt, строка 11423)
    provideClientHydration(withIncrementalHydration()),
    // DI-based interceptor для SSR - преобразует относительные URL в абсолютные
    { provide: HTTP_INTERCEPTORS, useClass: ServerHttpInterceptor, multi: true }
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
