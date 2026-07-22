import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { AudioPlayer, AudioRecorder, RecordOpts } from "./types.js";
import type { RealTimeVAD as RealTimeVADType } from 'avr-vad';
import { RMS_THRESHOLD, MIN_SPEECH_MS, DEFAULT_SILENCE_MS } from '@aaif/voice-shared/voice/constants.js';
import { computeRms } from '@aaif/voice-shared/voice/vad.js';

let _avr_vad_module: typeof import('avr-vad') | null = null;
async function getAvrVad(): Promise<typeof import('avr-vad') | null> {
  if (_avr_vad_module) return _avr_vad_module;
  try {
    _avr_vad_module = await import('avr-vad');
    return _avr_vad_module;
  } catch {
    return null;
  }
}

const TTS_SINK_NODE = 'goose-tts-sink';
const MIC_SOURCE_NODE = 'goose-mic-src';
const EC_SOURCE_NODE = 'honk-ec-source';
let ecModuleId: number | null = null;

let ttsLoopback: ChildProcess | null = null;
let micLoopback: ChildProcess | null = null;
const loopbackAvailable = spawnSync('pw-loopback', ['--help'], {
  stdio: ['ignore', 'ignore', 'ignore'],
}).status !== null;

function ensureTtsLoopback(): boolean {
  if (!loopbackAvailable) return false;
  if (ttsLoopback) return true;
  ttsLoopback = spawn('pw-loopback', [
    '--name=goose-tts', '--channels=1',
    '-i', `media.class=Audio/Sink node.name=${TTS_SINK_NODE} node.description=Goose\\ TTS node.virtual=true audio.position=[ MONO ] application.name=Goose`,
    '-o', 'node.name=goose-tts-out node.passive=true stream.dont-remix=true audio.position=[ MONO ]',
  ], { stdio: 'ignore' });
  ttsLoopback.on('exit', () => { ttsLoopback = null; });
  ttsLoopback.on('error', () => { ttsLoopback = null; });
  return true;
}

function ensureMicLoopback(): boolean {
  if (!loopbackAvailable) return false;
  if (micLoopback) return true;
  micLoopback = spawn('pw-loopback', [
    '--name=goose-mic', '--channels=1',
    '-i', 'node.name=goose-mic-in node.passive=true stream.dont-remix=true audio.position=[ MONO ]',
    '-o', `media.class=Audio/Source node.name=${MIC_SOURCE_NODE} node.description=Goose\\ Mic node.virtual=true audio.position=[ MONO ] application.name=Goose`,
  ], { stdio: 'ignore' });
  micLoopback.on('exit', () => { micLoopback = null; });
  micLoopback.on('error', () => { micLoopback = null; });
  return true;
}

export function loadEchoCancel(): boolean {
  if (ecModuleId !== null) return true;
  const args = [
    'load-module', 'module-echo-cancel',
    'source_name=honk-ec-source',
    'sink_master=goose-tts-sink',
    'rate=48000',
    'channels=1',
    'aec_method=webrtc',
    'aec_args=webrtc.noise_suppression=true webrtc.gain_control=false',
  ];
  if (process.env.GOOSE_AEC_DEBUG === '1') {
    args.push('debug.aec.wav-path=/tmp/goose-aec-debug');
  }
  const result = spawnSync('pactl', args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' });

  if (result.status !== 0) {
    console.warn('[aec] failed to load module-echo-cancel:', result.stderr ?? '');
    return false;
  }
  const id = parseInt((result.stdout ?? '').trim(), 10);
  if (isNaN(id)) {
    console.warn('[aec] module-echo-cancel loaded but could not parse module id');
    return false;
  }
  ecModuleId = id;
  return true;
}

export function unloadEchoCancel(): void {
  if (ecModuleId === null) return;
  spawnSync('pactl', ['unload-module', String(ecModuleId)], {
    stdio: 'ignore',
  });
  ecModuleId = null;
}

export function isEchoCancelLoaded(): boolean {
  return ecModuleId !== null;
}

export function disposeLoopbacks(): void {
  if (ttsLoopback) { ttsLoopback.kill('SIGTERM'); ttsLoopback = null; }
  if (micLoopback) { micLoopback.kill('SIGTERM'); micLoopback = null; }
  unloadEchoCancel();
}

// Best-effort orphan prevention: kill loopback children on process exit.
// Covers normal exit and signal-induced exit (SIGTERM/SIGINT) but not SIGKILL;
// stale SIGKILL orphans are cleaned up on next startup in tui.tsx.
process.on('exit', () => {
  if (ttsLoopback?.pid) { try { process.kill(ttsLoopback.pid, 'SIGTERM'); } catch {} }
  if (micLoopback?.pid) { try { process.kill(micLoopback.pid, 'SIGTERM'); } catch {} }
});

const PW_PROPS = JSON.stringify({
  "media.name": "Goose TTS",
  "application.name": "Goose",
  "node.dont-fallback": "true",
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
  private encodedProcs: ChildProcess[] = [];

  constructor(formats: readonly string[]) {
    this.supportedFormats = formats;
  }

  private useLoopback = false;

  async connect(): Promise<void> {
    this.stopped = false;
    this.useLoopback = ensureTtsLoopback();
    if (this.useLoopback) {
      await new Promise(r => setTimeout(r, 250));
    }
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

      const args = [
        '--playback', '--raw',
        `--rate=${header.sampleRate}`,
        `--channels=${header.channels}`,
        '--format=s16',
        '-P', PW_PROPS,
        '-',
      ];
      if (ttsLoopback !== null) args.splice(1, 0, `--target=${TTS_SINK_NODE}`);
      const child = spawn('pw-cat', args, { stdio: ['pipe', 'ignore', 'ignore'] });

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
      const args = ['-P', PW_PROPS, '-'];
      if (ttsLoopback !== null) args.unshift(`--target=${TTS_SINK_NODE}`);
      const child = spawn('pw-play', args, { stdio: ['pipe', 'ignore', 'ignore'] });
      this.encodedProcs.push(child);

      const cleanup = () => {
        this.encodedProcs = this.encodedProcs.filter(p => p !== child);
        resolve();
      };
      child.on('exit', cleanup);
      child.on('error', cleanup);
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
    this.killProc();
    for (const p of this.encodedProcs) {
      p.stdin?.destroy();
      p.kill('SIGTERM');
    }
    this.encodedProcs = [];
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

// --- Audio Recorder (symmetric pw-cat --record) ---

const PW_MIC_PROPS = JSON.stringify({
  "media.name": "Goose Mic",
  "application.name": "Goose",
  "node.dont-fallback": "true",
});

function bufferToFloat32(buf: Buffer): Float32Array {
  const sampleCount = Math.floor(buf.length / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buf.readInt16LE(i * 2) / 32768;
  }
  return out;
}

export class GStreamerAudioRecorder implements AudioRecorder {
  readonly backend = "gstreamer" as const;

  private proc: ChildProcess | null = null;
  private dataCb: ((pcm: Buffer) => void) | null = null;
  private speechCb: (() => void) | null = null;
  private silenceCb: (() => void) | null = null;

  private speaking = false;
  private silenceStart = 0;
  private speechStart = 0;
  private silenceThresholdMs = DEFAULT_SILENCE_MS;

  private useLoopback = false;
  private sileroVad: RealTimeVADType | null = null;

  async connect(opts: RecordOpts): Promise<void> {
    this.silenceThresholdMs = opts.silenceThresholdMs || DEFAULT_SILENCE_MS;
    this.speaking = false;
    this.silenceStart = 0;
    this.speechStart = 0;

    this.useLoopback = ensureMicLoopback();
    if (this.useLoopback) {
      await new Promise(r => setTimeout(r, 250));
    }

    if (opts.vadMethod === 'silero') {
      const avrVad = await getAvrVad();
      if (avrVad) {
        this.sileroVad = await avrVad.RealTimeVAD.new({
          model: 'v5',
          frameSamples: 512,
          sampleRate: opts.sampleRate,
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.35,
          redemptionFrames: 24,
          preSpeechPadFrames: 3,
          minSpeechFrames: 9,
          onSpeechStart: () => {
            this.speechCb?.();
          },
          onSpeechEnd: (_audio: Float32Array) => {
            this.silenceCb?.();
          },
          onVADMisfire: () => {},
          onSpeechRealStart: () => {},
          onFrameProcessed: () => {},
        });
        this.sileroVad.start();
      } else {
        console.warn('[vad] avr-vad not available, falling back to rms-energy');
      }
    }

    const args = [
      '--record', '--raw',
      `--rate=${opts.sampleRate}`,
      `--channels=${opts.channels}`,
      '--format=s16',
      '-P', PW_MIC_PROPS,
      '-',
    ];
    const target = (this.useLoopback && ecModuleId !== null) ? EC_SOURCE_NODE : MIC_SOURCE_NODE;
    if (this.useLoopback) args.splice(1, 0, `--target=${target}`);
    const child = spawn('pw-cat', args, { stdio: ['ignore', 'pipe', 'ignore'] });

    child.stdout!.on('data', (chunk: Buffer) => {
      this.dataCb?.(chunk);
      if (opts.vadMethod === 'silero' && this.sileroVad) {
        const sampleCount = Math.floor(chunk.length / 2);
        const float32 = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
          float32[i] = chunk.readInt16LE(i * 2) / 32768.0;
        }
        void this.sileroVad.processAudio(float32);
      } else if (opts.vadMethod !== 'none') {
        this.processVad(chunk);
      }
    });

    child.on('exit', () => { this.proc = null; });
    child.on('error', (err) => {
      console.error('[pw-cat record] error:', err.message);
      this.proc = null;
    });

    this.proc = child;
  }

  private processVad(chunk: Buffer): void {
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
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
    if (this.sileroVad) {
      void this.sileroVad.flush().then(() => this.sileroVad?.destroy());
      this.sileroVad = null;
    }
    this.speaking = false;
    this.silenceStart = 0;
  }

  async dispose(): Promise<void> {
    this.stop();
  }
}
