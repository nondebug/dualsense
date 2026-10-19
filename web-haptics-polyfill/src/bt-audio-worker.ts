// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import './types.ts';

const VENDOR_SONY = 0x054c;
const PRODUCT_SONY_DUALSENSE = 0x0ce6;
const PRODUCT_SONY_DUALSENSE_EDGE = 0x0df2;

const STATE_REPORT_ID = 0x32;
const AUDIO_REPORT_ID = 0x39;
const FULL_REPORT_LENGTH = 547;
const STATE_REPORT_LENGTH = 142;

const CHANNELS = 2;
const FRAMES_PER_OPUS_PACKET = 480;
const SAMPLES_PER_OPUS_PACKET = FRAMES_PER_OPUS_PACKET * CHANNELS; // 960
const TOTAL_PCM_FRAMES = FRAMES_PER_OPUS_PACKET * 2; // 960 stereo frames per 21.333ms report
const SYNTH_SAMPLE_RATE = 45000; // 960 frames / 0.021333333s = 45,000 Hz
const DT_SAMPLE = 1 / SYNTH_SAMPLE_RATE;

// Exact 21.333333 ms interval (1024 samples @ 48 kHz = 2 haptic blocks of 10.6667 ms each)
const AUDIO_INTERVAL_MS = 21.333333;
const STATE_HEARTBEAT_INTERVAL_MS = 250;

const audioReportBuffer = new Uint8Array(FULL_REPORT_LENGTH);
const stateReportBuffer = new Uint8Array(STATE_REPORT_LENGTH);
const audioReportPayload = audioReportBuffer.subarray(1);
const stateReportPayload = stateReportBuffer.subarray(1);
const pcmStereoBuffer = new Float32Array(TOTAL_PCM_FRAMES * CHANNELS);

// Pre-built 200-byte silent CBR Opus packet (TOC 0xFC: Fullband stereo 10ms CELT + DTX silence)
const SILENT_OPUS_FRAME = new Uint8Array(200);
SILENT_OPUS_FRAME[0] = 0xfc;
SILENT_OPUS_FRAME[1] = 0xff;
SILENT_OPUS_FRAME[2] = 0xfe;

let hidDevice: HIDDevice | null = null;
let isAudioLoopRunning = false;
let audioTimerHandle: number | null = null;
let nextAudioSendTime = 0;
let lastStateReportTimestamp = 0;

let packetCounter = 0;
let sequenceCounter = 0;

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

// --- Sony DualSense CRC32 Implementation (from ulti/dualsense-bluetooth-audio-haptics-demo) ---
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let bit = 0; bit < 8; bit++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function fillSonyCrc(report: Uint8Array): number {
  const dataLen = report.length - 4;
  let crc = ~0xeada2d49 >>> 0;
  for (let i = 0; i < dataLen; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ report[i]) & 0xff];
  }
  crc = ~crc >>> 0;
  report[dataLen] = crc & 0xff;
  report[dataLen + 1] = (crc >>> 8) & 0xff;
  report[dataLen + 2] = (crc >>> 16) & 0xff;
  report[dataLen + 3] = (crc >>> 24) & 0xff;
  return crc;
}

function getNextSequenceByte(): number {
  const seqByte = (sequenceCounter << 4) & 0xff;
  sequenceCounter = (sequenceCounter + 1) & 0x0f;
  return seqByte;
}

function isDualSenseBluetooth(device: HIDDevice): boolean {
  return (
    device.vendorId === VENDOR_SONY &&
    (device.productId === PRODUCT_SONY_DUALSENSE ||
      device.productId === PRODUCT_SONY_DUALSENSE_EDGE) &&
    device.collections.some(
      (c: any) =>
        c.outputReports?.some((r: any) => r.reportId === STATE_REPORT_ID) &&
        c.outputReports?.some((r: any) => r.reportId === AUDIO_REPORT_ID)
    )
  );
}

// --- State Report 0x32 (0x90, 0x3F) ---
// Enables Audio Control & Haptic Low-Pass Filter, disables classic rumble emulation
function buildStateReport(energy = 0): void {
  const report = stateReportBuffer;
  report.fill(0);

  const intensity = Math.min(1.0, energy / 10);
  const coldR = 0;
  const coldG = 144;
  const coldB = 255;
  const hotR = 30;
  const hotG = 255;
  const hotB = 120;

  const colorR = Math.sqrt(0.5 * (hotR * hotR * intensity + coldR * coldR * (1 - intensity)));
  const colorG = Math.sqrt(0.5 * (hotG * hotG * intensity + coldG * coldG * (1 - intensity)));
  const colorB = Math.sqrt(0.5 * (hotB * hotB * intensity + coldB * coldB * (1 - intensity)));

  report[0] = STATE_REPORT_ID;
  report[1] = getNextSequenceByte();
  report[2] = 0x90;
  report[3] = 0x3f;

  const state = 4;
  report[state + 0] = 0xf0; // ~EnableRumbleEmulation, ~UseRumbleNotHaptics, AllowAudioControl
  report[state + 1] = 0xb7; // AllowMuteLight, AllowAudioMute, AllowLedColor, AllowPlayerIndicators, AllowHapticLowPassFilter, AllowAudioControl2
  report[state + 4] = 0x00; // VolumeHeadphones (muted so silent Opus stream makes no sound)
  report[state + 5] = 0x00; // VolumeSpeaker (muted)
  report[state + 6] = 0x00; // VolumeMic
  report[state + 7] = 0x00; // OutputPathSelect
  report[state + 8] = 0x00; // MuteLightMode
  report[state + 37] = 0x01; // SpeakerCompPreGain
  report[state + 38] = 0x03; // AllowLightBrightnessChange | AllowColorLightFadeAnimation
  report[state + 39] = 0x01; // HapticLowPassFilter
  report[state + 41] = 0x02; // LightFadeAnimation
  report[state + 42] = 0x00; // LightBrightness
  report[state + 43] = (1 << 2) | (1 << 5); // Center player LED + fade
  report[state + 44] = Math.round(colorR) & 0xff;
  report[state + 45] = Math.round(colorG) & 0xff;
  report[state + 46] = Math.round(colorB) & 0xff;

  fillSonyCrc(report);
  lastStateReportTimestamp = performance.now();
}

// --- Synthesize Active Haptic Effects into 960 Stereo Frames (21.333333 ms) ---
function synthesizePcmFrame(output: Float32Array): boolean {
  if (activeWaves.length === 0) {
    output.fill(0);
    return false;
  }

  let hasSignal = false;

  for (let frame = 0; frame < TOTAL_PCM_FRAMES; frame++) {
    const frameTimeMs = frame * DT_SAMPLE * 1000;
    let sampleSum = 0;

    for (const wave of activeWaves) {
      const currentMs = wave.elapsedMs + frameTimeMs;
      if (currentMs >= wave.durationMs) continue;

      hasSignal = true;
      const progress = Math.min(1, currentMs / wave.durationMs);

      let freq = wave.frequency;
      if (wave.type === 'sweep' && wave.sweepEnd !== undefined) {
        freq = wave.frequency + (wave.sweepEnd - wave.frequency) * progress;
      } else if (wave.type === 'double-pulse' && wave.sweepEnd !== undefined && currentMs >= 60) {
        freq = wave.sweepEnd;
      }

      wave.phase += 2 * Math.PI * freq * DT_SAMPLE;
      if (wave.phase > 2 * Math.PI) {
        wave.phase -= 2 * Math.PI;
      }

      let env = 1.0;
      if (wave.type === 'sine') {
        const attack = Math.min(1, currentMs / 3);
        env = attack * Math.exp(-progress * 3.5);
      } else if (wave.type === 'harmonic') {
        const attack = Math.min(1, currentMs / 4);
        env = attack * Math.max(0, 1 - progress);
      } else if (wave.type === 'sweep') {
        env = Math.sin(progress * Math.PI);
      } else if (wave.type === 'burst') {
        const inBurst = currentMs % 45 < (wave.burstCadence ?? 25);
        env = inBurst ? 1.0 : 0.0;
      } else if (wave.type === 'double-pulse') {
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
        sampleVal =
          (sampleVal + wave.harmonicMix * Math.sin(wave.phase * 2)) / (1 + wave.harmonicMix);
      }

      sampleSum += sampleVal * env * wave.intensity;
    }

    // Master soft limiter
    const limited = Math.tanh(sampleSum);
    output[frame * 2] = limited;
    output[frame * 2 + 1] = limited;
  }

  // Advance elapsed time for active waveforms by exact 21.333333 ms report interval
  for (let w = activeWaves.length - 1; w >= 0; w--) {
    activeWaves[w].elapsedMs += AUDIO_INTERVAL_MS;
    if (activeWaves[w].elapsedMs >= activeWaves[w].durationMs) {
      activeWaves.splice(w, 1);
    }
  }

  return hasSignal;
}

// --- HD Haptics Block Generation (from ulti/dualsense-bluetooth-audio-haptics-demo) ---
function fillHapticBlocks(report: Uint8Array, pcmFrame: Float32Array | null): number {
  if (!pcmFrame) {
    report[10] = 0xd0;
    report[11] = 64;
    report.fill(0, 12, 74);
    report[74] = 0xd0;
    report[75] = 64;
    report.fill(0, 76, 138);
    return 0;
  }

  const pcm = pcmFrame;
  const totalInputFrames = pcm.length / 2;
  const windowSize = SAMPLES_PER_OPUS_PACKET / 62;

  function populateBlock(
    blockHeaderOffset: number,
    dataHeaderOffset: number,
    startIndex: number
  ): number {
    report[blockHeaderOffset] = 0xd2;
    report[blockHeaderOffset + 1] = 64;

    let energy = 0;
    for (let i = 0; i < 31; i++) {
      const pairIndex = startIndex + i;
      const windowStart = Math.floor(pairIndex * windowSize);
      const windowEnd = Math.min(Math.floor((pairIndex + 1) * windowSize), totalInputFrames);

      let peakLeft = 0;
      let peakRight = 0;

      for (let f = windowStart; f < windowEnd; f++) {
        const lVal = pcm[f * 2];
        const rVal = pcm[f * 2 + 1];

        if (Math.abs(lVal) > Math.abs(peakLeft)) peakLeft = lVal;
        if (Math.abs(rVal) > Math.abs(peakRight)) peakRight = rVal;
      }

      if (Math.abs(peakLeft) < 0.005) peakLeft = 0;
      if (Math.abs(peakRight) < 0.005) peakRight = 0;
      if (peakLeft > 1.0) peakLeft = 1.0;
      if (peakLeft < -1.0) peakLeft = -1.0;
      if (peakRight > 1.0) peakRight = 1.0;
      if (peakRight < -1.0) peakRight = -1.0;

      energy += peakLeft * peakLeft + peakRight * peakRight;
      report[dataHeaderOffset + i * 2] = Math.round(peakLeft * 127.0) & 0xff;
      report[dataHeaderOffset + i * 2 + 1] = Math.round(peakRight * 127.0) & 0xff;
    }

    if (energy < 0.0001) {
      report[blockHeaderOffset] = 0xd0;
      report[blockHeaderOffset + 1] = 64;
      report.fill(0, dataHeaderOffset, dataHeaderOffset + 62);
    }
    return energy;
  }

  return populateBlock(10, 12, 0) + populateBlock(74, 76, 31);
}

function buildAudioReport(): number {
  const report = audioReportBuffer;

  report[0] = AUDIO_REPORT_ID;
  report[1] = getNextSequenceByte();
  report[2] = 0x91;
  report[3] = 0x06;
  report[4] = 0x7e;

  report[5] = 64;
  report[6] = 64;
  report[7] = 64;
  report[8] = 64;

  packetCounter = (packetCounter + 2) & 0xff;
  report[9] = packetCounter;

  const hasSignal = synthesizePcmFrame(pcmStereoBuffer);
  const frameEnergy = fillHapticBlocks(report, hasSignal ? pcmStereoBuffer : null);

  // Opus packet framing (muted speaker target 0x13 | 0xC0 = 0xD3)
  report[140] = 0x13 | 0xc0;
  report[141] = SILENT_OPUS_FRAME.length;
  report.set(SILENT_OPUS_FRAME, 142);
  report.set(SILENT_OPUS_FRAME, 342);

  fillSonyCrc(report);
  return frameEnergy;
}

// --- Drift-Compensated 21.333333 ms Send Loop ---
function startAudioSendLoop(): void {
  if (isAudioLoopRunning) return;
  isAudioLoopRunning = true;
  nextAudioSendTime = performance.now();
  scheduleAudioSendTick();
}

function stopAudioSendLoop(): void {
  isAudioLoopRunning = false;
  if (audioTimerHandle !== null) {
    clearTimeout(audioTimerHandle);
    audioTimerHandle = null;
  }
}

function scheduleAudioSendTick(): void {
  if (!isAudioLoopRunning) return;
  nextAudioSendTime += AUDIO_INTERVAL_MS;
  const now = performance.now();
  const delay = Math.max(0, nextAudioSendTime - now);
  audioTimerHandle = self.setTimeout(sendAudioReportTick, delay);
}

async function sendAudioReportTick(): Promise<void> {
  if (!isAudioLoopRunning) return;

  if (hidDevice && hidDevice.opened) {
    const frameEnergy = buildAudioReport();
    try {
      await hidDevice.sendReport(AUDIO_REPORT_ID, audioReportPayload as any);
    } catch (err) {
      // Ignore transient Bluetooth report errors
    }

    // Interleaved State Report (keeps audio/haptic configuration & LPF active)
    const now = performance.now();
    if (now - lastStateReportTimestamp > STATE_HEARTBEAT_INTERVAL_MS) {
      buildStateReport(frameEnergy);
      try {
        await hidDevice.sendReport(STATE_REPORT_ID, stateReportPayload as any);
      } catch (err) {
        // Ignore transient state report errors
      }
    }
  }

  scheduleAudioSendTick();
}

function enqueueWaveform(effect: string, intensity: number): void {
  // Stevens' Power law scaling
  const scaledAmp = Math.pow(intensity, 1.5);

  switch (effect) {
    case 'tick':
      activeWaves.push({
        effect: 'tick',
        frequency: 150,
        durationMs: 40,
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
        sweepEnd: 130,
        durationMs: 35,
        elapsedMs: 0,
        intensity: scaledAmp,
        phase: 0,
        type: 'sweep'
      });
      break;
    case 'success':
      activeWaves.push({
        effect: 'success',
        frequency: 150,
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
        frequency: 95,
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

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    const match = msg.deviceMatch;
    if (!navigator.hid) return;
    const devices = await navigator.hid.getDevices();

    hidDevice =
      devices.find((d: HIDDevice) => {
        if (!match) return isDualSenseBluetooth(d);
        if (d.vendorId !== match.vendorId || d.productId !== match.productId) return false;
        if (d.collections.length !== match.collections.length) return false;
        return d.collections.every(
          (c: any, i: number) =>
            c.usagePage === match.collections[i].usagePage &&
            c.usage === match.collections[i].usage
        );
      }) ||
      devices.find(isDualSenseBluetooth) ||
      null;

    if (hidDevice && !hidDevice.opened) {
      try {
        await hidDevice.open();
      } catch (err) {
        console.warn('DualSense Worker: device.open() note', err);
      }
    }

    if (hidDevice) {
      stopAudioSendLoop();

      // Initial state handshake burst (matches ulti/dualsense-bluetooth-audio-haptics-demo)
      for (let i = 0; i < 6; i++) {
        buildStateReport(0);
        try {
          await hidDevice.sendReport(STATE_REPORT_ID, stateReportPayload as any);
        } catch (err) {
          // Ignore transient init errors
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      startAudioSendLoop();
      console.log('DualSense Web Worker: 21.33ms dual-block BT audio haptics stream active');
    }
  } else if (msg.type === 'play') {
    const { effect, intensity } = msg;
    enqueueWaveform(effect, Math.max(0, Math.min(1, intensity ?? 1)));
  } else if (msg.type === 'stop') {
    activeWaves.length = 0;
    stopAudioSendLoop();
  }
};
