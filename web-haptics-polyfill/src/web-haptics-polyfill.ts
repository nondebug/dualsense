// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import type { HapticEffect } from './types.ts';
import type { HapticsAudioEngine } from './haptics-audio.ts';

declare global {
  interface Navigator {
    playHaptics?: (effect: HapticEffect, intensity?: number | { intensity?: number }) => void;
  }
}

const VALID_EFFECTS: Set<string> = new Set([
  'hint',
  'edge',
  'tick',
  'align',
  'success',
  'error'
]);

export class WebHapticsPolyfill {
  private audioEngine: HapticsAudioEngine | null = null;
  private lastTickTime = 0;
  private originalNativeMethod: ((effect: any, intensity?: any) => void) | null = null;
  public isInstalled = false;

  constructor() {
    if (typeof navigator !== 'undefined' && 'playHaptics' in navigator) {
      this.originalNativeMethod = (navigator as any).playHaptics;
    }
  }

  isNativeAvailable(): boolean {
    const params = new URLSearchParams(window.location.search);
    if (params.get('api') === '1') return true;
    return typeof navigator !== 'undefined' && typeof (navigator as any).playHaptics === 'function';
  }

  install(audioEngine: HapticsAudioEngine): void {
    this.audioEngine = audioEngine;

    const polyfillFn = (
      effect: HapticEffect,
      intensity: number | { intensity?: number } = 1.0
    ): void => {
      // Validate effect enum per WebIDL spec
      if (!VALID_EFFECTS.has(effect)) {
        throw new TypeError(
          `Failed to execute 'playHaptics' on 'Navigator': The provided value '${effect}' is not a valid enum value of type HapticEffect.`
        );
      }

      // Handle optional dictionary overload gracefully
      let normalizedIntensity = 1.0;
      if (typeof intensity === 'number') {
        normalizedIntensity = intensity;
      } else if (typeof intensity === 'object' && intensity !== null && 'intensity' in intensity) {
        normalizedIntensity = (intensity as any).intensity ?? 1.0;
      }

      // Clamp intensity to [0.0, 1.0]
      normalizedIntensity = Math.max(0.0, Math.min(1.0, normalizedIntensity));
      if (normalizedIntensity <= 0.0) return;

      // 8 ms dead-time throttle on high-frequency consecutive ticks
      if (effect === 'tick') {
        const now = performance.now();
        if (now - this.lastTickTime < 8) {
          return;
        }
        this.lastTickTime = now;
      }

      this.audioEngine?.playEffect(effect, normalizedIntensity);
    };

    Object.defineProperty(navigator, 'playHaptics', {
      value: polyfillFn,
      writable: true,
      configurable: true,
      enumerable: true
    });

    this.isInstalled = true;
    console.log('Web Haptics API Polyfill installed with DualSense haptic engine.');
  }

  restore(): void {
    if (this.originalNativeMethod) {
      Object.defineProperty(navigator, 'playHaptics', {
        value: this.originalNativeMethod,
        writable: true,
        configurable: true,
        enumerable: true
      });
    } else {
      delete (navigator as any).playHaptics;
    }
    this.isInstalled = false;
  }
}
