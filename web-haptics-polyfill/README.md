# Web Haptics API — Sony DualSense Polyfill & Interactive Demo

This project provides an interactive demonstration and polyfill for the proposed **WICG Web Haptics API** (`navigator.playHaptics(effect, intensity = 1)`), targeting the **Sony PlayStation 5 DualSense Wireless Controller** (standard CFI-ZCT1W and DualSense Edge CFI-ZCP1).

## Key Features

1. **Dual-Transport DualSense Driver (`src/dualsense.ts`)**:
   * **USB**: Automatic transport detection via collection descriptor length (504 bits). Transmits initial Output Report `0x02` (47 zero bytes) to disable classic motor emulation and allow audio-driven voice-coil haptics.
   * **Bluetooth**: Automatic detection (616 bits). Sends Feature Report `0x05` handshake to switch to Extended Mode (Report `0x31`, 77 bytes @ 250 Hz). Constructs Report `0x31` for LEDs/triggers and Report `0x32` (141 bytes) for stereo interleaved PCM haptic streaming.
   * **IEEE 802.3 CRC-32**: Appends transport header `0xa2` and computes CRC-32 for all outbound Bluetooth HID reports.
   * **Full Telemetry**: Decodes digital buttons, analog sticks/triggers, dual multi-touch capacitive trackpad coordinates, battery capacity (0–100% in 10% steps), charging status, and 3.5mm headphone/mic jack connection status.

2. **Web Haptics API Polyfill (`src/web-haptics-polyfill.ts`)**:
   * Strictly adheres to Chromium's native IDL (`partial interface Navigator { undefined playHaptics(HapticEffect effect, optional double intensity = 1); }`).
   * Validates the 6 predefined effect enums (`hint`, `edge`, `tick`, `align`, `success`, `error`), throwing a `TypeError` on invalid strings.
   * Enforces 8 ms dead-time throttling on high-frequency consecutive `tick` events to avoid actuator mush.
   * Leaves native implementation untouched if detected or forced via `?api=1`.

3. **Acoustic Waveform Synthesis & Quadraphonic Routing (`src/haptics-audio.ts`)**:
   * Tuned specifically to the DualSense ~150 Hz voice-coil actuator resonance.
   * **Additive Mixing Bus**: Multiple concurrent haptic cues mix naturally without preemption cutoffs.
   * **Master Soft Limiter**: `DynamicsCompressorNode` and `Math.tanh` saturation shaper prevent digital clipping or voice-coil overdrive.
   * **USB 4-Channel Discrete Routing**: Destination configured as `channelCount = 4`, `channelCountMode = 'explicit'`, `channelInterpretation = 'discrete'`. Channels 0 & 1 remain silent; Channels 2 & 3 drive the left and right haptic actuators.
   * **Bluetooth Worker (`src/bt-audio-worker.ts`)**: Offloads periodic report generation and PCM synthesis to a dedicated Web Worker to eliminate main-thread layout jitter.

4. **Virtual Cursor & Multi-Event Simulation (`src/pointer-engine.ts`)**:
   * Relative displacement driven by capacitive trackpad swipes (with dynamic acceleration curve) and left thumbstick deflection (with deadzone).
   * Trackpad button click and Cross (✕) button trigger left-clicks.
   * Viewport bounds clamping within `[0, window.innerWidth]` and `[0, window.innerHeight]`.
   * Transparent handoff: native mouse/touch events snap the cursor to absolute $(X, Y)$ coordinates without drift.
   * Dispatches synthetic `PointerEvent`, `MouseEvent`, and `TouchEvent` sequences via `document.elementFromPoint()`.

5. **Setup Wizard (`src/wizard.ts`)**:
   * **Step 1 (Mode Selection)**: Native Web Haptics vs. DualSense USB vs. DualSense Bluetooth. Includes macOS Bluetooth limitation badge (bypassable with `?bt=1`).
   * **Step 2 (Device Pairing)**: Filters WebHID devices, dynamic connect/disconnect listeners, auto-selects first item, single-device disambiguation.
   * **Step 3 (Controller & Trackpad Verification)**: SVG visualizer displaying live stick axes, buttons, battery %, and multi-touch dots. "Next" button locked until trackpad interaction is detected.
   * **Step 4 (USB Audio Setup)**: Explains necessity of microphone access to unmask output device labels. Enumerates matching DualSense audio outputs. Strictly verifies $\ge 4$ channels and provides OS setup instructions if only 2 channels are detected.
   * **Step 5 (Haptics Test)**: Emits a 1 Hz test pulse and asks "Do you feel the haptics?" before launching the playground.

6. **Interactive Showcase Playground (`src/demo-widgets.ts`)**:
   * Stepped slider (`tick` on detents, `edge` at min/max).
   * Magnetic dock arena (`align` when docking into guide).
   * Segmented toggle switch (`tick` on state transition).
   * Interactive hover cards (`hint` on pointer enter).
   * Confirmation form (`success` on submission).
   * Destructive / error trigger (`error` on unauthorized action).

## Getting Started

### Development
```bash
cd dualsense-haptics
npm run dev
```
Open the displayed local URL (e.g. `http://localhost:5173`) in Google Chrome.

### Production Build
```bash
npm run build
npm run preview
```

### URL Query Parameters
* `?api=1`: Force exposure of the Native Web Haptics option even if the browser does not natively expose `navigator.playHaptics`.
* `?bt=1`: Force-enable Bluetooth on macOS (bypassing the IOHID rate-limiting safeguard).
