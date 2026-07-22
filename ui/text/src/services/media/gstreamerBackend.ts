import { spawn, type ChildProcess } from "node:child_process";
import type { AudioPlayer } from "./types.js";

const LOOPBACK_NAME = "goose-tts";

const CAPTURE_PROPS = JSON.stringify({
  "media.class": "Audio/Sink",
  "node.name": LOOPBACK_NAME,
  "node.description": "Goose",
  "media.name": "Goose TTS",
  "application.name": "Goose",
});

const PLAYBACK_PROPS = JSON.stringify({
  "media.role": "Communication",
});

export class GStreamerAudioPlayer implements AudioPlayer {
  readonly backend = "gstreamer" as const;
  readonly persistent = true as const;
  readonly supportedFormats: readonly string[];

  private loopback: ChildProcess | null = null;
  private queue: Buffer[] = [];
  private playing = false;
  private currentProc: ChildProcess | null = null;
  private stopped = false;

  constructor(formats: readonly string[]) {
    this.supportedFormats = formats;
  }

  async connect(): Promise<void> {
    if (this.loopback !== null) return;
    this.stopped = false;

    const child = spawn(
      "pw-loopback",
      [
        `--name=${LOOPBACK_NAME}`,
        "--channels=1",
        "-i", CAPTURE_PROPS,
        "-o", PLAYBACK_PROPS,
      ],
      { stdio: "ignore" },
    );

    child.on("error", (err) => {
      console.error("[pw-loopback] spawn error:", err.message);
      this.loopback = null;
    });

    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.error(`[pw-loopback] exited: ${code}`);
      }
      this.loopback = null;
    });

    this.loopback = child;
    await new Promise((r) => setTimeout(r, 200));
  }

  pushChunk(audio: Buffer, _format: string): void {
    if (this.stopped) return;
    this.queue.push(audio);
    if (!this.playing) {
      void this.drainQueue();
    }
  }

  private async drainQueue(): Promise<void> {
    this.playing = true;
    while (this.queue.length > 0 && !this.stopped) {
      const chunk = this.queue.shift()!;
      await this.playOne(chunk);
    }
    this.playing = false;
  }

  private playOne(audio: Buffer): Promise<void> {
    return new Promise<void>((resolve) => {
      const child = spawn(
        "pw-play",
        [
          `--target=${LOOPBACK_NAME}`,
          "-",
        ],
        { stdio: ["pipe", "ignore", "ignore"] },
      );

      this.currentProc = child;

      child.on("exit", () => {
        this.currentProc = null;
        resolve();
      });

      child.on("error", (err) => {
        console.error("[pw-play] error:", err.message);
        this.currentProc = null;
        resolve();
      });

      child.stdin!.write(audio);
      child.stdin!.end();
    });
  }

  setVolume(_level: number): void {
    // user adjusts via DE mixer on the persistent Goose node
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    if (this.currentProc) {
      this.currentProc.kill("SIGTERM");
      this.currentProc = null;
    }
  }

  async drain(): Promise<void> {
    while (this.playing) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async dispose(): Promise<void> {
    this.stop();
    if (this.loopback) {
      this.loopback.kill("SIGTERM");
      this.loopback = null;
    }
  }
}
