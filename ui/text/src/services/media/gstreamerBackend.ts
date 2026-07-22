import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { AudioPlayer } from "./types.js";

function hasPipeWireSink(): boolean {
  const result = spawnSync('gst-inspect-1.0', ['pipewiresink'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
  });
  const out = (result.stdout ?? '') as string;
  return !out.includes('No such element') && !out.includes('No such plugin');
}

/**
 * Linux audio backend using a persistent gst-launch-1.0 pipeline.
 *
 * Spawns ONE process for the entire app session. The PipeWire mixer
 * shows a stable "Goose" entry that never flickers because the
 * pipeline stays in PLAYING state between TTS chunks.
 *
 * Audio bytes (opus/wav/mp3/ogg) are written directly to stdin —
 * GStreamer's decodebin auto-detects the container format.
 */
export class GStreamerAudioPlayer implements AudioPlayer {
  readonly backend = "gstreamer" as const;
  readonly persistent = true as const;
  readonly supportedFormats: readonly string[];

  private proc: ChildProcess | null = null;

  constructor(formats: readonly string[]) {
    this.supportedFormats = formats;
  }

  async connect(): Promise<void> {
    if (this.proc !== null) return;

    const usePipeWire = hasPipeWireSink();
    const sinkArgs = usePipeWire
      ? [
          'pipewiresink',
          'client-name=Goose',
          'stream-properties=props,media.name=Goose TTS,media.role=Communication',
        ]
      : ['autoaudiosink'];

    if (!usePipeWire) {
      console.warn('[gstreamer] pipewiresink not available, using autoaudiosink (no persistent mixer entry)');
    }

    const child = spawn(
      "gst-launch-1.0",
      [
        "-q",
        "fdsrc",
        "fd=0",
        "!",
        "decodebin",
        "!",
        "audioconvert",
        "!",
        "audioresample",
        "!",
        ...sinkArgs,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );

    child.on("exit", (code) => {
      console.error(`[gstreamer] pipeline exited: ${code}`);
      this.proc = null;
    });

    child.on("error", (err) => {
      console.error(`[gstreamer] spawn error: ${err.message}`);
      this.proc = null;
    });

    // Wait until stdin is confirmed writable.
    await new Promise<void>((resolve, reject) => {
      const stdin = child.stdin;
      if (stdin === null) {
        reject(new Error("[gstreamer] stdin is null after spawn"));
        return;
      }

      // If already writable, resolve immediately.
      if (stdin.writable) {
        this.proc = child;
        resolve();
        return;
      }

      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      const onReady = (): void => {
        cleanup();
        this.proc = child;
        resolve();
      };

      const cleanup = (): void => {
        stdin.removeListener("error", onError);
        stdin.removeListener("open", onReady);
      };

      stdin.once("error", onError);
      stdin.once("open", onReady);
    });
  }

  pushChunk(audio: Buffer, _format: string): void {
    if (this.proc === null || this.proc.stdin === null) {
      console.warn("[gstreamer] pushChunk called but pipeline is not running");
      return;
    }

    if (!this.proc.stdin.writable) {
      console.warn("[gstreamer] pushChunk called but stdin is not writable");
      return;
    }

    // Write raw encoded bytes — decodebin auto-detects the container.
    this.proc.stdin.write(audio);
  }

  setVolume(_level: number): void {
    console.warn("[gstreamer] setVolume not yet implemented");
  }

  stop(): void {
    if (this.proc === null || this.proc.stdin === null) return;

    if (this.proc.stdin.writable) {
      // Write a brief silence buffer to avoid click artifacts.
      this.proc.stdin.write(Buffer.alloc(960));
    }
    // Pipeline stays alive in PLAYING state — PipeWire node persists.
  }

  async drain(): Promise<void> {
    // Audio is buffered inside GStreamer, not in Node.js.
    // Resolve immediately — the pipeline drains on its own.
  }

  async dispose(): Promise<void> {
    const child = this.proc;
    if (child === null) return;

    this.proc = null;

    if (child.stdin !== null && child.stdin.writable) {
      child.stdin.end();
    }

    child.kill("SIGTERM");

    // Wait for the process to actually exit.
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000);

      child.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
