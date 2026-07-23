// UNTESTED: Windows (requires ffmpeg/ffplay installed via winget install Gyan.FFmpeg)
// UNTESTED: macOS (requires ffmpeg/ffplay installed via brew install ffmpeg)
// On Windows, microphone device name may need explicit configuration.
// On macOS, AVFoundation device index ":0" may differ per system.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AudioPlayer, AudioRecorder, RecordOpts } from './types.js';
import type { VadEngine } from '@aaif/voice-shared/voice/vadEngine.js';
import {
  SILERO_POSITIVE_THRESHOLD,
  SILERO_NEGATIVE_THRESHOLD,
  SILERO_REDEMPTION_FRAMES,
  SILERO_MIN_SPEECH_FRAMES,
  SILERO_FRAME_SIZE,
  MIN_SPEECH_MS,
  DEFAULT_SILENCE_MS,
  RMS_THRESHOLD,
} from '@aaif/voice-shared/voice/constants.js';
import { computeRms } from '@aaif/voice-shared/voice/vad.js';
import { SileroNodeEngine } from '../vadEngines/sileroNodeEngine.js';

function killProc(proc: ChildProcess): void {
  if (process.platform === 'win32') {
    if (proc.pid) spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
  } else {
    proc.kill('SIGTERM');
  }
}

function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bufferToFloat32(buf: Buffer): Float32Array {
  const sampleCount = Math.floor(buf.length / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buf.readInt16LE(i * 2) / 32768;
  }
  return out;
}

export class FfmpegAudioPlayer implements AudioPlayer {
  readonly backend = 'ffmpeg';
  readonly persistent = false;
  readonly supportedFormats = ['wav', 'mp3', 'opus', 'ogg', 'flac'] as const;

  private pending: ChildProcess[] = [];
  private pendingTmp = new Set<string>();
  private tmpDir: string | null = null;
  private exitHandlerRegistered = false;

  async connect(): Promise<void> {
    if (!this.exitHandlerRegistered) {
      this.exitHandlerRegistered = true;
      process.on('exit', () => {
        for (const tmp of this.pendingTmp) {
          try { unlinkSync(tmp); } catch { /* already deleted */ }
        }
        if (this.tmpDir) {
          try { rmSync(this.tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
        }
      });
    }
    if (!this.tmpDir) {
      this.tmpDir = mkdtempSync(join(tmpdir(), 'goose-tts-'));
    }
  }

  pushChunk(audio: Buffer, format: string): void {
    const ext = format === 'opus' ? 'opus' : format === 'mp3' ? 'mp3' : format === 'ogg' ? 'ogg' : format === 'flac' ? 'flac' : 'wav';
    const filename = `chunk-${randomBytes(6).toString('hex')}.${ext}`;
    const tmp = join(this.tmpDir!, filename);
    try {
      writeFileSync(tmp, audio);
    } catch (err) {
      console.error('[ffmpeg] failed to write temp file:', err);
      return;
    }

    const proc = spawn(
      'ffplay',
      ['-nodisp', '-autoexit', '-loglevel', 'quiet', tmp],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );

    this.pending.push(proc);
    this.pendingTmp.add(tmp);

    proc.on('exit', () => {
      this.pending = this.pending.filter(p => p !== proc);
      this.pendingTmp.delete(tmp);
      try { unlinkSync(tmp); } catch { /* file already deleted */ }
    });

    proc.on('error', (err) => {
      console.error('[ffplay] error:', err.message);
      this.pending = this.pending.filter(p => p !== proc);
      this.pendingTmp.delete(tmp);
      try { unlinkSync(tmp); } catch { /* file already deleted */ }
    });
  }

  setVolume(_level: number): void {
    console.warn('[ffmpeg] setVolume not supported — use system mixer');
  }

  stop(): void {
    for (const proc of this.pending) killProc(proc);
    this.pending = [];
    // Immediately unlink temp files — don't wait for proc.on('exit') or dispose()
    for (const tmp of this.pendingTmp) {
      try { unlinkSync(tmp); } catch { /* already deleted or process did it */ }
    }
    this.pendingTmp.clear();
  }

  async drain(): Promise<void> {
    await Promise.all(
      this.pending.map(proc => new Promise<void>(resolve => {
        proc.on('exit', () => resolve());
        proc.on('error', () => resolve());
      }))
    );
  }

  async dispose(): Promise<void> {
    this.stop();
    for (const tmp of this.pendingTmp) {
      try { unlinkSync(tmp); } catch { /* file already deleted */ }
    }
    this.pendingTmp.clear();
    if (this.tmpDir) {
      try { rmSync(this.tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
      this.tmpDir = null;
    }
  }
}

export class FfmpegAudioRecorder implements AudioRecorder {
  readonly backend = 'ffmpeg';

  private proc: ChildProcess | null = null;
  private vadEngine: VadEngine | null = null;
  private vadSpeaking = false;
  private vadRedemption = 0;
  private vadSpeechFrames = 0;
  private vadLeftover = new Float32Array(0);

  private silenceThresholdMs = DEFAULT_SILENCE_MS;
  private speaking = false;
  private silenceStart = 0;
  private speechStart = 0;

  private dataCb: ((pcm: Buffer) => void) | null = null;
  private speechCb: (() => void) | null = null;
  private silenceCb: (() => void) | null = null;

  async connect(opts: RecordOpts): Promise<void> {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      console.warn(`[ffmpeg] UNTESTED: voice recording on ${process.platform} — report issues at https://github.com/aaif-goose/goose`);
    }
    this.silenceThresholdMs = opts.silenceThresholdMs || DEFAULT_SILENCE_MS;
    this.speaking = false;
    this.silenceStart = 0;
    this.speechStart = 0;

    if (opts.vadEngine === 'silero-v6') {
      const engine = new SileroNodeEngine();
      const ok = await engine.init();
      if (ok) {
        this.vadEngine = engine;
      } else {
        console.warn('[vad] SileroNodeEngine init failed, falling back to rms-energy');
      }
    }

    const inputArgs: string[] =
      process.platform === 'win32'
        ? ['-f', 'dshow', '-i', 'audio=Microphone']
        : ['-f', 'avfoundation', '-i', ':0'];

    const args = [
      ...inputArgs,
      '-ar', String(opts.sampleRate),
      '-ac', String(opts.channels),
      '-f', 's16le',
      '-loglevel', 'quiet',
      '-',
    ];

    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    proc.on('error', (err) => {
      console.error('[ffmpeg record] error:', err.message);
      this.proc = null;
    });

    proc.on('exit', () => { this.proc = null; });

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.dataCb?.(chunk);
      if (this.vadEngine) {
        void this.processSileroVad(chunk);
      } else if (opts.vadEngine !== 'none') {
        this.processRmsVad(chunk);
      }
    });

    this.proc = proc;
  }

  private async processSileroVad(chunk: Buffer): Promise<void> {
    if (!this.vadEngine) return;
    const float32 = bufferToFloat32(chunk);
    const combined = this.vadLeftover.length > 0
      ? concatFloat32(this.vadLeftover, float32)
      : float32;
    let offset = 0;
    while (offset + SILERO_FRAME_SIZE <= combined.length) {
      const frame = combined.slice(offset, offset + SILERO_FRAME_SIZE);
      offset += SILERO_FRAME_SIZE;
      const prob = await this.vadEngine.processFrame(frame);
      if (prob >= SILERO_POSITIVE_THRESHOLD) {
        this.vadRedemption = SILERO_REDEMPTION_FRAMES;
        this.vadSpeechFrames++;
        if (!this.vadSpeaking && this.vadSpeechFrames >= SILERO_MIN_SPEECH_FRAMES) {
          this.vadSpeaking = true;
          this.speechCb?.();
        }
      } else if (this.vadSpeaking) {
        if (this.vadRedemption > 0) {
          this.vadRedemption--;
        } else if (prob < SILERO_NEGATIVE_THRESHOLD) {
          this.vadSpeaking = false;
          this.vadSpeechFrames = 0;
          this.silenceCb?.();
        }
      } else {
        this.vadSpeechFrames = 0;
      }
    }
    this.vadLeftover = offset < combined.length ? combined.slice(offset) : new Float32Array(0);
  }

  private processRmsVad(chunk: Buffer): void {
    const level = computeRms(bufferToFloat32(chunk));
    const now = Date.now();
    if (level > RMS_THRESHOLD) {
      if (!this.speaking) {
        this.speaking = true;
        this.speechStart = now;
        this.speechCb?.();
      }
      this.silenceStart = 0;
    } else if (this.speaking) {
      if (this.silenceStart === 0) {
        this.silenceStart = now;
      } else if (now - this.silenceStart > this.silenceThresholdMs) {
        if (now - this.speechStart > MIN_SPEECH_MS) {
          this.silenceCb?.();
        }
        this.speaking = false;
        this.silenceStart = 0;
      }
    }
  }

  onData(cb: (pcm: Buffer) => void): void { this.dataCb = cb; }
  onSpeech(cb: () => void): void { this.speechCb = cb; }
  onSilence(cb: () => void): void { this.silenceCb = cb; }

  stop(): void {
    if (this.proc) {
      killProc(this.proc);
      this.proc = null;
    }
    if (this.vadEngine) {
      void this.vadEngine.destroy();
      this.vadEngine = null;
      this.vadSpeaking = false;
      this.vadRedemption = 0;
      this.vadSpeechFrames = 0;
      this.vadLeftover = new Float32Array(0);
    }
    this.speaking = false;
    this.silenceStart = 0;
  }

  async dispose(): Promise<void> {
    this.stop();
  }
}
