import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export type UserRole = 'admin' | 'employee' | 'photographer' | 'manager' | 'client';

export type Department =
  | 'photography'
  | 'retouching'
  | 'printing'
  | 'reception'
  | 'management';

export const DEPARTMENT_LABELS: Record<Department, string> = {
  photography: 'Фотографы',
  retouching: 'Ретушёры',
  printing: 'Печатники',
  reception: 'Администраторы',
  management: 'Менеджеры',
};

export const DEPARTMENT_COLORS: Record<Department, string> = {
  photography: '#f59e0b',
  retouching: '#8b5cf6',
  printing: '#06b6d4',
  reception: '#10b981',
  management: '#0ea5e9',
};

export function buildDisplayName(
  first: string | null | undefined,
  last: string | null | undefined,
  fallback: string,
): string {
  const full = [last, first].filter(Boolean).join(' ').trim();
  return full || fallback;
}

export interface StaffUser {
  id: string;
  email: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  department: Department | null;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserDto {
  email: string;
  first_name: string;
  last_name?: string;
  display_name?: string;
  department?: Department;
  phone?: string;
  role: 'employee' | 'photographer' | 'manager';
  password: string;
}

export interface UpdateUserDto {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string;
  department?: Department | null;
  phone?: string | null;
  role?: UserRole;
  is_active?: boolean;
  password?: string;
}

export interface UsersFilter {
  role?: string;
  is_active?: boolean;
  search?: string;
  department?: Department | 'all';
}

@Injectable({ providedIn: 'root' })
export class UsersApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/users';

  getUsers(filters: UsersFilter = {}): Observable<StaffUser[]> {
    const q = new URLSearchParams();
    if (filters.role) q.set('role', filters.role);
    if (filters.is_active !== undefined) q.set('is_active', String(filters.is_active));
    if (filters.search) q.set('search', filters.search);
    if (filters.department && filters.department !== 'all') q.set('department', filters.department);
    const qs = q.toString() ? `?${q}` : '';
    return this.http.get<{ success: boolean; data: StaffUser[] }>(`${this.base}/${qs}`).pipe(
      map(r => r.data),
    );
  }

  createUser(data: CreateUserDto): Observable<StaffUser> {
    return this.http.post<{ success: boolean; data: StaffUser }>(this.base, data).pipe(
      map(r => r.data),
    );
  }

  updateUser(id: string, data: UpdateUserDto): Observable<StaffUser> {
    return this.http.put<{ success: boolean; data: StaffUser }>(`${this.base}/${id}`, data).pipe(
      map(r => r.data),
    );
  }

  deactivateUser(id: string): Observable<StaffUser> {
    return this.http.delete<{ success: boolean; data: StaffUser }>(`${this.base}/${id}`).pipe(
      map(r => r.data),
    );
  }
}
