import { useState, useCallback, useRef } from 'react';
import { synthesizeTts } from '../acp/tts';
import { useConfig } from '../components/ConfigContext';

const CACHE_MAX = 50;

interface UseAudioPlayerReturn {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  isPlaying: boolean;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, Blob>>(new Map());
  const cacheOrderRef = useRef<string[]>([]);
  const { read } = useConfig();

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      const src = audioRef.current.src;
      audioRef.current = null;
      if (src.startsWith('blob:')) {
        URL.revokeObjectURL(src);
      }
    }
    setIsPlaying(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      stop();

      const provider = ((await read('voice_tts_provider', false)) as string) || '__disabled__';
      if (provider === '__disabled__') return;

      const voice = ((await read('voice_tts_voice', false)) as string) || '';
      const speedStr = ((await read('voice_tts_speed', false)) as string) || '1.00';
      const speed = parseFloat(speedStr) || 1.0;

      if (provider === 'browser') {
        if (!window.speechSynthesis) return;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = speed;
        if (voice) {
          const voices = window.speechSynthesis.getVoices();
          const match = voices.find((v) => v.name === voice || v.voiceURI === voice);
          if (match) utterance.voice = match;
        }
        setIsPlaying(true);
        utterance.onend = () => setIsPlaying(false);
        utterance.onerror = () => setIsPlaying(false);
        window.speechSynthesis.speak(utterance);
        return;
      }

      const cacheKey = `${provider}:${voice}:${speed}:${text}`;
      let blob = cacheRef.current.get(cacheKey);

      if (!blob) {
        try {
          const { audio, mimeType } = await synthesizeTts(text, provider, voice, speed);
          const raw = atob(audio);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          blob = new Blob([bytes], { type: mimeType });

          // LRU eviction
          if (cacheOrderRef.current.length >= CACHE_MAX) {
            const oldest = cacheOrderRef.current.shift()!;
            cacheRef.current.delete(oldest);
          }
          cacheRef.current.set(cacheKey, blob);
          cacheOrderRef.current.push(cacheKey);
        } catch (err) {
          console.error('TTS synthesis failed:', err);
          return;
        }
      } else {
        // Move to end of LRU order
        const idx = cacheOrderRef.current.indexOf(cacheKey);
        if (idx !== -1) {
          cacheOrderRef.current.splice(idx, 1);
          cacheOrderRef.current.push(cacheKey);
        }
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setIsPlaying(true);

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };

      await audio.play().catch(() => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      });
    },
    [read, stop]
  );

  return { speak, stop, isPlaying };
}
