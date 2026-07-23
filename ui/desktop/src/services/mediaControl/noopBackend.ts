import type { MediaControlService } from './types';

export class NoopMediaControlBackend implements MediaControlService {
  async pauseAll(): Promise<string[]> {
    return [];
  }

  async resumePaused(_tokens: string[]): Promise<void> {
    // no-op on macOS/Windows
  }

  async dispose(): Promise<void> {
    // no cleanup needed
  }
}
