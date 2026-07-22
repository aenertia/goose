import type { AudioPlayer, AudioRecorder, RecordOpts } from './types.js';

export class NoopAudioPlayer implements AudioPlayer {
  readonly backend = 'noop' as const;
  readonly persistent = false;
  readonly supportedFormats: readonly string[] = [];

  connect(): Promise<void> {
    console.warn('[audio] no audio backend available');
    return Promise.resolve();
  }

  pushChunk(_audio: Buffer, _format: string): void {
    // no-op
  }

  setVolume(_level: number): void {
    // no-op
  }

  stop(): void {
    // no-op
  }

  drain(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

export class NoopAudioRecorder implements AudioRecorder {
  readonly backend = 'noop' as const;

  connect(_opts: RecordOpts): Promise<void> {
    return Promise.resolve();
  }

  onData(_cb: (pcm: Buffer) => void): void {}
  onSpeech(_cb: () => void): void {}
  onSilence(_cb: () => void): void {}

  stop(): void {}

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
