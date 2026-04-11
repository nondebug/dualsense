(function() {
    const nativeGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
    const nativeAddEventListener = window.addEventListener;
    const nativeRemoveEventListener = window.removeEventListener;

    let ds = null;
    let playingEffect = null;
    let playingPCM = null;
    let gamepadAudioCtx = null;
    let strongGain = null;
    let weakGain = null;
    let audioMerger = null

    const initAudio = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop());
        } catch (e) {
            console.warn("Microphone permission denied. Device labels will be hidden, and setSinkId may fail.", e);
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const dualSense = devices.find(d => 
            d.kind === 'audiooutput' && 
            d.label.toLowerCase().includes('wireless controller') &&
            !d.label.toLowerCase().includes('default')
        );

        if (!dualSense) {
            console.log('No DualSense audio device found');
            return;
        }
        const contextOptions = { sinkId: dualSense.deviceId };
        const audioCtx = new AudioContext(contextOptions);

        if (audioCtx.destination.maxChannelCount < 4) {
            console.log('Expected 4-channel audio device');
            return;
        }
        audioCtx.destination.channelCount = 4;
        audioCtx.destination.channelCountMode = 'explicit';
        audioCtx.destination.channelInterpretation = 'discrete';

				// Legacy rumble emulation
        const strongOsc = audioCtx.createOscillator();
        strongOsc.frequency.value = 60;  // Deep, heavy rumble
        strongGain = audioCtx.createGain();
        strongGain.gain.value = 0;
        strongOsc.connect(strongGain);

        const weakOsc = audioCtx.createOscillator();
        weakOsc.frequency.value = 180;  // Sharp, light buzz
        weakGain = audioCtx.createGain();
        weakGain.gain.value = 0;
        weakOsc.connect(weakGain);

        const hapticBus = audioCtx.createGain();
        strongGain.connect(hapticBus);
        weakGain.connect(hapticBus);
        strongOsc.start();
        weakOsc.start();

        audioMerger = audioCtx.createChannelMerger(4);
        audioMerger.connect(audioCtx.destination);
        hapticBus.connect(audioMerger, 0, 2);
        hapticBus.connect(audioMerger, 0, 3);
        
        return audioCtx;
    }

    const listeners = {
        gamepadconnected: new Set(),
        gamepaddisconnected: new Set()
    };
    let gamepads = [];
    Object.defineProperties(navigator, {
        getGamepads: {
            value: () => gamepads,
            writable: true
        },
        initGamepadHapticsPCM: {
            value: async () => {
                gamepadAudioCtx = await initAudio();
                ds = new DualSenseHid();

								const connected = await ds.connect();
                if (!connected) {
                    console.log('Failed to connect to DualSenseHid');
                    return false;
                }                
                await ds.initialize();

                const gamepad = {
                    id: 'DualSense',
                    index: 0,
                    connected: true,
                    timestamp: Date.now(),
                    mapping: 'standard',
                    axes: ds.input.axes,
                    buttons: ds.input.buttons,
                    touches: ds.input.touches,
                    vibrationActuator: {
                        effects: ['dual-rumble'],
                        playEffect: (type, options) => {
                            if (type !== 'dual-rumble') {
                                throw new NotSupportedError();
                            }
                            if (playingEffect) {
                                const doResolve = playingEffect.resolve;
                                playingEffect = null;
                                console.log('playEffect preempted');
                                doResolve('preempted');
                            }
                            if (playingPCM) {
                                playingPCM.source.onended = null;
                                playingPCM.source.stop();
                                playingPCM.source.disconnect();
                                playingPCM.splitter.disconnect();
                                const doResolve = playingPCM.resolve;
                                playingPCM = null;
                                console.log('play preempted');
                                doResolve('preempted');
                            }
                            console.log('playEffect start');
                            const startTime = gamepadAudioCtx.currentTime;
                            const strong = 'strongMagnitude' in options ? options.strongMagnitude : 0;
                            const weak = 'weakMagnitude' in options ? options.weakMagnitude : 0;
                            strongGain.gain.setTargetAtTime(strong, startTime, 0.05);
                            weakGain.gain.setTargetAtTime(weak, startTime, 0.05);
                            return new Promise((resolve, reject) => {
                                window.setTimeout(() => {
                                    if (!playingEffect || playingEffect.startTime !== startTime) {
                                        return;
                                    }
                                    const endTime = gamepadAudioCtx.currentTime;
                                    strongGain.gain.linearRampToValueAtTime(0, endTime + 0.05);
                                    weakGain.gain.linearRampToValueAtTime(0, endTime + 0.05);
                                    playingEffect = null;
                                    console.log('playEffect end');
                                    resolve('complete');
                                }, options.duration);
                                playingEffect = { resolve, startTime };
                            });
                            return promise;
                        },
                        play: (audioBuffer) => {
                            if (!gamepadAudioCtx) return;
                            if (playingEffect) {
                                const doResolve = playingEffect.resolve;
                                const endTime = gamepadAudioCtx.currentTime;
                                strongGain.gain.linearRampToValueAtTime(0, endTime + 0.05);
                                weakGain.gain.linearRampToValueAtTime(0, endTime + 0.05);
                                playingEffect = null;
                                console.log('playEffect preempted');
                                doResolve('preempted');
                            }
                            if (playingPCM) {
                                playingPCM.source.onended = null;
                                playingPCM.source.stop();
                                playingPCM.source.disconnect();
                                playingPCM.splitter.disconnect();
                                const doResolve = playingPCM.resolve;
                                playingPCM = null;
                                console.log('play preempted');
                                doResolve('preempted');
                            }
                            console.log('play start');
                            const startTime = gamepadAudioCtx.currentTime;
                            const source = gamepadAudioCtx.createBufferSource();
                            source.buffer = audioBuffer;
                            const splitter = gamepadAudioCtx.createChannelSplitter(2);
                            source.connect(splitter);
                            splitter.connect(audioMerger, 0, 2);
                            splitter.connect(audioMerger, 1, 3);
                            return new Promise((resolve, reject) => {
                                source.start();
                                source.onended = (e) => {
                                    if (!playingPCM || playingPCM.startTime !== startTime) {
                                        return;
                                    }
                                    playingPCM.source.disconnect();
                                    playingPCM.splitter.disconnect();
                                    playingPCM = null;
                                    console.log('play end');
                                    resolve(true);
                                };
                                playingPCM = { resolve, startTime, source, splitter };
                            });
                        },
                        reset: () => {
                            if (playingEffect) {
                                const doResolve = playingEffect.resolve;
                                playingEffect = null;
                                const endTime = gamepadAudioCtx.currentTime;
                                strongGain.gain.linearRampToValueAtTime(0, endTime + 0.05);
                                weakGain.gain.linearRampToValueAtTime(0, endTime + 0.05);
                                console.log('playEffect preempted');
                                doResolve('preempted');
                            }
                            if (playingPCM) {
                                playingPCM.source.onended = null;
                                playingPCM.source.stop();
                                playingPCM.source.disconnect();
                                playingPCM.splitter.disconnect();
                                const doResolve = playingPCM.resolve;
                                playingPCM = null;
                                console.log('play preempted');
                                doResolve('preempted');
                            }
                        }
                    },
                };
                gamepads = [gamepad];

                ds.addEventListener('inputreport', (e) => {
                    gamepad.axes = ds.input.axes;
                    gamepad.buttons = ds.input.buttons;
                    gamepad.touches = ds.input.touches.map(touch => {
                        return {
                            x: (2 * touch.x / 1920) - 1.0,
                            y: (2 * touch.y / 1080) - 1.0,
                            id: touch.id,
                        };
                    })
                });

                const event = new Event('gamepadconnected');
                Object.defineProperty(event, 'gamepad', { value: gamepad });

                listeners[event.type].forEach(callback => {
                    try {
                        if (typeof callback === 'function') {
                            callback.call(window, event);
                        } else if (callback && typeof callback.handleEvent === 'function') {
                            callback.handleEvent(event);
                        }
                    } catch (err) {
                        console.error('Error in intercepted listener:', err);
                    }
                });
                return true;
            }
        },
    });

    const gamepadEvents = ['gamepadconnected', 'gamepaddisconnected'];
    window.addEventListener = function(type, listener, options) {
        if (gamepadEvents.includes(type)) {
            listeners[type].add(listener);
            return; 
        }
        return nativeAddEventListener.call(window, type, listener, options);
    };
    window.removeEventListener = function(type, listener, options) {
        if (gamepadEvents.includes(type)) {
            listeners[type].remove(listener);
            return;
        }
        return nativeRemoveEventListener.call(window, type, listener, options);
    };
})();