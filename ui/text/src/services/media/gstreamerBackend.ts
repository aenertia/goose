import { spawn, type ChildProcess } from "node:child_process";
import type { AudioPlayer } from "./types.js";

const PW_PROPS = JSON.stringify({
  "media.name": "Goose TTS",
  "application.name": "Goose",
});

function parseWavHeader(buf: Buffer): { sampleRate: number; channels: number; dataOffset: number } | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  // Find 'data' chunk — usually at offset 36 but can vary
  let offset = 12;
  while (offset + 8 < buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') return { sampleRate, channels, dataOffset: offset + 8 };
    offset += 8 + size;
  }
  return { sampleRate, channels, dataOffset: 44 };
}

export class GStreamerAudioPlayer implements AudioPlayer {
  readonly backend = "gstreamer" as const;
  readonly persistent = true as const;
  readonly supportedFormats: readonly string[];

  private proc: ChildProcess | null = null;
  private queue: Buffer[] = [];
  private draining = false;
  private stopped = false;
  private sampleRate = 0;

  constructor(formats: readonly string[]) {
    this.supportedFormats = formats;
  }

  async connect(): Promise<void> {
    this.stopped = false;
  }

  pushChunk(audio: Buffer, format: string): void {
    if (this.stopped) return;
    this.queue.push(audio);
    if (!this.draining) {
      void this.drainQueue(format);
    }
  }

  private async drainQueue(format: string): Promise<void> {
    this.draining = true;
    while (this.queue.length > 0 && !this.stopped) {
      const chunk = this.queue.shift()!;

      if (format === 'wav' || format === 'pcm') {
        this.feedPcm(chunk);
      } else {
        await this.playEncoded(chunk);
      }
    }
    this.draining = false;
  }

  private feedPcm(wav: Buffer): void {
    const header = parseWavHeader(wav);
    if (!header) {
      console.error('[pw-cat] invalid WAV header');
      return;
    }

    if (!this.proc || this.sampleRate !== header.sampleRate) {
      this.killProc();
      this.sampleRate = header.sampleRate;

      const child = spawn('pw-cat', [
        '--playback', '--raw',
        `--rate=${header.sampleRate}`,
        `--channels=${header.channels}`,
        '--format=s16',
        '--media-role=Communication',
        '-P', PW_PROPS,
        '-',
      ], { stdio: ['pipe', 'ignore', 'ignore'] });

      child.on('exit', () => { this.proc = null; });
      child.on('error', (err) => {
        console.error('[pw-cat] error:', err.message);
        this.proc = null;
      });

      this.proc = child;
    }

    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(wav.subarray(header.dataOffset));
    }
  }

  private playEncoded(audio: Buffer): Promise<void> {
    return new Promise<void>((resolve) => {
      const child = spawn('pw-play', [
        '--media-role=Communication',
        '-P', PW_PROPS,
        '-',
      ], { stdio: ['pipe', 'ignore', 'ignore'] });

      child.on('exit', () => resolve());
      child.on('error', () => resolve());
      child.stdin!.write(audio);
      child.stdin!.end();
    });
  }

  private killProc(): void {
    if (this.proc) {
      this.proc.stdin?.end();
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  setVolume(_level: number): void {}

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  async drain(): Promise<void> {
    while (this.draining) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async dispose(): Promise<void> {
    this.stop();
    this.killProc();
  }
}
