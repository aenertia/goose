import { useState, useRef, useCallback, useEffect } from 'react';
import { useAudioPlayer } from './useAudioPlayer';

export type ConversationState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'submitting'
  | 'speaking';

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
  snapshotListeningState: () => void;
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

export function useConversationMode({
  submitMessage,
  startRecording,
  stopRecording,
  isRecording,
  isLoading: _isLoading,
}: UseConversationModeOptions): UseConversationModeReturn {
  // --- Two independent state axes ---
  const [honkActive, setHonkActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { speak, stop: stopPlayback, isPlaying, startStreamingSpeak, enqueueStreamChunk } = useAudioPlayer();

  // Refs for stable callback access
  const honkActiveRef = useRef(false);
  const isListeningRef = useRef(false);
  const pausedMediaRef = useRef<string[]>([]);
  const wasListeningBeforeSpeakingRef = useRef(false);

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
    setIsListening(true);
    isListeningRef.current = true;
    startRecordingRef.current();
  }, []);

  // --- Public API ---
  const activateHonk = useCallback(() => {
    setHonkActive(true);
    honkActiveRef.current = true;
    window.electron?.voiceInhibitStart?.('Voice conversation active');
    window.electron?.voiceMediaPause?.().then((tokens) => {
      pausedMediaRef.current = tokens;
    });
  }, []);

  const deactivateHonk = useCallback(() => {
    setHonkActive(false);
    honkActiveRef.current = false;
    setIsListening(false);
    isListeningRef.current = false;
    setIsSubmitting(false);
    stopRecordingRef.current();
    stopPlayback();
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

  const snapshotListeningState = useCallback(() => {
    wasListeningBeforeSpeakingRef.current = isListeningRef.current;
  }, []);

  // --- Conversation loop handlers ---

  /**
   * Called by useAudioRecorder's onSilenceAutoSubmit when silence is detected
   * after speech in conversation mode. Receives the transcribed text.
   */
  const handleAutoSubmit = useCallback(
    (text: string) => {
      if (!honkActiveRef.current) return;

      // Filter out non-speech artifacts (parenthetical noise descriptions)
      const filtered = text.replace(/\([^)]*\)/g, '').trim();
      if (!filtered) {
        beginListening();
        return;
      }

      // Stop recording, submit the text
      stopRecordingRef.current();
      setIsSubmitting(true);
      submitMessageRef.current(filtered);
    },
    [beginListening]
  );

  /**
   * Called when the LLM stream finishes. If HONK mode is active,
   * auto-speak the response and then optionally restart listening.
   */
  const handleStreamFinish = useCallback(
    (responseText: string) => {
      if (!honkActiveRef.current) return;

      const cleaned = responseText.trim();
      if (!cleaned) {
        beginListening();
        return;
      }

      // Snapshot whether mic was in the voice loop before we enter speaking
      wasListeningBeforeSpeakingRef.current = isListeningRef.current;
      speak(cleaned);
    },
    [speak, beginListening]
  );

  // --- Effects ---

  // Clear isSubmitting when TTS starts playing (transition submitting→speaking)
  useEffect(() => {
    if (isPlaying && isSubmitting) {
      setIsSubmitting(false);
    }
  }, [isPlaying, isSubmitting]);

  // Watch isPlaying transitions: when TTS finishes and we were in speaking state,
  // restart listening only if mic was active before speaking began.
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (wasPlayingRef.current && !isPlaying && honkActive) {
      if (wasListeningBeforeSpeakingRef.current) {
        beginListening();
      }
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, honkActive, beginListening]);

  // User interruption: if user starts speaking during TTS playback,
  // stop TTS and let recording continue
  useEffect(() => {
    if (honkActive && isRecording && isPlaying) {
      stopPlayback();
    }
  }, [honkActive, isRecording, isPlaying, stopPlayback]);

  // Notify IPC of state changes
  useEffect(() => {
    window.electron?.voiceStateChange?.({ phase: state, conversationActive: honkActive });
  }, [state, honkActive]);

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
    startStreamingSpeak,
    enqueueStreamChunk,
    snapshotListeningState,
  };
}
