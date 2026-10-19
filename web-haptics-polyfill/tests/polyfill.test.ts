// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebHapticsPolyfill } from '../src/web-haptics-polyfill.ts';
import type { HapticEffect } from '../src/types.ts';

describe('Web Haptics API Polyfill', () => {
  let playedEffects: Array<{ effect: HapticEffect; intensity: number }>;
  let mockAudioEngine: any;
  let polyfill: WebHapticsPolyfill;

  beforeEach(() => {
    playedEffects = [];
    mockAudioEngine = {
      playEffect: (effect: HapticEffect, intensity: number) => {
        playedEffects.push({ effect, intensity });
      }
    };
    // Ensure global navigator exists in Node test env
    if (typeof globalThis.navigator === 'undefined') {
      (globalThis as any).navigator = {};
    }
    polyfill = new WebHapticsPolyfill();
  });

  it('mounts onto navigator.playHaptics conforming to Chromium IDL signature', () => {
    polyfill.install(mockAudioEngine);
    assert.equal(typeof navigator.playHaptics, 'function');
    assert.equal(polyfill.isInstalled, true);
  });

  it('plays each of the 6 predefined effects with default intensity 1.0', () => {
    polyfill.install(mockAudioEngine);
    const effects: HapticEffect[] = ['hint', 'edge', 'tick', 'align', 'success', 'error'];

    for (const effect of effects) {
      const ret = navigator.playHaptics!(effect);
      assert.equal(ret, undefined, 'playHaptics() must return undefined per Chromium WebIDL');
    }

    assert.equal(playedEffects.length, 6);
    assert.deepEqual(
      playedEffects.map((p) => p.effect),
      effects
    );
    assert.ok(playedEffects.every((p) => p.intensity === 1.0));
  });

  it('throws TypeError when invoked with an invalid effect name', () => {
    polyfill.install(mockAudioEngine);

    assert.throws(
      () => {
        (navigator as any).playHaptics('invalid-effect-name');
      },
      {
        name: 'TypeError',
        message: /is not a valid enum value of type HapticEffect/
      }
    );

    assert.throws(
      () => {
        (navigator as any).playHaptics('rumble');
      },
      {
        name: 'TypeError'
      }
    );
  });

  it('normalizes intensity parameters from number and dictionary options', () => {
    polyfill.install(mockAudioEngine);

    // Number overload
    navigator.playHaptics!('hint', 0.4);
    assert.equal(playedEffects[0].intensity, 0.4);

    // Dictionary options overload
    navigator.playHaptics!('align', { intensity: 0.75 });
    assert.equal(playedEffects[1].intensity, 0.75);

    // Clamps > 1.0 to 1.0
    navigator.playHaptics!('edge', 2.5);
    assert.equal(playedEffects[2].intensity, 1.0);

    // Values <= 0 do not trigger audio
    navigator.playHaptics!('tick', 0);
    assert.equal(playedEffects.length, 3, 'Zero intensity should be a no-op');
  });

  it('throttles consecutive rapid tick events with an 8 ms dead-time window', async () => {
    polyfill.install(mockAudioEngine);

    // Fire 5 ticks synchronously
    navigator.playHaptics!('tick', 1.0);
    navigator.playHaptics!('tick', 1.0);
    navigator.playHaptics!('tick', 1.0);
    navigator.playHaptics!('tick', 1.0);
    navigator.playHaptics!('tick', 1.0);

    // Only the first tick should pass; subsequent synchronous ticks should be throttled
    assert.equal(playedEffects.length, 1);

    // Wait 15 ms and fire another tick
    await new Promise((r) => setTimeout(r, 15));
    navigator.playHaptics!('tick', 1.0);
    assert.equal(playedEffects.length, 2, 'Tick after 15ms dead-time should be allowed');
  });

  it('restores previous navigator.playHaptics upon polyfill.restore()', () => {
    const originalFn = () => {};
    (navigator as any).playHaptics = originalFn;

    const p = new WebHapticsPolyfill();
    p.install(mockAudioEngine);
    assert.notEqual(navigator.playHaptics, originalFn);

    p.restore();
    assert.equal(navigator.playHaptics, originalFn);
  });
});
