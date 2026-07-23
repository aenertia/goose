import type { Tray } from 'electron';
import type { VoiceIndicatorService } from './types';
import { TrayIndicatorBackend } from './trayBackend';

export type { VoiceIndicatorService, VoiceState, VoicePhase } from './types';

export function createVoiceIndicatorService(tray: Tray | null): VoiceIndicatorService {
  return new TrayIndicatorBackend(tray);
}
