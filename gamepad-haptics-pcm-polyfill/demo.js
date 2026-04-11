const audioCtx = new AudioContext();
const effectDurationMillis = 1000;
const sampleCount = effectDurationMillis * audioCtx.sampleRate / 1000;
const stereoEffect = audioCtx.createBuffer(2, sampleCount, audioCtx.sampleRate);
const leftEffect = audioCtx.createBuffer(2, sampleCount, audioCtx.sampleRate);
const rightEffect = audioCtx.createBuffer(2, sampleCount, audioCtx.sampleRate);
const stereoDataL = stereoEffect.getChannelData(0);
const stereoDataR = stereoEffect.getChannelData(1);
const leftData = leftEffect.getChannelData(0);
const rightData = rightEffect.getChannelData(1);
for (let i = 0; i < sampleCount; ++i) {
    const value = Math.sin(2 * Math.PI * 120 * i / audioCtx.sampleRate);
    stereoDataL[i] = stereoDataR[i] = leftData[i] = rightData[i] = value;
}

let oldButtons = null;
const onRequestAnimationFrame = () => {
  const gamepads = navigator.getGamepads();
  if (gamepads.length < 0 || gamepads[0] === null || !gamepads[0].connected) {
    return;
  }
  const gamepad = gamepads[0];
  if (!gamepad.vibrationActuator) {
    return;
  }
  if (gamepad.buttons[0].pressed && (!oldButtons || !oldButtons[0].pressed)) {
    gamepad.vibrationActuator.play(stereoEffect);
  }
  if (gamepad.buttons[1].pressed && (!oldButtons || !oldButtons[1].pressed)) {
    gamepad.vibrationActuator.play(rightEffect);
  }
  if (gamepad.buttons[2].pressed && (!oldButtons || !oldButtons[2].pressed)) {
    gamepad.vibrationActuator.play(leftEffect);
  }
  if (gamepad.buttons[3].pressed && (!oldButtons || !oldButtons[3].pressed)) {
    gamepad.vibrationActuator.reset();
  }
  if (gamepad.buttons[12].pressed && (!oldButtons || !oldButtons[12].pressed)) {
    gamepad.vibrationActuator.reset();
  }
  if (gamepad.buttons[13].pressed && (!oldButtons || !oldButtons[13].pressed)) {
    gamepad.vibrationActuator.playEffect('dual-rumble', {duration: 1000, strongMagnitude: 1.0, weakMagnitude: 1.0});
  }
  if (gamepad.buttons[14].pressed && (!oldButtons || !oldButtons[14].pressed)) {
    gamepad.vibrationActuator.playEffect('dual-rumble', {duration: 1000, strongMagnitude: 1.0, weakMagnitude: 0.0});
  }
  if (gamepad.buttons[15].pressed && (!oldButtons || !oldButtons[15].pressed)) {
    gamepad.vibrationActuator.playEffect('dual-rumble', {duration: 1000, strongMagnitude: 0.0, weakMagnitude: 1.0});
  }
  oldButtons = gamepads[0].buttons.map(b => { return {pressed: b.pressed}; });

  if (gamepad.touches.length > 0) {
      const touchX = gamepad.touches[0].x;
      const touchY = gamepad.touches[0].y;
      const strongMagnitude = 0.5 * (touchX + 1.0);
      const weakMagnitude = 0.5 * (touchY + 1.0);
      console.log(strongMagnitude, weakMagnitude);
      gamepad.vibrationActuator.playEffect('dual-rumble', {duration: 100, strongMagnitude, weakMagnitude});
  }

  window.requestAnimationFrame(onRequestAnimationFrame);
};

window.addEventListener('gamepadconnected', (e) => {
    console.log('Connected', e.gamepad);
    window.requestAnimationFrame(onRequestAnimationFrame);    
});

window.addEventListener('gamepaddisconnected', (e) => {
    console.log('Disconnected', e.gamepad);
});

document.addEventListener('DOMContentLoaded', (e) => {
    const connectBtn = document.getElementById('connect-btn');
    connectBtn.addEventListener('click', () => navigator.initGamepadHapticsPCM());
});
