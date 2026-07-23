import { isWayland } from '../../utils/linuxDesktop';
import type { MediaInhibitService } from './types';

export type { MediaInhibitService } from './types';

export async function createMediaInhibitService(): Promise<MediaInhibitService> {
  if (process.platform === 'linux' && isWayland()) {
    const { PortalInhibitBackend } = await import('./portalBackend');
    return new PortalInhibitBackend();
  }
  const { ElectronInhibitBackend } = await import('./electronBackend');
  return new ElectronInhibitBackend();
}
