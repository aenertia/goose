import { useState, useCallback, useRef } from 'react';
import { synthesizeTts } from '../acp/tts';
import { useConfig } from '../components/ConfigContext';
import { createAudioDeviceResolver, type StoredDevice } from '../services/audioDevices';

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

const resolver = createAudioDeviceResolver();
let audioOutputDevice: StoredDevice | null = null;

export async function setAudioOutputDevice(deviceId: string | null): Promise<void> {
  if (!deviceId) {
    audioOutputDevice = null;
    return;
  }
  audioOutputDevice = await resolver.storeOutputDevice(deviceId);
}

export function getAudioOutputDevice(): string | null {
  return audioOutputDevice?.deviceId ?? null;
}

export function getStoredAudioOutputDevice(): StoredDevice | null {
  return audioOutputDevice;
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
  startStreamingSpeak: () => Promise<void>;
  enqueueStreamChunk: (text: string) => Promise<void>;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const playingRef = useRef(false);
  const { read } = useConfig();

  // Streaming TTS refs — declared before stop() so it can close over them
  const streamProviderRef = useRef('');
  const streamVoiceRef = useRef('');
  const streamSpeedRef = useRef(1.0);
  const streamProfileRef = useRef<string | undefined>(undefined);
  const streamQueueRef = useRef<Promise<AudioBuffer | null>[]>([]);
  const drainingRef = useRef(false);
  const streamInitPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const streamEpochRef = useRef(0);

  const stop = useCallback(() => {
    streamEpochRef.current += 1;
    streamQueueRef.current = [];
    drainingRef.current = false;
    globalStopped = true;
    if (globalSource) {
      try {
        globalSource.stop();
      } catch {
        /* already stopped */
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

  const startStreamingSpeak = useCallback(async () => {
    streamEpochRef.current += 1;
    stop();
    globalStopped = false;
    streamQueueRef.current = [];
    drainingRef.current = false;

    const initPromise = (async () => {
      streamProviderRef.current = ((await read('voice_tts_provider', false)) as string) || '__disabled__';
      streamVoiceRef.current = ((await read('voice_tts_voice', false)) as string) || '';
      const speedStr = ((await read('voice_tts_speed', false)) as string) || '1.00';
      streamSpeedRef.current = parseFloat(speedStr) || 1.0;
      streamProfileRef.current = ((await read('voice_tts_active_profile', false)) as string) || undefined;
    })();
    streamInitPromiseRef.current = initPromise;
    await initPromise;
  }, [read, stop]);

  const drainStreamingQueue = useCallback(async () => {
    const myEpoch = streamEpochRef.current;
    while (streamQueueRef.current.length > 0) {
      if (globalStopped || streamEpochRef.current !== myEpoch) break;
      const bufPromise = streamQueueRef.current.shift()!;
      const buf = await bufPromise;
      if (!buf || globalStopped || streamEpochRef.current !== myEpoch) continue;
      await playBuffer(buf);
    }
    if (streamEpochRef.current === myEpoch) {
      drainingRef.current = false;
      if (!globalStopped) {
        playingRef.current = false;
        setIsPlaying(false);
      }
    }
  }, [playBuffer]);

  const enqueueStreamChunk = useCallback(
    async (text: string) => {
      await streamInitPromiseRef.current;
      const provider = streamProviderRef.current;
      if (!provider || provider === '__disabled__' || globalStopped) return;

      const bufPromise = synthesizeChunk(
        text, provider, streamVoiceRef.current, streamSpeedRef.current, streamProfileRef.current
      );
      streamQueueRef.current.push(bufPromise);

      if (!drainingRef.current) {
        drainingRef.current = true;
        playingRef.current = true;
        setIsPlaying(true);
        void drainStreamingQueue();
      }
    },
    [synthesizeChunk, drainStreamingQueue]
  );

  return { speak, stop, isPlaying, startStreamingSpeak, enqueueStreamChunk };
}
