export type VoicePhase = 'idle' | 'listening' | 'transcribing' | 'submitting' | 'speaking';

export interface VoiceState {
  phase: VoicePhase;
  conversationActive: boolean;
}

export interface VoiceIndicatorService {
  updateState(state: VoiceState): void;
  dispose(): void;
}
