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

// Exact 21.333333 ms interval (1024 samples @ 48 kHz = 2 haptic blocks of 10.6667 ms each)
const AUDIO_INTERVAL_MS = 21.333333;
const STATE_HEARTBEAT_INTERVAL_MS = 250;

const stateReportBuffer = new Uint8Array(STATE_REPORT_LENGTH);
const stateReportPayload = stateReportBuffer.subarray(1);
const resampleOutputBuffer = new Float32Array(SAMPLES_PER_OPUS_PACKET * 2);

// Ring buffer for timing jitter elimination (fed by 48 kHz AudioWorkletProcessor)
const RING_CAPACITY = 4;
const ringBuffers = Array.from({ length: RING_CAPACITY }, () => new Uint8Array(FULL_REPORT_LENGTH));
const ringPayloads = ringBuffers.map((b) => b.subarray(1));
let ringWriteIndex = 0;
let ringReadIndex = 0;
let ringCount = 0;

// Pre-built 200-byte silent CBR Opus packet (TOC 0xFC: Fullband stereo 10ms CELT + DTX silence)
const SILENT_OPUS_FRAME = new Uint8Array(200);
SILENT_OPUS_FRAME[0] = 0xfc;
SILENT_OPUS_FRAME[1] = 0xff;
SILENT_OPUS_FRAME[2] = 0xfe;

let hidDevice: HIDDevice | null = null;
let audioPort: MessagePort | null = null;
let isAudioLoopRunning = false;
let audioTimerHandle: number | null = null;
let nextAudioSendTime = 0;
let lastStateReportTimestamp = 0;
let lastFrameEnergy = 0;

let packetCounter = 0;
let sequenceCounter = 0;

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

function resampleStereoLinear(
  input: Float32Array,
  inputFrames: number,
  output: Float32Array,
  outputFrames: number
): void {
  const step = inputFrames / outputFrames;
  for (let outputFrame = 0; outputFrame < outputFrames; outputFrame++) {
    const sourcePosition = outputFrame * step;
    const sourceFrame = Math.floor(sourcePosition);
    const fraction = sourcePosition - sourceFrame;
    const nextFrame = Math.min(sourceFrame + 1, inputFrames - 1);

    const sourceOffset = sourceFrame * 2;
    const nextOffset = nextFrame * 2;
    const outputOffset = outputFrame * 2;

    output[outputOffset] =
      input[sourceOffset] + (input[nextOffset] - input[sourceOffset]) * fraction;
    output[outputOffset + 1] =
      input[sourceOffset + 1] + (input[nextOffset + 1] - input[sourceOffset + 1]) * fraction;
  }
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

// --- HD Haptics Block Generation ---
function fillHapticBlocks(report: Uint8Array, pcmFrame: Float32Array | null): number {
  if (!pcmFrame) {
    report[10] = 0xd2;
    report[11] = 64;
    report.fill(0, 12, 140);
    return 0;
  }

  const pcm = pcmFrame;
  const totalInputFrames = pcm.length / 2;
  const windowSize = SAMPLES_PER_OPUS_PACKET / 64;

  report[10] = 0xd2;
  report[11] = 64;

  let energy = 0;
  for (let i = 0; i < 64; i++) {
    const windowStart = Math.floor(i * windowSize);
    const windowEnd = Math.min(Math.floor((i + 1) * windowSize), totalInputFrames);

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
    report[12 + i * 2] = Math.round(peakLeft * 127.0) & 0xff;
    report[12 + i * 2 + 1] = Math.round(peakRight * 127.0) & 0xff;
  }

  return energy;
}

function buildAudioReportIntoSlot(slotIndex: number, pcmFrame: Float32Array): void {
  const report = ringBuffers[slotIndex];

  report[0] = AUDIO_REPORT_ID;
  report[2] = 0x91;
  report[3] = 0x06;
  report[4] = 0x7e;

  report[5] = 64;
  report[6] = 64;
  report[7] = 64;
  report[8] = 64;

  lastFrameEnergy = fillHapticBlocks(report, pcmFrame);

  // Opus packet framing (muted speaker target 0x13 | 0xC0 = 0xD3)
  report[140] = 0x13 | 0xc0;
  report[141] = SILENT_OPUS_FRAME.length;
  report.set(SILENT_OPUS_FRAME, 142);
  report.set(SILENT_OPUS_FRAME, 342);
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
  ringCount = 0;
  ringReadIndex = 0;
  ringWriteIndex = 0;
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

  if (hidDevice && hidDevice.opened && ringCount > 0) {
    const slot = ringReadIndex;
    ringReadIndex = (ringReadIndex + 1) % RING_CAPACITY;
    ringCount--;

    const report = ringBuffers[slot];
    const payload = ringPayloads[slot];

    // Stamp sequence, packet counter, and CRC directly before sending
    report[1] = getNextSequenceByte();
    packetCounter = (packetCounter + 2) & 0xff;
    report[9] = packetCounter;
    fillSonyCrc(report);

    try {
      await hidDevice.sendReport(AUDIO_REPORT_ID, payload as any);
    } catch (err) {
      // Ignore transient Bluetooth report errors
    }

    // Interleaved State Report (keeps audio/haptic configuration & LPF active)
    const now = performance.now();
    if (now - lastStateReportTimestamp > STATE_HEARTBEAT_INTERVAL_MS) {
      buildStateReport(lastFrameEnergy);
      try {
        await hidDevice.sendReport(STATE_REPORT_ID, stateReportPayload as any);
      } catch (err) {
        // Ignore transient state report errors
      }
    }
  }

  scheduleAudioSendTick();
}

function attachAudioPort(port: MessagePort): void {
  audioPort = port;
  audioPort.onmessage = (event: MessageEvent) => {
    if (!hidDevice || !hidDevice.opened) {
      if (event.data?.pcm?.buffer) {
        audioPort?.postMessage({ action: 'recycle-buffer', buffer: event.data.pcm.buffer }, [
          event.data.pcm.buffer
        ]);
      }
      return;
    }

    const { pcm } = event.data;
    if (!pcm) return;

    resampleStereoLinear(pcm, 1024, resampleOutputBuffer, SAMPLES_PER_OPUS_PACKET);

    if (ringCount < RING_CAPACITY) {
      buildAudioReportIntoSlot(ringWriteIndex, resampleOutputBuffer);
      ringWriteIndex = (ringWriteIndex + 1) % RING_CAPACITY;
      ringCount++;
    } else {
      // Overwrite oldest slot if queue is full to prevent latency buildup
      buildAudioReportIntoSlot(ringWriteIndex, resampleOutputBuffer);
      ringWriteIndex = (ringWriteIndex + 1) % RING_CAPACITY;
      ringReadIndex = (ringReadIndex + 1) % RING_CAPACITY;
    }

    // Start send loop once buffer is primed (at least 2 packets, matching ulti-demo)
    if (!isAudioLoopRunning && ringCount >= 2) {
      startAudioSendLoop();
    }

    if (pcm.buffer) {
      audioPort?.postMessage({ action: 'recycle-buffer', buffer: pcm.buffer }, [pcm.buffer]);
    }
  };
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    const match = msg.deviceMatch;
    if (msg.port) {
      attachAudioPort(msg.port);
    }
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

      console.log('DualSense Web Worker: Web Audio -> AudioWorklet -> BT stream initialized');
    }
  } else if (msg.type === 'stop') {
    stopAudioSendLoop();
  }
};
