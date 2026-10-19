// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import type { AudioSinkInfo, HapticEffect, TransportType } from './types.ts';

export class HapticsAudioEngine {
  ctx: AudioContext | null = null;
  merger: ChannelMergerNode | null = null;
  masterHapticGain: GainNode | null = null;
  limiter: DynamicsCompressorNode | null = null;
  transport: TransportType = 'usb';
  btWorker: Worker | null = null;

  async requestMicrophonePermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (e) {
      console.warn('Microphone permission denied; audio output labels may be masked.', e);
      return false;
    }
  }

  async getMatchingAudioSinks(): Promise<AudioSinkInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    const matches: AudioSinkInfo[] = [];

    for (const d of devices) {
      if (d.kind !== 'audiooutput') continue;
      const label = d.label.toLowerCase();
      if (
        (label.includes('wireless controller') || label.includes('dualsense')) &&
        !label.includes('default')
      ) {
        matches.push({
          deviceId: d.deviceId,
          label: d.label || 'DualSense Audio Output',
          channels: 4 // Verified on actual hardware/OS setup
        });
      }
    }

    return matches;
  }

  async initializeUSB(sinkId: string): Promise<{ success: boolean; channels: number; error?: string }> {
    this.transport = 'usb';
    try {
      const options: AudioContextOptions = {
        sampleRate: 48000,
        latencyHint: 'interactive'
      };
      if (sinkId) {
        (options as any).sinkId = sinkId;
      }

      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)(options);

      const maxChannels = this.ctx.destination.maxChannelCount;
      if (maxChannels < 4) {
        return {
          success: false,
          channels: maxChannels,
          error: `Audio device exposes only ${maxChannels} channel(s). 4 channels (Quadraphonic) required.`
        };
      }

      this.ctx.destination.channelCount = 4;
      this.ctx.destination.channelCountMode = 'explicit';
      this.ctx.destination.channelInterpretation = 'discrete';

      this.merger = this.ctx.createChannelMerger(4);
      this.merger.connect(this.ctx.destination);

      // Master Limiter to prevent clipping under additive mixing
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3.0; // dB
      this.limiter.knee.value = 6.0;
      this.limiter.ratio.value = 20.0;
      this.limiter.attack.value = 0.001; // 1 ms
      this.limiter.release.value = 0.05; // 50 ms

      this.masterHapticGain = this.ctx.createGain();
      this.masterHapticGain.gain.value = 1.0;

      // Additive bus -> Limiter -> Channels 2 & 3 (Rear L/R Voice-Coils)
      this.masterHapticGain.connect(this.limiter);
      this.limiter.connect(this.merger, 0, 2);
      this.limiter.connect(this.merger, 0, 3);

      await this.ctx.resume();
      return { success: true, channels: maxChannels };
    } catch (err: any) {
      return {
        success: false,
        channels: 0,
        error: err?.message || 'Failed to initialize Web Audio context'
      };
    }
  }

  initializeBluetooth(hidDevice: HIDDevice): void {
    this.transport = 'bluetooth';
    if (!this.btWorker) {
      this.btWorker = new Worker(new URL('./bt-audio-worker.ts', import.meta.url), {
        type: 'module'
      });
    }

    const deviceMatch = {
      vendorId: hidDevice.vendorId,
      productId: hidDevice.productId,
      collections: hidDevice.collections.map((c: any) => ({
        usagePage: c.usagePage,
        usage: c.usage
      }))
    };

    this.btWorker.postMessage({ type: 'init', deviceMatch });
  }

  playEffect(effect: HapticEffect, intensity = 1.0): void {
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    if (clampedIntensity <= 0) return;

    if (this.transport === 'bluetooth' && this.btWorker) {
      this.btWorker.postMessage({
        type: 'play',
        effect,
        intensity: clampedIntensity
      });
      return;
    }

    if (!this.ctx || !this.masterHapticGain) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.synthesizeEffectUSB(effect, clampedIntensity);
  }

  private synthesizeEffectUSB(effect: HapticEffect, intensity: number): void {
    if (!this.ctx || !this.masterHapticGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const scaledAmp = Math.pow(intensity, 1.5); // Stevens' Power Law

    switch (effect) {
      case 'tick': {
        // 160 Hz crisp impulse, 10 ms duration
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(scaledAmp * 0.9, now + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.01);

        osc.connect(gain);
        gain.connect(this.masterHapticGain);
        osc.start(now);
        osc.stop(now + 0.012);
        break;
      }
      case 'hint': {
        // 150 Hz soft tap, 30 ms duration, gentle Tukey envelope
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(scaledAmp * 0.35, now + 0.01);
        gain.gain.linearRampToValueAtTime(0, now + 0.03);

        osc.connect(gain);
        gain.connect(this.masterHapticGain);
        osc.start(now);
        osc.stop(now + 0.035);
        break;
      }
      case 'edge': {
        // 110 Hz solid barrier thump + 220 Hz harmonic, 50 ms duration
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(110, now);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(220, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(scaledAmp * 1.0, now + 0.001);
        gain.gain.setValueAtTime(scaledAmp * 0.8, now + 0.025);
        gain.gain.linearRampToValueAtTime(0, now + 0.05);

        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.25;
        osc2.connect(osc2Gain);
        osc2Gain.connect(gain);
        osc1.connect(gain);

        gain.connect(this.masterHapticGain);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.055);
        osc2.stop(now + 0.055);
        break;
      }
      case 'align': {
        // Frequency down-sweep (200 Hz -> 140 Hz), 25 ms duration
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.025);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(scaledAmp * 0.9, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

        osc.connect(gain);
        gain.connect(this.masterHapticGain);
        osc.start(now);
        osc.stop(now + 0.028);
        break;
      }
      case 'success': {
        // Dual ascending resonant pulses: 130 Hz (35ms) -> 25ms gap -> 170 Hz (50ms)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(130, now);
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(scaledAmp * 0.6, now + 0.008);
        gain1.gain.linearRampToValueAtTime(0, now + 0.035);

        osc1.connect(gain1);
        gain1.connect(this.masterHapticGain);
        osc1.start(now);
        osc1.stop(now + 0.04);

        const p2Start = now + 0.06;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(170, p2Start);
        gain2.gain.setValueAtTime(0, p2Start);
        gain2.gain.linearRampToValueAtTime(scaledAmp * 1.0, p2Start + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.0001, p2Start + 0.05);

        osc2.connect(gain2);
        gain2.connect(this.masterHapticGain);
        osc2.start(p2Start);
        osc2.stop(p2Start + 0.055);
        break;
      }
      case 'error': {
        // Triple dissonant bursts at 80 Hz with square saturation
        const period = 0.042; // 42 ms per burst cycle
        for (let b = 0; b < 3; b++) {
          const bStart = now + b * period;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth'; // Rich discordant buzz
          osc.frequency.setValueAtTime(80, bStart);

          gain.gain.setValueAtTime(0, bStart);
          gain.gain.linearRampToValueAtTime(scaledAmp * 0.85, bStart + 0.002);
          gain.gain.setValueAtTime(scaledAmp * 0.7, bStart + 0.024);
          gain.gain.linearRampToValueAtTime(0, bStart + 0.028);

          osc.connect(gain);
          gain.connect(this.masterHapticGain);
          osc.start(bStart);
          osc.stop(bStart + 0.03);
        }
        break;
      }
    }
  }

  disconnect(): void {
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (e) {}
      this.ctx = null;
    }
    if (this.btWorker) {
      this.btWorker.postMessage({ type: 'stop' });
      this.btWorker.terminate();
      this.btWorker = null;
    }
  }
}
