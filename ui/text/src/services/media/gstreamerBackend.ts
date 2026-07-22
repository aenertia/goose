import { spawn, type ChildProcess } from "node:child_process";
import type { AudioPlayer } from "./types.js";

const PW_PROPS = JSON.stringify({
  "media.name": "Goose TTS",
  "application.name": "Goose",
});

export class GStreamerAudioPlayer implements AudioPlayer {
  readonly backend = "gstreamer" as const;
  readonly persistent = true as const;
  readonly supportedFormats: readonly string[];

  private queue: Buffer[] = [];
  private playing = false;
  private currentProc: ChildProcess | null = null;
  private stopped = false;

  constructor(formats: readonly string[]) {
    this.supportedFormats = formats;
  }

  async connect(): Promise<void> {
    this.stopped = false;
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
          "--media-role=Communication",
          "-P", PW_PROPS,
          "-",
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );

      this.currentProc = child;

      child.on("exit", () => {
        this.currentProc = null;
        resolve();
      });

      child.on("error", (err) => {
        console.error("[pw-play] spawn error:", err.message);
        this.currentProc = null;
        resolve();
      });

      child.stdin!.write(audio);
      child.stdin!.end();
    });
  }

  setVolume(_level: number): void {
    // user adjusts via DE mixer
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
  }
}
