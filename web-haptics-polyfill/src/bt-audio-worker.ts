// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import './types.ts';
import { fillDualSenseChecksum } from './dualsense.ts';

let device: HIDDevice | null = null;
let isRunning = false;
let isSending = false;
let nextScheduledTime = 0;
let audioSeq = 0;

// DualSense Bluetooth Audio Parameters
// 3,000 Hz sample rate, 32 samples per report = 10.6667 ms per report
const SAMPLE_RATE = 3000;
const SAMPLES_PER_REPORT = 32;
const PACKET_DURATION_MS = (SAMPLES_PER_REPORT / SAMPLE_RATE) * 1000; // 10.6667 ms

// Active synthesizer state
interface ActiveWaveform {
  effect: string;
  frequency: number;
  sweepEnd?: number;
  harmonicMix?: number;
  durationMs: number;
  elapsedMs: number;
  intensity: number;
  phase: number;
  type: 'sine' | 'harmonic' | 'sweep' | 'burst' | 'double-pulse';
  burstCadence?: number;
}

const activeWaves: ActiveWaveform[] = [];

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    const match = msg.deviceMatch;
    if (!navigator.hid) return;
    const devices = await navigator.hid.getDevices();

    // Match the exact HID interface that the main thread opened
    device =
      devices.find((d: HIDDevice) => {
        if (d.vendorId !== match.vendorId || d.productId !== match.productId) return false;
        if (d.collections.length !== match.collections.length) return false;
        return d.collections.every(
          (c: any, i: number) =>
            c.usagePage === match.collections[i].usagePage &&
            c.usage === match.collections[i].usage
        );
      }) || null;

    if (device && !device.opened) {
      try {
        await device.open();
      } catch (err) {
        console.warn('DualSense Worker: device.open() note', err);
      }
    }

    if (device) {
      startAudioLoop();
      console.log('DualSense Web Worker: steady 3kHz BT audio haptics stream active');
    }
  } else if (msg.type === 'play') {
    const { effect, intensity } = msg;
    enqueueWaveform(effect, Math.max(0, Math.min(1, intensity ?? 1)));
  } else if (msg.type === 'stop') {
    activeWaves.length = 0;
  }
};

function startAudioLoop(): void {
  if (isRunning) return;
  isRunning = true;
  nextScheduledTime = performance.now();
  scheduleNextFrame();
}

function scheduleNextFrame(): void {
  if (!isRunning) return;
  nextScheduledTime += PACKET_DURATION_MS;
  const now = performance.now();
  // Self-adjusting drift compensation
  const delay = Math.max(0, nextScheduledTime - now);
  self.setTimeout(runAudioFrame, delay);
}

async function runAudioFrame(): Promise<void> {
  if (!isRunning || !device || !device.opened) {
    scheduleNextFrame();
    return;
  }

  // Prevent overlapping concurrent sendReport calls on Windows Bluetooth stack
  if (isSending) {
    scheduleNextFrame();
    return;
  }

  isSending = true;
  try {
    const reportData = buildReport0x32();
    await device.sendReport(0x32, reportData as any);
  } catch (e) {
    // Ignore transient transport hiccups
  } finally {
    isSending = false;
    scheduleNextFrame();
  }
}

function enqueueWaveform(effect: string, intensity: number): void {
  // Stevens' Power law scaling
  const scaledAmp = Math.pow(intensity, 1.5);

  switch (effect) {
    case 'tick':
      activeWaves.push({
        effect: 'tick',
        frequency: 150,
        durationMs: 35,
        elapsedMs: 0,
        intensity: scaledAmp,
        phase: 0,
        type: 'sine'
      });
      break;
    case 'hint':
      activeWaves.push({
        effect: 'hint',
        frequency: 150,
        durationMs: 45,
        elapsedMs: 0,
        intensity: scaledAmp * 0.4,
        phase: 0,
        type: 'sine'
      });
      break;
    case 'edge':
      activeWaves.push({
        effect: 'edge',
        frequency: 120,
        durationMs: 70,
        elapsedMs: 0,
        intensity: scaledAmp,
        phase: 0,
        type: 'harmonic',
        harmonicMix: 0.3
      });
      break;
    case 'align':
      activeWaves.push({
        effect: 'align',
        frequency: 220,
        sweepEnd: 140,
        durationMs: 40,
        elapsedMs: 0,
        intensity: scaledAmp,
        phase: 0,
        type: 'sweep'
      });
      break;
    case 'success':
      activeWaves.push({
        effect: 'success',
        frequency: 160,
        sweepEnd: 220,
        durationMs: 130,
        elapsedMs: 0,
        intensity: scaledAmp,
        phase: 0,
        type: 'double-pulse'
      });
      break;
    case 'error':
      activeWaves.push({
        effect: 'error',
        frequency: 100,
        durationMs: 160,
        elapsedMs: 0,
        intensity: scaledAmp,
        phase: 0,
        type: 'burst',
        burstCadence: 30
      });
      break;
  }
}

function buildReport0x32(): Uint8Array {
  const dt = 1 / SAMPLE_RATE;
  const samples = new Uint8Array(64);
  const dataView = new DataView(samples.buffer);

  for (let i = 0; i < SAMPLES_PER_REPORT; i++) {
    const frameT = i * dt;
    let sampleSum = 0;

    for (const wave of activeWaves) {
      const currentMs = wave.elapsedMs + frameT * 1000;
      const progress = Math.min(1, currentMs / wave.durationMs);

      let freq = wave.frequency;
      if (wave.type === 'sweep' && wave.sweepEnd !== undefined) {
        freq = wave.frequency + (wave.sweepEnd - wave.frequency) * progress;
      }

      wave.phase += 2 * Math.PI * freq * dt;
      if (wave.phase > 2 * Math.PI) {
        wave.phase -= 2 * Math.PI;
      }

      let env = 1.0;
      if (wave.type === 'sine') {
        // Fast 4ms attack, smooth exponential decay
        const attackProgress = Math.min(1, currentMs / 4);
        env = attackProgress * Math.exp(-progress * 3.5);
      } else if (wave.type === 'harmonic') {
        const attackProgress = Math.min(1, currentMs / 5);
        env = attackProgress * Math.max(0, 1 - progress);
      } else if (wave.type === 'sweep') {
        env = Math.sin(progress * Math.PI);
      } else if (wave.type === 'burst') {
        const inBurst = currentMs % 45 < (wave.burstCadence ?? 25);
        env = inBurst ? 1.0 : 0.0;
      } else if (wave.type === 'double-pulse') {
        // Ascending double pulse: Pulse 1 (0-35ms), gap (35-60ms), Pulse 2 (60-120ms)
        if (currentMs < 35) {
          env = Math.sin((currentMs / 35) * Math.PI);
        } else if (currentMs >= 60 && currentMs < 120) {
          env = Math.sin(((currentMs - 60) / 60) * Math.PI);
        } else {
          env = 0.0;
        }
      }

      let sampleVal = Math.sin(wave.phase);
      if (wave.type === 'harmonic' && wave.harmonicMix) {
        sampleVal = (sampleVal + wave.harmonicMix * Math.sin(wave.phase * 2)) / (1 + wave.harmonicMix);
      }

      sampleSum += sampleVal * env * wave.intensity;
    }

    // Master soft limiter (tanh)
    const limited = Math.tanh(sampleSum);
    const intVal = Math.max(-32768, Math.min(32767, Math.round(limited * 32767)));
    dataView.setInt16(i * 2, intVal, true);
  }

  // Advance elapsed time for active waveforms by exact packet duration
  for (let w = activeWaves.length - 1; w >= 0; w--) {
    activeWaves[w].elapsedMs += PACKET_DURATION_MS;
    if (activeWaves[w].elapsedMs >= activeWaves[w].durationMs) {
      activeWaves.splice(w, 1);
    }
  }

  // Construct Report 0x32 (141 bytes total)
  const reportData = new Uint8Array(141);
  reportData[0] = 0x00;

  // Sub-packet 1: Audio control header (Length 7)
  reportData[1] = 0x91;
  reportData[2] = 0x07;
  reportData[3] = 0xfe;
  reportData[4] = 0x00;
  reportData[5] = 0x00;
  reportData[6] = 0x00;
  reportData[7] = 0x00;
  reportData[8] = 0xff;
  reportData[9] = audioSeq;
  audioSeq = (audioSeq + 1) % 256;

  // Sub-packet 2: PCM Payload Header (64 bytes = 32 samples)
  reportData[10] = 0x92;
  reportData[11] = 0x40;
  reportData.set(samples, 12);

  fillDualSenseChecksum(0x32, reportData);
  return reportData;
}
