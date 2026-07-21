import { useState, useCallback, useRef } from 'react';
import { synthesizeTts } from '../acp/tts';
import { useConfig } from '../components/ConfigContext';

const CACHE_MAX = 50;

type SplitStrategy = 'none' | 'punctuation' | 'paragraph';

function splitText(text: string, strategy: SplitStrategy): string[] {
  if (strategy === 'none') return [text];
  if (strategy === 'paragraph') return text.split(/\n\n+/).filter((s) => s.trim());
  // punctuation: split after sentence-ending punctuation followed by whitespace
  return text.split(/(?<=[.!?;])\s+/).filter((s) => s.trim());
}

// Module-level state so any hook instance can stop playback started by another
let globalAudio: HTMLAudioElement | null = null;
let globalStopped = false;

// Shared LRU cache across all instances
const globalCache = new Map<string, Blob>();
const globalCacheOrder: string[] = [];

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
    if (globalAudio) {
      globalAudio.pause();
      globalAudio.currentTime = 0;
      const src = globalAudio.src;
      if (src.startsWith('blob:')) {
        URL.revokeObjectURL(src);
      }
      globalAudio = null;
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
      speed: number
    ): Promise<Blob | null> => {
      const cacheKey = `${provider}:${voice}:${speed}:${chunkText}`;
      const cached = globalCache.get(cacheKey);
      if (cached) {
        // Move to end of LRU order
        const idx = globalCacheOrder.indexOf(cacheKey);
        if (idx !== -1) {
          globalCacheOrder.splice(idx, 1);
          globalCacheOrder.push(cacheKey);
        }
        return cached;
      }

      try {
        const { audio, mimeType } = await synthesizeTts(chunkText, provider, voice, speed);
        const raw = atob(audio);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const blob = new Blob([bytes], { type: mimeType });

        // LRU eviction
        if (globalCacheOrder.length >= CACHE_MAX) {
          const oldest = globalCacheOrder.shift()!;
          globalCache.delete(oldest);
        }
        globalCache.set(cacheKey, blob);
        globalCacheOrder.push(cacheKey);
        return blob;
      } catch (err) {
        console.error('TTS synthesis failed:', err);
        return null;
      }
    },
    []
  );

  const playBlob = useCallback((blob: Blob): Promise<void> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      globalAudio = audio;

      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (globalAudio === audio) {
          globalAudio = null;
        }
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        resolve();
      };

      audio.play().catch(() => {
        cleanup();
        resolve();
      });
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

      if (provider === 'browser') {
        if (!window.speechSynthesis) return;
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

      // Sequential playback with prefetch: synthesize chunk N+1 while playing chunk N
      let nextBlobPromise: Promise<Blob | null> | null = null;

      for (let i = 0; i < chunks.length; i++) {
        if (globalStopped) break;

        // Get current chunk blob (either from prefetch or synthesize now)
        const currentBlob =
          i === 0
            ? await synthesizeChunk(chunks[i], provider, voice, speed)
            : await (nextBlobPromise ?? synthesizeChunk(chunks[i], provider, voice, speed));

        if (globalStopped || !currentBlob) break;

        // Start prefetching next chunk
        if (i + 1 < chunks.length) {
          nextBlobPromise = synthesizeChunk(chunks[i + 1], provider, voice, speed);
        } else {
          nextBlobPromise = null;
        }

        // Play current chunk and wait for it to finish
        await playBlob(currentBlob);
      }

      if (!globalStopped) {
        playingRef.current = false;
        setIsPlaying(false);
      }
    },
    [read, stop, synthesizeChunk, playBlob]
  );

  return { speak, stop, isPlaying };
}
