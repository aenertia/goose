import type { VadEngine, VadEngineId } from '../vadEngine.js';

export class NoopEngine implements VadEngine {
  readonly name: VadEngineId = 'none';
  readonly frameSamples = 512;

  async init(): Promise<boolean> { return true; }
  async processFrame(_samples: Float32Array): Promise<number> { return 0; }
  reset(): void {}
  async destroy(): Promise<void> {}
}
