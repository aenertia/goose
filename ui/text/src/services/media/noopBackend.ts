import type { AudioPlayer } from './types.js';

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
