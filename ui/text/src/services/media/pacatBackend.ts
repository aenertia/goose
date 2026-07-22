import { spawn, type ChildProcess } from 'node:child_process';
import type { AudioPlayer } from './types.js';

function stripWavHeader(wav: Buffer): Buffer {
  // RIFF header is 44 bytes: 'RIFF' + size + 'WAVE' + 'fmt ' chunk + 'data' chunk header
  // Check for 'RIFF' magic at offset 0
  if (wav.length > 44 && wav.slice(0, 4).toString('ascii') === 'RIFF') {
    return wav.slice(44);
  }
  // Not a WAV header or already PCM — return as-is
  return wav;
}

export class PacatAudioPlayer implements AudioPlayer {
  readonly backend = 'pacat';
  readonly persistent = true;
  readonly supportedFormats = ['wav'] as const;

  private proc: ChildProcess | null = null;

  async connect(): Promise<void> {
    if (this.proc) return;

    this.proc = spawn('pacat', [
      '--playback',
      '--rate=24000',
      '--channels=1',
      '--format=s16le',
      '--client-name=Goose',
      '--stream-name=Goose TTS',
    ], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });

    this.proc.on('error', (err) => {
      console.error('[pacat] process error:', err.message);
      this.proc = null;
    });

    this.proc.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`[pacat] exited with code ${code}`);
      } else if (signal) {
        console.error(`[pacat] killed by signal ${signal}`);
      }
      this.proc = null;
    });
  }

  pushChunk(audio: Buffer, format: string): void {
    if (!this.proc?.stdin?.writable) {
      console.warn('[pacat] stdin not writable, dropping chunk');
      return;
    }
    if (format === 'wav') {
      this.proc.stdin.write(stripWavHeader(audio));
    } else {
      // pacat only supports PCM — warn and skip non-wav formats
      console.warn(`[pacat] unsupported format: ${format}, skipping chunk`);
    }
  }

  setVolume(_level: number): void {
    console.warn('[pacat] setVolume not supported — adjust via DE mixer');
  }

  stop(): void {
    // no-op: keep process alive between chunks
  }

  async drain(): Promise<void> {
    // Audio is buffered in pacat/PulseAudio, not Node.js — resolve immediately
  }

  async dispose(): Promise<void> {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null;
    p.stdin?.end();
    p.kill();
  }
}
