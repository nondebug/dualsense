// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import type { DualSenseState, DualSenseStateListener, TouchPoint, TransportType } from './types.ts';

export const VENDOR_ID_SONY = 0x054c;
export const PRODUCT_ID_DUAL_SENSE = 0x0ce6;
export const PRODUCT_ID_DUAL_SENSE_EDGE = 0x0df2;

export const USAGE_PAGE_GENERIC_DESKTOP = 0x0001;
export const USAGE_ID_GD_GAME_PAD = 0x0005;

export const DUAL_SENSE_USB_INPUT_REPORT_0x01_SIZE = 63;
export const DUAL_SENSE_BT_INPUT_REPORT_0x01_SIZE = 9;
export const DUAL_SENSE_BT_INPUT_REPORT_0x31_SIZE = 77;

// Generate IEEE 802.3 CRC-32 table
const makeCRCTable = (): Uint32Array => {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; ++n) {
    let c = n;
    for (let k = 0; k < 8; ++k) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  return crcTable;
};

const gCrcTable = makeCRCTable();

export const crc32 = (prefixBytes: number[], dataView: DataView): number => {
  let crc = (-1 >>> 0);
  for (const byte of prefixBytes) {
    crc = (crc >>> 8) ^ gCrcTable[(crc ^ byte) & 0xff];
  }
  for (let i = 0; i < dataView.byteLength; ++i) {
    crc = (crc >>> 8) ^ gCrcTable[(crc ^ dataView.getUint8(i)) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
};

export const fillDualSenseChecksum = (reportId: number, reportData: Uint8Array): void => {
  const crc = crc32([0xa2, reportId], new DataView(reportData.buffer, 0, reportData.byteLength - 4));
  reportData[reportData.byteLength - 4] = (crc >>> 0) & 0xff;
  reportData[reportData.byteLength - 3] = (crc >>> 8) & 0xff;
  reportData[reportData.byteLength - 2] = (crc >>> 16) & 0xff;
  reportData[reportData.byteLength - 1] = (crc >>> 24) & 0xff;
};

export class DualSenseController {
  device: HIDDevice;
  transport: TransportType = 'usb';
  listeners: Set<DualSenseStateListener> = new Set();
  audioSeq = 0;
  outputSeq = 0;

  state: DualSenseState = {
    leftStickX: 0,
    leftStickY: 0,
    rightStickX: 0,
    rightStickY: 0,
    l2Axis: 0,
    r2Axis: 0,
    cross: false,
    circle: false,
    square: false,
    triangle: false,
    l1: false,
    r1: false,
    l2Btn: false,
    r2Btn: false,
    create: false,
    options: false,
    l3: false,
    r3: false,
    dpadUp: false,
    dpadDown: false,
    dpadLeft: false,
    dpadRight: false,
    ps: false,
    touchpadClick: false,
    mute: false,
    touch0: { active: false, id: 0, x: 0, y: 0 },
    touch1: { active: false, id: 0, x: 0, y: 0 },
    batteryLevel: 100,
    isCharging: false,
    isFullyCharged: false,
    isPlugged: false,
    headphoneConnected: false,
    micConnected: false,
    micMuted: false,
    gyroX: 0,
    gyroY: 0,
    gyroZ: 0,
    accelX: 0,
    accelY: 0,
    accelZ: 0
  };

  constructor(device: HIDDevice) {
    this.device = device;
    this.detectTransport();
  }

  private detectTransport(): void {
    for (const c of this.device.collections) {
      if (c.usagePage !== USAGE_PAGE_GENERIC_DESKTOP || c.usage !== USAGE_ID_GD_GAME_PAD) {
        continue;
      }
      const maxInputBits = c.inputReports.reduce((max: number, report: any) => {
        return Math.max(
          max,
          report.items.reduce((sum: number, item: any) => sum + item.reportSize * item.reportCount, 0)
        );
      }, 0);

      if (maxInputBits === 504) {
        this.transport = 'usb';
      } else if (maxInputBits === 616) {
        this.transport = 'bluetooth';
      }
    }
  }

  async initialize(): Promise<void> {
    if (!this.device.opened) {
      await this.device.open();
    }

    this.device.oninputreport = (e: HIDInputReportEvent) => this.handleInputReport(e);

    if (this.transport === 'bluetooth') {
      await this.setBluetoothHighReportingMode();
      await this.sendOutputReportBT();
    } else {
      await this.silenceClassicRumbleUSB();
    }
  }

  async setBluetoothHighReportingMode(): Promise<void> {
    try {
      await this.device.receiveFeatureReport(0x05);
    } catch (err) {
      console.warn('DualSense: receiveFeatureReport(0x05) fallback', err);
    }
  }

  async silenceClassicRumbleUSB(): Promise<void> {
    // Send output report 0x02 with 47 zeros to disable rumble emulation mode
    try {
      await this.device.sendReport(0x02, new Uint8Array(47));
    } catch (e) {
      console.warn('DualSense: USB report 0x02 init note', e);
    }
  }

  subscribe(listener: DualSenseStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private normalizeStick(v: number): number {
    return (2 * v) / 255 - 1.0;
  }

  private normalizeTrigger(v: number): number {
    return v / 255;
  }

  private handleInputReport(event: HIDInputReportEvent): void {
    const reportId = event.reportId;
    const data = event.data;

    if (this.transport === 'usb' && reportId === 0x01) {
      this.parseUsbReport01(data);
    } else if (this.transport === 'bluetooth') {
      if (reportId === 0x31) {
        this.parseBtReport31(data);
      } else if (reportId === 0x01) {
        this.parseBtReport01(data);
      }
    }
  }

  private parseUsbReport01(data: DataView): void {
    if (data.byteLength < DUAL_SENSE_USB_INPUT_REPORT_0x01_SIZE) return;

    // Sticks
    this.state.leftStickX = this.normalizeStick(data.getUint8(0));
    this.state.leftStickY = this.normalizeStick(data.getUint8(1));
    this.state.rightStickX = this.normalizeStick(data.getUint8(2));
    this.state.rightStickY = this.normalizeStick(data.getUint8(3));
    this.state.l2Axis = this.normalizeTrigger(data.getUint8(4));
    this.state.r2Axis = this.normalizeTrigger(data.getUint8(5));

    // Buttons
    const b7 = data.getUint8(7);
    const b8 = data.getUint8(8);
    const b9 = data.getUint8(9);

    const dpad = b7 & 0x0f;
    this.state.dpadUp = dpad === 0 || dpad === 1 || dpad === 7;
    this.state.dpadDown = dpad === 3 || dpad === 4 || dpad === 5;
    this.state.dpadLeft = dpad === 5 || dpad === 6 || dpad === 7;
    this.state.dpadRight = dpad === 1 || dpad === 2 || dpad === 3;

    this.state.square = (b7 & 0x10) !== 0;
    this.state.cross = (b7 & 0x20) !== 0;
    this.state.circle = (b7 & 0x40) !== 0;
    this.state.triangle = (b7 & 0x80) !== 0;

    this.state.l1 = (b8 & 0x01) !== 0;
    this.state.r1 = (b8 & 0x02) !== 0;
    this.state.l2Btn = (b8 & 0x04) !== 0 || this.state.l2Axis > 0.1;
    this.state.r2Btn = (b8 & 0x08) !== 0 || this.state.r2Axis > 0.1;
    this.state.create = (b8 & 0x10) !== 0;
    this.state.options = (b8 & 0x20) !== 0;
    this.state.l3 = (b8 & 0x40) !== 0;
    this.state.r3 = (b8 & 0x80) !== 0;

    this.state.ps = (b9 & 0x01) !== 0;
    this.state.touchpadClick = (b9 & 0x02) !== 0;
    this.state.mute = (b9 & 0x04) !== 0;

    // Multi-Touch Trackpad
    this.parseTouch(
      data.getUint8(32),
      data.getUint8(33) | ((data.getUint8(34) & 0x0f) << 8),
      (data.getUint8(35) << 4) | ((data.getUint8(34) & 0xf0) >> 4),
      data.getUint8(36),
      data.getUint8(37) | ((data.getUint8(38) & 0x0f) << 8),
      (data.getUint8(39) << 4) | ((data.getUint8(38) & 0xf0) >> 4)
    );

    // Battery & Power (USB Report 0x01 status byte is at offset 52)
    if (data.byteLength >= 53) {
      const status = data.getUint8(52);
      this.parseBattery(status);
    }
    if (data.byteLength >= 54) {
      const audioStatus = data.getUint8(53);
      this.state.headphoneConnected = (audioStatus & 0x01) !== 0;
      this.state.micConnected = (audioStatus & 0x02) !== 0;
      this.state.micMuted = (audioStatus & 0x04) !== 0;
    }

    this.notify();
  }

  private parseBtReport31(data: DataView): void {
    if (data.byteLength < DUAL_SENSE_BT_INPUT_REPORT_0x31_SIZE) return;

    // Offset +1 relative to USB
    this.state.leftStickX = this.normalizeStick(data.getUint8(1));
    this.state.leftStickY = this.normalizeStick(data.getUint8(2));
    this.state.rightStickX = this.normalizeStick(data.getUint8(3));
    this.state.rightStickY = this.normalizeStick(data.getUint8(4));
    this.state.l2Axis = this.normalizeTrigger(data.getUint8(5));
    this.state.r2Axis = this.normalizeTrigger(data.getUint8(6));

    const b8 = data.getUint8(8);
    const b9 = data.getUint8(9);
    const b10 = data.getUint8(10);

    const dpad = b8 & 0x0f;
    this.state.dpadUp = dpad === 0 || dpad === 1 || dpad === 7;
    this.state.dpadDown = dpad === 3 || dpad === 4 || dpad === 5;
    this.state.dpadLeft = dpad === 5 || dpad === 6 || dpad === 7;
    this.state.dpadRight = dpad === 1 || dpad === 2 || dpad === 3;

    this.state.square = (b8 & 0x10) !== 0;
    this.state.cross = (b8 & 0x20) !== 0;
    this.state.circle = (b8 & 0x40) !== 0;
    this.state.triangle = (b8 & 0x80) !== 0;

    this.state.l1 = (b9 & 0x01) !== 0;
    this.state.r1 = (b9 & 0x02) !== 0;
    this.state.l2Btn = (b9 & 0x04) !== 0 || this.state.l2Axis > 0.1;
    this.state.r2Btn = (b9 & 0x08) !== 0 || this.state.r2Axis > 0.1;
    this.state.create = (b9 & 0x10) !== 0;
    this.state.options = (b9 & 0x20) !== 0;
    this.state.l3 = (b9 & 0x40) !== 0;
    this.state.r3 = (b9 & 0x80) !== 0;

    this.state.ps = (b10 & 0x01) !== 0;
    this.state.touchpadClick = (b10 & 0x02) !== 0;
    this.state.mute = (b10 & 0x04) !== 0;

    // Trackpad in Report 0x31 starts at offset 33
    this.parseTouch(
      data.getUint8(33),
      data.getUint8(34) | ((data.getUint8(35) & 0x0f) << 8),
      (data.getUint8(36) << 4) | ((data.getUint8(35) & 0xf0) >> 4),
      data.getUint8(37),
      data.getUint8(38) | ((data.getUint8(39) & 0x0f) << 8),
      (data.getUint8(40) << 4) | ((data.getUint8(39) & 0xf0) >> 4)
    );

    // Battery & Power Telemetry (Byte index 53 in BT report 0x31)
    if (data.byteLength >= 54) {
      const status = data.getUint8(53);
      this.parseBattery(status);
    }
    if (data.byteLength >= 55) {
      const audioStatus = data.getUint8(54);
      this.state.headphoneConnected = (audioStatus & 0x01) !== 0;
      this.state.micConnected = (audioStatus & 0x02) !== 0;
      this.state.micMuted = (audioStatus & 0x04) !== 0;
    }

    this.notify();
  }

  private parseBtReport01(data: DataView): void {
    if (data.byteLength < DUAL_SENSE_BT_INPUT_REPORT_0x01_SIZE) return;
    this.state.leftStickX = this.normalizeStick(data.getUint8(0));
    this.state.leftStickY = this.normalizeStick(data.getUint8(1));
    this.state.rightStickX = this.normalizeStick(data.getUint8(2));
    this.state.rightStickY = this.normalizeStick(data.getUint8(3));
    this.state.l2Axis = this.normalizeTrigger(data.getUint8(7));
    this.state.r2Axis = this.normalizeTrigger(data.getUint8(8));

    const b4 = data.getUint8(4);
    const dpad = b4 & 0x0f;
    this.state.dpadUp = dpad === 0 || dpad === 1 || dpad === 7;
    this.state.dpadDown = dpad === 3 || dpad === 4 || dpad === 5;
    this.state.dpadLeft = dpad === 5 || dpad === 6 || dpad === 7;
    this.state.dpadRight = dpad === 1 || dpad === 2 || dpad === 3;

    this.state.square = (b4 & 0x10) !== 0;
    this.state.cross = (b4 & 0x20) !== 0;
    this.state.circle = (b4 & 0x40) !== 0;
    this.state.triangle = (b4 & 0x80) !== 0;

    this.notify();
  }

  private parseTouch(
    t0active: number,
    t0x: number,
    t0y: number,
    t1active: number,
    t1x: number,
    t1y: number
  ): void {
    this.state.touch0 = {
      active: (t0active & 0x80) === 0,
      id: t0active & 0x7f,
      x: t0x,
      y: t0y
    };
    this.state.touch1 = {
      active: (t1active & 0x80) === 0,
      id: t1active & 0x7f,
      x: t1x,
      y: t1y
    };
  }

  private parseBattery(status: number): void {
    const rawCapacity = status & 0x0f;
    this.state.batteryLevel = Math.min(100, rawCapacity * 10 + 5);
    const chargeCode = (status & 0xf0) >> 4;
    this.state.isCharging = chargeCode === 0x01;
    this.state.isFullyCharged = chargeCode === 0x02;
    this.state.isPlugged = chargeCode === 0x01 || chargeCode === 0x02;
  }

  async sendOutputReportBT(): Promise<boolean> {
    if (this.transport !== 'bluetooth') return false;

    const reportData = new Uint8Array(77);
    reportData[0] = (this.outputSeq << 4) & 0xf0;
    this.outputSeq = (this.outputSeq + 1) % 16;
    reportData[1] = 0x10; // DS_OUTPUT_TAG

    const common = new DataView(reportData.buffer, 2, 47);
    common.setUint8(0, 0xfd); // valid_flag0: clears HAPTICS_SELECT to allow audio haptics
    common.setUint8(1, 0xf7); // valid_flag1: lightbar, LEDs
    common.setUint8(39, 0x02); // lightbar setup
    common.setUint8(41, 0x02); // lightbar enable

    // Default pleasant cyan glow
    common.setUint8(44, 0x00); // Red
    common.setUint8(45, 0x90); // Green
    common.setUint8(46, 0xff); // Blue

    fillDualSenseChecksum(0x31, reportData);

    try {
      await this.device.sendReport(0x31, reportData);
      return true;
    } catch (e) {
      console.warn('DualSense: sendReport(0x31) error', e);
      return false;
    }
  }

  async sendHapticReportBT(stereoPcmSamples: Uint8Array): Promise<boolean> {
    if (this.transport !== 'bluetooth') return false;
    if (stereoPcmSamples.length !== 64) {
      return false;
    }

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
    reportData[9] = this.audioSeq;
    this.audioSeq = (this.audioSeq + 1) % 256;

    // Sub-packet 2: PCM Payload Header (64 bytes = 16 stereo frames)
    reportData[10] = 0x92;
    reportData[11] = 0x40;
    reportData.set(stereoPcmSamples, 12);

    fillDualSenseChecksum(0x32, reportData);

    try {
      await this.device.sendReport(0x32, reportData);
      return true;
    } catch (e) {
      return false;
    }
  }

  disconnect(): void {
    if (this.device) {
      try {
        this.device.close();
      } catch (e) {}
    }
  }
}
