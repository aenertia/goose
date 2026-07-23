import type { MediaControlService } from './types';

export type { MediaControlService } from './types';

export async function createMediaControlService(): Promise<MediaControlService> {
  if (process.platform === 'linux') {
    const { MprisMediaControlBackend } = await import('./mprisBackend');
    return new MprisMediaControlBackend();
  }
  const { NoopMediaControlBackend } = await import('./noopBackend');
  return new NoopMediaControlBackend();
}
