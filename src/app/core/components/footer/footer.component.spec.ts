/// <reference types="node" />
import { ɵresolveComponentResources as resolveComponentResources, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFile } from 'node:fs/promises';
import { FooterComponent } from './footer.component';
import { ChannelStatusService } from '../../services/channel-status.service';

describe('FooterComponent', () => {
  let component: FooterComponent;
  let fixture: ComponentFixture<FooterComponent>;
  const whatsappNotice = signal<string | undefined>(undefined);

  beforeAll(async () => {
    await resolveComponentResources((url) =>
      readFile(new URL(url, import.meta.url), 'utf8'),
    );
  });

  beforeEach(async () => {
    whatsappNotice.set(undefined);
    await TestBed.configureTestingModule({
      imports: [FooterComponent],
      providers: [
        provideRouter([]),
        {
          provide: ChannelStatusService,
          useValue: { whatsappNotice, whatsappAvailable: signal(true), refresh: () => undefined },
        },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(FooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('hides the WhatsApp outage warning when the channel is available', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappLink = compiled.querySelector<HTMLAnchorElement>('.footer-social-link--whatsapp');

    expect(compiled.querySelector('.footer-social-warning')).toBeNull();
    expect(whatsappLink?.getAttribute('aria-label')).toBe('WhatsApp');
  });

  it('shows the WhatsApp outage warning when the channel is unavailable', () => {
    whatsappNotice.set('Временно не работает');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const whatsappLink = compiled.querySelector<HTMLAnchorElement>('.footer-social-link--whatsapp');
    const warning = compiled.querySelector<HTMLElement>('.footer-social-warning');

    expect(whatsappLink?.getAttribute('aria-label')).toBe('WhatsApp: Временно не работает');
    expect(warning?.textContent).toContain('WhatsApp временно не работает');
  });
});
