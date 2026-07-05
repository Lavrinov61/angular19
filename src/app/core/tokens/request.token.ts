import { InjectionToken } from '@angular/core';
import { Request } from 'express';

/**
 * Токен для инъекции Express-запроса в Angular-приложение при SSR
 * Используется для доступа к заголовкам и данным HTTP-запроса на сервере
 */
export const REQUEST = new InjectionToken<Request>('SERVER_REQUEST');
