import { useState, useRef, useCallback, useEffect } from 'react';
import { useAudioPlayer } from './useAudioPlayer';
import type { VoicePhase } from '@aaif/voice-shared/voice/types.js';

export type ConversationState = VoicePhase;

export interface UseConversationModeReturn {
  // --- New two-axis API (Wave 1) ---
  /** Whether HONK style (conversational mode) is enabled. */
  honkActive: boolean;
  /** Whether the mic is actively recording in conversation context. */
  isListening: boolean;
  /** Derived: honkActive && isListening — full voice loop is running. */
  voiceLoopActive: boolean;
  /** Enable HONK style, fire IPC inhibit/media pause. Does NOT start recording. */
  activateHonk: () => void;
  /** Disable HONK style, stop recording if listening, stop playback, fire IPC release/resume. */
  deactivateHonk: () => void;
  /** Start mic recording; only works when honkActive. */
  startListening: () => void;
  /** Stop mic recording; keeps honkActive. */
  stopListening: () => void;

  // --- Backward compat (Wave 2 will update callers) ---
  /** @deprecated Use honkActive instead. */
  isActive: boolean;
  /** @deprecated Use activateHonk instead. Note: no longer starts recording. */
  activate: () => void;
  /** @deprecated Use deactivateHonk instead. */
  deactivate: () => void;
  /** Current phase of the conversation loop (derived from both axes). */
  state: ConversationState;
  /** Wire this as onSilenceAutoSubmit into useAudioRecorder. */
  handleAutoSubmit: (text: string) => void;
  /** Call when the LLM stream finishes (from onStreamFinish). */
  handleStreamFinish: (responseText: string) => void;
  startStreamingSpeak: () => Promise<void>;
  enqueueStreamChunk: (text: string) => Promise<void>;
  handleSpeechStart: () => void;
}

interface UseConversationModeOptions {
  /** Submit a message to the chat session. */
  submitMessage: (text: string) => void;
  /** Start audio recording (from useAudioRecorder). */
  startRecording: () => void;
  /** Stop audio recording (from useAudioRecorder). */
  stopRecording: () => void;
  /** Whether audio is currently recording. */
  isRecording: boolean;
  /** Whether the LLM is currently generating. */
  isLoading: boolean;
}

// Module-level persistence: survives React component remounts (ChatInput
// remounts during the first LLM response cycle, resetting all useState).
// Same pattern as globalStopped/globalSource in useAudioPlayer.ts.
let persistedHonkActive = false;

export function useConversationMode({
  submitMessage,
  startRecording,
  stopRecording,
  isRecording: _isRecording,
  isLoading: _isLoading,
}: UseConversationModeOptions): UseConversationModeReturn {
  // --- Two independent state axes ---
  const [honkActive, setHonkActive] = useState(persistedHonkActive);
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { stop: stopPlayback, isPlaying, startStreamingSpeak, enqueueStreamChunk } = useAudioPlayer();

  // Refs for stable callback access
  const honkActiveRef = useRef(false);
  const isListeningRef = useRef(false);
  const pausedMediaRef = useRef<string[]>([]);
  const echoSuspectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTtsAudioTimeRef = useRef(0);
  const prevIsPlayingRef = useRef(false);

  // Keep refs in sync
  honkActiveRef.current = honkActive;
  isListeningRef.current = isListening;

  // Stable refs for option callbacks (avoid stale closures)
  const submitMessageRef = useRef(submitMessage);
  submitMessageRef.current = submitMessage;
  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  // --- Derived state ---
  // Priority: !honkActive → isPlaying → isSubmitting → isListening → idle
  const state: ConversationState = (() => {
    if (!honkActive) return 'idle';
    if (isPlaying) return 'speaking';
    if (isSubmitting) return 'submitting';
    if (isListening) return 'listening';
    return 'idle';
  })();

  const voiceLoopActive = honkActive && isListening;

  // --- Internal: restart recording after TTS ---
  const beginListening = useCallback(() => {
    if (!honkActiveRef.current) return;
    if (isListeningRef.current) return;
    setIsListening(true);
    isListeningRef.current = true;
    startRecordingRef.current();
  }, []);

  // --- Public API ---
  const activateHonk = useCallback(() => {
    persistedHonkActive = true;
    setHonkActive(true);
    honkActiveRef.current = true;
    window.electron?.voiceInhibitStart?.('Voice conversation active');
    window.electron?.voiceMediaPause?.().then((tokens) => {
      pausedMediaRef.current = tokens;
    });
  }, []);

  const deactivateHonk = useCallback(() => {
    persistedHonkActive = false;
    setHonkActive(false);
    honkActiveRef.current = false;
    setIsListening(false);
    isListeningRef.current = false;
    setIsSubmitting(false);
    stopRecordingRef.current();
    stopPlayback();
    if (echoSuspectTimerRef.current !== null) {
      clearTimeout(echoSuspectTimerRef.current);
      echoSuspectTimerRef.current = null;
    }
    window.electron?.voiceInhibitRelease?.();
    if (pausedMediaRef.current.length > 0) {
      window.electron?.voiceMediaResume?.(pausedMediaRef.current);
      pausedMediaRef.current = [];
    }
  }, [stopPlayback]);

  const startListeningFn = useCallback(() => {
    if (!honkActiveRef.current) return;
    setIsListening(true);
    isListeningRef.current = true;
    startRecordingRef.current();
  }, []);

  const stopListeningFn = useCallback(() => {
    setIsListening(false);
    isListeningRef.current = false;
    stopRecordingRef.current();
  }, []);

  const handleAutoSubmit = useCallback(
    (text: string) => {
      if (!honkActiveRef.current) return;

      const filtered = text.replace(/\([^)]*\)/g, '').trim();
      if (!filtered) return;

      setIsSubmitting(true);
      submitMessageRef.current(filtered);
    },
    []
  );

  // Echo-suspect barge-in classification: when TTS is playing (or just finished),
  // VAD triggers are likely speaker echo, not genuine user speech. Defer 200ms
  // and only interrupt if speech persists. Mirrors TUI gstreamerBackend logic.
  const ECHO_SUSPECT_DEFER_MS = 200;

  const handleSpeechStart = useCallback(() => {
    if (!honkActiveRef.current) return;

    const isSpeakingNow = isPlaying;
    const isRecentTts = Date.now() - lastTtsAudioTimeRef.current < 150;
    const isEchoSuspect = isSpeakingNow || isRecentTts;

    if (isEchoSuspect) {
      // Already deferred — don't stack timers
      if (echoSuspectTimerRef.current !== null) return;
      echoSuspectTimerRef.current = setTimeout(() => {
        echoSuspectTimerRef.current = null;
        // Speech persisted past the defer window — genuine barge-in
        if (isPlaying) {
          stopPlayback();
        }
      }, ECHO_SUSPECT_DEFER_MS);
    } else {
      // Not echo-suspect — immediate barge-in
      if (echoSuspectTimerRef.current !== null) {
        clearTimeout(echoSuspectTimerRef.current);
        echoSuspectTimerRef.current = null;
      }
      if (isPlaying) {
        stopPlayback();
      }
    }
  }, [isPlaying, stopPlayback]);

  /**
   * Called when the LLM stream finishes. Streaming TTS already speaks
   * chunks via enqueueStreamChunk during the stream, so this must NOT
   * call speak() again. The isPlaying watcher effect handles restarting
   * the mic when all TTS chunks finish playing.
   */
  const handleStreamFinish = useCallback(
    (_responseText: string) => {
      if (!honkActiveRef.current) return;
    },
    []
  );

  // --- Effects ---

  // Clear isSubmitting when TTS starts playing (transition submitting→speaking)
  useEffect(() => {
    if (isPlaying && isSubmitting) {
      setIsSubmitting(false);
    }
  }, [isPlaying, isSubmitting]);

  // Notify IPC of state changes
  useEffect(() => {
    window.electron?.voiceStateChange?.({ phase: state, conversationActive: honkActive });
  }, [state, honkActive]);

  // Restart listening when TTS playback ends (true→false transition)
  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    prevIsPlayingRef.current = isPlaying;

    if (!wasPlaying || isPlaying || !honkActive || isListening || isSubmitting) return;

    const timerId = setTimeout(() => {
      if (honkActiveRef.current && !isListeningRef.current) {
        beginListening();
      }
    }, 100);
    return () => clearTimeout(timerId);
  }, [isPlaying, honkActive, isListening, isSubmitting, beginListening]);

  return {
    // New two-axis API
    honkActive,
    isListening,
    voiceLoopActive,
    activateHonk,
    deactivateHonk,
    startListening: startListeningFn,
    stopListening: stopListeningFn,
    // Backward compat aliases
    isActive: honkActive,
    activate: activateHonk,
    deactivate: deactivateHonk,
    // Shared
    state,
    handleAutoSubmit,
    handleStreamFinish,
    startStreamingSpeak: async () => {
      lastTtsAudioTimeRef.current = Date.now();
      return startStreamingSpeak();
    },
    enqueueStreamChunk: async (text: string) => {
      lastTtsAudioTimeRef.current = Date.now();
      return enqueueStreamChunk(text);
    },
    handleSpeechStart,
  };
}
