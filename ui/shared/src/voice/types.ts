export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'submitting' | 'speaking';

export interface VoiceConfig {
  provider: string;
  voice: string;
  speed: number;
  format: string;
  quality?: string;
}

export interface VadConfig {
  method: 'silero' | 'rms-energy' | 'gst-level' | 'none';
  positiveThreshold: number;
  negativeThreshold: number;
  redemptionFrames: number;
  minSpeechFrames: number;
  silenceDurationMs: number;
  sampleRate: number;
}
