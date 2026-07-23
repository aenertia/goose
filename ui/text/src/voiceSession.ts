import type { AudioPlayer, AudioRecorder, MediaCapabilities } from './services/media/index.js';
import type { VoicePhase } from '@aaif/voice-shared/voice/types.js';

export interface VoiceSessionState {
  ttsEnabled: boolean;
  player: AudioPlayer | null;
  recorder: AudioRecorder | null;
  capabilities: MediaCapabilities | null;
  streamBuffer: string;
  streamCursor: number;
  voiceProvider: string;
  voiceId: string;
  voiceFormat: string;
  voiceSpeed: number;
  phase: VoicePhase;
  voiceConfigInitialized: boolean;
  conversationTurn: number;
  dictationProvider: string;
  dictationConfigInitialized: boolean;
  isListening: boolean;
  speechBuffer: Buffer[];
  playbackEpoch: number;
  isTranscribing: boolean;
  lastTtsChunkTime: number;
  echoSuspectTimer: ReturnType<typeof setTimeout> | null;
}

export const voiceSession: VoiceSessionState = {
  ttsEnabled: false,
  player: null,
  recorder: null,
  capabilities: null,
  streamBuffer: '',
  streamCursor: 0,
  voiceProvider: '',
  voiceId: '',
  voiceFormat: 'opus',
  voiceSpeed: 1.0,
  phase: 'idle',
  voiceConfigInitialized: false,
  conversationTurn: 0,
  dictationProvider: '',
  dictationConfigInitialized: false,
  isListening: false,
  speechBuffer: [],
  playbackEpoch: 0,
  isTranscribing: false,
  lastTtsChunkTime: 0,
  echoSuspectTimer: null,
};

export function resetVoiceSession(): void {
  voiceSession.streamBuffer = '';
  voiceSession.streamCursor = 0;
  voiceSession.speechBuffer = [];
  voiceSession.playbackEpoch = 0;
  voiceSession.isTranscribing = false;
  voiceSession.lastTtsChunkTime = 0;
  if (voiceSession.echoSuspectTimer !== null) {
    clearTimeout(voiceSession.echoSuspectTimer);
    voiceSession.echoSuspectTimer = null;
  }
}
