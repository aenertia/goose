import { useState, useCallback, useRef } from 'react';
import { synthesizeTts } from '../acp/tts';
import { useConfig } from '../components/ConfigContext';

const CACHE_MAX = 50;

type SplitStrategy = 'none' | 'punctuation' | 'paragraph';

function splitText(text: string, strategy: SplitStrategy): string[] {
  if (strategy === 'none') return [text];
  if (strategy === 'paragraph') return text.split(/\n\n+/).filter((s) => s.trim());
  return text.split(/(?<=[.!?;])\s+/).filter((s) => s.trim());
}

let globalSource: AudioBufferSourceNode | null = null;
let globalStopped = false;

let globalSharedCtx: AudioContext | null = null;

function getSharedCtx(): AudioContext {
  if (!globalSharedCtx || globalSharedCtx.state === 'closed') {
    globalSharedCtx = new AudioContext();
  }
  return globalSharedCtx;
}

const globalCache = new Map<string, AudioBuffer>();
const globalCacheOrder: string[] = [];

let _selectedOutputDeviceId: string | null = null;

export function setAudioOutputDevice(deviceId: string | null) {
  _selectedOutputDeviceId = deviceId;
}

export function getAudioOutputDevice(): string | null {
  return _selectedOutputDeviceId;
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

interface UseAudioPlayerReturn {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  isPlaying: boolean;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(false);
  const { read } = useConfig();

  const stop = useCallback(() => {
    globalStopped = true;
    if (globalSource) {
      try {
        globalSource.stop();
      } catch {
        // already stopped
      }
      globalSource = null;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    playingRef.current = false;
    setIsPlaying(false);
  }, []);

  const synthesizeChunk = useCallback(
    async (
      chunkText: string,
      provider: string,
      voice: string,
      speed: number,
      profileId?: string
    ): Promise<AudioBuffer | null> => {
      const cacheKey = `${profileId || provider}:${voice}:${speed}:${chunkText}`;
      const cached = globalCache.get(cacheKey);
      if (cached) {
        const idx = globalCacheOrder.indexOf(cacheKey);
        if (idx !== -1) {
          globalCacheOrder.splice(idx, 1);
          globalCacheOrder.push(cacheKey);
        }
        return cached;
      }

      try {
        const { audio } = await synthesizeTts(chunkText, provider, voice, speed, profileId);
        const arrayBuf = b64ToArrayBuffer(audio);
        const ctx = getSharedCtx();
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);

        if (globalCacheOrder.length >= CACHE_MAX) {
          const oldest = globalCacheOrder.shift()!;
          globalCache.delete(oldest);
        }
        globalCache.set(cacheKey, audioBuffer);
        globalCacheOrder.push(cacheKey);
        return audioBuffer;
      } catch (err) {
        console.error('[TTS] synthesis failed:', err);
        return null;
      }
    },
    []
  );

  const playBuffer = useCallback((audioBuffer: AudioBuffer): Promise<void> => {
    return new Promise((resolve) => {
      const ctx = getSharedCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (globalStopped) {
        resolve();
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      globalSource = source;

      source.onended = () => {
        if (globalSource === source) globalSource = null;
        resolve();
      };

      source.start();
    });
  }, []);

  const speak = useCallback(
    async (text: string) => {
      stop();
      globalStopped = false;

      const provider = ((await read('voice_tts_provider', false)) as string) || '__disabled__';
      if (provider === '__disabled__') return;

      const voice = ((await read('voice_tts_voice', false)) as string) || '';
      const speedStr = ((await read('voice_tts_speed', false)) as string) || '1.00';
      const speed = parseFloat(speedStr) || 1.0;
      const strategy =
        ((await read('voice_tts_split_on', false)) as SplitStrategy) || 'punctuation';
      const profileId =
        ((await read('voice_tts_active_profile', false)) as string) || undefined;

      if (provider === 'browser') {
        if (!window.speechSynthesis) return;
        if (window.speechSynthesis.getVoices().length === 0) {
          console.warn('[TTS] Browser provider selected but no voices available (speech-dispatcher not installed?)');
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = speed;
        if (voice) {
          const voices = window.speechSynthesis.getVoices();
          const match = voices.find((v) => v.name === voice || v.voiceURI === voice);
          if (match) utterance.voice = match;
        }
        playingRef.current = true;
        setIsPlaying(true);
        utterance.onend = () => {
          playingRef.current = false;
          setIsPlaying(false);
        };
        utterance.onerror = () => {
          playingRef.current = false;
          setIsPlaying(false);
        };
        window.speechSynthesis.speak(utterance);
        return;
      }

      const chunks = splitText(text, strategy);
      if (chunks.length === 0) return;

      playingRef.current = true;
      setIsPlaying(true);

      let nextBufPromise: Promise<AudioBuffer | null> | null = null;

      for (let i = 0; i < chunks.length; i++) {
        if (globalStopped) break;

        const currentBuf =
          i === 0
            ? await synthesizeChunk(chunks[i], provider, voice, speed, profileId)
            : await (nextBufPromise ??
                synthesizeChunk(chunks[i], provider, voice, speed, profileId));

        if (globalStopped || !currentBuf) break;

        if (i + 1 < chunks.length) {
          nextBufPromise = synthesizeChunk(chunks[i + 1], provider, voice, speed, profileId);
        } else {
          nextBufPromise = null;
        }

        await playBuffer(currentBuf);
      }

      if (!globalStopped) {
        playingRef.current = false;
        setIsPlaying(false);
      }
    },
    [read, stop, synthesizeChunk, playBuffer]
  );

  return { speak, stop, isPlaying };
}
