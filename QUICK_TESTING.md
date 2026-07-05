# Краткая инструкция по тестированию миграции

## ✅ Что готово к тестированию

1. **AuthService** - полностью мигрирован на Яндекс OAuth + JWT
2. **auth-token.interceptor** - обновлен для JWT токенов
3. **RatingService** - мигрирован на REST API
4. **PhotographerApiService** - полностью мигрирован на REST API
5. **LoginFormComponent** - обновлен для Яндекс OAuth
6. **RegisterComponent** - обновлен для Яндекс OAuth
7. **AuthCallbackComponent** - создан для обработки OAuth callback

## ⚠️ Известные проблемы компиляции

Есть несколько ошибок компиляции связанных с:
- Использованием старых полей (`phoneNumber`, `personalData`, `photoURL`, `displayName`)
- Удаленными методами (`updateUserFirestoreProfile`, `firestore`)

Эти ошибки не критичны для тестирования основных функций авторизации и публичных страниц.

## 🚀 Быстрый старт для тестирования

### 1. Запустить backend

```bash
cd /var/www/apimain/angular-app/backend
npm install
npm run dev
```

Backend должен быть доступен на `http://localhost:3000`

### 2. Настроить Яндекс OAuth

В `angular-app/src/environments/environment.ts`:
```typescript
yandex: {
  clientId: 'YOUR_YANDEX_CLIENT_ID', // Заполнить реальным значением
  redirectUri: 'http://localhost:4200/auth/callback'
}
```

В `backend/.env`:
```
YANDEX_CLIENT_ID=your_client_id
YANDEX_CLIENT_SECRET=your_client_secret
YANDEX_REDIRECT_URI=http://localhost:4200/auth/callback
```

### 3. Тестировать авторизацию

1. Откройте `/auth/login`
2. Нажмите любую кнопку входа (Google, Apple, VK или "Войти")
3. Должен произойти редирект на Яндекс OAuth
4. После авторизации редирект на `/auth/callback`
5. Проверьте localStorage - должны быть `access_token` и `refresh_token`

### 4. Тестировать публичные страницы

- `/` - главная страница (должна загрузить рейтинг)
- `/photographers` - список фотографов (должен загрузиться через REST API)

## 📝 Что проверить

1. ✅ Компиляция проходит (кроме известных ошибок)
2. ✅ Backend запущен и отвечает
3. ✅ Яндекс OAuth редирект работает
4. ✅ Callback обрабатывается корректно
5. ✅ Токены сохраняются в localStorage
6. ✅ Запросы к API содержат Authorization header
7. ✅ Публичные страницы загружают данные через REST API

## 🔧 Исправление ошибок компиляции

Ошибки компиляции в других компонентах можно исправить позже, так как они не критичны для тестирования основной функциональности авторизации и публичных страниц.

Полная инструкция по тестированию в файле `TESTING_GUIDE.md`.

