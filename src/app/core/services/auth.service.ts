import { Injectable, inject, signal, computed, PLATFORM_ID, Injector } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  Observable,
  of,
  tap,
  catchError,
  map,
  throwError,
  firstValueFrom,
  finalize,
  shareReplay,
  switchMap,
} from 'rxjs';
import { ApiService } from './api.service';
import { FingerprintService } from './fingerprint.service';

export type StudentDiscountStatus = 'active' | 'expired' | 'revoked' | (string & {});

export interface StudentDiscountAccount {
  status: StudentDiscountStatus;
  source_token: string;
  activated_at: string;
  expires_at: string;
  print_sheets_limit: number;
  print_sheets_used: number;
  print_sheets_remaining: number;
  print_sheet_price: number;
  max_print_fill_percent: number;
  photo_limit: number;
  photo_used: number;
  photo_remaining: number;
  allowance_period_id?: string | null;
  allowance_period_start?: string | null;
  allowance_period_end?: string | null;
  binding_limit: number;
  binding_uses: number;
  binding_remaining: number;
}

export interface PrivacyConsentPayload {
  documentType: string;
  documentVersion: string;
  scope: string[];
  source: string;
  accepted?: boolean;
  visitorId?: string;
  details?: {
    registrationMethod?: string;
    uiSurface?: string;
    [key: string]: unknown;
  };
}

interface DeleteAccountResponse {
  id: string;
  deleted: boolean;
}

// UserProfile interface compatible with previous Firebase structure
export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  photo_url?: string;
  role?: 'admin' | 'manager' | 'employee' | 'client' | 'photographer';
  email_verified?: boolean;
  phone_verified?: boolean;
  is_active?: boolean;
  account_type?: 'personal' | 'education' | 'business';
  accountType?: 'personal' | 'education' | 'business';
  pin_enabled?: boolean;
  pinEnabled?: boolean;
  personal_data?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    preferences?: Record<string, unknown>;
  };
  preferences?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  // 2FA
  two_factor_enabled?: boolean;
  two_factor_method?: 'sms' | 'telegram';
  // Backward compatibility aliases for Firebase-style properties
  displayName?: string; // Alias for display_name
  photoURL?: string; // Alias for photo_url
  emailVerified?: boolean; // Alias for email_verified
  phoneVerified?: boolean; // Alias for phone_verified
  uid?: string; // Alias for id (Firebase compatibility)
  // Связанные аккаунты социальных сетей
  linkedAccounts?: Record<string, boolean>;
  // Pending approvals count for notification badge
  pendingApprovals?: number;
  student_discount?: StudentDiscountAccount | null;
  studentDiscount?: StudentDiscountAccount | null;
}

export interface RequiredProfileFields {
  displayName: boolean;
  phone: boolean;
}

export interface RequiredProfileFieldsOptions {
  forcePhone?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface RefreshAccessTokenOptions {
  redirectOnFailure?: boolean;
}

export interface ClientPinStatus {
  enabled: boolean;
  setupAvailable: boolean;
  unlockRequired: boolean;
  lockedUntil: string | null;
}

export interface ClientPinUnlockResult {
  tokens: AuthTokens;
  user: UserProfile;
}

/** OAuth provider info as returned by GET /api/auth/providers */
export interface OAuthProvider {
  id: string;
  name: string;
  url: string;
}

export interface PhoneAuthProfileInput {
  displayName: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
}

export interface PhoneAuthCompleteResult {
  user: UserProfile;
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
  requiresProfile?: false;
}

export interface PhoneAuthRequiresProfileResult {
  requiresProfile: true;
  isNewUser: boolean;
  phone: string;
}

export type PhoneAuthVerifyResult = PhoneAuthCompleteResult | PhoneAuthRequiresProfileResult;

const AUTH_PROVIDERS_CACHE_TTL_MS = 30_000;

function isPhoneAuthCompleteResult(result: PhoneAuthVerifyResult): result is PhoneAuthCompleteResult {
  return result.requiresProfile !== true;
}

type UserRole = NonNullable<UserProfile['role']>;

const USER_ROLES: readonly UserRole[] = ['admin', 'manager', 'employee', 'client', 'photographer'];

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    record[key] = Reflect.get(value, key);
  }
  return record;
}

function readBooleanRecord(value: unknown): Record<string, boolean> | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'boolean') {
      result[key] = item;
    }
  }
  return result;
}

function readUserRole(value: unknown): UserRole | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return USER_ROLES.find(role => role === value);
}

function readTwoFactorMethod(value: unknown): UserProfile['two_factor_method'] | undefined {
  const method = readString(value);
  return method === 'sms' || method === 'telegram' ? method : undefined;
}

function readPersonalData(value: unknown): UserProfile['personal_data'] | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    firstName: readString(record['firstName']),
    lastName: readString(record['lastName']),
    dateOfBirth: readString(record['dateOfBirth']),
    preferences: readRecord(record['preferences']),
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hasBoundPhone(user: Pick<UserProfile, 'phone'> | null | undefined): boolean {
  return (user?.phone?.trim() ?? '').length > 0;
}

function hasPersistedPhoneRequirementSkip(user: Pick<UserProfile, 'preferences'> | null | undefined): boolean {
  const preferences = user?.preferences;
  if (!preferences) {
    return false;
  }

  const skippedAt = preferences['phoneRequirementSkippedAt'];
  if (typeof skippedAt === 'string') {
    return skippedAt.trim().length > 0;
  }

  return preferences['phoneRequirementSkipped'] === true;
}

function readAccountType(value: unknown): UserProfile['account_type'] {
  switch (value) {
    case 'personal':
    case 'education':
    case 'business':
      return value;
    default:
      return undefined;
  }
}

function normalizeUserProfile(user: UserProfile): UserProfile {
  const phoneVerified = hasBoundPhone(user);
  const accountType = user.account_type ?? user.accountType;
  const pinEnabled = user.pin_enabled ?? user.pinEnabled;
  return {
    ...user,
    account_type: accountType,
    accountType,
    pin_enabled: pinEnabled,
    pinEnabled,
    displayName: user.display_name ?? user.displayName,
    photoURL: user.photo_url ?? user.photoURL,
    emailVerified: user.email_verified ?? user.emailVerified,
    phone_verified: phoneVerified,
    phoneVerified,
    uid: user.id || user.uid,
  };
}

function readStudentDiscount(value: unknown): StudentDiscountAccount | null | undefined {
  if (value === null) return null;
  const record = readRecord(value);
  if (!record) return undefined;
  return {
    status: readString(record['status']) ?? 'expired',
    source_token: readString(record['source_token']) ?? '',
    activated_at: readString(record['activated_at']) ?? '',
    expires_at: readString(record['expires_at']) ?? '',
    print_sheets_limit: readNumber(record['print_sheets_limit']) ?? 0,
    print_sheets_used: readNumber(record['print_sheets_used']) ?? 0,
    print_sheets_remaining: readNumber(record['print_sheets_remaining']) ?? 0,
    print_sheet_price: readNumber(record['print_sheet_price']) ?? 3,
    max_print_fill_percent: readNumber(record['max_print_fill_percent']) ?? 100,
    photo_limit: readNumber(record['photo_limit']) ?? 0,
    photo_used: readNumber(record['photo_used']) ?? 0,
    photo_remaining: readNumber(record['photo_remaining']) ?? 0,
    allowance_period_id: readString(record['allowance_period_id']) ?? null,
    allowance_period_start: readString(record['allowance_period_start']) ?? null,
    allowance_period_end: readString(record['allowance_period_end']) ?? null,
    binding_limit: readNumber(record['binding_limit']) ?? 0,
    binding_uses: readNumber(record['binding_uses']) ?? 0,
    binding_remaining: readNumber(record['binding_remaining']) ?? 0,
  };
}

function mapUserProfile(profile: Record<string, unknown>): UserProfile {
  const id = readString(profile['id']) ?? '';
  const displayName = readString(profile['display_name']);
  const photoUrl = readString(profile['photo_url']);
  const emailVerified = readBoolean(profile['email_verified']);
  const phone = readString(profile['phone']);
  const phoneVerified = readBoolean(profile['phone_verified']);
  const studentDiscount = readStudentDiscount(profile['student_discount']);

  return normalizeUserProfile({
    id,
    email: readString(profile['email']) ?? '',
    display_name: displayName,
    username: readString(profile['username']),
    first_name: readString(profile['first_name']),
    last_name: readString(profile['last_name']),
    phone,
    photo_url: photoUrl,
    role: readUserRole(profile['role']),
    email_verified: emailVerified,
    phone_verified: phoneVerified,
    is_active: readBoolean(profile['is_active']),
    account_type: readAccountType(profile['account_type']),
    pin_enabled: readBoolean(profile['pin_enabled']),
    personal_data: readPersonalData(profile['personal_data']),
    preferences: readRecord(profile['preferences']),
    created_at: readString(profile['created_at']),
    updated_at: readString(profile['updated_at']),
    two_factor_enabled: readBoolean(profile['two_factor_enabled']),
    two_factor_method: readTwoFactorMethod(profile['two_factor_method']),
    displayName,
    photoURL: photoUrl,
    emailVerified,
    phoneVerified,
    uid: id,
    linkedAccounts: readBooleanRecord(profile['linkedAccounts']) ?? readBooleanRecord(profile['linked_accounts']),
    pendingApprovals: readNumber(profile['pendingApprovals']) ?? readNumber(profile['pending_approvals']),
    student_discount: studentDiscount,
    studentDiscount,
  });
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router: Router = inject(Router);
  private http: HttpClient = inject(HttpClient);
  private apiService: ApiService = inject(ApiService);
  private fingerprintService = inject(FingerprintService);
  private platformId = inject(PLATFORM_ID);
  private injector = inject(Injector);

  // Signals for modern state management
  private currentUserSignal = signal<UserProfile | null>(null);
  private isLoadingSignal = signal<boolean>(true); // Start as true until first auth state is known
  private errorSignal = signal<string>('');
  private availableProvidersSignal = signal<OAuthProvider[]>([]);
  private phoneAuthAvailableSignal = signal<boolean>(false);
  private phoneAuthProvidersSignal = signal<string[]>([]);
  private pinUnlockRequiredSignal = signal<boolean>(false);
  private providersLoaded = false;
  private providersLoadedAt = 0;
  private providersRequest: Observable<OAuthProvider[]> | null = null;

  // Token storage keys
  private readonly ACCESS_TOKEN_KEY = 'access_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private readonly SESSION_HINT_KEY = 'auth_session_hint';
  private readonly LOGIN_DATE_KEY = 'auth_login_date';
  private readonly PHONE_REQUIREMENT_SKIP_PREFIX = 'auth_phone_requirement_skipped:';
  private readonly PRIVACY_POLICY_VERSION = '2026-05-16';
  private nightLogoutTimer: ReturnType<typeof setTimeout> | null = null;
  private phoneRequirementSkipVersion = signal(0);

  // Computed properties for easy access in components
  public readonly currentUser = this.currentUserSignal.asReadonly();
  public readonly isAuthenticated = computed(() => this.currentUserSignal() !== null);
  public readonly isLoading = this.isLoadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();
  public readonly userRole = computed(() => this.currentUserSignal()?.role || null);
  public readonly isAdmin = computed(() => this.userRole() === 'admin');
  public readonly isPhoneVerified = computed(() => hasBoundPhone(this.currentUserSignal()));
  public readonly requiredProfileFields = computed(() => this.getRequiredProfileFields());
  public readonly requiresProfileCompletion = computed(() => {
    const fields = this.requiredProfileFields();
    return fields.displayName || fields.phone;
  });
  /** Список OAuth-провайдеров, настроенных на бэкенде (есть credentials) */
  public readonly availableProviders = this.availableProvidersSignal.asReadonly();
  /** Доступна ли авторизация по номеру телефона (настроен хотя бы один OTP-провайдер) */
  public readonly phoneAuthAvailable = this.phoneAuthAvailableSignal.asReadonly();
  /** Список OTP-провайдеров (telegram / sms / max) */
  public readonly phoneAuthProviders = this.phoneAuthProvidersSignal.asReadonly();
  public readonly pinUnlockRequired = this.pinUnlockRequiredSignal.asReadonly();
  /** Server-sourced permissions — populated from GET /auth/me response */
  private readonly permissionsSignal = signal<string[]>([]);
  public readonly permissions = this.permissionsSignal.asReadonly();

  hasPermission(permission: string): boolean {
    const role = this.userRole();
    if (role === 'admin' || this.permissionsSignal().includes(permission)) return true;
    if (permission === 'students:verify') return role === 'manager' || role === 'employee';
    return false;
  }
  
  /**
   * Проверяет, может ли пользователь получить доступ к приватному контенту
   * (требуется верификация телефона или email)
   */
  canAccessPrivateContent(): boolean {
    const user = this.currentUserSignal();
    return user !== null && (hasBoundPhone(user) || user.email_verified === true || user.emailVerified === true);
  }

  getRequiredProfileFields(
    user: UserProfile | null = this.currentUserSignal(),
    options: RequiredProfileFieldsOptions = {},
  ): RequiredProfileFields {
    this.phoneRequirementSkipVersion();

    if (!user) {
      return { displayName: false, phone: false };
    }

    return {
      displayName: !this.hasRequiredDisplayName(user),
      phone: !this.hasRequiredPhone(user, options.forcePhone === true),
    };
  }

  getProfileCompletionRedirectUrl(returnUrl?: string): string {
    const target = this.normalizeInternalReturnUrl(returnUrl);
    return `/auth/complete-profile?returnUrl=${encodeURIComponent(target)}`;
  }

  getPostAuthRedirectUrl(returnUrl?: string): string {
    const target = this.normalizeInternalReturnUrl(returnUrl);
    if (this.requiresProfileCompletion()) {
      return this.getProfileCompletionRedirectUrl(target);
    }

    if (this.shouldPromptClientPinSetup()) {
      return `/auth/pin?mode=setup&returnUrl=${encodeURIComponent(target)}`;
    }

    return target;
  }

  private hasRequiredDisplayName(user: UserProfile): boolean {
    const displayName = user.display_name ?? user.displayName ?? '';
    return displayName.trim().length >= 2;
  }

  canSkipPhoneRequirement(): boolean {
    const user = this.currentUserSignal();
    return user !== null && !hasBoundPhone(user);
  }

  hasSkippedPhoneRequirement(): boolean {
    const user = this.currentUserSignal();
    return user !== null && this.hasSkippedPhoneRequirementForUser(user);
  }

  skipPhoneRequirement(attemptedPhone?: string): Observable<boolean> {
    const user = this.currentUserSignal();
    if (!user || hasBoundPhone(user) || !this.isBrowser()) {
      return of(false);
    }

    const userId = this.getPhoneRequirementUserId(user);
    if (!userId) {
      return of(false);
    }

    const payload = attemptedPhone?.trim()
      ? { attemptedPhone: attemptedPhone.trim() }
      : {};

    return this.apiService.post<UserProfile>('/users/me/phone-requirement-skip', payload).pipe(
      map(response => {
        if (response.success && response.data) {
          return normalizeUserProfile(response.data);
        }
        throw new Error(response.error || response.message || 'Не удалось продолжить без телефона');
      }),
      tap(userProfile => {
        localStorage.setItem(this.getPhoneRequirementSkipKey(userId), '1');
        this.currentUserSignal.set(userProfile);
        this.phoneRequirementSkipVersion.update(version => version + 1);
      }),
      map(() => true),
    );
  }

  private hasRequiredPhone(user: UserProfile, forcePhone: boolean): boolean {
    return hasBoundPhone(user) || (!forcePhone && this.hasSkippedPhoneRequirementForUser(user));
  }

  private hasSkippedPhoneRequirementForUser(user: Pick<UserProfile, 'id' | 'uid' | 'preferences'>): boolean {
    if (hasPersistedPhoneRequirementSkip(user)) {
      return true;
    }

    if (!this.isBrowser()) {
      return false;
    }

    const userId = this.getPhoneRequirementUserId(user);
    return userId !== null && localStorage.getItem(this.getPhoneRequirementSkipKey(userId)) === '1';
  }

  private clearSkippedPhoneRequirementForUser(user: Pick<UserProfile, 'id' | 'uid'> | null | undefined): void {
    if (!this.isBrowser() || !user) {
      return;
    }

    const userId = this.getPhoneRequirementUserId(user);
    if (!userId) {
      return;
    }

    localStorage.removeItem(this.getPhoneRequirementSkipKey(userId));
    this.phoneRequirementSkipVersion.update(version => version + 1);
  }

  private getPhoneRequirementUserId(user: Pick<UserProfile, 'id' | 'uid'>): string | null {
    const userId = user.id || user.uid;
    return userId?.trim() || null;
  }

  private getPhoneRequirementSkipKey(userId: string): string {
    return `${this.PHONE_REQUIREMENT_SKIP_PREFIX}${userId}`;
  }

  private normalizeInternalReturnUrl(returnUrl?: string): string {
    const target = returnUrl?.trim() || '/';
    if (
      !target.startsWith('/')
      || target.startsWith('/auth/complete-profile')
      || target.startsWith('/auth/phone-verification')
      || target.startsWith('/auth/pin')
    ) {
      return '/';
    }
    return target;
  }

  private shouldPromptClientPinSetup(): boolean {
    const user = this.currentUserSignal();
    return user?.role === 'client' && user.pin_enabled === false;
  }

  /**
   * Связать аккаунт с провайдером социальной сети
   * TODO: Реализовать реальную логику связывания аккаунтов
   */
  async linkAccountWithProvider(provider: 'google' | 'apple'): Promise<void> {
    // OAuth account linking requires server-side OAuth flow configuration
    // Currently not supported — silently skip
    void provider;
  }

  // Token access (computed signal for SSR compatibility)
  public readonly token = computed(() => {
    // In SSR mode, always return null
    if (!this.isBrowser()) {
      return null;
    }
    return this.getAccessToken();
  });

  // Aliases for compatibility with the previous service's API
  public readonly user = this.currentUserSignal.asReadonly();
  public readonly loading = this.isLoadingSignal.asReadonly();
  public readonly profile = computed(() => this.currentUserSignal());

  private initialized = false;

  constructor() {
    // Auth initialization is handled by APP_INITIALIZER
    // Do NOT call initializeAuth() here — it must complete BEFORE Angular bootstraps
  }

  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  /**
   * Инициализация auth state. Вызывается через APP_INITIALIZER.
   * Angular НЕ запустится, пока этот Promise не разрешится.
   */
  initializeAuth(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    this.initialized = true;

    if (!this.isBrowser()) {
      this.isLoadingSignal.set(false);
      return Promise.resolve();
    }

    const session$ = this.createInitialSessionLoad();

    if (!session$) {
      this.isLoadingSignal.set(false);
      return Promise.resolve();
    }

    // scheduleNightLogout() обеспечивает автовыход в 03:00 —
    // дополнительная проверка hasDayChangedSinceLogin() убрана,
    // т.к. она выкидывала при F5 утром если логин был вчера

    return firstValueFrom(
      session$.pipe(
        tap((user) => {
          this.currentUserSignal.set(user);
          this.isLoadingSignal.set(false);
          // Preload available OAuth providers in background (non-blocking, only when authenticated)
          this.loadAvailableProviders().subscribe();
          // Планируем автовыход в 03:00 для сотрудников
          if (user?.role && user.role !== 'client') {
            this.scheduleNightLogout();
          }
        }),
        catchError(error => {
          if (this.isPinRequiredError(error)) {
            this.clearAccessToken();
            this.currentUserSignal.set(null);
            this.permissionsSignal.set([]);
            this.pinUnlockRequiredSignal.set(true);
            this.isLoadingSignal.set(false);
            return of(null);
          }

          this.clearTokens();
          this.isLoadingSignal.set(false);
          return of(null);
        }),
      ),
    ).then(() => { /* noop */ });
  }

  private createInitialSessionLoad(): Observable<UserProfile> | null {
    const accessToken = this.getAccessToken();
    if (accessToken) {
      return this.loadUserProfile();
    }

    if (!this.hasRefreshableSession()) {
      return null;
    }

    return this.refreshAccessToken({ redirectOnFailure: false }).pipe(
      switchMap(() => this.loadUserProfile()),
    );
  }

  // --- Core Authentication Methods ---

  /**
   * Initiate Yandex OAuth login flow
   * Redirects user to Yandex OAuth authorization page
   */
  login(email?: string, password?: string): Observable<{ success: boolean; data?: { user: UserProfile; accessToken: string; refreshToken: string } }> {
    if (!email || !password) {
      this.signInWithYandex();
      return new Observable<{ success: boolean; data?: { user: UserProfile; accessToken: string; refreshToken: string } }>(() => {
        return undefined;
      });
    }

    this.isLoadingSignal.set(true);
    return this.http.post<{ success: boolean; data: { user: UserProfile; accessToken: string; refreshToken: string } }>(
      '/api/auth/login',
      { email, password }
    ).pipe(
      switchMap(res => {
        if (res.success && res.data) {
          this.setTokens(res.data.accessToken, res.data.refreshToken);
          return this.loadUserProfile().pipe(
            tap(user => {
              this.currentUserSignal.set(user);
              this.linkPendingApprovalTokens();
            }),
            map(() => res),
          );
        }
        return of(res);
      }),
      finalize(() => this.isLoadingSignal.set(false)),
      catchError(err => {
        // Rate limiter returns plain string, normalize to { error: string }
        const body = err.error;
        if (typeof body === 'string') {
          return throwError(() => ({ error: body }));
        }
        return throwError(() => body || { error: 'Ошибка авторизации' });
      })
    );
  }

  /**
   * Initiate Yandex OAuth login
   */
  signInWithYandex(): Observable<unknown> {
    if (!this.isBrowser()) {
      return of({ success: false, message: 'Authentication not available on server' });
    }

    // Redirect to backend OAuth endpoint
    const authUrl = `/api/auth/yandex`;
    window.location.href = authUrl;

    // Return observable that never completes (since we're redirecting)
    return new Observable(() => { /* noop */ });
  }

  /**
   * Handle OAuth callback with tokens
   * Called from AuthCallbackComponent after redirect
   */
  handleAuthCallback(accessToken: string, refreshToken: string): Observable<UserProfile> {
    if (!this.isBrowser()) {
      return throwError(() => new Error('Authentication not available on server'));
    }

    // Store tokens
    this.setTokens(accessToken, refreshToken);

    // Load user profile
    return this.loadUserProfile().pipe(
      tap(user => {
        this.currentUserSignal.set(user);
        this.isLoadingSignal.set(false);
      }),
      catchError(error => {
        this.clearLocalAuthState();
        throw error;
      })
    );
  }

  /**
   * Load user profile from API
   */
  private loadUserProfile(): Observable<UserProfile> {
    return this.apiService.get<Record<string, unknown>>('/auth/me').pipe(
      map(response => {
        if (response.success && response.data) {
          const { permissions: perms, ...profile } = response.data;
          // Server is the source of truth for permissions
          this.permissionsSignal.set(readStringArray(perms));
          return mapUserProfile(profile);
        }
        throw new Error('Failed to load user profile');
      })
    );
  }

  /**
   * Register with email + password (calls POST /api/auth/register)
   */
  register(
    email: string,
    password: string,
    displayName?: string,
    privacyConsent: PrivacyConsentPayload = this.buildRegistrationPrivacyConsent(),
  ): Observable<{ success: boolean; requiresVerification?: boolean; message?: string }> {
    this.isLoadingSignal.set(true);
    return this.http.post<{ success: boolean; requiresVerification?: boolean; message?: string }>(
      '/api/auth/register',
      {
        email,
        password,
        displayName,
        privacyConsent,
      }
    ).pipe(
      tap(() => this.isLoadingSignal.set(false)),
      catchError(err => {
        this.isLoadingSignal.set(false);
        return throwError(() => err.error || { error: 'Ошибка регистрации' });
      })
    );
  }

  recordPrivacyConsent(payload: PrivacyConsentPayload): Observable<void> {
    return this.apiService.post<{ id: string }>('/privacy/consents', payload).pipe(
      map(response => {
        if (!response.success) {
          throw new Error(response.error || response.message || 'Не удалось сохранить согласие');
        }
        return undefined;
      })
    );
  }

  private buildRegistrationPrivacyConsent(): PrivacyConsentPayload {
    const visitorId = this.fingerprintService.visitorId() || undefined;
    return {
      documentType: 'privacy_policy',
      documentVersion: this.PRIVACY_POLICY_VERSION,
      scope: ['personal_data', 'privacy_policy', 'public_offer', 'registration'],
      source: 'email_registration',
      accepted: true,
      visitorId,
      details: {
        registrationMethod: 'email',
        uiSurface: 'register_form',
      },
    };
  }

  resendVerificationEmail(email: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>('/api/auth/resend-verification', { email });
  }

  /** @deprecated Use register() instead */
  signUpWithEmail(email: string, password: string, displayName?: string): Observable<unknown> {
    return this.register(email, password, displayName);
  }

  employeeLogin(email: string, password: string): Observable<{ success: boolean; data?: { user: UserProfile; accessToken: string; refreshToken: string } }> {
    this.isLoadingSignal.set(true);
    return this.http.post<{ success: boolean; data: { user: UserProfile; accessToken: string; refreshToken: string } }>(
      '/api/auth/employee-login',
      { email, password }
    ).pipe(
      switchMap(res => {
        if (res.success && res.data) {
          this.setTokens(res.data.accessToken, res.data.refreshToken);
          this.saveLoginDate();
          return this.loadUserProfile().pipe(
            tap(user => {
              this.currentUserSignal.set(user);
              this.scheduleNightLogout();
              this.linkPendingApprovalTokens();
            }),
            map(() => res),
          );
        }
        return of(res);
      }),
      finalize(() => this.isLoadingSignal.set(false)),
      catchError(err => {
        return throwError(() => err.error || { error: 'Ошибка авторизации' });
      })
    );
  }

  forgotPassword(email: string): Observable<{ success: boolean }> {
    return this.apiService.post<{ success: boolean }>('/auth/forgot-password', { email });
  }

  resetPassword(token: string, password: string): Observable<{ success: boolean }> {
    return this.apiService.post<{ success: boolean }>('/auth/reset-password', { token, password });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ success: boolean }> {
    return this.apiService.post<{ success: boolean }>('/auth/change-password', { currentPassword, newPassword });
  }

  /** @deprecated Use register() instead */
  signup(email: string, password: string): Observable<unknown> {
    return this.register(email, password);
  }

  /**
   * Logout user
   */
  logout(): Observable<void> {
    if (!this.isBrowser()) {
      this.clearLocalAuthState();
      this.router.navigate(['/auth/login']);
      return of(undefined);
    }

    this.isLoadingSignal.set(true);
    const refreshToken = this.getRefreshToken();

    // Call logout endpoint — sends refreshToken in body (legacy) + httpOnly cookie
    if (refreshToken || this.isBrowser()) {
      return this.http.post('/api/auth/logout', { refreshToken: refreshToken || undefined }, { withCredentials: true }).pipe(
        map(() => void 0),
        tap(() => {
          this.clearLocalAuthState();
          this.isLoadingSignal.set(false);
          this.router.navigate(['/auth/login']);
        }),
        catchError(() => {
          // Even if logout fails, clear local state
          this.clearLocalAuthState();
          this.isLoadingSignal.set(false);
          this.router.navigate(['/auth/login']);
          return of(undefined);
        })
      );
    } else {
      this.clearLocalAuthState();
      this.isLoadingSignal.set(false);
      this.router.navigate(['/auth/login']);
      return of(undefined);
    }
  }

  signOut(): Promise<void> {
    return new Promise((resolve) => {
      this.logout().subscribe(() => resolve());
    });
  }

  /**
   * Send password reset email
   */
  sendPasswordResetEmail(email: string): Observable<void> {
    return this.forgotPassword(email).pipe(map(() => undefined));
  }

  /**
   * Send email verification — resends the verification link
   */
  sendEmailVerification(email?: string): Observable<void> {
    if (!email) return of(undefined);
    return this.resendVerificationEmail(email).pipe(map(() => undefined));
  }

  /**
   * Delete account
   */
  deleteAccount(): Observable<void> {
    if (!this.isBrowser()) {
      return of(undefined);
    }

    return this.apiService.delete<DeleteAccountResponse>('/users/me').pipe(
      map(response => {
        if (!response.success) {
          throw new Error(response.error || response.message || 'Ошибка удаления аккаунта');
        }
        return undefined;
      }),
      tap(() => {
        this.clearLocalAuthState();
        this.router.navigate(['/auth/login']);
      })
    );
  }

  // --- Social Auth (legacy methods) ---

  googleSignIn(): Observable<unknown> {
    return this.signInWithGoogle();
  }

  appleSignIn(): Observable<unknown> {
    return this.signInWithApple();
  }

  /**
   * Initiate Google OAuth login
   */
  signInWithGoogle(): Observable<unknown> {
    if (!this.isBrowser()) {
      return of({ success: false, message: 'Authentication not available on server' });
    }

    // Redirect to backend OAuth endpoint
    const authUrl = `/api/auth/google`;
    window.location.href = authUrl;

    // Return observable that never completes (since we're redirecting)
    return new Observable(() => { /* noop */ });
  }

  /**
   * Initiate Apple OAuth login
   */
  signInWithApple(): Observable<unknown> {
    if (!this.isBrowser()) {
      return of({ success: false, message: 'Authentication not available on server' });
    }

    // Redirect to backend OAuth endpoint
    const authUrl = `/api/auth/apple`;
    window.location.href = authUrl;

    // Return observable that never completes (since we're redirecting)
    return new Observable(() => { /* noop */ });
  }

  /**
   * Initiate VK OAuth login
   */
  signInWithVk(): Observable<unknown> {
    if (!this.isBrowser()) {
      return of({ success: false, message: 'Authentication not available on server' });
    }

    // Redirect to backend OAuth endpoint
    const authUrl = `/api/auth/vk`;
    window.location.href = authUrl;

    // Return observable that never completes (since we're redirecting)
    return new Observable(() => { /* noop */ });
  }

  signInWithCustomProvider(provider: 'vk' | 'telegram', data: unknown): Observable<unknown> {
    if (provider === 'vk') {
      return this.signInWithProvider('vk');
    }
    // For telegram, use custom provider logic
    return this.apiService.post('/auth/telegram', data);
  }

  private isProvidersCacheFresh(now = Date.now()): boolean {
    return this.providersLoaded && now - this.providersLoadedAt < AUTH_PROVIDERS_CACHE_TTL_MS;
  }

  private applyPhoneAuthConfig(phoneAuth?: {
    available: boolean;
    providers: string[];
  }): void {
    if (phoneAuth) {
      this.phoneAuthAvailableSignal.set(phoneAuth.available);
      this.phoneAuthProvidersSignal.set(phoneAuth.providers);
      return;
    }

    this.phoneAuthAvailableSignal.set(false);
    this.phoneAuthProvidersSignal.set([]);
  }

  /**
   * Load available OAuth providers from backend (cached).
   * Providers are shown to users only if they are returned here.
   */
  loadAvailableProviders(): Observable<OAuthProvider[]> {
    if (this.isProvidersCacheFresh()) {
      return of(this.availableProvidersSignal());
    }

    if (this.providersRequest) {
      return this.providersRequest;
    }

    this.providersRequest = this.http.get<{
      success: boolean;
      data: OAuthProvider[];
      phoneAuth?: {
        available: boolean;
        providers: string[];
      };
    }>('/api/auth/providers').pipe(
      map(res => {
        const providers = res.data || [];
        this.availableProvidersSignal.set(providers);
        this.applyPhoneAuthConfig(res.phoneAuth);
        this.providersLoaded = true;
        this.providersLoadedAt = Date.now();
        return providers;
      }),
      catchError(() => {
        this.availableProvidersSignal.set([]);
        this.applyPhoneAuthConfig();
        this.providersLoaded = false;
        this.providersLoadedAt = 0;
        return of([] as OAuthProvider[]);
      }),
      finalize(() => {
        this.providersRequest = null;
      }),
      shareReplay(1),
    );

    return this.providersRequest;
  }

  /**
   * Generic OAuth sign-in — redirects to the provider's backend URL.
   * Only works for providers returned by loadAvailableProviders().
   */
  signInWithProvider(providerId: string, returnUrl?: string): Observable<unknown> {
    if (!this.isBrowser()) {
      return of({ success: false, message: 'Authentication not available on server' });
    }
    // Save returnUrl so auth-callback can redirect back after OAuth
    const target = returnUrl || window.location.pathname;
    if (target && target !== '/' && target !== '/auth/callback') {
      localStorage.setItem('oauth_return_url', target);
    }
    const provider = this.availableProvidersSignal().find(p => p.id === providerId);
    const url = provider?.url ?? `/api/auth/${providerId}`;
    window.location.href = url;
    return new Observable(() => { /* noop */ });
  }

  // --- Token Management ---

  /**
   * Get access token synchronously (for guards)
   */
  getAccessTokenSync(): string | null {
    return this.getAccessToken();
  }

  /**
   * Get access token from localStorage
   */
  getAuthToken(): Promise<string | null> {
    if (!this.isBrowser()) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.getAccessToken());
  }

  /**
   * Get access token synchronously
   */
  private getAccessToken(): string | null {
    if (!this.isBrowser()) {
      return null;
    }
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  /**
   * Get refresh token
   */
  private getRefreshToken(): string | null {
    if (!this.isBrowser()) {
      return null;
    }
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  private hasRefreshableSession(): boolean {
    if (!this.isBrowser()) {
      return false;
    }
    return this.getRefreshToken() !== null || localStorage.getItem(this.SESSION_HINT_KEY) === '1';
  }

  /** Public getter for refresh token (used by WebSocket for seamless reconnect) */
  getRefreshTokenValue(): string | null {
    return this.getRefreshToken();
  }

  /** Update only access token (called when WS server issues refreshed JWT) */
  updateToken(newAccessToken: string): void {
    if (!this.isBrowser()) return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, newAccessToken);
  }

  /**
   * Store tokens in localStorage
   */
  private setTokens(accessToken: string, refreshToken: string): void {
    if (!this.isBrowser()) {
      return;
    }
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(this.SESSION_HINT_KEY, '1');
    this.pinUnlockRequiredSignal.set(false);
  }

  /**
   * Clear tokens from localStorage
   */
  private clearTokens(): void {
    if (!this.isBrowser()) {
      return;
    }
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.SESSION_HINT_KEY);
  }

  private clearAccessToken(): void {
    if (!this.isBrowser()) {
      return;
    }
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
  }

  clearLocalAuthState(): void {
    this.clearTokens();
    this.currentUserSignal.set(null);
    this.permissionsSignal.set([]);
    this.pinUnlockRequiredSignal.set(false);
  }

  isPinRequiredError(error: unknown): boolean {
    return this.readAuthErrorCode(error) === 'PIN_REQUIRED' || this.readAuthErrorCode(error) === 'PIN_LOCKED';
  }

  private readAuthErrorCode(error: unknown): string | null {
    if (error instanceof HttpErrorResponse) {
      const body = error.error;
      if (typeof body === 'object' && body !== null) {
        const code = Reflect.get(body, 'code');
        if (typeof code === 'string') return code;
        const bodyError = Reflect.get(body, 'error');
        if (typeof bodyError === 'string') return bodyError;
      }
      return null;
    }

    if (typeof error === 'object' && error !== null) {
      const code = Reflect.get(error, 'code');
      if (typeof code === 'string') return code;
      const bodyError = Reflect.get(error, 'error');
      if (typeof bodyError === 'string') return bodyError;
    }

    return null;
  }

  /**
   * Refresh access token using refresh token
   */
  refreshAccessToken(options: RefreshAccessTokenOptions = {}): Observable<AuthTokens> {
    // Send refreshToken in body (legacy) — backend also reads httpOnly cookie
    const refreshToken = this.getRefreshToken();

    return this.http.post<{ success: boolean; data: AuthTokens }>(
      '/api/auth/refresh',
      { refreshToken: refreshToken || undefined },
      { withCredentials: true },
    ).pipe(
      map(response => {
        if (response.success && response.data) {
          // Keep localStorage in sync during transition period
          this.setTokens(response.data.accessToken, response.data.refreshToken);
          return response.data;
        }
        throw new Error('Failed to refresh token');
      }),
      catchError(error => {
        if (this.isPinRequiredError(error)) {
          this.clearAccessToken();
          this.currentUserSignal.set(null);
          this.permissionsSignal.set([]);
          this.pinUnlockRequiredSignal.set(true);
          if (options.redirectOnFailure !== false) {
            const currentUrl = this.router.url && this.router.url !== '/auth/pin'
              ? this.router.url
              : '/';
            this.router.navigate(['/auth/pin'], { queryParams: { returnUrl: currentUrl } });
          }
          return throwError(() => error);
        }

        // If refresh fails, clear tokens and redirect to login
        this.clearLocalAuthState();
        if (options.redirectOnFailure !== false) {
          this.router.navigate(['/auth/login']);
        }
        return throwError(() => error);
      })
    );
  }

  getPinStatus(): Observable<ClientPinStatus> {
    return this.http.get<{ success: boolean; data: ClientPinStatus }>(
      '/api/auth/pin/status',
      { withCredentials: true },
    ).pipe(
      map(response => {
        if (response.success && response.data) {
          return response.data;
        }
        throw new Error('Failed to load PIN status');
      }),
    );
  }

  setupPin(pin: string): Observable<ClientPinStatus> {
    const refreshToken = this.getRefreshToken();
    return this.http.post<{ success: boolean; data: ClientPinStatus }>(
      '/api/auth/pin/setup',
      { pin, refreshToken: refreshToken || undefined },
      { withCredentials: true },
    ).pipe(
      map(response => {
        if (response.success && response.data) {
          return response.data;
        }
        throw new Error('Failed to setup PIN');
      }),
      tap(() => {
        const user = this.currentUserSignal();
        if (user) {
          this.currentUserSignal.set({ ...user, pin_enabled: true, pinEnabled: true });
        }
        this.pinUnlockRequiredSignal.set(false);
      }),
    );
  }

  unlockWithPin(pin: string): Observable<ClientPinUnlockResult> {
    const refreshToken = this.getRefreshToken();
    this.isLoadingSignal.set(true);
    return this.http.post<{ success: boolean; data: AuthTokens }>(
      '/api/auth/pin/unlock',
      { pin, refreshToken: refreshToken || undefined },
      { withCredentials: true },
    ).pipe(
      switchMap(response => {
        if (!response.success || !response.data) {
          throw new Error('Failed to unlock PIN session');
        }
        this.setTokens(response.data.accessToken, response.data.refreshToken);
        return this.loadUserProfile().pipe(
          tap(user => {
            this.currentUserSignal.set(user);
            this.pinUnlockRequiredSignal.set(false);
            this.loadAvailableProviders().subscribe();
          }),
          map(user => ({ tokens: response.data, user })),
        );
      }),
      finalize(() => this.isLoadingSignal.set(false)),
    );
  }

  disablePin(pin: string): Observable<void> {
    return this.http.post<{ success: boolean; data: { enabled: boolean } }>(
      '/api/auth/pin/disable',
      { pin },
      { withCredentials: true },
    ).pipe(
      tap(() => {
        const user = this.currentUserSignal();
        if (user) {
          this.currentUserSignal.set({ ...user, pin_enabled: false, pinEnabled: false });
        }
      }),
      map(() => void 0),
    );
  }

  // --- User Profile Management ---

  /**
   * Update user profile
   */
  updateUserProfile(data: Partial<UserProfile>): Observable<UserProfile> {
    // Convert camelCase aliases to snake_case for API
    const apiData: Record<string, unknown> = { ...data };
    if (apiData['displayName'] !== undefined) {
      apiData['display_name'] = apiData['displayName'];
      delete apiData['displayName'];
    }
    if (apiData['photoURL'] !== undefined) {
      apiData['photo_url'] = apiData['photoURL'];
      delete apiData['photoURL'];
    }

    return this.apiService.put<UserProfile>('/users/me', apiData).pipe(
      map(response => {
        if (response.success && response.data) {
          const profile = response.data;
          const userProfile = normalizeUserProfile(profile);
          if (hasBoundPhone(userProfile)) {
            this.clearSkippedPhoneRequirementForUser(userProfile);
          }
          this.currentUserSignal.set(userProfile);
          return userProfile;
        }
        throw new Error('Failed to update profile');
      })
    );
  }

  /**
   * Update profile photo URL
   */
  updateProfilePhoto(photoUrl: string): Observable<void> {
    return this.updateUserProfile({ photo_url: photoUrl }).pipe(
      map(() => void 0)
    );
  }

  /**
   * Clear profile photo
   */
  clearProfilePhoto(): Observable<void> {
    return this.updateUserProfile({ photo_url: undefined }).pipe(
      map(() => void 0)
    );
  }

  // --- Helper & Compatibility Methods ---

  isLoggedIn(): boolean {
    return this.isAuthenticated();
  }

  getCurrentUser(): UserProfile | null {
    return this.currentUser();
  }

  /**
   * Get all users (admin only)
   */
  getAllUsers(): Observable<UserProfile[]> {
    return this.apiService.get<UserProfile[]>('/users').pipe(
      map(response => response.data || [])
    );
  }

  /**
   * Update user role (admin only)
   */
  updateUserRole(userId: string, role: 'admin' | 'manager' | 'employee' | 'client' | 'photographer'): Observable<void> {
    return this.apiService.put(`/users/${userId}/role`, { role }).pipe(
      map(() => void 0)
    );
  }

  /**
   * Upload file (delegates to FileStorageService)
   * Kept for compatibility
   */
  uploadFile(_file: File, _path: string): Observable<string> {
    // This should be handled by FileStorageService
    // For now, return error
    return throwError(() => new Error('Use FileStorageService.uploadFile() instead'));
  }

  /** Lazily link pending approval tokens after successful auth */
  private linkPendingApprovalTokens(): void {
    import('./photo-approval.service').then(m => {
      const svc = this.injector.get(m.PhotoApprovalService);
      svc.linkPendingTokens();
      svc.autoLink().subscribe();
    }).catch(() => { /* noop */ });
  }

  // --- Верификация телефона + 2FA (ПЛАН 7) ---

  /**
   * Отправить SMS-код для верификации телефона или 2FA
   */
  sendPhoneCode(phone: string, purpose: 'phone_verify' | 'two_factor' = 'phone_verify'): Observable<{ method: string; expiresIn: number }> {
    return this.apiService.post<{ method: string; expiresIn: number }>(
      '/auth/send-phone-code',
      { phone, purpose }
    ).pipe(
      map(r => {
        if (r.success && r.data) {
          return r.data;
        }
        throw new Error(r.error || 'Ошибка отправки кода');
      })
    );
  }

  /**
   * Подтвердить телефон кодом из SMS
   */
  verifyPhone(phone: string, code: string): Observable<void> {
    return this.apiService.post('/auth/verify-phone', { phone, code }).pipe(
      map(response => {
        if (!response.success) {
          throw new Error(response.error || 'Ошибка подтверждения телефона');
        }
        return undefined;
      }),
      tap(() => {
        const user = this.currentUserSignal();
        if (user) {
          this.clearSkippedPhoneRequirementForUser(user);
          this.currentUserSignal.set({ ...user, phone, phone_verified: true, phoneVerified: true });
        }
      }),
      map(() => void 0)
    );
  }

  /**
   * Подтвердить и привязать обязательный телефон через голосовой OTP.
   */
  verifyProfilePhoneCode(phone: string, code: string): Observable<void> {
    const fingerprintVisitorId = this.fingerprintService.visitorId() || undefined;
    return this.apiService.post('/auth/profile-phone-verify', { phone, code, fingerprintVisitorId }).pipe(
      map(response => {
        if (!response.success) {
          throw new Error(response.error || 'Ошибка подтверждения телефона');
        }
        return undefined;
      }),
      tap(() => {
        const user = this.currentUserSignal();
        if (user) {
          this.clearSkippedPhoneRequirementForUser(user);
          this.currentUserSignal.set({ ...user, phone, phone_verified: true, phoneVerified: true });
        }
      }),
      map(() => void 0)
    );
  }

  /**
   * Включить двухфакторную аутентификацию
   */
  enable2FA(method: 'sms' | 'telegram'): Observable<void> {
    return this.apiService.post('/auth/enable-2fa', { method }).pipe(
      tap(() => {
        const user = this.currentUserSignal();
        if (user) {
          this.currentUserSignal.set({ ...user, two_factor_enabled: true, two_factor_method: method });
        }
      }),
      map(() => void 0)
    );
  }

  /**
   * Отключить двухфакторную аутентификацию
   */
  disable2FA(): Observable<void> {
    return this.apiService.post('/auth/disable-2fa', {}).pipe(
      tap(() => {
        const user = this.currentUserSignal();
        if (user) {
          this.currentUserSignal.set({ ...user, two_factor_enabled: false, two_factor_method: undefined });
        }
      }),
      map(() => void 0)
    );
  }

  /**
   * Верифицировать код 2FA при входе (tempToken + code → полные токены)
   */
  verify2FA(tempToken: string, code: string): Observable<{ user: UserProfile; accessToken: string; refreshToken: string }> {
    return this.http.post<{ success: boolean; data: { user: UserProfile; accessToken: string; refreshToken: string } }>(
      '/api/auth/verify-2fa',
      { tempToken, code }
    ).pipe(
      tap(res => {
        if (res.success && res.data) {
          this.setTokens(res.data.accessToken, res.data.refreshToken);
          const userProfile = normalizeUserProfile(res.data.user);
          this.currentUserSignal.set(userProfile);
          this.loadUserProfile().subscribe();
          this.linkPendingApprovalTokens();
          this.isLoadingSignal.set(false);
        }
      }),
      map(res => res.data)
    );
  }

  // --- Вход / Регистрация по телефону (Phone OTP Auth) ---

  /**
   * Запросить OTP-код для входа/регистрации по номеру телефона.
   * Код проговаривается в автоматическом голосовом звонке.
   */
  requestPhoneCode(phone: string): Observable<{ expiresIn: number; provider: string }> {
    const fingerprintVisitorId = this.fingerprintService.visitorId() || undefined;
    return this.http.post<{ success: boolean; data?: { expiresIn: number; provider: string }; error?: string; message?: string }>(
      '/api/auth/phone-code',
      { phone, fingerprintVisitorId }
    ).pipe(
      map(res => {
        if (res.success && res.data) {
          return res.data;
        }
        throw new Error(res.error || res.message || 'Не удалось запустить звонок');
      })
    );
  }

  /**
   * Подтвердить OTP-код.
   * Для нового телефона сначала возвращает requiresProfile, затем создаёт клиента с профилем.
   * При успехе сохраняет токены и устанавливает currentUser.
   */
  verifyPhoneCode(
    phone: string,
    code: string,
    staffOnly = false,
    profile?: PhoneAuthProfileInput,
  ): Observable<PhoneAuthVerifyResult> {
    this.isLoadingSignal.set(true);
    const fingerprintVisitorId = this.fingerprintService.visitorId() || undefined;
    return this.http.post<{ success: boolean; data: PhoneAuthVerifyResult }>(
      '/api/auth/phone-verify',
      {
        phone,
        code,
        staffOnly,
        fingerprintVisitorId,
        profile,
      }
    ).pipe(
      switchMap(res => {
        if (res.success && res.data && isPhoneAuthCompleteResult(res.data)) {
          this.setTokens(res.data.accessToken, res.data.refreshToken);
          return this.loadUserProfile().pipe(
            tap(user => {
              this.currentUserSignal.set(user);
              if (user.role && user.role !== 'client') {
                this.saveLoginDate();
                this.scheduleNightLogout();
              }
              this.linkPendingApprovalTokens();
            }),
            map(() => res),
          );
        }
        return of(res);
      }),
      finalize(() => this.isLoadingSignal.set(false)),
      catchError(err => {
        return throwError(() => err.error || { error: 'Ошибка верификации' });
      }),
      map(res => {
        if (!res.data) {
          throw new Error('Empty phone auth response');
        }
        return res.data;
      })
    );
  }

  // ===== Night auto-logout (сотрудники) =====

  /**
   * Планирует автоматический logout в 03:00 ночи.
   * Утром сотрудник должен залогиниться заново.
   */
  private scheduleNightLogout(): void {
    if (!this.isBrowser()) return;
    if (this.nightLogoutTimer) clearTimeout(this.nightLogoutTimer);

    const now = new Date();
    const night = new Date(now);
    night.setHours(3, 0, 0, 0);
    if (night.getTime() <= now.getTime()) {
      night.setDate(night.getDate() + 1);
    }
    const ms = night.getTime() - now.getTime();

    this.nightLogoutTimer = setTimeout(() => {
      this.logout().subscribe();
    }, ms);
  }

  /**
   * Проверяет, сменился ли день с момента логина.
   * Если да — сессия устарела, нужен перелогин.
   */
  private hasDayChangedSinceLogin(): boolean {
    if (!this.isBrowser()) return false;
    const loginDate = localStorage.getItem(this.LOGIN_DATE_KEY);
    if (!loginDate) return false;
    const today = new Date().toISOString().split('T')[0];
    return loginDate !== today;
  }

  private saveLoginDate(): void {
    if (!this.isBrowser()) return;
    localStorage.setItem(this.LOGIN_DATE_KEY, new Date().toISOString().split('T')[0]);
  }
}
