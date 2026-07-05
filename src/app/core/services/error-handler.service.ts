
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { LoggerService, ContextLogger } from './logger.service';

type ErrorMessages = Record<string, string>;

@Injectable({
  providedIn: 'root'
})
export class ErrorHandlerService {
  // HTTP ошибки (заменяют Firebase Auth ошибки)
  private httpAuthErrors: ErrorMessages = {
    '401': 'Требуется авторизация',
    '403': 'Доступ запрещен',
    '404': 'Пользователь не найден',
    '409': 'Этот email уже используется другим аккаунтом',
    '422': 'Неверный формат данных',
    '429': 'Слишком много запросов. Пожалуйста, попробуйте позже',
    'network-error': 'Ошибка сети. Пожалуйста, проверьте подключение к Интернету'
  };

  // HTTP Storage ошибки (заменяют Firebase Storage ошибки)
  private httpStorageErrors: ErrorMessages = {
    '403': 'У вас нет прав на доступ к этому хранилищу',
    '404': 'Файл не найден',
    '413': 'Размер файла превышает допустимый лимит',
    '415': 'Неподдерживаемый тип файла',
    '500': 'Ошибка сервера при загрузке файла',
    'network-error': 'Ошибка сети при загрузке файла'
  };

  // HTTP Database ошибки (заменяют Firestore ошибки)
  private httpDatabaseErrors: ErrorMessages = {
    '400': 'Неверный запрос',
    '403': 'Недостаточно прав для выполнения операции',
    '404': 'Документ не найден',
    '409': 'Документ уже существует',
    '422': 'Ошибка валидации данных',
    '500': 'Внутренняя ошибка сервера',
    '503': 'Сервис временно недоступен',
    'network-error': 'Ошибка сети при выполнении запроса'
  };

  // Общие ошибки
  private commonErrors: ErrorMessages = {
    'network-error': 'Ошибка сети. Пожалуйста, проверьте подключение к Интернету',
    'timeout': 'Превышено время ожидания запроса',
    'server-error': 'Ошибка сервера. Пожалуйста, попробуйте позже',
    'unknown-error': 'Произошла неизвестная ошибка',
    'file-too-large': 'Размер файла превышает допустимый лимит',
    'invalid-file-type': 'Неподдерживаемый тип файла',
    'validation-error': 'Ошибка валидации данных'
  };

  private snackBar = inject(MatSnackBar);
  private readonly log: ContextLogger = inject(LoggerService).createChild('ErrorHandler');

  /**
   * Обработать ошибку и показать соответствующее сообщение
   * @param error Объект ошибки
   * @param defaultMessage Сообщение по умолчанию
   * @param duration Продолжительность показа сообщения в мс
   */
  handleError(error: unknown, defaultMessage = 'Произошла ошибка', duration = 5000): void {
    this.log.error(error instanceof HttpErrorResponse
      ? `HTTP ${error.status} ${error.url || ''}`
      : (error instanceof Error ? error.message : defaultMessage), {
      type: error instanceof HttpErrorResponse ? 'http' : 'js',
      httpStatus: error instanceof HttpErrorResponse ? error.status : undefined,
      httpUrl: error instanceof HttpErrorResponse ? error.url : undefined,
    });
    
    let errorMessage = defaultMessage;
    
    if (error instanceof HttpErrorResponse) {
      // Обработка HTTP ошибок
      const status = error.status.toString();
      
      // Проверяем категорию ошибки по URL или контексту
      const url = error.url || '';
      if (url.includes('/auth/') || url.includes('/login') || url.includes('/register')) {
        errorMessage = this.httpAuthErrors[status] || this.getHttpStatusMessage(error.status);
      } else if (url.includes('/files/') || url.includes('/upload')) {
        errorMessage = this.httpStorageErrors[status] || this.getHttpStatusMessage(error.status);
      } else {
        errorMessage = this.httpDatabaseErrors[status] || this.getHttpStatusMessage(error.status);
      }
      
      if (error.error?.message) {
        errorMessage = error.error.message;
      }
    } else if (error instanceof Error) {
      // Обработка обычных JS ошибок
      errorMessage = error.message || defaultMessage;
    } else if (typeof error === 'string') {
      // Если ошибка передана как строка
      errorMessage = error;
    }
    
    // Показать SnackBar с сообщением об ошибке
    this.showErrorMessage(errorMessage, duration);
  }
  
  /**
   * Получить сообщение об ошибке по HTTP статусу
   */
  private getHttpStatusMessage(status: number): string {
    switch (status) {
      case 400:
        return 'Неверный запрос';
      case 401:
        return 'Требуется авторизация';
      case 403:
        return 'Доступ запрещен';
      case 404:
        return 'Ресурс не найден';
      case 409:
        return 'Конфликт данных';
      case 413:
        return 'Размер файла превышает допустимый лимит';
      case 415:
        return 'Неподдерживаемый тип файла';
      case 422:
        return 'Ошибка валидации данных';
      case 429:
        return 'Слишком много запросов. Пожалуйста, попробуйте позже';
      case 500:
        return 'Внутренняя ошибка сервера';
      case 503:
        return 'Сервис временно недоступен';
      default:
        return `Ошибка HTTP: ${status}`;
    }
  }
  
  /**
   * Показать сообщение об ошибке
   * @param message Сообщение
   * @param duration Продолжительность в мс
   */
  showErrorMessage(message: string, duration = 5000): void {
    this.snackBar.open(message, 'Закрыть', {
      duration: duration,
      panelClass: ['error-snackbar']
    });
  }
  
  /**
   * Показать сообщение об успехе
   * @param message Сообщение
   * @param duration Продолжительность в мс
   */
  showSuccessMessage(message: string, duration = 3000): void {
    this.snackBar.open(message, 'OK', {
      duration: duration,
      panelClass: ['success-snackbar']
    });
  }
}
