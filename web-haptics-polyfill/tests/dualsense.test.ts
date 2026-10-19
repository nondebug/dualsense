// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, DualSenseController, fillDualSenseChecksum } from '../src/dualsense.ts';
import { MockHIDDevice } from './mock-hid.ts';

describe('DualSense Core Hardware & Protocol Driver', () => {
  it('computes IEEE 802.3 CRC-32 with 0xa2 Bluetooth HID transaction prefix correctly', () => {
    // Known test vector
    const reportData = new Uint8Array(77);
    reportData[0] = 0x10;
    reportData[1] = 0x10;
    reportData[2] = 0xfd;

    fillDualSenseChecksum(0x31, reportData);

    // Verify trailing 4 bytes are non-zero little-endian CRC
    const crcView = new DataView(reportData.buffer, 73, 4);
    const calculatedCrc = crcView.getUint32(0, true);
    assert.ok(calculatedCrc !== 0, 'CRC should be non-zero');

    // Recalculating CRC over the entire packet prefix + body should be deterministic
    const verifyCrc = crc32([0xa2, 0x31], new DataView(reportData.buffer, 0, 73));
    assert.equal(calculatedCrc, verifyCrc, 'Stored CRC must match calculated CRC32');
  });

  it('detects USB transport from 504-bit collection report length', () => {
    const mockDevice = new MockHIDDevice(0x054c, 0x0ce6, 504);
    const controller = new DualSenseController(mockDevice as any);
    assert.equal(controller.transport, 'usb');
  });

  it('detects Bluetooth transport from 616-bit collection report length', () => {
    const mockDevice = new MockHIDDevice(0x054c, 0x0ce6, 616);
    const controller = new DualSenseController(mockDevice as any);
    assert.equal(controller.transport, 'bluetooth');
  });

  it('initializes USB device by sending 47-byte Report 0x02 to silence classic motor emulation', async () => {
    const mockDevice = new MockHIDDevice(0x054c, 0x0ce6, 504);
    const controller = new DualSenseController(mockDevice as any);

    await controller.initialize();

    assert.equal(mockDevice.opened, true);
    assert.equal(mockDevice.sentReports.length, 1);
    assert.equal(mockDevice.sentReports[0].reportId, 0x02);
    assert.equal(mockDevice.sentReports[0].data.byteLength, 47);
    assert.equal(mockDevice.sentReports[0].data[0], 0x00, 'valid_flag0 must be 0 to silence rumble');
  });

  it('initializes Bluetooth device with Feature Report 0x05 handshake and initial Report 0x31', async () => {
    const mockDevice = new MockHIDDevice(0x054c, 0x0ce6, 616);
    const controller = new DualSenseController(mockDevice as any);

    await controller.initialize();

    assert.equal(mockDevice.opened, true);
    assert.ok(mockDevice.receivedFeatureReports.includes(0x05), 'Must issue Feature Report 0x05 handshake');
    assert.equal(mockDevice.sentReports.length, 1);
    assert.equal(mockDevice.sentReports[0].reportId, 0x31);
    assert.equal(mockDevice.sentReports[0].data.byteLength, 77);
  });

  it('decodes USB Input Report 0x01 analog axes, triggers, buttons, and battery', async () => {
    const mockDevice = new MockHIDDevice(0x054c, 0x0ce6, 504);
    const controller = new DualSenseController(mockDevice as any);
    await controller.initialize();

    const report = new Uint8Array(64);
    // Sticks: neutral is ~128 (0x80)
    report[0] = 0x00; // Left Stick X -> -1.0
    report[1] = 0xff; // Left Stick Y -> +1.0
    report[2] = 0x80; // Right Stick X -> ~0.0
    report[3] = 0x80; // Right Stick Y -> ~0.0
    report[4] = 0xff; // L2 Axis -> 1.0
    report[5] = 0x80; // R2 Axis -> 0.5

    // Buttons
    report[7] = 0x20 | 0x02; // Cross button (0x20) + D-pad Right (2)
    report[8] = 0x01 | 0x40; // L1 (0x01) + L3 (0x40)
    report[9] = 0x02;        // Touchpad Click (0x02)

    // Touch 0: active-low bit 7 = 0 (active), ID = 42, X = 960 (0x03C0), Y = 540 (0x021C)
    // X: byte 33 = 0xC0, byte 34 low nibble = 0x03
    // Y: byte 34 high nibble = 0x01, byte 35 = 0x21 -> ((0x21 << 4) | 0x01) = 0x211
    report[32] = 42; // Bit 7 is 0 => active! ID = 42
    report[33] = 0xc0;
    report[34] = 0x13; // low nibble = 3 (X high bits), high nibble = 1 (Y low bits)
    report[35] = 0x21; // Y high bits

    // Touch 1: Bit 7 is 1 (0x80) => inactive
    report[36] = 0x80;

    // Battery at byte 52: 0x18 -> charging (0x1) + level 8 (85%)
    report[52] = 0x18;

    // Audio status at byte 53: 0x01 -> headphone connected
    report[53] = 0x01;

    mockDevice.dispatchMockInputReport(0x01, report);

    assert.equal(controller.state.leftStickX, -1.0);
    assert.equal(controller.state.leftStickY, 1.0);
    assert.equal(controller.state.l2Axis, 1.0);
    assert.equal(controller.state.cross, true);
    assert.equal(controller.state.circle, false);
    assert.equal(controller.state.dpadRight, true);
    assert.equal(controller.state.dpadLeft, false);
    assert.equal(controller.state.l1, true);
    assert.equal(controller.state.l3, true);
    assert.equal(controller.state.touchpadClick, true);

    // Multi-touch trackpad
    assert.equal(controller.state.touch0.active, true);
    assert.equal(controller.state.touch0.id, 42);
    assert.equal(controller.state.touch0.x, 960);
    assert.equal(controller.state.touch0.y, 529);
    assert.equal(controller.state.touch1.active, false);

    // Battery & Telemetry
    assert.equal(controller.state.batteryLevel, 85);
    assert.equal(controller.state.isCharging, true);
    assert.equal(controller.state.isPlugged, true);
    assert.equal(controller.state.headphoneConnected, true);
  });

  it('decodes Bluetooth Extended Input Report 0x31 with +1 offset and status byte 53', async () => {
    const mockDevice = new MockHIDDevice(0x054c, 0x0ce6, 616);
    const controller = new DualSenseController(mockDevice as any);
    await controller.initialize();

    const report = new Uint8Array(78);
    // Report 0x31 offset +1
    report[0] = 0x01; // sequence counter
    report[1] = 0xff; // Left Stick X -> +1.0
    report[2] = 0x00; // Left Stick Y -> -1.0
    report[5] = 0xff; // L2 Axis -> 1.0

    report[8] = 0x40; // Circle button
    report[9] = 0x02; // R1
    report[10] = 0x04; // Mute button

    // Battery status at byte 53: 0x0A -> discharging (0x0) + level 10 (100%)
    report[53] = 0x0a;
    report[54] = 0x04; // Mic muted

    mockDevice.dispatchMockInputReport(0x31, report);

    assert.equal(controller.state.leftStickX, 1.0);
    assert.equal(controller.state.leftStickY, -1.0);
    assert.equal(controller.state.l2Axis, 1.0);
    assert.equal(controller.state.circle, true);
    assert.equal(controller.state.cross, false);
    assert.equal(controller.state.r1, true);
    assert.equal(controller.state.mute, true);

    assert.equal(controller.state.batteryLevel, 100);
    assert.equal(controller.state.isCharging, false);
    assert.equal(controller.state.micMuted, true);
  });

  it('constructs Bluetooth Report 0x32 with 141-byte haptic stream and valid CRC', async () => {
    const mockDevice = new MockHIDDevice(0x054c, 0x0ce6, 616);
    const controller = new DualSenseController(mockDevice as any);
    await controller.initialize();

    // 16 stereo frames = 64 bytes
    const pcmSamples = new Uint8Array(64);
    pcmSamples[0] = 0x55;
    pcmSamples[63] = 0xaa;

    const sent = await controller.sendHapticReportBT(pcmSamples);
    assert.equal(sent, true);

    const lastReport = mockDevice.sentReports[mockDevice.sentReports.length - 1];
    assert.equal(lastReport.reportId, 0x32);
    assert.equal(lastReport.data.byteLength, 141);

    // Verify sub-packet headers
    assert.equal(lastReport.data[1], 0x91); // Audio control tag
    assert.equal(lastReport.data[2], 0x07); // Length 7
    assert.equal(lastReport.data[10], 0x92); // PCM data tag
    assert.equal(lastReport.data[11], 0x40); // 64 bytes length
    assert.equal(lastReport.data[12], 0x55);
    assert.equal(lastReport.data[75], 0xaa);

    // Verify trailing CRC is populated
    const crc = new DataView(lastReport.data.buffer, 137, 4).getUint32(0, true);
    assert.ok(crc !== 0);
  });
});
