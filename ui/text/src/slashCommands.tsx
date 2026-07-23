import { spawnSync } from "node:child_process";
import { getTtsEnabled, setTtsEnabled, getTtsCapabilities, setTtsFormat, getTtsFormat, setTtsVoice, getTtsVoice, setTtsSpeed, getTtsSpeed, getHonkActive, setHonkActive } from "./voiceState.js";

export interface SlashCommandContext {
  cwd: string;
  args: string;
}

export type SlashCommandResult =
  | { handled: true; message?: string }
  | { handled: true; overlay: "diff"; content: string; truncated: boolean }
  | { handled: true; detach: true; message: string }
  | { handled: false };

export interface SlashCommand {
  name: string;
  description: string;
  run: (ctx: SlashCommandContext) => SlashCommandResult;
}

function isGitRepo(cwd: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return result.status === 0;
}

const MAX_DIFF_BYTES = 2_000_000;

function readDiff(cwd: string): { text: string; truncated: boolean } | null {
  const result = spawnSync(
    "git",
    ["--no-pager", "diff", "--no-color"],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.status !== 0 && result.status !== null) return null;
  const stdout = result.stdout ?? "";
  if (stdout.length > MAX_DIFF_BYTES) {
    return { text: stdout.slice(0, MAX_DIFF_BYTES), truncated: true };
  }
  return { text: stdout, truncated: false };
}

const diffCommand: SlashCommand = {
  name: "diff",
  description: "show unstaged changes",
  run: (ctx) => {
    if (!isGitRepo(ctx.cwd)) {
      return {
        handled: true,
        message: `not a git repository: ${ctx.cwd}`,
      };
    }

    const diff = readDiff(ctx.cwd);
    if (diff === null) {
      return { handled: true, message: "failed to run `git diff`" };
    }

    if (diff.text.trim().length === 0) {
      return { handled: true, message: "no unstaged changes" };
    }

    return {
      handled: true,
      overlay: "diff",
      content: diff.text,
      truncated: diff.truncated,
    };
  },
};

const ttsCommand: SlashCommand = {
  name: "tts",
  description: "voice settings (on|off|format|voice|speed)",
  run: (ctx) => {
    const caps = getTtsCapabilities();
    const parts = ctx.args.trim().split(/\s+/);
    const sub = parts[0]?.toLowerCase() ?? "";
    const val = parts.slice(1).join(" ");

    if (!caps || !caps.audioPlayback) {
      const reason = !caps
        ? "audio backend not yet initialized"
        : `no audio playback available (backend: ${caps.backend})`;
      return { handled: true, message: `[tts] ${reason}` };
    }

    if (sub === "on") {
      setTtsEnabled(true);
      return { handled: true, message: `[tts] enabled — format: ${getTtsFormat() || "auto"}, voice: ${getTtsVoice() || "default"}, speed: ${getTtsSpeed()}` };
    }

    if (sub === "off") {
      setTtsEnabled(false);
      return { handled: true, message: "[tts] disabled" };
    }

    if (sub === "format") {
      if (!val) {
        const fmts = caps.supportedFormats.join(", ");
        return { handled: true, message: `[tts] format: ${getTtsFormat() || "auto"} — available: ${fmts}` };
      }
      if (!caps.supportedFormats.includes(val)) {
        return { handled: true, message: `[tts] unsupported format '${val}' — available: ${caps.supportedFormats.join(", ")}` };
      }
      setTtsFormat(val);
      return { handled: true, message: `[tts] format set to ${val}` };
    }

    if (sub === "voice") {
      if (!val) {
        return { handled: true, message: `[tts] voice: ${getTtsVoice() || "default"}` };
      }
      setTtsVoice(val);
      return { handled: true, message: `[tts] voice set to ${val}` };
    }

    if (sub === "speed") {
      if (!val) {
        return { handled: true, message: `[tts] speed: ${getTtsSpeed()}` };
      }
      const n = parseFloat(val);
      if (isNaN(n) || n < 0.25 || n > 4.0) {
        return { handled: true, message: "[tts] speed must be 0.25–4.0" };
      }
      setTtsSpeed(n);
      return { handled: true, message: `[tts] speed set to ${n}` };
    }

    const state = getTtsEnabled() ? "on" : "off";
    const fmts = caps.supportedFormats.join(", ");
    return {
      handled: true,
      message: `[tts] ${state} — backend: ${caps.backend}, format: ${getTtsFormat() || "auto"}, voice: ${getTtsVoice() || "default"}, speed: ${getTtsSpeed()}, formats: ${fmts}`,
    };
  },
};

const honkCommand: SlashCommand = {
  name: "honk",
  description: "voice conversation mode (on|off) — requires mic + speaker",
  run: (ctx) => {
    const caps = getTtsCapabilities();
    const sub = ctx.args.trim().toLowerCase();

    if (!caps) {
      return { handled: true, message: "[honk] audio backend not yet initialized" };
    }
    if (!caps.audioPlayback) {
      return { handled: true, message: "[honk] no audio playback available — TTS required for conversation mode" };
    }
    if (!caps.audioCapture) {
      return { handled: true, message: "[honk] no audio capture available — mic required for conversation mode (pw-cat not found)" };
    }

    if (sub === "on") {
      setHonkActive(true);
      setTtsEnabled(true);
      const ecWarn = !caps.loopbackAvailable ? ' ⚠ no echo cancellation — headphones required' : '';
      return { handled: true, message: `[honk] conversation mode ON — speak naturally, Ctrl+L to toggle mic${ecWarn}` };
    }

    if (sub === "off") {
      setHonkActive(false);
      return { handled: true, message: "[honk] conversation mode OFF" };
    }

    const state = getHonkActive() ? "on" : "off";
    return {
      handled: true,
      message: `[honk] ${state} — backend: ${caps.backend}, playback: ${caps.audioPlayback}, capture: ${caps.audioCapture}`,
    };
  },
};

const detachCommand: SlashCommand = {
  name: 'detach',
  description: 'Disconnect from session (session persists on goose serve)',
  run: () => ({
    handled: true as const,
    detach: true as const,
    message: '[detach] Disconnecting — session persists on goose serve. Reconnect with: goose session --attach',
  }),
};

const COMMANDS: Record<string, SlashCommand> = {
  diff: diffCommand,
  tts: ttsCommand,
  honk: honkCommand,
  detach: detachCommand,
};

export function tryRunSlashCommand(
  input: string,
  ctx: Omit<SlashCommandContext, "args">,
): SlashCommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { handled: false };
  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1).join(" ");
  const cmd = COMMANDS[name];
  if (!cmd) return { handled: false };
  return cmd.run({ ...ctx, args });
}

export function listSlashCommands(): SlashCommand[] {
  return Object.values(COMMANDS);
}
