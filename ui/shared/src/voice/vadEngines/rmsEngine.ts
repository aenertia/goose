import type { VadEngine, VadEngineId } from '../vadEngine.js';
import { computeRms } from '../vad.js';
import { SILERO_FRAME_SIZE } from '../constants.js';

export class RmsEnergyEngine implements VadEngine {
  readonly name: VadEngineId = 'rms-energy';
  readonly frameSamples = SILERO_FRAME_SIZE;

  constructor(private readonly threshold: number = 0.015) {}

  async init(): Promise<boolean> { return true; }

  async processFrame(samples: Float32Array): Promise<number> {
    return computeRms(samples) >= this.threshold ? 1.0 : 0.0;
  }

  reset(): void {}

  async destroy(): Promise<void> {}
}
