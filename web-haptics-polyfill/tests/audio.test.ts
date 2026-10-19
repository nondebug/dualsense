// Copyright 2026 The Chromium Authors / DualSense Haptics Authors
// Use of this source code is governed by a BSD-style license.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HapticsAudioEngine } from '../src/haptics-audio.ts';

// Mock Web Audio API for Node.js test environment
class MockAudioNode {
  connections: Array<{ target: any; outputIndex?: number; inputIndex?: number }> = [];
  connect(target: any, outputIndex = 0, inputIndex = 0) {
    this.connections.push({ target, outputIndex, inputIndex });
    return target;
  }
  disconnect() {
    this.connections = [];
  }
}

class MockAudioParam {
  value: number;
  timeline: Array<{ action: string; value: number; time: number }> = [];
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(val: number, time: number) {
    this.value = val;
    this.timeline.push({ action: 'set', value: val, time });
  }
  linearRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.timeline.push({ action: 'linear', value: val, time });
  }
  exponentialRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.timeline.push({ action: 'exponential', value: val, time });
  }
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam(1.0);
}

class MockOscillatorNode extends MockAudioNode {
  type = 'sine';
  frequency = new MockAudioParam(440);
  started = false;
  stopped = false;
  start(_time = 0) {
    this.started = true;
  }
  stop(_time = 0) {
    this.stopped = true;
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  threshold = new MockAudioParam(-3.0);
  knee = new MockAudioParam(6.0);
  ratio = new MockAudioParam(20.0);
  attack = new MockAudioParam(0.001);
  release = new MockAudioParam(0.05);
}

class MockChannelMergerNode extends MockAudioNode {
  numberOfInputs: number;
  constructor(numberOfInputs = 4) {
    super();
    this.numberOfInputs = numberOfInputs;
  }
}

class MockAudioDestinationNode extends MockAudioNode {
  maxChannelCount = 4;
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
}

class MockAudioContext {
  currentTime = 0;
  state = 'running';
  destination = new MockAudioDestinationNode();
  options: any;

  createdOscillators: MockOscillatorNode[] = [];
  createdGains: MockGainNode[] = [];

  constructor(options: any = {}) {
    this.options = options;
  }

  createGain() {
    const g = new MockGainNode();
    this.createdGains.push(g);
    return g;
  }

  createOscillator() {
    const o = new MockOscillatorNode();
    this.createdOscillators.push(o);
    return o;
  }

  createDynamicsCompressor() {
    return new MockDynamicsCompressorNode();
  }

  createChannelMerger(num: number) {
    return new MockChannelMergerNode(num);
  }

  async resume() {
    this.state = 'running';
  }

  async close() {
    this.state = 'closed';
  }
}

describe('Web Audio Quadraphonic & Haptics Synthesis Engine', () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).AudioContext = MockAudioContext;
  });

  it('configures 4-channel discrete routing and connects master limiter to rear channels 2 & 3', async () => {
    const engine = new HapticsAudioEngine();
    const res = await engine.initializeUSB('mock-sink-id');

    assert.equal(res.success, true);
    assert.equal(res.channels, 4);

    const ctx = engine.ctx as any;
    assert.equal(ctx.destination.channelCount, 4);
    assert.equal(ctx.destination.channelCountMode, 'explicit');
    assert.equal(ctx.destination.channelInterpretation, 'discrete');

    // Verify limiter routes to merger inputs 2 and 3 (channels 3 and 4)
    const limiter = engine.limiter as any;
    assert.ok(limiter);
    const rearConnections = limiter.connections.filter((c: any) => c.inputIndex === 2 || c.inputIndex === 3);
    assert.equal(rearConnections.length, 2, 'Limiter must route to rear left (2) and rear right (3)');
  });

  it('rejects and provides clear diagnostic error if maxChannelCount is less than 4', async () => {
    class MockStereoContext extends MockAudioContext {
      constructor(opts: any) {
        super(opts);
        this.destination.maxChannelCount = 2; // Only stereo available
      }
    }
    (globalThis as any).AudioContext = MockStereoContext;

    const engine = new HapticsAudioEngine();
    const res = await engine.initializeUSB('mock-sink-id');

    assert.equal(res.success, false);
    assert.equal(res.channels, 2);
    assert.match(res.error!, /Quadraphonic/);
  });

  it('synthesizes all 6 predefined effects without throwing', async () => {
    const engine = new HapticsAudioEngine();
    await engine.initializeUSB('mock-sink-id');

    const effects = ['tick', 'hint', 'edge', 'align', 'success', 'error'] as const;
    for (const eff of effects) {
      assert.doesNotThrow(() => {
        engine.playEffect(eff, 0.8);
      });
    }

    const ctx = engine.ctx as any;
    assert.ok(ctx.createdOscillators.length >= 6, 'Oscillators must be scheduled for effects');
    assert.ok(ctx.createdOscillators.every((o: any) => o.started), 'All scheduled oscillators must be started');
  });
});
