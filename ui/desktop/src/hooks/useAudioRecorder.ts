import { useState, useRef, useCallback, useEffect } from "react";
import { getDictationConfig, transcribeDictation } from "../acp/dictation";
import { useConfig } from "../components/ConfigContext";
import type { DictationProvider } from "../types/dictation";
import { errorMessage } from "../utils/conversionUtils";
import { getTtsReferenceStream } from "./useAudioPlayer";
import { useSileroVad } from "./useSileroVad";
import { SAMPLE_RATE, DEFAULT_SILENCE_MS, MIN_SPEECH_MS, RMS_THRESHOLD } from '@aaif/voice-shared/voice/constants.js';
import { encodeWav } from '@aaif/voice-shared/voice/encoding.js';
import { computeRms } from '@aaif/voice-shared/voice/vad.js';

interface UseAudioRecorderOptions {
  onTranscription: (text: string) => void;
  onError: (message: string) => void;
  /** Called in conversation mode when silence is detected after speech.
   *  Receives the transcribed text. The hook stops recording before calling. */
  onSilenceAutoSubmit?: (text: string) => void;
  /** Called when VAD detects speech onset (transition from silence to speech).
   *  Use for barge-in: stop TTS playback when the user starts speaking. */
  onSpeechStart?: () => void;
}



// Resolve worklet URL at runtime from window.location so it works under both
// the dev server (http://localhost) and packaged builds (file://).
const WORKLET_URL = new URL(
  "audio-capture-worklet.js",
  window.location.href.split("#")[0]
).href;

const AEC_WORKLET_URL = new URL(
  "aec-worklet.js",
  window.location.href.split("#")[0]
).href;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export const useAudioRecorder = ({
  onTranscription,
  onError,
  onSilenceAutoSubmit,
  onSpeechStart,
}: UseAudioRecorderOptions) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [provider, setProvider] = useState<DictationProvider | null>(null);

  const { read, config } = useConfig();

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aecNodeRef = useRef<AudioWorkletNode | null>(null);
  const refSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Configurable silence threshold (read from config, default 800ms)
  const silenceMsRef = useRef(DEFAULT_SILENCE_MS);

  // VAD state (all refs to avoid re-render/stale closure issues)
  const samplesRef = useRef<Float32Array[]>([]);
  const isSpeakingRef = useRef(false);
  const silenceStartRef = useRef(0);
  const speechStartRef = useRef(0);
  const pendingTranscriptions = useRef(0);
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // Keep callback refs fresh
  const onTranscriptionRef = useRef(onTranscription);
  onTranscriptionRef.current = onTranscription;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSilenceAutoSubmitRef = useRef(onSilenceAutoSubmit);
  onSilenceAutoSubmitRef.current = onSilenceAutoSubmit;
  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  // Silero VAD (primary, falls back to RMS when not ready)
  const preSpeechBufferRef = useRef<Float32Array[]>([]);
  const MAX_PRE_SPEECH_FRAMES = 9; // match MIN_SPEECH_FRAMES in useSileroVad

  const { processSamples: sileroProcess, isReadyRef: sileroReadyRef, reset: sileroReset } = useSileroVad({
    onSpeechStart: () => {
      isSpeakingRef.current = true;
      speechStartRef.current = Date.now();
      samplesRef.current = [...preSpeechBufferRef.current];
      preSpeechBufferRef.current = [];
      onSpeechStartRef.current?.();
    },
    onSpeechEnd: () => {
      if (isSpeakingRef.current && samplesRef.current.length > 0) {
        if (Date.now() - speechStartRef.current > MIN_SPEECH_MS) {
          if (onSilenceAutoSubmitRef.current) {
            flushAutoSubmitRef.current();
          } else {
            flushRef.current();
          }
        } else {
          samplesRef.current = [];
        }
      }
      isSpeakingRef.current = false;
      silenceStartRef.current = 0;
    },
  });

  useEffect(() => {
    const check = async () => {
      try {
        const val = await read("voice_dictation_provider", false);
        const pref = (val as DictationProvider) || null;
        if (!pref) {
          setIsEnabled(false);
          setProvider(null);
          return;
        }
        const providers = await getDictationConfig();
        setIsEnabled(!!providers[pref]?.configured);
        setProvider(pref);
      } catch (error) {
        console.error("Failed to check dictation config:", error);
        setIsEnabled(false);
        setProvider(null);
      }
    };
    check();
  }, [read, config]);

  // Load configurable silence threshold from preferences
  useEffect(() => {
    const loadThreshold = async () => {
      try {
        const val = await read("voice_silence_threshold", false);
        if (val && typeof val === "string") {
          const ms = parseInt(val, 10);
          if (!isNaN(ms) && ms >= 500 && ms <= 3000) {
            silenceMsRef.current = ms;
          }
        }
      } catch {
        // Keep default on error
      }
    };
    loadThreshold();
  }, [read, config]);

  const transcribeChunk = useCallback(async (samples: Float32Array) => {
    const prov = providerRef.current;
    if (!prov) return;

    pendingTranscriptions.current++;
    setIsTranscribing(true);

    try {
      const wav = new Blob([encodeWav(samples, SAMPLE_RATE)], {
        type: "audio/wav",
      });
      const base64 = await blobToBase64(wav);
      const text = await transcribeDictation(base64, "audio/wav", prov);
      if (text) {
        onTranscriptionRef.current(text);
      }
    } catch (error) {
      onErrorRef.current(errorMessage(error));
    } finally {
      pendingTranscriptions.current--;
      if (pendingTranscriptions.current === 0) setIsTranscribing(false);
    }
  }, []);

  /** Transcribe collected samples and invoke the auto-submit callback if set. */
  const transcribeAndAutoSubmit = useCallback(
    async (samples: Float32Array) => {
      const prov = providerRef.current;
      if (!prov) return;

      pendingTranscriptions.current++;
      setIsTranscribing(true);

      try {
        const wav = new Blob([encodeWav(samples, SAMPLE_RATE)], {
          type: "audio/wav",
        });
        const base64 = await blobToBase64(wav);
        const text = await transcribeDictation(base64, "audio/wav", prov);
        if (text) {
          onSilenceAutoSubmitRef.current?.(text);
        }
      } catch (error) {
        onErrorRef.current(errorMessage(error));
      } finally {
        pendingTranscriptions.current--;
        if (pendingTranscriptions.current === 0) setIsTranscribing(false);
      }
    },
    []
  );

  const flush = useCallback(() => {
    const chunks = samplesRef.current;
    if (chunks.length === 0) return;

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    samplesRef.current = [];
    transcribeChunk(merged);
  }, [transcribeChunk]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  /** Flush and route to auto-submit path (conversation mode). */
  const flushAutoSubmit = useCallback(() => {
    const chunks = samplesRef.current;
    if (chunks.length === 0) return;

    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    samplesRef.current = [];
    transcribeAndAutoSubmit(merged);
  }, [transcribeAndAutoSubmit]);

  const flushAutoSubmitRef = useRef(flushAutoSubmit);
  flushAutoSubmitRef.current = flushAutoSubmit;

  const handleSamples = useCallback((samples: Float32Array) => {
    const now = Date.now();

    if (computeRms(samples) > RMS_THRESHOLD) {
      if (!isSpeakingRef.current) {
        isSpeakingRef.current = true;
        speechStartRef.current = now;
        onSpeechStartRef.current?.();
      }
      silenceStartRef.current = 0;
      samplesRef.current.push(new Float32Array(samples));
    } else if (isSpeakingRef.current) {
      samplesRef.current.push(new Float32Array(samples));

      if (silenceStartRef.current === 0) {
        silenceStartRef.current = now;
      } else if (now - silenceStartRef.current > silenceMsRef.current) {
        if (now - speechStartRef.current > MIN_SPEECH_MS) {
          if (onSilenceAutoSubmitRef.current) {
            flushAutoSubmitRef.current();
          } else {
            flushRef.current();
          }
        } else {
          samplesRef.current = [];
        }
        isSpeakingRef.current = false;
        silenceStartRef.current = 0;
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    sileroReset();
    preSpeechBufferRef.current = [];
    if (isSpeakingRef.current && samplesRef.current.length > 0) {
      flushRef.current();
    }
    isSpeakingRef.current = false;
    silenceStartRef.current = 0;

    aecNodeRef.current?.port.postMessage({ type: "setEnabled", enabled: false });
    aecNodeRef.current?.disconnect();
    aecNodeRef.current?.port.close();
    aecNodeRef.current = null;
    refSourceRef.current?.disconnect();
    refSourceRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsRecording(false);
  }, [sileroReset]);

  const startRecording = useCallback(
    async () => {
      if (!isEnabled) {
        onError("Voice dictation is not enabled");
        return;
      }

      try {
        const preferredMic = await read("voice_dictation_preferred_mic", false);

        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (preferredMic && typeof preferredMic === "string") {
          audioConstraints.deviceId = { exact: preferredMic };
        }

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
          });
        } catch (e) {
          if (
            preferredMic &&
            e instanceof DOMException &&
            (e.name === "NotFoundError" || e.name === "OverconstrainedError")
          ) {
            delete audioConstraints.deviceId;
            stream = await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints,
            });
          } else {
            throw e;
          }
        }
        streamRef.current = stream;

        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        audioContextRef.current = ctx;

        await ctx.audioWorklet.addModule(WORKLET_URL);
        await ctx.audioWorklet.addModule(AEC_WORKLET_URL);

        const source = ctx.createMediaStreamSource(stream);

        // AEC worklet: 2 inputs (mic near-end + TTS far-end reference), no audio output
        const aecNode = new AudioWorkletNode(ctx, "aec-processor", {
          numberOfInputs: 2,
          numberOfOutputs: 0,
        });
        aecNodeRef.current = aecNode;

        // Connect TTS reference stream to AEC input[1] if available
        const ttsRef = getTtsReferenceStream();
        if (ttsRef) {
          const refSrc = ctx.createMediaStreamSource(ttsRef);
          refSrc.connect(aecNode, 0, 1);
          refSourceRef.current = refSrc;
          aecNode.port.postMessage({ type: "setEnabled", enabled: true });
        }

        // Connect mic to AEC input[0]
        source.connect(aecNode);

        // AEC posts cleaned samples via port — route through Silero or RMS fallback
        aecNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
          const samples = e.data;
          if (sileroReadyRef.current) {
            if (isSpeakingRef.current) {
              samplesRef.current.push(new Float32Array(samples));
            } else {
              preSpeechBufferRef.current.push(new Float32Array(samples));
              if (preSpeechBufferRef.current.length > MAX_PRE_SPEECH_FRAMES) {
                preSpeechBufferRef.current.shift();
              }
            }
            void sileroProcess(samples);
          } else {
            handleSamples(samples);
          }
        };

        // Keep capture worklet connected through silent gain for fallback
        const worklet = new AudioWorkletNode(ctx, "audio-capture");
        const silence = ctx.createGain();
        silence.gain.value = 0;
        source.connect(worklet);
        worklet.connect(silence);
        silence.connect(ctx.destination);

        setIsRecording(true);
      } catch (error) {
        stopRecording();
        onError(errorMessage(error));
      }
    },
    [isEnabled, onError, handleSamples, stopRecording, read, sileroProcess, sileroReadyRef]
  );

  useEffect(() => {
    return () => {
      audioContextRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    isEnabled,
    dictationProvider: provider,
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
  };
};
