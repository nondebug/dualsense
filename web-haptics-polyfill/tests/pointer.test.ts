// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DualSensePointerEngine } from '../src/pointer-engine.ts';
import type { DualSenseState } from '../src/types.ts';

// Setup minimal mock DOM environment for Node.js test runner
function setupMockDOM() {
  (globalThis as any).window = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: (_type: string, _listener: any) => {}
  };

  class MockElement {
    events: Array<{ type: string; detail: any }> = [];
    style: any = {};
    parentNode: any = null;
    focused = false;
    type = 'text';
    value = '50';
    min = '0';
    max = '100';
    step = '10';

    addEventListener() {}
    focus() {
      this.focused = true;
    }
    blur() {
      this.focused = false;
    }
    closest(_selector: string) {
      return null;
    }
    getBoundingClientRect() {
      return { left: 100, top: 200, width: 200, height: 20 };
    }
    appendChild(node: any) {
      node.parentNode = this;
      return node;
    }
    removeChild(node: any) {
      node.parentNode = null;
      return node;
    }
    dispatchEvent(e: any) {
      this.events.push({ type: e.type, detail: e });
      return true;
    }
  }

  const mockTarget = new MockElement();
  const mockBody = new MockElement();

  (globalThis as any).document = {
    body: mockBody,
    createElement: (_tag: string) => new MockElement(),
    elementFromPoint: (_x: number, _y: number) => mockTarget
  };

  (globalThis as any).HTMLInputElement = MockElement;
  (globalThis as any).Event = class {
    type: string;
    bubbles: boolean;
    constructor(type: string, init: any = {}) {
      this.type = type;
      this.bubbles = !!init.bubbles;
    }
  };

  (globalThis as any).PointerEvent = class {
    type: string;
    clientX: number;
    clientY: number;
    button: number;
    buttons: number;
    constructor(type: string, init: any = {}) {
      this.type = type;
      this.clientX = init.clientX;
      this.clientY = init.clientY;
      this.button = init.button;
      this.buttons = init.buttons;
    }
  };

  return { mockTarget };
}

function createDefaultState(): DualSenseState {
  return {
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
    isPlugged: true,
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
}

describe('DualSense Virtual Pointer Engine', () => {
  let mockTarget: any;
  let engine: DualSensePointerEngine;

  beforeEach(() => {
    const dom = setupMockDOM();
    mockTarget = dom.mockTarget;
    engine = new DualSensePointerEngine();
    engine.init();
  });

  it('initializes virtual cursor centered in viewport', () => {
    assert.equal(engine.cursorX, 1920 / 2);
    assert.equal(engine.cursorY, 1080 / 2);
  });

  it('updates cursor position via relative capacitive trackpad movement', () => {
    const state = createDefaultState();

    // Baseline touch down
    state.touch0 = { active: true, id: 1, x: 500, y: 500 };
    engine.updateFromGamepad(state, 0.016);
    const initialX = engine.cursorX;
    const initialY = engine.cursorY;

    // Relative swipe (+50 X, +20 Y)
    state.touch0 = { active: true, id: 1, x: 550, y: 520 };
    engine.updateFromGamepad(state, 0.016);

    assert.ok(engine.cursorX > initialX, 'Cursor X must move right on positive delta');
    assert.ok(engine.cursorY > initialY, 'Cursor Y must move down on positive delta');
  });

  it('updates cursor velocity from left thumbstick outside deadzone', () => {
    const state = createDefaultState();

    // Within deadzone (0.05 < 0.12) -> no movement
    state.leftStickX = 0.05;
    state.leftStickY = 0.05;
    const startX = engine.cursorX;
    engine.updateFromGamepad(state, 0.016);
    assert.equal(engine.cursorX, startX, 'Movement within deadzone must be ignored');

    // Outside deadzone (deflected right stickX = 0.8)
    state.leftStickX = 0.8;
    state.leftStickY = 0.0;
    engine.updateFromGamepad(state, 0.1); // 100 ms frame
    assert.ok(engine.cursorX > startX, 'Cursor must move right when stick deflected');
  });

  it('clamps cursor strictly within viewport window bounds', () => {
    const state = createDefaultState();
    state.leftStickX = 1.0; // Extreme deflection right

    // Move across several seconds
    for (let i = 0; i < 50; i++) {
      engine.updateFromGamepad(state, 0.1);
    }

    assert.equal(engine.cursorX, 1920, 'Cursor X cannot exceed window.innerWidth');

    // Deflect to top-left negative
    state.leftStickX = -1.0;
    state.leftStickY = -1.0;
    for (let i = 0; i < 50; i++) {
      engine.updateFromGamepad(state, 0.1);
    }

    assert.equal(engine.cursorX, 0, 'Cursor X cannot be negative');
    assert.equal(engine.cursorY, 0, 'Cursor Y cannot be negative');
  });

  it('dispatches synthetic pointerdown and click on touchpad click or cross button', () => {
    const state = createDefaultState();

    // Press touchpad button
    state.touchpadClick = true;
    engine.updateFromGamepad(state, 0.016);

    const downEvents = mockTarget.events.filter((e: any) => e.type === 'pointerdown');
    assert.equal(downEvents.length, 1, 'Must dispatch pointerdown on button press');
    assert.equal(downEvents[0].detail.button, 0);

    // Release touchpad button
    state.touchpadClick = false;
    engine.updateFromGamepad(state, 0.016);

    const upEvents = mockTarget.events.filter((e: any) => e.type === 'pointerup');
    const clickEvents = mockTarget.events.filter((e: any) => e.type === 'click');
    assert.equal(upEvents.length, 1, 'Must dispatch pointerup on button release');
    assert.equal(clickEvents.length, 1, 'Must dispatch click on button release');
  });

  it('explicitly focuses input elements when clicked by the virtual cursor', () => {
    const state = createDefaultState();

    assert.equal(mockTarget.focused, false);

    // Click on input element
    state.cross = true;
    engine.updateFromGamepad(state, 0.016);

    assert.equal(mockTarget.focused, true, 'Input element must be focused on pointerdown/click');
  });

  it('updates range slider value and dispatches input event when dragged', () => {
    mockTarget.type = 'range';
    mockTarget.min = '0';
    mockTarget.max = '100';
    mockTarget.step = '10';
    mockTarget.value = '0';

    const state = createDefaultState();

    // Move cursor over slider (rect left is 100, width is 200)
    // To set 50%, cursorX should be 100 + 100 = 200
    engine.cursorX = 200;
    engine.cursorY = 210;

    // Press down to begin drag
    state.touchpadClick = true;
    engine.updateFromGamepad(state, 0.016);

    assert.equal(mockTarget.value, '50', 'Slider value should update to 50% on pointerdown at center');
    const inputEvents = mockTarget.events.filter((e: any) => e.type === 'input');
    assert.ok(inputEvents.length >= 1, 'Must dispatch input event on slider update');

    // Drag to move (cursor moves right)
    state.touch0 = { active: true, id: 1, x: 100, y: 100 };
    engine.updateFromGamepad(state, 0.016);
    state.touch0 = { active: true, id: 1, x: 160, y: 100 };
    engine.updateFromGamepad(state, 0.016);

    assert.ok(parseFloat(mockTarget.value) > 50, 'Slider value should increase when dragged right');
  });
});
