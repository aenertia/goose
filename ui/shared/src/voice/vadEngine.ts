export type VadEngineId = 'silero-v6' | 'silero-v5' | 'rms-energy' | 'none';

export interface VadEngineConfig {
  sampleRate: number;
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionFrames: number;
  minSpeechFrames: number;
  preSpeechPadFrames: number;
}

export const VAD_DEFAULTS: VadEngineConfig = {
  sampleRate: 16000,
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionFrames: 24,
  minSpeechFrames: 9,
  preSpeechPadFrames: 3,
};

export interface VadEngine {
  readonly name: VadEngineId;
  readonly frameSamples: number;
  init(): Promise<boolean>;
  processFrame(samples: Float32Array): Promise<number>;
  reset(): void;
  destroy(): Promise<void>;
}
