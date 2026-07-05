/// <reference types="node" />

import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFile } from 'node:fs/promises';
import { StudioAlertService } from '../../../core/services/studio-alert.service';
import { ChannelStatusService } from '../../../core/services/channel-status.service';
import { ContactsComponent } from './contacts.component';

describe('ContactsComponent', () => {
  let component: ContactsComponent;
  let fixture: ComponentFixture<ContactsComponent>;
  const whatsappNotice = signal<string | undefined>(undefined);

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    whatsappNotice.set(undefined);
    await TestBed.configureTestingModule({
      imports: [ContactsComponent],
      providers: [
        provideRouter([]),
        {
          provide: StudioAlertService,
          useValue: {
            getClosureForStudio: () => null,
          },
        },
        {
          provide: ChannelStatusService,
          useValue: { whatsappNotice, whatsappAvailable: signal(true), refresh: () => undefined },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('routes the hero write action to channel choices instead of one messenger', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const action = compiled.querySelector<HTMLAnchorElement>('.hero-action--primary');

    expect(action).toBeTruthy();
    expect(action?.getAttribute('href')).toBe('#contact-methods');
    expect(action?.hasAttribute('target')).toBe(false);
    expect(action?.textContent).toContain('Выбрать канал');
    expect(compiled.querySelector('#contact-methods')).toBeTruthy();
  });

  it('does not warn on the WhatsApp channel when it is available', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappCard = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.channel-card'))
      .find((card) => card.textContent?.includes('WhatsApp'));

    expect(whatsappCard).toBeTruthy();
    expect(whatsappCard?.classList.contains('channel-card--warning')).toBe(false);
    expect(whatsappCard?.textContent).not.toContain('Временно не работает');
  });

  it('shows a temporary outage warning on the WhatsApp contact channel when unavailable', () => {
    whatsappNotice.set('Временно не работает');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappCard = Array.from(compiled.querySelectorAll<HTMLAnchorElement>('.channel-card'))
      .find((card) => card.textContent?.includes('WhatsApp'));

    expect(whatsappCard).toBeTruthy();
    expect(whatsappCard?.classList.contains('channel-card--warning')).toBe(true);
    expect(whatsappCard?.getAttribute('aria-label')).toBe('WhatsApp: Временно не работает');
    expect(whatsappCard?.textContent).toContain('Временно не работает');
    expect(whatsappCard?.textContent).not.toContain('Ответим в рабочее время');
  });
});
