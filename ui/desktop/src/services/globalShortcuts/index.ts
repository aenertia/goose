import { isWayland } from '../../utils/linuxDesktop';
import type { ShortcutService } from './types';

export type { ShortcutService, ShortcutBinding } from './types';

export async function createShortcutService(): Promise<ShortcutService> {
  if (process.platform === 'linux' && isWayland()) {
    const { PortalShortcutBackend } = await import('./portalBackend');
    return new PortalShortcutBackend();
  }
  const { ElectronShortcutBackend } = await import('./electronBackend');
  return new ElectronShortcutBackend();
}
