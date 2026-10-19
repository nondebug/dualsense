// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

export function initDemoWidgets(container: HTMLElement): void {
  container.innerHTML = `
    <div class="demo-grid">
      <!-- 1. Stepped Slider (tick + edge) -->
      <section class="widget-card">
        <div class="widget-header">
          <h3>1. Stepped Slider</h3>
          <span class="badge badge-effect">tick</span>
          <span class="badge badge-effect">edge</span>
        </div>
        <p class="widget-desc">Moving through discrete ticks triggers <code>tick</code>. Colliding with boundaries triggers <code>edge</code>.</p>
        <div class="slider-container">
          <input type="range" id="stepped-slider" min="0" max="100" step="10" value="50" class="custom-slider" />
          <div class="slider-marks">
            <span data-val="0">0</span>
            <span data-val="20">20</span>
            <span data-val="40">40</span>
            <span data-val="60">60</span>
            <span data-val="80">80</span>
            <span data-val="100">100</span>
          </div>
          <div class="slider-readout">Value: <span id="slider-val">50</span>%</div>
        </div>
      </section>

      <!-- 2. Magnetic Docking Zone (align) -->
      <section class="widget-card">
        <div class="widget-header">
          <h3>2. Magnetic Docking Zone</h3>
          <span class="badge badge-effect">align</span>
        </div>
        <p class="widget-desc">Drag the token into the docking bay. Snapping to the lock guides triggers <code>align</code>.</p>
        <div class="dock-arena" id="dock-arena">
          <div class="dock-zone" id="dock-zone">
            <span class="dock-label">Dock Target</span>
          </div>
          <div class="dock-token" id="dock-token" tabindex="0">
            <span>●</span>
          </div>
        </div>
      </section>

      <!-- 3. Segmented Switch (tick) -->
      <section class="widget-card">
        <div class="widget-header">
          <h3>3. Segmented Switch</h3>
          <span class="badge badge-effect">tick</span>
        </div>
        <p class="widget-desc">Switching discrete state modes triggers a crisp mechanical <code>tick</code>.</p>
        <div class="segmented-control" id="segmented-ctrl">
          <button class="seg-btn active" data-val="eco">Eco Mode</button>
          <button class="seg-btn" data-val="balanced">Balanced</button>
          <button class="seg-btn" data-val="performance">Performance</button>
        </div>
      </section>

      <!-- 4. Interactive Affordance Cards (hint) -->
      <section class="widget-card">
        <div class="widget-header">
          <h3>4. Hover Focus Cards</h3>
          <span class="badge badge-effect">hint</span>
        </div>
        <p class="widget-desc">Hovering interactive touch targets triggers a gentle affordance <code>hint</code>.</p>
        <div class="cards-row">
          <div class="hover-box" tabindex="0">
            <strong>Affordance A</strong>
            <span>Subtle tactile cue</span>
          </div>
          <div class="hover-box" tabindex="0">
            <strong>Affordance B</strong>
            <span>Subtle tactile cue</span>
          </div>
        </div>
      </section>

      <!-- 5. Form Submit Action (success) -->
      <section class="widget-card">
        <div class="widget-header">
          <h3>5. Action Confirmation</h3>
          <span class="badge badge-effect">success</span>
        </div>
        <p class="widget-desc">Completing a verification form or task trigger fires a positive <code>success</code> chime.</p>
        <form id="demo-form" class="demo-form" onsubmit="return false;">
          <input type="text" id="demo-input" placeholder="Type your confirmation..." class="form-input" required />
          <button type="submit" class="btn btn-primary" id="btn-submit">Submit Action</button>
        </form>
        <div id="submit-toast" class="toast hidden">✓ Action Confirmed Successfully!</div>
      </section>

      <!-- 6. Destructive / Error Trigger (error) -->
      <section class="widget-card">
        <div class="widget-header">
          <h3>6. Error & Boundary Failure</h3>
          <span class="badge badge-effect">error</span>
        </div>
        <p class="widget-desc">Attempting an unauthorized or invalid action fires a dissonant warning <code>error</code> rattle.</p>
        <div class="error-action-row">
          <button class="btn btn-danger" id="btn-danger">Trigger Security Lockout</button>
          <button class="btn btn-secondary" id="btn-disabled-action">Restricted Action</button>
        </div>
        <div id="error-toast" class="toast toast-error hidden">⚠ Access Denied: Action Not Permitted</div>
      </section>
    </div>
  `;

  // --- Attach Handlers Using navigator.playHaptics ---

  // 1. Slider
  const slider = container.querySelector('#stepped-slider') as HTMLInputElement;
  const sliderVal = container.querySelector('#slider-val') as HTMLElement;
  const sliderMarks = container.querySelectorAll('.slider-marks span');
  let lastVal = parseInt(slider.value, 10);

  const applySliderValue = (newVal: number) => {
    slider.value = String(newVal);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  };

  sliderMarks.forEach((mark) => {
    mark.addEventListener('click', () => {
      const val = parseInt(mark.getAttribute('data-val') || '0', 10);
      applySliderValue(val);
    });
    mark.addEventListener('pointerdown', () => {
      const val = parseInt(mark.getAttribute('data-val') || '0', 10);
      applySliderValue(val);
    });
  });

  slider.addEventListener('input', () => {
    const curVal = parseInt(slider.value, 10);
    sliderVal.textContent = String(curVal);

    if (curVal !== lastVal) {
      if (curVal === 0 || curVal === 100) {
        navigator.playHaptics?.('edge', 1.0);
      } else {
        navigator.playHaptics?.('tick', 0.8);
      }
      lastVal = curVal;
    }
  });

  // 2. Magnetic Docking Zone
  const arena = container.querySelector('#dock-arena') as HTMLElement;
  const zone = container.querySelector('#dock-zone') as HTMLElement;
  const token = container.querySelector('#dock-token') as HTMLElement;
  let isDragging = false;
  let isDocked = false;

  const getArenaCoords = (clientX: number, clientY: number) => {
    const rect = arena.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  token.addEventListener('pointerdown', (e: PointerEvent) => {
    isDragging = true;
    token.setPointerCapture(e.pointerId);
    token.classList.add('dragging');
  });

  token.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging) return;
    const { x, y } = getArenaCoords(e.clientX, e.clientY);
    const clampedX = Math.max(16, Math.min(arena.clientWidth - 16, x));
    const clampedY = Math.max(16, Math.min(arena.clientHeight - 16, y));

    token.style.left = `${clampedX}px`;
    token.style.top = `${clampedY}px`;

    // Check collision with Dock Target
    const zoneRect = zone.getBoundingClientRect();
    const tokenRect = token.getBoundingClientRect();

    const dx = Math.abs(zoneRect.left + zoneRect.width / 2 - (tokenRect.left + tokenRect.width / 2));
    const dy = Math.abs(zoneRect.top + zoneRect.height / 2 - (tokenRect.top + tokenRect.height / 2));

    const snapDistance = 35;
    if (dx < snapDistance && dy < snapDistance) {
      if (!isDocked) {
        isDocked = true;
        zone.classList.add('active-dock');
        navigator.playHaptics?.('align', 1.0);
      }
    } else {
      if (isDocked) {
        isDocked = false;
        zone.classList.remove('active-dock');
      }
    }
  });

  const endDrag = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    token.classList.remove('dragging');
    try {
      token.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (isDocked) {
      // Snap to center of dock
      token.style.left = `${zone.offsetLeft + zone.clientWidth / 2}px`;
      token.style.top = `${zone.offsetTop + zone.clientHeight / 2}px`;
    }
  };

  token.addEventListener('pointerup', endDrag);
  token.addEventListener('pointercancel', endDrag);

  // 3. Segmented Switch
  const segButtons = container.querySelectorAll('.seg-btn');
  segButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      segButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      navigator.playHaptics?.('tick', 0.9);
    });
  });

  // 4. Hover Affordance Cards
  const hoverBoxes = container.querySelectorAll('.hover-box');
  hoverBoxes.forEach((box) => {
    box.addEventListener('pointerenter', () => {
      navigator.playHaptics?.('hint', 0.7);
    });
  });

  // 5. Form Submit Action
  const form = container.querySelector('#demo-form') as HTMLFormElement;
  const demoInput = container.querySelector('#demo-input') as HTMLInputElement;
  const toast = container.querySelector('#submit-toast') as HTMLElement;

  if (demoInput) {
    demoInput.addEventListener('pointerdown', () => demoInput.focus());
    demoInput.addEventListener('click', () => demoInput.focus());
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    navigator.playHaptics?.('success', 1.0);
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2500);
  });

  // 6. Error & Boundary Failure
  const btnDanger = container.querySelector('#btn-danger') as HTMLElement;
  const btnDisabled = container.querySelector('#btn-disabled-action') as HTMLElement;
  const errorToast = container.querySelector('#error-toast') as HTMLElement;

  const triggerError = () => {
    navigator.playHaptics?.('error', 1.0);
    errorToast.classList.remove('hidden');
    setTimeout(() => errorToast.classList.add('hidden'), 2500);
  };

  btnDanger.addEventListener('click', triggerError);
  btnDisabled.addEventListener('click', triggerError);
}
