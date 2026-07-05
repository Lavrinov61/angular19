/// <reference types="node" />

import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFile } from 'node:fs/promises';

import { AuthService, type UserProfile } from '../../../../core/services/auth.service';
import { CabinetSettingsComponent } from './cabinet-settings.component';

describe('CabinetSettingsComponent', () => {
  let fixture: ComponentFixture<CabinetSettingsComponent>;

  const currentUser = signal<UserProfile | null>({
    id: 'user-1',
    email: 'client@example.com',
    display_name: 'Клиент',
    role: 'client',
  });
  const authServiceStub = {
    currentUser,
  } satisfies Pick<AuthService, 'currentUser'>;

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CabinetSettingsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CabinetSettingsComponent);
    fixture.detectChanges();
  });

  it('keeps the account page focused on profile settings instead of discount promotion', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.account-discount-panel')).toBeNull();
    expect(element.textContent).not.toContain('Тип аккаунта и скидки');
    expect(element.textContent).toContain('Профиль');
    expect(element.textContent).toContain('Выгодно');
  });
});
