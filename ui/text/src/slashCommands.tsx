import { spawnSync } from "node:child_process";
import { getTtsEnabled, setTtsEnabled, getTtsCapabilities } from "./ttsState.js";

export interface SlashCommandContext {
  cwd: string;
  args: string;
}

export type SlashCommandResult =
  | { handled: true; message?: string }
  | { handled: true; overlay: "diff"; content: string; truncated: boolean }
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
  description: "enable/disable text-to-speech (on|off)",
  run: (ctx) => {
    const caps = getTtsCapabilities();

    if (!caps || !caps.audioPlayback) {
      const reason = !caps
        ? "audio backend not yet initialized"
        : `no audio playback available (backend: ${caps.backend})`;
      return { handled: true, message: `[tts] ${reason}` };
    }

    const arg = ctx.args.trim().toLowerCase();

    if (arg === "on") {
      setTtsEnabled(true);
      const fmts = caps.supportedFormats.join(", ");
      return {
        handled: true,
        message: `[tts] enabled — backend: ${caps.backend}, formats: ${fmts}`,
      };
    }

    if (arg === "off") {
      setTtsEnabled(false);
      return { handled: true, message: "[tts] disabled" };
    }

    const state = getTtsEnabled() ? "on" : "off";
    const fmts = caps.supportedFormats.join(", ");
    return {
      handled: true,
      message: `[tts] ${state} — backend: ${caps.backend} (${caps.gstreamerVersion ?? "n/a"}), formats: ${fmts || "none"}, persistent: ${caps.persistentStreams}`,
    };
  },
};

const COMMANDS: Record<string, SlashCommand> = {
  diff: diffCommand,
  tts: ttsCommand,
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
