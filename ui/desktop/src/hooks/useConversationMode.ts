import { useState, useRef, useCallback, useEffect } from 'react';
import { useAudioPlayer } from './useAudioPlayer';

export type ConversationState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'submitting'
  | 'speaking';

export interface UseConversationModeReturn {
  /** Whether conversation mode is currently running. */
  isActive: boolean;
  /** Start the listen-speak loop. */
  activate: () => void;
  /** Stop everything and return to idle. */
  deactivate: () => void;
  /** Current phase of the conversation loop. */
  state: ConversationState;
  /** Wire this as onSilenceAutoSubmit into useAudioRecorder. */
  handleAutoSubmit: (text: string) => void;
  /** Call when the LLM stream finishes (from onStreamFinish). */
  handleStreamFinish: (responseText: string) => void;
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
  const [isActive, setIsActive] = useState(false);
  const [state, setState] = useState<ConversationState>('idle');
  const { speak, stop: stopPlayback, isPlaying } = useAudioPlayer();

  const isActiveRef = useRef(false);
  const stateRef = useRef<ConversationState>('idle');

  // Keep refs in sync
  isActiveRef.current = isActive;
  stateRef.current = state;

  const submitMessageRef = useRef(submitMessage);
  submitMessageRef.current = submitMessage;
  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  const beginListening = useCallback(() => {
    if (!isActiveRef.current) return;
    setState('listening');
    startRecordingRef.current();
  }, []);

  const activate = useCallback(() => {
    setIsActive(true);
    isActiveRef.current = true;
    setState('listening');
    startRecordingRef.current();
  }, []);

  const deactivate = useCallback(() => {
    setIsActive(false);
    isActiveRef.current = false;
    setState('idle');
    stopRecordingRef.current();
    stopPlayback();
  }, [stopPlayback]);

  /**
   * Called by useAudioRecorder's onSilenceAutoSubmit when silence is detected
   * after speech in conversation mode. Receives the transcribed text.
   */
  const handleAutoSubmit = useCallback(
    (text: string) => {
      if (!isActiveRef.current) return;

      // Filter out non-speech artifacts (parenthetical noise descriptions)
      const filtered = text.replace(/\([^)]*\)/g, '').trim();
      if (!filtered) {
        // No real speech detected, go back to listening
        beginListening();
        return;
      }

      // Stop recording, submit the text
      stopRecordingRef.current();
      setState('submitting');
      submitMessageRef.current(filtered);
    },
    [beginListening]
  );

  /**
   * Called when the LLM stream finishes. If conversation mode is active,
   * auto-speak the response and then restart listening.
   */
  const handleStreamFinish = useCallback(
    (responseText: string) => {
      if (!isActiveRef.current) return;

      const cleaned = responseText.trim();
      if (!cleaned) {
        beginListening();
        return;
      }

      setState('speaking');
      speak(cleaned);
    },
    [speak, beginListening]
  );

  // Watch isPlaying transitions: when TTS finishes and we are in speaking state,
  // restart listening to continue the conversation loop.
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (wasPlayingRef.current && !isPlaying && isActive && state === 'speaking') {
      beginListening();
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, isActive, state, beginListening]);

  // User interruption: if user starts speaking during TTS playback,
  // stop TTS and switch to listening
  useEffect(() => {
    if (isActive && isRecording && isPlaying) {
      stopPlayback();
      setState('listening');
    }
  }, [isActive, isRecording, isPlaying, stopPlayback]);

  return {
    isActive,
    activate,
    deactivate,
    state,
    handleAutoSubmit,
    handleStreamFinish,
  };
}
