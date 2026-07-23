import type { VadEngineId } from '@aaif/voice-shared/voice/vadEngine.js';

export interface AudioPlayer {
  readonly backend: string;
  readonly persistent: boolean;
  readonly supportedFormats: readonly string[];

  connect(): Promise<void>;
  pushChunk(audio: Buffer, format: string): void;
  setVolume(level: number): void; // 0.0–1.0
  stop(): void;
  drain(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RecordOpts {
  sampleRate: number;
  channels: number;
  vadEngine: VadEngineId;
  silenceThresholdMs: number;
}

export interface AudioRecorder {
  readonly backend: string;

  connect(opts: RecordOpts): Promise<void>;
  onData(cb: (pcm: Buffer) => void): void;
  onSpeech(cb: () => void): void;
  onSilence(cb: () => void): void;
  stop(): void;
  dispose(): Promise<void>;
}

export interface MediaCapabilities {
  backend: 'gstreamer' | 'pacat' | 'afplay' | 'powershell' | 'ffmpeg' | 'noop';
  audioPlayback: boolean;
  audioCapture: boolean;
  persistentStreams: boolean;
  screenCapture: boolean;
  supportedFormats: readonly string[];
  gstreamerVersion: string | null;
  pipewire: boolean;
  loopbackAvailable: boolean;
  echoCancelAvailable: boolean;
}
