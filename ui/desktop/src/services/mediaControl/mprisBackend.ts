import type { MediaControlService } from './types';

export class MprisMediaControlBackend implements MediaControlService {
  private bus: any = null;

  private async getBus(): Promise<any> {
    if (!this.bus) {
      const dbus = await import('dbus-next');
      this.bus = dbus.sessionBus();
    }
    return this.bus;
  }

  async pauseAll(): Promise<string[]> {
    const paused: string[] = [];

    try {
      const bus = await this.getBus();
      const dbusObj = await bus.getProxyObject(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus'
      );
      const dbusIface = dbusObj.getInterface('org.freedesktop.DBus');
      const names: string[] = await dbusIface.ListNames();
      const mprisNames = names.filter((n: string) =>
        n.startsWith('org.mpris.MediaPlayer2.')
      );

      for (const name of mprisNames) {
        try {
          const playerObj = await bus.getProxyObject(
            name,
            '/org/mpris/MediaPlayer2'
          );
          const player = playerObj.getInterface(
            'org.mpris.MediaPlayer2.Player'
          );
          const props = playerObj.getInterface(
            'org.freedesktop.DBus.Properties'
          );
          const status = await props.Get(
            'org.mpris.MediaPlayer2.Player',
            'PlaybackStatus'
          );
          const statusValue = status.value ?? status;

          if (statusValue === 'Playing') {
            await player.Pause();
            paused.push(name);
          }
        } catch (e) {
          console.warn(`[MediaControl] Failed to pause ${name}:`, e);
        }
      }
    } catch (e) {
      console.warn('[MediaControl] Failed to enumerate MPRIS players:', e);
    }

    return paused;
  }

  async resumePaused(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;

    try {
      const bus = await this.getBus();

      for (const name of tokens) {
        try {
          const playerObj = await bus.getProxyObject(
            name,
            '/org/mpris/MediaPlayer2'
          );
          const player = playerObj.getInterface(
            'org.mpris.MediaPlayer2.Player'
          );
          await player.Play();
        } catch (e) {
          console.warn(`[MediaControl] Failed to resume ${name}:`, e);
        }
      }
    } catch (e) {
      console.warn('[MediaControl] Failed to resume players:', e);
    }
  }

  async dispose(): Promise<void> {
    if (this.bus) {
      this.bus.disconnect();
      this.bus = null;
    }
  }
}
