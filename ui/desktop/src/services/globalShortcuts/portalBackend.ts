import type { ShortcutBinding, ShortcutService } from './types';

export class PortalShortcutBackend implements ShortcutService {
  private bus: any = null;
  private callbacks = new Map<string, () => void>();
  private fallback: ShortcutService | null = null;

  async register(bindings: ShortcutBinding[]): Promise<void> {
    // If we already fell back to Electron, delegate directly
    if (this.fallback) {
      return this.fallback.register(bindings);
    }

    try {
      await this.registerViaPortal(bindings);
    } catch (e) {
      console.warn('[GlobalShortcuts] Portal CreateSession failed, falling back to Electron backend:', e);
      const { ElectronShortcutBackend } = await import('./electronBackend');
      this.fallback = new ElectronShortcutBackend();
      return this.fallback.register(bindings);
    }
  }

  private async registerViaPortal(bindings: ShortcutBinding[]): Promise<void> {
    const dbus = await import('dbus-next');
    const Variant = dbus.Variant;

    this.bus = dbus.sessionBus();
    const obj = await this.bus.getProxyObject(
      'org.freedesktop.portal.Desktop',
      '/org/freedesktop/portal/desktop'
    );
    const portal = obj.getInterface('org.freedesktop.portal.GlobalShortcuts');

    // Store callbacks
    for (const b of bindings) {
      this.callbacks.set(b.id, b.callback);
    }

    // CreateSession
    const token = `goose_${Date.now()}`;
    const sessionToken = `goose_session_${Date.now()}`;
    const senderName = this.bus.name.replace(/^:/, '').replace(/\./g, '_');
    const expectedRequestPath = `/org/freedesktop/portal/desktop/request/${senderName}/${token}`;

    // Subscribe to Response signal BEFORE calling CreateSession
    const sessionHandle = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Portal CreateSession timed out'));
      }, 5000);

      this.bus.getProxyObject('org.freedesktop.portal.Desktop', expectedRequestPath)
        .then((reqObj: any) => {
          const reqIface = reqObj.getInterface('org.freedesktop.portal.Request');
          reqIface.on('Response', (responseCode: number, results: Record<string, any>) => {
            clearTimeout(timeout);
            if (responseCode === 0) {
              resolve(results.session_handle?.value ?? results.session_handle);
            } else {
              reject(new Error(`Portal CreateSession returned response code ${responseCode}`));
            }
          });

          // Now call CreateSession
          portal.CreateSession({
            handle_token: new Variant('s', token),
            session_handle_token: new Variant('s', sessionToken),
          }).catch((err: Error) => {
            clearTimeout(timeout);
            reject(err);
          });
        })
        .catch((err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    // BindShortcuts
    const shortcutsArray = bindings.map((b) => [
      b.id,
      {
        description: new Variant('s', b.description),
        preferred_trigger: new Variant('s', b.accelerator),
      },
    ]);

    const bindToken = `goose_bind_${Date.now()}`;
    const expectedBindPath = `/org/freedesktop/portal/desktop/request/${senderName}/${bindToken}`;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Portal BindShortcuts timed out'));
      }, 5000);

      this.bus.getProxyObject('org.freedesktop.portal.Desktop', expectedBindPath)
        .then((reqObj: any) => {
          const reqIface = reqObj.getInterface('org.freedesktop.portal.Request');
          reqIface.on('Response', (responseCode: number) => {
            clearTimeout(timeout);
            if (responseCode === 0) {
              resolve();
            } else {
              reject(new Error(`Portal BindShortcuts returned response code ${responseCode}`));
            }
          });

          portal.BindShortcuts(
            sessionHandle,
            shortcutsArray,
            '', // parent_window
            { handle_token: new Variant('s', bindToken) }
          ).catch((err: Error) => {
            clearTimeout(timeout);
            reject(err);
          });
        })
        .catch((err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    // Listen for Activated signal on the portal interface
    portal.on('Activated', (_sessionHandle: string, shortcutId: string) => {
      const cb = this.callbacks.get(shortcutId);
      if (cb) cb();
    });
  }

  async unregisterAll(): Promise<void> {
    if (this.fallback) {
      return this.fallback.unregisterAll();
    }
    this.callbacks.clear();
  }

  async dispose(): Promise<void> {
    if (this.fallback) {
      await this.fallback.dispose();
      this.fallback = null;
      return;
    }
    this.callbacks.clear();
    if (this.bus) {
      this.bus.disconnect();
      this.bus = null;
    }
  }
}
