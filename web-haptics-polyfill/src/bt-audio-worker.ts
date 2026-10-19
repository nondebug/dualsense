// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import './types.ts';
import { fillDualSenseChecksum } from './dualsense.ts';

let device: HIDDevice | null = null;
let timerId: number | null = null;
let audioSeq = 0;

// Active synthesizer state
interface ActiveWaveform {
  frequency: number;
  durationMs: number;
  elapsedMs: number;
  intensity: number;
  type: 'sine' | 'harmonic' | 'sweep' | 'burst';
  sweepEnd?: number;
  harmonicMix?: number;
  burstCadence?: number;
}

const activeWaves: ActiveWaveform[] = [];

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    const match = msg.deviceMatch;
    if (!navigator.hid) return;
    const devices = await navigator.hid.getDevices();

    device = devices.find((d: HIDDevice) => {
      if (d.vendorId !== match.vendorId || d.productId !== match.productId) return false;
      if (d.collections.length !== match.collections.length) return false;
      return d.collections.every(
        (c: any, i: number) =>
          c.usagePage === match.collections[i].usagePage &&
          c.usage === match.collections[i].usage
      );
    }) || null;

    if (device && !device.opened) {
      await device.open();
    }

    if (device && timerId === null) {
      // 10 ms interval = 100 Hz report rate (16 stereo frames @ 1600 Hz)
      timerId = self.setInterval(processHapticsLoop, 10);
    }
  } else if (msg.type === 'play') {
    const { effect, intensity } = msg;
    enqueueWaveform(effect, Math.max(0, Math.min(1, intensity ?? 1)));
  } else if (msg.type === 'stop') {
    activeWaves.length = 0;
  }
};

function enqueueWaveform(effect: string, intensity: number): void {
  // Stevens' Power law scaling
  const scaledAmp = Math.pow(intensity, 1.5);

  switch (effect) {
    case 'tick':
      activeWaves.push({
        frequency: 160,
        durationMs: 10,
        elapsedMs: 0,
        intensity: scaledAmp,
        type: 'sine'
      });
      break;
    case 'hint':
      activeWaves.push({
        frequency: 150,
        durationMs: 30,
        elapsedMs: 0,
        intensity: scaledAmp * 0.35,
        type: 'sine'
      });
      break;
    case 'edge':
      activeWaves.push({
        frequency: 110,
        durationMs: 50,
        elapsedMs: 0,
        intensity: scaledAmp,
        type: 'harmonic',
        harmonicMix: 0.25
      });
      break;
    case 'align':
      activeWaves.push({
        frequency: 200,
        sweepEnd: 140,
        durationMs: 25,
        elapsedMs: 0,
        intensity: scaledAmp,
        type: 'sweep'
      });
      break;
    case 'success':
      activeWaves.push({
        frequency: 130,
        sweepEnd: 170,
        durationMs: 110,
        elapsedMs: 0,
        intensity: scaledAmp,
        type: 'sweep'
      });
      break;
    case 'error':
      activeWaves.push({
        frequency: 80,
        durationMs: 130,
        elapsedMs: 0,
        intensity: scaledAmp,
        type: 'burst',
        burstCadence: 30
      });
      break;
  }
}

async function processHapticsLoop(): Promise<void> {
  if (!device || !device.opened) return;

  const sampleRate = 1600; // 16 stereo frames in 10 ms = 1600 Hz
  const numFrames = 16;
  const samples = new Uint8Array(64); // 16 frames * 2 channels * 2 bytes = 64 bytes
  const dataView = new DataView(samples.buffer);

  let hasSignal = false;

  for (let frame = 0; frame < numFrames; frame++) {
    const tMs = frame * (1000 / sampleRate);
    let leftSum = 0;
    let rightSum = 0;

    for (let w = activeWaves.length - 1; w >= 0; w--) {
      const wave = activeWaves[w];
      const curT = (wave.elapsedMs + tMs) / 1000;

      if (wave.elapsedMs + tMs >= wave.durationMs) {
        activeWaves.splice(w, 1);
        continue;
      }

      hasSignal = true;
      let val = 0;
      const progress = (wave.elapsedMs + tMs) / wave.durationMs;

      if (wave.type === 'sine') {
        const decay = Math.exp(-progress * 4);
        val = Math.sin(2 * Math.PI * wave.frequency * curT) * wave.intensity * decay;
      } else if (wave.type === 'harmonic') {
        const f1 = Math.sin(2 * Math.PI * wave.frequency * curT);
        const f2 = Math.sin(2 * Math.PI * wave.frequency * 2 * curT);
        val = (f1 + (wave.harmonicMix ?? 0.25) * f2) * wave.intensity;
      } else if (wave.type === 'sweep') {
        const startF = wave.frequency;
        const endF = wave.sweepEnd ?? startF;
        const instantF = startF + (endF - startF) * progress;
        val = Math.sin(2 * Math.PI * instantF * curT) * wave.intensity;
      } else if (wave.type === 'burst') {
        // 30 ms burst, 18 ms silence
        const burstPeriod = 48;
        const inBurst = (wave.elapsedMs + tMs) % burstPeriod < (wave.burstCadence ?? 30);
        if (inBurst) {
          val = Math.sin(2 * Math.PI * wave.frequency * curT) * wave.intensity;
          val = val > 0 ? 0.9 : -0.9; // Square saturation
        }
      }

      leftSum += val;
      rightSum += val;
    }

    // Master soft-limiter (tanh)
    const limitedLeft = Math.tanh(leftSum);
    const limitedRight = Math.tanh(rightSum);

    const intLeft = Math.max(-32768, Math.min(32767, Math.round(limitedLeft * 32767)));
    const intRight = Math.max(-32768, Math.min(32767, Math.round(limitedRight * 32767)));

    // Interleaved stereo: Left (channel 2), Right (channel 3)
    dataView.setInt16(frame * 4, intLeft, true);
    dataView.setInt16(frame * 4 + 2, intRight, true);
  }

  // Advance wave elapsed times by 10 ms
  for (const wave of activeWaves) {
    wave.elapsedMs += 10;
  }

  if (!hasSignal && activeWaves.length === 0) {
    // Only send silence if needed to clear DAC or occasionally keep alive
    return;
  }

  // Construct Report 0x32
  const reportData = new Uint8Array(141);
  reportData[0] = 0x00;

  // Header 0x91 0x07
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

  // PCM Payload Header 0x92 0x40
  reportData[10] = 0x92;
  reportData[11] = 0x40;
  reportData.set(samples, 12);

  fillDualSenseChecksum(0x32, reportData);

  try {
    await device.sendReport(0x32, reportData);
  } catch (e) {
    // Ignore report send errors to prevent console flooding
  }
}
