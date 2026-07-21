import { powerSaveBlocker } from 'electron';
import type { MediaInhibitService } from './types';

export class ElectronInhibitBackend implements MediaInhibitService {
  private blockerId: number | null = null;

  async inhibit(_reason: string): Promise<void> {
    if (this.blockerId !== null) return;
    this.blockerId = powerSaveBlocker.start('prevent-display-sleep');
  }

  async release(): Promise<void> {
    if (this.blockerId === null) return;
    powerSaveBlocker.stop(this.blockerId);
    this.blockerId = null;
  }

  async dispose(): Promise<void> {
    await this.release();
  }
}
