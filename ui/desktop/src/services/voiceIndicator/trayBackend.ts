import type { Tray } from 'electron';
import type { VoiceIndicatorService, VoicePhase, VoiceState } from './types';

const labels: Record<VoicePhase, string> = {
  idle: 'Goose',
  listening: 'Goose: Listening...',
  transcribing: 'Goose: Transcribing...',
  submitting: 'Goose: Thinking...',
  speaking: 'Goose: Speaking...',
};

export class TrayIndicatorBackend implements VoiceIndicatorService {
  constructor(private tray: Tray | null) {}

  updateState(state: VoiceState): void {
    if (!this.tray) return;
    if (!state.conversationActive) {
      this.tray.setToolTip('Goose');
      return;
    }
    this.tray.setToolTip(labels[state.phase]);
  }

  dispose(): void {
    /* no cleanup needed */
  }
}
