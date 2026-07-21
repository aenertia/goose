import { globalShortcut } from 'electron';
import type { ShortcutBinding, ShortcutService } from './types';

export class ElectronShortcutBackend implements ShortcutService {
  async register(bindings: ShortcutBinding[]): Promise<void> {
    globalShortcut.unregisterAll();
    for (const binding of bindings) {
      try {
        globalShortcut.register(binding.accelerator, binding.callback);
      } catch (e) {
        console.error(`Failed to register shortcut "${binding.id}" (${binding.accelerator}):`, e);
      }
    }
  }

  async unregisterAll(): Promise<void> {
    globalShortcut.unregisterAll();
  }

  async dispose(): Promise<void> {
    globalShortcut.unregisterAll();
  }
}
