import type { MediaInhibitService } from './types';

export class PortalInhibitBackend implements MediaInhibitService {
  private bus: any = null;
  private inhibited = false;
  private fallback: MediaInhibitService | null = null;

  async inhibit(reason: string): Promise<void> {
    if (this.inhibited) return;

    if (this.fallback) {
      return this.fallback.inhibit(reason);
    }

    try {
      await this.inhibitViaPortal(reason);
      this.inhibited = true;
    } catch (e) {
      console.warn('[MediaInhibit] Portal Inhibit failed, falling back to Electron backend:', e);
      const { ElectronInhibitBackend } = await import('./electronBackend');
      this.fallback = new ElectronInhibitBackend();
      return this.fallback.inhibit(reason);
    }
  }

  private async inhibitViaPortal(reason: string): Promise<void> {
    const dbus = await import('dbus-next');
    const Variant = dbus.Variant;

    this.bus = dbus.sessionBus();
    const obj = await this.bus.getProxyObject(
      'org.freedesktop.portal.Desktop',
      '/org/freedesktop/portal/desktop'
    );
    const portal = obj.getInterface('org.freedesktop.portal.Inhibit');

    const token = `goose_inhibit_${Date.now()}`;
    const senderName = this.bus.name.replace(/^:/, '').replace(/\./g, '_');
    const expectedRequestPath = `/org/freedesktop/portal/desktop/request/${senderName}/${token}`;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Portal Inhibit timed out'));
      }, 5000);

      this.bus
        .getProxyObject('org.freedesktop.portal.Desktop', expectedRequestPath)
        .then((reqObj: any) => {
          const reqIface = reqObj.getInterface('org.freedesktop.portal.Request');
          reqIface.on('Response', (responseCode: number) => {
            clearTimeout(timeout);
            if (responseCode === 0) {
              resolve();
            } else {
              reject(new Error(`Portal Inhibit returned response code ${responseCode}`));
            }
          });

          // flags: 4 (suspend) | 8 (idle) = 12
          portal
            .Inhibit('', 12, {
              handle_token: new Variant('s', token),
              reason: new Variant('s', reason),
            })
            .catch((err: Error) => {
              clearTimeout(timeout);
              reject(err);
            });
        })
        .catch((err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  async release(): Promise<void> {
    if (this.fallback) {
      return this.fallback.release();
    }
    this.inhibited = false;
    // Portal inhibition is released by disconnecting the bus or closing the request
    if (this.bus) {
      this.bus.disconnect();
      this.bus = null;
    }
  }

  async dispose(): Promise<void> {
    if (this.fallback) {
      await this.fallback.dispose();
      this.fallback = null;
      return;
    }
    this.inhibited = false;
    if (this.bus) {
      this.bus.disconnect();
      this.bus = null;
    }
  }
}
