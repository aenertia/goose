import { useRef, useCallback, useEffect } from 'react';
import type { VadEngine } from '@aaif/voice-shared/voice/vadEngine.js';
import {
  SILERO_POSITIVE_THRESHOLD,
  SILERO_NEGATIVE_THRESHOLD,
  SILERO_REDEMPTION_FRAMES,
  SILERO_MIN_SPEECH_FRAMES,
} from '@aaif/voice-shared/voice/constants.js';

function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

interface UseVadOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

export function useVad(engine: VadEngine, { onSpeechStart, onSpeechEnd }: UseVadOptions = {}) {
  const isReadyRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const redemptionRef = useRef(0);
  const speechFramesRef = useRef(0);
  const leftoverRef = useRef(new Float32Array(0));

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;
  const onSpeechEndRef = useRef(onSpeechEnd);
  onSpeechEndRef.current = onSpeechEnd;

  useEffect(() => {
    engine.init().then((ok: boolean) => { isReadyRef.current = ok; });
    return () => {
      isReadyRef.current = false;
      engine.destroy();
    };
  }, [engine]);

  const processSamples = useCallback(async (samples: Float32Array): Promise<boolean | null> => {
    if (!isReadyRef.current) return null;
    const combined = leftoverRef.current.length > 0
      ? concatFloat32(leftoverRef.current, samples)
      : samples;
    const FRAME = engine.frameSamples;
    let offset = 0;
    while (offset + FRAME <= combined.length) {
      const frame = combined.slice(offset, offset + FRAME);
      offset += FRAME;
      const prob = await engine.processFrame(frame);
      if (prob >= SILERO_POSITIVE_THRESHOLD) {
        redemptionRef.current = SILERO_REDEMPTION_FRAMES;
        speechFramesRef.current++;
        if (!isSpeakingRef.current && speechFramesRef.current >= SILERO_MIN_SPEECH_FRAMES) {
          isSpeakingRef.current = true;
          onSpeechStartRef.current?.();
        }
      } else if (isSpeakingRef.current) {
        if (redemptionRef.current > 0) {
          redemptionRef.current--;
        } else if (prob < SILERO_NEGATIVE_THRESHOLD) {
          isSpeakingRef.current = false;
          speechFramesRef.current = 0;
          onSpeechEndRef.current?.();
        }
      } else {
        speechFramesRef.current = 0;
      }
    }
    leftoverRef.current = offset < combined.length
      ? combined.slice(offset)
      : new Float32Array(0);
    return isSpeakingRef.current;
  }, [engine]);

  const reset = useCallback(() => {
    isSpeakingRef.current = false;
    redemptionRef.current = 0;
    speechFramesRef.current = 0;
    leftoverRef.current = new Float32Array(0);
    engine.reset();
  }, [engine]);

  return { processSamples, reset, isReadyRef };
}
