import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

type SoundType = 'receipt_success' | 'receipt_error' | 'scan_beep' | 'void_success' | 'shift_open' | 'shift_close';

interface SoundProfile {
  freq: [number, number];
  duration: number;
  type?: OscillatorType;
  doubleBeep?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PosSoundService {
  private readonly platformId = inject(PLATFORM_ID);
  private audioContext: AudioContext | null = null;

  readonly enabled = signal(true);

  private static readonly PROFILES: Record<SoundType, SoundProfile> = {
    receipt_success: { freq: [660, 880], duration: 0.25 },
    receipt_error:   { freq: [440, 330], duration: 0.35 },
    scan_beep:       { freq: [1200, 1200], duration: 0.08 },
    void_success:    { freq: [550, 440], duration: 0.3, doubleBeep: true },
    shift_open:      { freq: [440, 660], duration: 0.3 },
    shift_close:     { freq: [660, 440], duration: 0.3 },
  };

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const stored = localStorage.getItem('pos_sound_enabled');
      if (stored !== null) this.enabled.set(stored !== 'false');
    }
  }

  toggle(): void {
    const next = !this.enabled();
    this.enabled.set(next);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('pos_sound_enabled', String(next));
    }
  }

  play(type: SoundType): void {
    if (!this.enabled() || !isPlatformBrowser(this.platformId)) return;

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      const ctx = this.audioContext;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const profile = PosSoundService.PROFILES[type] || PosSoundService.PROFILES['receipt_success'];

      const playTone = (startTime: number): void => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(profile.freq[0], startTime);
        osc.frequency.setValueAtTime(profile.freq[1], startTime + profile.duration * 0.4);
        osc.type = profile.type || 'sine';
        gain.gain.setValueAtTime(0.12, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + profile.duration);
        osc.start(startTime);
        osc.stop(startTime + profile.duration);
      };

      playTone(ctx.currentTime);
      if (profile.doubleBeep) {
        playTone(ctx.currentTime + profile.duration + 0.05);
      }
    } catch (_e) { /* AudioContext not available */ }
  }
}
