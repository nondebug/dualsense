// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import type { DualSenseState } from './types.ts';

export class DualSensePointerEngine {
  cursorX = window.innerWidth / 2;
  cursorY = window.innerHeight / 2;

  private lastTouch0 = { active: false, x: 0, y: 0 };
  private isPointerDown = false;
  private currentTarget: Element | null = null;
  private activeDragElement: HTMLElement | null = null;
  private cursorElement: HTMLElement | null = null;
  private active = false;

  private stickSpeed = 900; // pixels per second at max deflection
  private deadzone = 0.12;

  init(): void {
    this.createCursorElement();
    this.attachNativePointerListeners();
    this.active = true;
  }

  private createCursorElement(): void {
    if (this.cursorElement) return;
    this.cursorElement = document.createElement('div');
    this.cursorElement.id = 'dualsense-virtual-cursor';
    this.cursorElement.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      width: 22px;
      height: 22px;
      border: 2.5px solid #00e5ff;
      background: rgba(0, 229, 255, 0.25);
      border-radius: 50%;
      pointer-events: none;
      z-index: 999999;
      transform: translate(-50%, -50%);
      transition: width 0.08s ease, height 0.08s ease, background-color 0.08s ease;
      box-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
    `;
    document.body.appendChild(this.cursorElement);
    this.updateCursorVisual();
  }

  private attachNativePointerListeners(): void {
    // Transparent handoff: Native mouse or touch moves the cursor using absolute X/Y
    window.addEventListener('pointermove', (e: PointerEvent) => {
      // Ignore synthetic events dispatched by this engine
      if ((e as any).__isDualSenseSynthetic) return;
      this.cursorX = Math.max(0, Math.min(window.innerWidth, e.clientX));
      this.cursorY = Math.max(0, Math.min(window.innerHeight, e.clientY));
      this.updateCursorVisual();
    });
  }

  updateFromGamepad(state: DualSenseState, dtSeconds: number): void {
    if (!this.active) return;

    let moved = false;

    // 1. Capacitive Trackpad Relative Movement
    if (state.touch0.active) {
      if (this.lastTouch0.active) {
        const dx = state.touch0.x - this.lastTouch0.x;
        const dy = state.touch0.y - this.lastTouch0.y;

        // Sensible trackpad sensitivity & acceleration
        const dist = Math.hypot(dx, dy);
        const accel = 1.0 + Math.min(3.0, dist * 0.04);
        const sensitivity = 0.9;

        this.cursorX += dx * sensitivity * accel;
        this.cursorY += dy * sensitivity * accel;
        moved = true;
      }
      this.lastTouch0 = { active: true, x: state.touch0.x, y: state.touch0.y };
    } else {
      this.lastTouch0.active = false;
    }

    // 2. Left Thumbstick Velocity-Based Movement
    const stickX = state.leftStickX;
    const stickY = state.leftStickY;
    const mag = Math.hypot(stickX, stickY);

    if (mag > this.deadzone) {
      const normalizedMag = (mag - this.deadzone) / (1.0 - this.deadzone);
      const curve = Math.pow(normalizedMag, 1.8); // Exponential response curve
      const angle = Math.atan2(stickY, stickX);

      this.cursorX += Math.cos(angle) * curve * this.stickSpeed * dtSeconds;
      this.cursorY += Math.sin(angle) * curve * this.stickSpeed * dtSeconds;
      moved = true;
    }

    // 3. Viewport Clamping
    this.cursorX = Math.max(0, Math.min(window.innerWidth, this.cursorX));
    this.cursorY = Math.max(0, Math.min(window.innerHeight, this.cursorY));

    if (moved) {
      this.updateCursorVisual();
      this.dispatchSyntheticPointerMove();
    }

    // 4. Click Actions: Trackpad Click or Cross Button
    const shouldClick = state.touchpadClick || state.cross;
    if (shouldClick && !this.isPointerDown) {
      this.isPointerDown = true;
      this.setCursorPressed(true);
      this.dispatchSyntheticPointerDown();
    } else if (!shouldClick && this.isPointerDown) {
      this.isPointerDown = false;
      this.setCursorPressed(false);
      this.dispatchSyntheticPointerUp();
    }
  }

  private updateCursorVisual(): void {
    if (this.cursorElement) {
      this.cursorElement.style.transform = `translate(${this.cursorX}px, ${this.cursorY}px) translate(-50%, -50%)`;
    }
  }

  private setCursorPressed(pressed: boolean): void {
    if (this.cursorElement) {
      if (pressed) {
        this.cursorElement.style.width = '16px';
        this.cursorElement.style.height = '16px';
        this.cursorElement.style.backgroundColor = 'rgba(0, 229, 255, 0.7)';
      } else {
        this.cursorElement.style.width = '22px';
        this.cursorElement.style.height = '22px';
        this.cursorElement.style.backgroundColor = 'rgba(0, 229, 255, 0.25)';
      }
    }
  }

  private dispatchSyntheticPointerMove(): void {
    const target = document.elementFromPoint(this.cursorX, this.cursorY) || document.body;

    // Handle pointer enter / leave transitions
    if (target !== this.currentTarget) {
      if (this.currentTarget) {
        this.dispatchEvent(this.currentTarget, 'pointerout');
        this.dispatchEvent(this.currentTarget, 'pointerleave', false);
      }
      this.dispatchEvent(target, 'pointerover');
      this.dispatchEvent(target, 'pointerenter', false);
      this.currentTarget = target;
    }

    // Active range slider drag handling
    if (this.isPointerDown && this.activeDragElement) {
      const slider =
        this.activeDragElement instanceof HTMLInputElement && this.activeDragElement.type === 'range'
          ? this.activeDragElement
          : (this.activeDragElement.closest('input[type="range"]') as HTMLInputElement | null);

      if (slider) {
        this.updateRangeSliderValue(slider);
      }
    }

    this.dispatchEvent(target, 'pointermove', true, 0, this.isPointerDown ? 1 : 0);
    this.dispatchEvent(target, 'mousemove', true, 0, this.isPointerDown ? 1 : 0);
  }

  private dispatchSyntheticPointerDown(): void {
    const target = (document.elementFromPoint(this.cursorX, this.cursorY) || document.body) as HTMLElement;
    this.currentTarget = target;
    this.activeDragElement = target;

    // Explicitly focus input, textarea, or focusable elements on click/down
    if (target && typeof target.focus === 'function') {
      try {
        target.focus();
      } catch (_) {}
    }

    // If clicking directly on a range slider track/thumb, jump/update immediately
    const slider =
      target instanceof HTMLInputElement && target.type === 'range'
        ? target
        : (target.closest('input[type="range"]') as HTMLInputElement | null);
    if (slider) {
      this.updateRangeSliderValue(slider);
    }

    this.dispatchEvent(target, 'pointerdown', true, 0, 1);
    this.dispatchEvent(target, 'mousedown', true, 0, 1);
    this.dispatchTouchEvent(target, 'touchstart');
  }

  private dispatchSyntheticPointerUp(): void {
    const target = (document.elementFromPoint(this.cursorX, this.cursorY) || document.body) as HTMLElement;

    if (this.activeDragElement) {
      const slider =
        this.activeDragElement instanceof HTMLInputElement && this.activeDragElement.type === 'range'
          ? this.activeDragElement
          : (this.activeDragElement.closest('input[type="range"]') as HTMLInputElement | null);

      if (slider) {
        slider.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    this.activeDragElement = null;

    // Reinforce focus on pointerup/click
    if (target && typeof target.focus === 'function') {
      try {
        target.focus();
      } catch (_) {}
    }

    this.dispatchEvent(target, 'pointerup', true, 0, 0);
    this.dispatchEvent(target, 'mouseup', true, 0, 0);
    this.dispatchEvent(target, 'click', true, 0, 0);
    this.dispatchTouchEvent(target, 'touchend');
  }

  private updateRangeSliderValue(slider: HTMLInputElement): void {
    const rect = slider.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = Math.max(0, Math.min(1, (this.cursorX - rect.left) / rect.width));
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '100');
    const step = parseFloat(slider.step || '1');

    const rawVal = min + ratio * (max - min);
    const steppedVal = Math.round((rawVal - min) / step) * step + min;
    const clampedVal = Math.max(min, Math.min(max, steppedVal));

    if (parseFloat(slider.value) !== clampedVal) {
      slider.value = String(clampedVal);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  private dispatchEvent(
    target: Element,
    type: string,
    bubbles = true,
    button = 0,
    buttons = 0
  ): void {
    const event = new PointerEvent(type, {
      bubbles,
      cancelable: true,
      composed: true,
      clientX: this.cursorX,
      clientY: this.cursorY,
      screenX: this.cursorX,
      screenY: this.cursorY,
      button,
      buttons,
      pointerId: 99,
      pointerType: 'mouse',
      isPrimary: true
    });

    (event as any).__isDualSenseSynthetic = true;
    target.dispatchEvent(event);
  }

  private dispatchTouchEvent(target: Element, type: string): void {
    if (typeof TouchEvent === 'undefined') return;
    try {
      const touch = new Touch({
        identifier: 99,
        target,
        clientX: this.cursorX,
        clientY: this.cursorY,
        screenX: this.cursorX,
        screenY: this.cursorY,
        pageX: this.cursorX,
        pageY: this.cursorY
      });

      const touchEvent = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch]
      });
      (touchEvent as any).__isDualSenseSynthetic = true;
      target.dispatchEvent(touchEvent);
    } catch (e) {
      // Touch constructor may throw in desktop environments without touch simulation
    }
  }

  destroy(): void {
    this.active = false;
    if (this.cursorElement && this.cursorElement.parentNode) {
      this.cursorElement.parentNode.removeChild(this.cursorElement);
    }
  }
}
