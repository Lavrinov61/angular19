import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService, ApiResponse } from './api.service';
import { AuthService } from './auth.service';

// Interfaces can remain largely the same, as they define the data structure
// we want to work with in the app.
export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  photoURL?: string;
  role: 'admin' | 'employee' | 'client' | 'photographer';
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  accountType?: 'personal' | 'education' | 'business';
  account_type?: 'personal' | 'education' | 'business';
  createdAt: string;
  updatedAt: string;
  preferences?: unknown;
  personalData?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    preferences?: unknown;
  };
  linkedAccounts?: {
    google?: boolean;
    apple?: boolean;
    microsoft?: boolean;
    facebook?: boolean;
    twitter?: boolean;
  };
}

export interface UpdateUserRequest {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string; // Для обратной совместимости, будет преобразовано в phone
  phone?: string;
  photoURL?: string; // Для обратной совместимости, будет преобразовано в photo_url
  photo_url?: string;
  accountType?: 'personal' | 'education' | 'business';
  account_type?: 'personal' | 'education' | 'business';
  preferences?: unknown;
  personalData?: unknown; // Для обратной совместимости, будет преобразовано в personal_data
  personal_data?: unknown;
}

/**
 * User API Service - Мигрирован на REST API
 */
@Injectable({
  providedIn: 'root'
})
export class UserApiService {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  
  private isLoadingSignal = signal<boolean>(false);
  private errorSignal = signal<string>('');

  public readonly isLoading = this.isLoadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();
  
  /**
   * Обновить профиль текущего пользователя через REST API
   */
  updateCurrentUserProfile(userData: Partial<UpdateUserRequest>): Observable<ApiResponse<User>> {
    this.isLoadingSignal.set(true);
    const currentUser = this.authService.getCurrentUser();

    if (!currentUser) {
      this.isLoadingSignal.set(false);
      const errorResponse = { success: false, message: 'No authenticated user found.' };
      return of(errorResponse as ApiResponse<User>);
    }

    // Преобразуем camelCase в snake_case для API
    const apiData: Record<string, unknown> = { ...userData };
    if (apiData['phoneNumber'] !== undefined) {
      apiData['phone'] = apiData['phoneNumber'];
      delete apiData['phoneNumber'];
    }
    if (apiData['photoURL'] !== undefined) {
      apiData['photo_url'] = apiData['photoURL'];
      delete apiData['photoURL'];
    }
    if (apiData['personalData'] !== undefined) {
      apiData['personal_data'] = apiData['personalData'];
      delete apiData['personalData'];
    }
    if (apiData['accountType'] !== undefined) {
      apiData['account_type'] = apiData['accountType'];
      delete apiData['accountType'];
    }

    return this.apiService.put<User>('/users/me', apiData).pipe(
      map(response => {
        this.isLoadingSignal.set(false);
        return response;
      }),
      catchError(error => {
        this.isLoadingSignal.set(false);
        const errorMessage = error.error?.message || error.message || 'Failed to update profile';
        this.errorSignal.set(errorMessage);
        return of({ success: false, message: errorMessage } as ApiResponse<User>);
      })
    );
  }

  // --- Deprecated Methods ---
  // The methods below are not implemented for Firestore yet.
  // They will log a warning and return an error.

  private notImplemented<T>(): Observable<T> {
    return throwError(() => new Error('This method is not implemented for Firestore yet.'));
  }

  getUsers(_params?: Record<string, unknown>): Observable<unknown> { return this.notImplemented(); }
  getUserById(_id: string): Observable<unknown> { return this.notImplemented(); }
  createUser(_userData: Record<string, unknown>): Observable<unknown> { return this.notImplemented(); }
  updateUser(_id: string, _userData: Record<string, unknown>): Observable<unknown> { return this.notImplemented(); }
  patchUser(_id: string, _userData: Record<string, unknown>): Observable<unknown> { return this.notImplemented(); }
  deleteUser(_id: string): Observable<unknown> { return this.notImplemented(); }
  getCurrentUserProfile(): Observable<unknown> { return this.notImplemented(); }
  changePassword(_oldPassword: string, _newPassword: string): Observable<unknown> { return this.notImplemented(); }
  verifyEmail(_token: string): Observable<unknown> { return this.notImplemented(); }
  sendPhoneVerification(_phone: string): Observable<unknown> { return this.notImplemented(); }
  verifyPhone(_phone: string, _code: string): Observable<unknown> { return this.notImplemented(); }
  uploadProfilePhoto(_file: File): Observable<unknown> { return this.notImplemented(); }
  getUsersByRole(_role: string, _params?: Record<string, unknown>): Observable<unknown> { return this.notImplemented(); }
  searchUsers(_query: string, _params?: Record<string, unknown>): Observable<unknown> { return this.notImplemented(); }
  toggleUserStatus(_id: string, _isActive: boolean): Observable<unknown> { return this.notImplemented(); }
  changeUserRole(_id: string, _role: string): Observable<unknown> { return this.notImplemented(); }
  getUserStats(): Observable<unknown> { return this.notImplemented(); }
}
