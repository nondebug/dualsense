// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

export type HapticEffect = 'hint' | 'edge' | 'tick' | 'align' | 'success' | 'error';

export type TransportType = 'usb' | 'bluetooth' | 'native';

export interface TouchPoint {
  active: boolean;
  id: number;
  x: number; // 0 - 1919
  y: number; // 0 - 1079
}

export interface DualSenseState {
  // Axes [-1.0, 1.0]
  leftStickX: number;
  leftStickY: number;
  rightStickX: number;
  rightStickY: number;

  // Triggers [0.0, 1.0]
  l2Axis: number;
  r2Axis: number;

  // Buttons (W3C standard)
  cross: boolean;
  circle: boolean;
  square: boolean;
  triangle: boolean;
  l1: boolean;
  r1: boolean;
  l2Btn: boolean;
  r2Btn: boolean;
  create: boolean;
  options: boolean;
  l3: boolean;
  r3: boolean;
  dpadUp: boolean;
  dpadDown: boolean;
  dpadLeft: boolean;
  dpadRight: boolean;

  // Extensions
  ps: boolean;
  touchpadClick: boolean;
  mute: boolean;

  // Capacitive Touchpad
  touch0: TouchPoint;
  touch1: TouchPoint;

  // Battery & Power Telemetry
  batteryLevel: number; // 0 - 100%
  isCharging: boolean;
  isFullyCharged: boolean;
  isPlugged: boolean;

  // Audio / Headset Telemetry
  headphoneConnected: boolean;
  micConnected: boolean;
  micMuted: boolean;

  // IMU
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  accelX: number;
  accelY: number;
  accelZ: number;
}

export interface AudioSinkInfo {
  deviceId: string;
  label: string;
  channels: number;
}

export type DualSenseStateListener = (state: DualSenseState) => void;

// Ambient WebHID Declarations
declare global {
  interface HIDDevice extends EventTarget {
    opened: boolean;
    vendorId: number;
    productId: number;
    productName: string;
    collections: Array<{
      usagePage: number;
      usage: number;
      inputReports: Array<{
        items: Array<{
          reportSize: number;
          reportCount: number;
        }>;
      }>;
    }>;
    open(): Promise<void>;
    close(): Promise<void>;
    sendReport(reportId: number, data: BufferSource): Promise<void>;
    receiveFeatureReport(reportId: number): Promise<DataView>;
    oninputreport: ((this: HIDDevice, ev: HIDInputReportEvent) => any) | null;
  }

  interface HIDInputReportEvent extends Event {
    device: HIDDevice;
    reportId: number;
    data: DataView;
  }

  interface Navigator {
    hid?: {
      getDevices(): Promise<HIDDevice[]>;
      requestDevice(options: {
        filters: Array<{ vendorId?: number; productId?: number; usagePage?: number; usage?: number }>;
      }): Promise<HIDDevice[]>;
      addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    };
  }
}
