import type { VadEngineId } from './vadEngine.js';

export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'submitting' | 'speaking';

export interface VoiceConfig {
  provider: string;
  voice: string;
  speed: number;
  format: string;
  quality?: string;
}

export interface VadConfig {
  engine: VadEngineId;
  positiveThreshold: number;
  negativeThreshold: number;
  redemptionFrames: number;
  minSpeechFrames: number;
  silenceDurationMs: number;
  sampleRate: number;
}
