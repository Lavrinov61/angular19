/**
 * Утилита для загрузки переменных окружения из .env файла
 * или из других источников (Secret Manager, Environment Variables и т.д.)
 */

// Conditional imports for Node.js modules based on platform
import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';
import { fs, path, process as nodeProcess } from './server-module-proxy';

// dotenv is only available on server-side, using dynamic import
interface DotenvConfig { error?: Error; parsed?: Record<string, string> }
interface GlobalWithRequire { require?: (id: string) => unknown }
let dotenv: { config: (options: { path: string }) => DotenvConfig } | null = null;

// Function to initialize dotenv module safely
function initDotenv(): void {
  try {
    // Try to load dotenv only on server
    const g = globalThis as GlobalWithRequire;
    if (g.require) {
      dotenv = g.require('dotenv') as typeof dotenv;
    }
  } catch {
    // dotenv not available, that's ok
    dotenv = null;
  }
}

/**
 * Загружает переменные окружения из .env файла
 * @returns true если файл был загружен, false в противном случае
 */
export function loadEnvironmentVariables(): boolean {
  const platformId = inject(PLATFORM_ID);
  
  // Загружаем переменные только на сервере
  if (!isPlatformServer(platformId)) {
    return false;
  }

  // Initialize dotenv on server
  if (isPlatformServer(platformId)) {
    initDotenv();
  }

  try {
    // Определяем путь к .env файлу
    const envPath = path.resolve(nodeProcess.cwd(), '.env');
    
    // Проверяем, существует ли файл
    if (!fs.existsSync(envPath)) {
      return false;
    }

    if (!dotenv) {
      return false;
    }

    const result = dotenv.config({ path: envPath });

    if (result.error) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Получает значение переменной окружения или значение по умолчанию
 * @param name Имя переменной окружения
 * @param defaultValue Значение по умолчанию
 * @returns Значение переменной окружения или значение по умолчанию
 */
export function getEnvVariable(name: string, defaultValue = ''): string {
  return nodeProcess.env[name] || defaultValue;
}

/**
 * Получает числовое значение переменной окружения или значение по умолчанию
 * @param name Имя переменной окружения
 * @param defaultValue Значение по умолчанию
 * @returns Числовое значение переменной окружения или значение по умолчанию
 */
export function getNumericEnvVariable(name: string, defaultValue = 0): number {
  const value = nodeProcess.env[name];
  if (value === undefined) return defaultValue;
  
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Получает булево значение переменной окружения или значение по умолчанию
 * @param name Имя переменной окружения
 * @param defaultValue Значение по умолчанию
 * @returns Булево значение переменной окружения или значение по умолчанию
 */
export function getBooleanEnvVariable(name: string, defaultValue = false): boolean {
  const value = nodeProcess.env[name];
  if (value === undefined) return defaultValue;
  
  return value.toLowerCase() === 'true';
}

/**
 * Проверяет, запущен ли сервер в режиме разработки
 * @returns true если сервер запущен в режиме разработки, false в противном случае
 */
export function isDevelopmentMode(): boolean {
  return getEnvVariable('NODE_ENV', 'production').toLowerCase() === 'development';
}
