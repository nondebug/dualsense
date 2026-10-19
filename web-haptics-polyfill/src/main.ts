// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import './style.css';
import { HapticsAudioEngine } from './haptics-audio.ts';
import { WebHapticsPolyfill } from './web-haptics-polyfill.ts';
import { DualSensePointerEngine } from './pointer-engine.ts';
import { SetupWizard } from './wizard.ts';
import { initDemoWidgets } from './demo-widgets.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header>
    <h1>
      <span>🎮</span>
      <span>Web Haptics API — DualSense Demo</span>
    </h1>
    <div class="header-status" id="header-status">
      <span class="badge badge-info">Standby</span>
    </div>
  </header>
  <main class="main-container" id="main-content">
    <div class="wizard-overlay" id="wizard-slot">
      <div class="wizard-card" style="text-align: center; padding: 3rem 2rem;">
        <h2 style="font-size: 1.6rem; margin-bottom: 0.75rem;">Web Haptics API Playground</h2>
        <p style="color: var(--text-muted); margin-bottom: 2rem; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.5;">
          Experience semantic tactile haptics using a Sony DualSense controller over USB or Bluetooth with full trackpad cursor navigation.
        </p>
        <button id="btn-start" class="btn btn-primary" style="padding: 0.85rem 2.25rem; font-size: 1.05rem;">
          Start Setup Wizard
        </button>
      </div>
    </div>
    <div id="demo-slot" class="hidden"></div>
  </main>
`;

const startBtn = document.querySelector<HTMLButtonElement>('#btn-start')!;
const wizardSlot = document.querySelector<HTMLDivElement>('#wizard-slot')!;
const demoSlot = document.querySelector<HTMLDivElement>('#demo-slot')!;
const headerStatus = document.querySelector<HTMLDivElement>('#header-status')!;

const audioEngine = new HapticsAudioEngine();
const polyfill = new WebHapticsPolyfill();
const pointerEngine = new DualSensePointerEngine();

startBtn.addEventListener('click', () => {
  headerStatus.innerHTML = `<span class="badge badge-warning">Wizard In Progress</span>`;

  const wizard = new SetupWizard(
    wizardSlot,
    audioEngine,
    polyfill,
    pointerEngine,
    () => {
      // Wizard complete! Show demo playground
      wizardSlot.classList.add('hidden');
      demoSlot.classList.remove('hidden');

      const modeBadge = polyfill.isInstalled
        ? `<span class="badge badge-success">DualSense Polyfill Active</span>`
        : `<span class="badge badge-primary">Native Web Haptics Active</span>`;

      headerStatus.innerHTML = `
        ${modeBadge}
        <span class="badge badge-effect">6 Effects Ready</span>
      `;

      initDemoWidgets(demoSlot);
    }
  );

  wizard.start();
});
