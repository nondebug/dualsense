// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import './types.ts';
import {
  DualSenseController,
  PRODUCT_ID_DUAL_SENSE,
  PRODUCT_ID_DUAL_SENSE_EDGE,
  VENDOR_ID_SONY
} from './dualsense.ts';
import type { AudioSinkInfo, DualSenseState, TransportType } from './types.ts';
import type { HapticsAudioEngine } from './haptics-audio.ts';
import type { WebHapticsPolyfill } from './web-haptics-polyfill.ts';
import type { DualSensePointerEngine } from './pointer-engine.ts';

export class SetupWizard {
  private container: HTMLElement;
  private audioEngine: HapticsAudioEngine;
  private polyfill: WebHapticsPolyfill;
  private pointerEngine: DualSensePointerEngine;

  private selectedTransport: TransportType = 'usb';
  private controller: DualSenseController | null = null;
  private selectedHidDevice: HIDDevice | null = null;
  private selectedAudioSink: AudioSinkInfo | null = null;

  private trackpadInteracted = false;
  private testInterval: number | null = null;
  private onCompleteCallback: () => void = () => {};

  constructor(
    container: HTMLElement,
    audioEngine: HapticsAudioEngine,
    polyfill: WebHapticsPolyfill,
    pointerEngine: DualSensePointerEngine,
    onComplete: () => void
  ) {
    this.container = container;
    this.audioEngine = audioEngine;
    this.polyfill = polyfill;
    this.pointerEngine = pointerEngine;
    this.onCompleteCallback = onComplete;
  }

  start(): void {
    this.renderStep1Transport();
  }

  private isMacOS(): boolean {
    if ((navigator as any).userAgentData?.platform) {
      return (navigator as any).userAgentData.platform.toLowerCase().includes('mac');
    }
    return (
      navigator.platform.toLowerCase().includes('mac') ||
      navigator.userAgent.toLowerCase().includes('macintosh')
    );
  }

  private isBluetoothAllowed(): boolean {
    const params = new URLSearchParams(window.location.search);
    if (params.get('bt') === '1') return true;
    return !this.isMacOS();
  }

  // --- Step 1: Transport & Mode Selection ---
  private renderStep1Transport(): void {
    const nativeAvailable = this.polyfill.isNativeAvailable();
    const btAllowed = this.isBluetoothAllowed();
    const mac = this.isMacOS();

    this.container.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-header">
          <h2>Web Haptics Setup Wizard</h2>
          <p class="subtitle">Step 1 of 5: Select Connection Mode</p>
        </div>

        <div class="wizard-body">
          <div class="info-alert">
            <strong>Single Controller Policy:</strong> To ensure accurate audio sink and HID pairing, please ensure only <strong>one</strong> DualSense controller is connected.
          </div>

          <div class="transport-options">
            <!-- Option 1: Native API -->
            <label class="option-card ${!nativeAvailable ? 'disabled' : ''}">
              <input type="radio" name="transport" value="native" ${nativeAvailable ? 'checked' : 'disabled'} />
              <div class="option-content">
                <div class="option-title">
                  <strong>Native Web Haptics API</strong>
                  ${nativeAvailable ? '<span class="badge badge-success">Available</span>' : '<span class="badge badge-warning">Unavailable</span>'}
                </div>
                <p>Use browser's native implementation (leaves navigator.playHaptics unmodified).</p>
                ${
                  !nativeAvailable
                    ? '<p class="note">To enable in Chromium, launch with <code>--enable-features=WebHaptics</code> or append <code>?api=1</code> to test layout.</p>'
                    : ''
                }
              </div>
            </label>

            <!-- Option 2: DualSense USB -->
            <label class="option-card">
              <input type="radio" name="transport" value="usb" ${!nativeAvailable ? 'checked' : ''} />
              <div class="option-content">
                <div class="option-title">
                  <strong>DualSense USB (Recommended)</strong>
                  <span class="badge badge-primary">High Fidelity</span>
                </div>
                <p>Full 4-channel discrete audio haptics (channels 3 & 4) and 1000 Hz input polling.</p>
              </div>
            </label>

            <!-- Option 3: DualSense Bluetooth -->
            <label class="option-card ${!btAllowed ? 'disabled' : ''}">
              <input type="radio" name="transport" value="bluetooth" ${!btAllowed ? 'disabled' : ''} />
              <div class="option-content">
                <div class="option-title">
                  <strong>DualSense Bluetooth</strong>
                  ${!btAllowed ? '<span class="badge badge-danger">Limited on macOS</span>' : '<span class="badge badge-info">Wireless</span>'}
                </div>
                <p>Wireless haptic streaming via WebHID report 0x32 with CRC-32 integrity.</p>
                ${
                  mac && !btAllowed
                    ? '<p class="note">macOS IOHID rate-limiting stalls Bluetooth reports >50Hz. Please use USB-C or append <code>?bt=1</code> to test.</p>'
                    : ''
                }
              </div>
            </label>
          </div>
        </div>

        <div class="wizard-footer">
          <div></div>
          <button id="btn-step1-next" class="btn btn-primary">Continue</button>
        </div>
      </div>
    `;

    const radioButtons = this.container.querySelectorAll('input[name="transport"]');
    radioButtons.forEach((r) => {
      r.addEventListener('change', (e) => {
        this.selectedTransport = (e.target as HTMLInputElement).value as TransportType;
      });
    });

    const activeRadio = this.container.querySelector('input[name="transport"]:checked') as HTMLInputElement;
    if (activeRadio) {
      this.selectedTransport = activeRadio.value as TransportType;
    }

    const nextBtn = this.container.querySelector('#btn-step1-next') as HTMLButtonElement;
    nextBtn.addEventListener('click', () => {
      if (this.selectedTransport === 'native') {
        this.completeWizard();
      } else {
        this.renderStep2DeviceList();
      }
    });
  }

  // --- Step 2: WebHID Device Selection ---
  private async renderStep2DeviceList(): Promise<void> {
    const filters = [
      { vendorId: VENDOR_ID_SONY, productId: PRODUCT_ID_DUAL_SENSE },
      { vendorId: VENDOR_ID_SONY, productId: PRODUCT_ID_DUAL_SENSE_EDGE }
    ];

    this.container.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-header">
          <h2>Connect DualSense Gamepad</h2>
          <p class="subtitle">Step 2 of 5: Select Connected Device (${this.selectedTransport.toUpperCase()})</p>
        </div>

        <div class="wizard-body">
          <p>Select your DualSense controller from the recognized WebHID devices below:</p>
          <div id="hid-device-list" class="device-list">
            <div class="loading-spinner">Searching for connected gamepads...</div>
          </div>
          <div class="device-actions">
            <button id="btn-request-device" class="btn btn-secondary">+ Pair / Request New Device</button>
          </div>
        </div>

        <div class="wizard-footer">
          <button id="btn-step2-back" class="btn btn-secondary">Back</button>
          <button id="btn-step2-connect" class="btn btn-primary" disabled>Connect Gamepad</button>
        </div>
      </div>
    `;

    const listContainer = this.container.querySelector('#hid-device-list') as HTMLElement;
    const connectBtn = this.container.querySelector('#btn-step2-connect') as HTMLButtonElement;
    const backBtn = this.container.querySelector('#btn-step2-back') as HTMLButtonElement;
    const requestBtn = this.container.querySelector('#btn-request-device') as HTMLButtonElement;

    backBtn.addEventListener('click', () => this.renderStep1Transport());

    const refreshList = async () => {
      if (!navigator.hid) {
        listContainer.innerHTML = `<div class="error-msg">WebHID API is not supported in this browser.</div>`;
        return;
      }

      let devices = await navigator.hid.getDevices();
      devices = devices.filter((d: any) =>
        filters.some((f) => d.vendorId === f.vendorId && d.productId === f.productId)
      );

      if (devices.length === 0) {
        listContainer.innerHTML = `
          <div class="empty-list">
            <p>No paired DualSense devices found.</p>
            <p class="subtext">Click "+ Pair / Request New Device" above to grant browser access.</p>
          </div>
        `;
        connectBtn.disabled = true;
        this.selectedHidDevice = null;
        return;
      }

      listContainer.innerHTML = '';
      devices.forEach((dev: any, idx: number) => {
        const item = document.createElement('div');
        item.className = `device-item ${idx === 0 ? 'selected' : ''}`;
        item.innerHTML = `
          <div class="device-info">
            <strong>${dev.productName || 'Sony DualSense Wireless Controller'}</strong>
            <span class="subtext">VID: 0x${dev.vendorId.toString(16).padStart(4, '0')} | PID: 0x${dev.productId.toString(16).padStart(4, '0')}</span>
          </div>
        `;

        item.addEventListener('click', () => {
          listContainer.querySelectorAll('.device-item').forEach((el) => el.classList.remove('selected'));
          item.classList.add('selected');
          this.selectedHidDevice = dev;
          connectBtn.disabled = false;
        });

        listContainer.appendChild(item);
      });

      // Auto-select first item
      this.selectedHidDevice = devices[0];
      connectBtn.disabled = false;
    };

    requestBtn.addEventListener('click', async () => {
      try {
        if (!navigator.hid) return;
        const requested = await navigator.hid.requestDevice({ filters });
        if (requested.length > 0) {
          await refreshList();
        }
      } catch (err) {
        console.warn('User cancelled WebHID prompt', err);
      }
    });

    // Dynamic connection monitoring
    navigator.hid?.addEventListener('connect', refreshList);
    navigator.hid?.addEventListener('disconnect', refreshList);

    await refreshList();

    connectBtn.addEventListener('click', async () => {
      if (!this.selectedHidDevice) return;
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting...';

      this.controller = new DualSenseController(this.selectedHidDevice);
      await this.controller.initialize();

      // Launch pointer engine and link to gamepad state
      this.pointerEngine.init();
      let lastTime = performance.now();
      this.controller.subscribe((state: DualSenseState) => {
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        this.pointerEngine.updateFromGamepad(state, dt);
      });

      this.renderStep3Visualizer();
    });
  }

  // --- Step 3: Controller & Trackpad Visualizer ---
  private renderStep3Visualizer(): void {
    this.trackpadInteracted = false;

    this.container.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-header">
          <h2>Verify Controller Inputs</h2>
          <p class="subtitle">Step 3 of 5: Touchpad Verification</p>
        </div>

        <div class="wizard-body">
          <p>Interact with your DualSense. Move the sticks, press buttons, and swipe on the capacitive trackpad.</p>
          
          <div class="controller-visualizer">
            <div class="telemetry-bar">
              <span>Battery: <strong id="vis-battery">--%</strong></span>
              <span>Charging: <strong id="vis-charge">No</strong></span>
              <span>Transport: <strong>${this.controller?.transport.toUpperCase()}</strong></span>
            </div>

            <!-- SVG Controller representation -->
            <div class="pad-surface-container">
              <div class="touchpad-frame" id="vis-touchpad">
                <div class="touch-dot" id="touch-dot-0"></div>
                <div class="touch-dot dot-1" id="touch-dot-1"></div>
                <div class="touchpad-hint">Touch & swipe here to unlock Next button</div>
              </div>
            </div>

            <div class="inputs-readout" id="vis-buttons">
              Buttons: Cross: <span id="v-cross">0</span>, Circle: <span id="v-circle">0</span>, Pad Click: <span id="v-pad">0</span>
            </div>
          </div>
        </div>

        <div class="wizard-footer">
          <button id="btn-step3-back" class="btn btn-secondary">Back</button>
          <button id="btn-step3-next" class="btn btn-primary" disabled>Next (Interact with Trackpad)</button>
        </div>
      </div>
    `;

    const nextBtn = this.container.querySelector('#btn-step3-next') as HTMLButtonElement;
    const backBtn = this.container.querySelector('#btn-step3-back') as HTMLButtonElement;
    const touchDot0 = this.container.querySelector('#touch-dot-0') as HTMLElement;
    const touchDot1 = this.container.querySelector('#touch-dot-1') as HTMLElement;
    const padFrame = this.container.querySelector('#vis-touchpad') as HTMLElement;

    const batEl = this.container.querySelector('#vis-battery') as HTMLElement;
    const chargeEl = this.container.querySelector('#vis-charge') as HTMLElement;
    const vCross = this.container.querySelector('#v-cross') as HTMLElement;
    const vCircle = this.container.querySelector('#v-circle') as HTMLElement;
    const vPad = this.container.querySelector('#v-pad') as HTMLElement;

    backBtn.addEventListener('click', () => {
      this.controller?.disconnect();
      this.renderStep2DeviceList();
    });

    const unsubscribe = this.controller?.subscribe((state: DualSenseState) => {
      batEl.textContent = `${state.batteryLevel}%`;
      chargeEl.textContent = state.isCharging ? 'Charging (Fast)' : state.isPlugged ? 'Plugged' : 'No';

      vCross.textContent = state.cross ? 'PRESSED' : '-';
      vCircle.textContent = state.circle ? 'PRESSED' : '-';
      vPad.textContent = state.touchpadClick ? 'CLICKED' : '-';

      // Touch 0 Visualizer
      if (state.touch0.active) {
        this.trackpadInteracted = true;
        nextBtn.disabled = false;
        nextBtn.textContent = 'Continue to Audio Setup';

        const normX = (state.touch0.x / 1920) * padFrame.clientWidth;
        const normY = (state.touch0.y / 1080) * padFrame.clientHeight;
        touchDot0.style.display = 'block';
        touchDot0.style.transform = `translate(${normX}px, ${normY}px)`;
      } else {
        touchDot0.style.display = 'none';
      }

      // Touch 1 Visualizer
      if (state.touch1.active) {
        const normX = (state.touch1.x / 1920) * padFrame.clientWidth;
        const normY = (state.touch1.y / 1080) * padFrame.clientHeight;
        touchDot1.style.display = 'block';
        touchDot1.style.transform = `translate(${normX}px, ${normY}px)`;
      } else {
        touchDot1.style.display = 'none';
      }
    });

    nextBtn.addEventListener('click', () => {
      if (this.selectedTransport === 'usb') {
        this.renderStep4UsbAudio();
      } else {
        // Bluetooth skips mic/audio steps and initializes worker haptics
        if (this.selectedHidDevice) {
          this.audioEngine.initializeBluetooth(this.selectedHidDevice);
          this.polyfill.install(this.audioEngine);
        }
        this.renderStep5HapticsTest();
      }
    });
  }

  // --- Step 4: USB Audio Endpoint & Quadraphonic Setup ---
  private async renderStep4UsbAudio(): Promise<void> {
    this.container.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-header">
          <h2>USB Audio & Quadraphonic Setup</h2>
          <p class="subtitle">Step 4 of 5: Audio Endpoint Routing</p>
        </div>

        <div class="wizard-body">
          <div class="info-alert">
            <strong>Microphone Access Notice:</strong> In Chrome, audio output device names are hidden by default for privacy. Requesting temporary microphone access allows the browser to show device names so you can select the DualSense audio output. <em>No audio is recorded or stored.</em>
          </div>

          <div class="permission-row">
            <button id="btn-request-mic" class="btn btn-secondary">Grant Permission to Unmask Device Names</button>
            <span id="mic-status" class="badge">Permission Pending</span>
          </div>

          <div class="audio-sinks-section">
            <label><strong>Select DualSense 4-Channel Audio Sink:</strong></label>
            <div id="audio-sink-list" class="device-list">
              <div class="empty-list">Click "Grant Permission" above to populate DualSense audio outputs.</div>
            </div>
          </div>

          <div id="channel-error-box" class="channel-alert hidden">
            <h4>⚠ Quadraphonic Setup Required (2 Channels Detected)</h4>
            <p>DualSense haptics are routed over audio channels 3 & 4. Your operating system currently exposes only 2 channels.</p>
            <div class="os-guides">
              <strong>Configuration Instructions:</strong>
              <ul>
                <li><strong>Windows:</strong> Open <code>mmsys.cpl</code> (Sound Control Panel) → Select "Wireless Controller" → Click <strong>Configure</strong> → Choose <strong>Quadraphonic</strong>.</li>
                <li><strong>macOS:</strong> Open <strong>Audio MIDI Setup</strong> → Select "Wireless Controller" → Configure Speakers → Select <strong>Quadraphonic</strong>.</li>
                <li><strong>Linux:</strong> In <code>pavucontrol</code> or PipeWire, change device profile to <strong>Pro Audio</strong> or <strong>Analog Surround 4.0</strong>.</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="wizard-footer">
          <button id="btn-step4-back" class="btn btn-secondary">Back</button>
          <button id="btn-step4-connect" class="btn btn-primary" disabled>Initialize 4-Channel Haptics</button>
        </div>
      </div>
    `;

    const micBtn = this.container.querySelector('#btn-request-mic') as HTMLButtonElement;
    const micStatus = this.container.querySelector('#mic-status') as HTMLElement;
    const sinkList = this.container.querySelector('#audio-sink-list') as HTMLElement;
    const channelAlert = this.container.querySelector('#channel-error-box') as HTMLElement;
    const connectBtn = this.container.querySelector('#btn-step4-connect') as HTMLButtonElement;
    const backBtn = this.container.querySelector('#btn-step4-back') as HTMLButtonElement;

    backBtn.addEventListener('click', () => this.renderStep3Visualizer());

    const refreshSinks = async () => {
      const sinks = await this.audioEngine.getMatchingAudioSinks();
      if (sinks.length === 0) {
        sinkList.innerHTML = `<div class="empty-list">No "Wireless Controller" audio outputs found. Please check USB cable.</div>`;
        connectBtn.disabled = true;
        this.selectedAudioSink = null;
        return;
      }

      sinkList.innerHTML = '';
      sinks.forEach((sink, idx) => {
        const el = document.createElement('div');
        el.className = `device-item ${idx === 0 ? 'selected' : ''}`;
        el.innerHTML = `
          <div class="device-info">
            <strong>${sink.label}</strong>
            <span class="subtext">Device ID: ${sink.deviceId.slice(0, 16)}...</span>
          </div>
        `;
        el.addEventListener('click', () => {
          sinkList.querySelectorAll('.device-item').forEach((i) => i.classList.remove('selected'));
          el.classList.add('selected');
          this.selectedAudioSink = sink;
          connectBtn.disabled = false;
        });
        sinkList.appendChild(el);
      });

      this.selectedAudioSink = sinks[0];
      connectBtn.disabled = false;
    };

    micBtn.addEventListener('click', async () => {
      micBtn.disabled = true;
      const granted = await this.audioEngine.requestMicrophonePermission();
      if (granted) {
        micStatus.textContent = '✓ Permission Granted';
        micStatus.className = 'badge badge-success';
        await refreshSinks();
      } else {
        micStatus.textContent = '✗ Permission Denied';
        micStatus.className = 'badge badge-danger';
        sinkList.innerHTML = `<div class="error-msg">Microphone permission was denied. Cannot unmask audio outputs. Please reset permission and retry.</div>`;
      }
    });

    connectBtn.addEventListener('click', async () => {
      if (!this.selectedAudioSink) return;
      connectBtn.disabled = true;
      connectBtn.textContent = 'Verifying Channels...';

      const result = await this.audioEngine.initializeUSB(this.selectedAudioSink.deviceId);

      if (!result.success || result.channels < 4) {
        channelAlert.classList.remove('hidden');
        connectBtn.disabled = false;
        connectBtn.textContent = 'Retry 4-Channel Verification';
        return;
      }

      // Success: 4 channels verified!
      channelAlert.classList.add('hidden');
      this.polyfill.install(this.audioEngine);
      this.renderStep5HapticsTest();
    });
  }

  // --- Step 5: Haptics Verification & Test Pulse ---
  private renderStep5HapticsTest(): void {
    this.container.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-header">
          <h2>Verify Tactile Haptics</h2>
          <p class="subtitle">Step 5 of 5: Test Pulse</p>
        </div>

        <div class="wizard-body">
          <div class="test-pulse-container">
            <div class="haptic-ripple" id="pulse-indicator"></div>
            <p>Playing a 1 Hz haptic test pulse on your DualSense actuators...</p>
            <p class="question">Do you feel the haptic pulse in your hands?</p>
          </div>
        </div>

        <div class="wizard-footer">
          <button id="btn-step5-retry" class="btn btn-secondary">Troubleshoot / Retry</button>
          <button id="btn-step5-yes" class="btn btn-primary">Yes, I Feel It! (Complete Setup)</button>
        </div>
      </div>
    `;

    const indicator = this.container.querySelector('#pulse-indicator') as HTMLElement;
    const yesBtn = this.container.querySelector('#btn-step5-yes') as HTMLButtonElement;
    const retryBtn = this.container.querySelector('#btn-step5-retry') as HTMLButtonElement;

    // Pulse 1 Hz
    this.testInterval = window.setInterval(() => {
      navigator.playHaptics?.('tick', 1.0);
      indicator.classList.add('pulse');
      setTimeout(() => indicator.classList.remove('pulse'), 150);
    }, 1000);

    retryBtn.addEventListener('click', () => {
      this.stopTestPulse();
      if (this.selectedTransport === 'usb') {
        this.renderStep4UsbAudio();
      } else {
        this.renderStep2DeviceList();
      }
    });

    yesBtn.addEventListener('click', () => {
      this.stopTestPulse();
      this.completeWizard();
    });
  }

  private stopTestPulse(): void {
    if (this.testInterval !== null) {
      clearInterval(this.testInterval);
      this.testInterval = null;
    }
  }

  private completeWizard(): void {
    this.container.innerHTML = '';
    this.onCompleteCallback();
  }
}
