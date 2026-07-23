<div align="center">

<table><tr>
<td><img src="documentation/static/img/goose-logo-black.png" width="400" alt="goose"/></td>
<td style="vertical-align: middle; font-size: 72px; line-height: 1; padding: 0 8px;">
<b><code>❗❗❗</code></b>
</td>
</tr></table>

# HONK!

**Full voice I/O for goose — TTS, dictation, conversation mode, echo cancellation, and accessibility — in both Electron and terminal.**

`feat/voice-audio-overhaul` · 65 commits ahead of upstream/main · 125 files changed

</div>

---

## What is HONK?

HONK is a platform extension that adds complete voice capabilities to [goose](https://github.com/block/goose), the open source AI agent from the Agentic AI Foundation. It enables hands-free voice conversation with goose in both the Electron desktop app and the Ink-based terminal UI.

This fork/branch implements:

- **Text-to-Speech (TTS)** — server-side synthesis via OpenAI, ElevenLabs, browser native, or model-native audio (GPT-4o-audio), with voice profiles, format selection (WAV/opus/mp3), and speed control
- **Speech-to-Text (STT/Dictation)** — transcription via OpenAI Whisper, ElevenLabs, Groq, model-native, or local Whisper (Candle GGUF, fully offline)
- **HONK Conversation Mode** — continuous listen→transcribe→respond→speak loop with automatic turn-taking
- **Voice Activity Detection (VAD)** — Silero v5 neural VAD (ONNX) with RMS energy fallback
- **Acoustic Echo Cancellation (AEC)** — prevents goose from hearing its own TTS output as speech input
- **Accessibility** — screen reader detection, PipeWire `media.role=Accessibility` for TTS, HONK sub-skills for verbal descriptions and semantic structure
- **5 composable HONK skills** — `honk-core`, `honk-tool-protocol`, `honk-precision`, `honk-styles`, `honk-accessible` — compiled into the binary

> **Upstream target**: [block/goose](https://github.com/block/goose). This branch is being prepared for submission as 2–3 discrete PRs.

---

## Feature Matrix

| Feature | Electron Desktop | Terminal (TUI) |
|---------|:---:|:---:|
| **TTS Playback** | Web Audio API (`AudioContext`) | `pw-cat --playback` / `pw-play` |
| **TTS Streaming** | Chunk queue with pre-fetch | Persistent `pw-cat` process |
| **TTS Caching** | LRU cache (50 entries) | — |
| **Mic Recording** | `getUserMedia` + AudioWorklet | `pw-cat --record` (PipeWire) |
| **Silero VAD** | `onnxruntime-web` (WASM) | `avr-vad` (`onnxruntime-node`) |
| **RMS Fallback VAD** | Shared `computeRms()` | Shared `computeRms()` |
| **Echo Cancellation** | NLMS AudioWorklet (256 taps) | `pactl module-echo-cancel` (WebRTC AEC) |
| **TTS Reference Signal** | `MediaStreamDestination` node | `pw-loopback` virtual sink |
| **Barge-In Detection** | Echo-suspect timer (200ms defer) | Echo-suspect timer (200ms defer) |
| **HONK Conversation Mode** | `useConversationMode` hook | `/honk on\|off` slash command |
| **Voice Settings UI** | 13 settings components | `/tts format\|voice\|speed` commands |
| **Voice Profiles** | Full CRUD UI | Via ACP backend |
| **Media Inhibit** | Electron `powerSaveBlocker` + XDG Portal | — |
| **Media Pause (MPRIS)** | D-Bus MPRIS control (Linux) | — |
| **Voice Indicator** | Tray icon phase display | Terminal header badge |
| **Screen Reader Detection** | Via HONK extension | Via HONK extension |
| **i18n (Voice Strings)** | 26 keys × 16 locales | — |

### Shared Components (`@aaif/voice-shared`)

Both frontends import from `ui/shared/src/voice/`:

| Module | Exports |
|--------|---------|
| `constants.ts` | `SAMPLE_RATE` (16kHz), VAD thresholds, echo-suspect timing, `HONK_FULL_CONTEXT` system prompt |
| `types.ts` | `VoicePhase`, `VoiceConfig`, `VadConfig` |
| `encoding.ts` | `encodeWav()` — Float32Array PCM → WAV |
| `vad.ts` | `computeRms()` — RMS energy calculation |
| `sentenceBoundary.ts` | `detectSentenceBoundary()` — TTS streaming chunk splitter |

---

## Architecture

```
                         ┌──────────────────────────┐
                         │   Rust Backend (ACP)      │
                         │                          │
                         │  tts/providers.rs        │ ← OpenAI, ElevenLabs, Browser, ModelNative
                         │  dictation/providers.rs  │ ← OpenAI, ElevenLabs, Groq, ModelNative, Local
                         │  dictation/whisper.rs    │ ← Candle GGUF (offline)
                         │  honk.rs (extension)     │ ← honk_status, honk_announce, honk_mode
                         │  skills/builtins/honk-*  │ ← 5 composable conversation skills
                         └────────────┬─────────────┘
                                      │ ACP JSON-RPC
                    ┌─────────────────┼─────────────────┐
                    │                 │                  │
           ┌────────▼──────┐  ┌──────▼───────┐  ┌──────▼──────┐
           │  Desktop       │  │  TUI          │  │  Shared     │
           │  (Electron)    │  │  (Ink/Node)   │  │  Package    │
           │                │  │               │  │             │
           │ useAudioPlayer │  │ GStreamer      │  │ constants   │
           │ useAudioRec.   │  │ Backend       │  │ types       │
           │ useSileroVad   │  │ (pw-cat)      │  │ encoding    │
           │ useConvMode    │  │ voiceSession   │  │ vad         │
           │ AEC Worklet    │  │ echo-cancel   │  │ sentBound.  │
           └────────────────┘  └───────────────┘  └─────────────┘
```

For detailed architecture docs, clone the repo and see the AGENTS.md hierarchy (local development aids, not pushed to GitHub):

```
AGENTS.md                    — root (CI gates, commands, conventions)
crates/goose/AGENTS.md       — core library (agent, extensions, providers)
ui/desktop/AGENTS.md         — Electron app (hooks, services, i18n)
ui/text/AGENTS.md            — TUI (PipeWire pipeline, media backends)
ui/shared/AGENTS.md          — shared voice package
```

Regenerate after significant changes: run `/init-deep` in an opencode session.

---

## Configuration

### TTS

| Config Key | Env Var | Values |
|------------|---------|--------|
| `voice.tts.provider` | `VOICE_TTS_PROVIDER` | `openai`, `elevenlabs`, `browser`, `model-native` |
| `voice.tts.voice` | `VOICE_TTS_VOICE` | Provider-specific voice ID |
| `voice.tts.speed` | `VOICE_TTS_SPEED` | `0.25` – `4.0` (default `1.0`) |
| `voice.tts.format` | `VOICE_TTS_FORMAT` | `wav`, `opus`, `mp3` |

### Dictation

| Config Key | Env Var | Values |
|------------|---------|--------|
| `voice.dictation.provider` | `VOICE_DICTATION_PROVIDER` | `openai`, `elevenlabs`, `groq`, `model-native`, `local` |

### Voice Profiles

Saved as JSON in `~/.config/goose/tts_profiles/`. CRUD via Desktop settings UI or ACP API.

---

## Platform Requirements

### Desktop (Electron)
- Standard Electron requirements (no additional system deps)
- `onnxruntime-web` for Silero VAD (bundled, WASM backend)

### Terminal (TUI) — Linux
- **PipeWire** with `pw-cat` (recording and playback)
- **GStreamer** with opus/mp3 codec plugins (for encoded formats)
- **PulseAudio** `pactl` (for echo cancellation module loading)
- `pw-loopback` (for virtual TTS sink and mic source nodes)
- `onnxruntime-node` via `avr-vad` (for Silero VAD)

Fallback chain: GStreamer/PipeWire → PulseAudio `pacat` → noop (silent)

Detection is automatic — run `goose session` and voice capabilities are probed at startup.

---

## Testing

### CI Gates (all passing)

| Gate | Status |
|------|--------|
| `cargo fmt --check` | ✅ 0 diffs |
| `cargo clippy --all-targets -- -D warnings` | ✅ clean |
| `cargo test` (1424 tests) | ✅ pass (4 pre-existing GCP/JWT failures — not ours) |
| `cargo-machete` (unused deps) | ✅ clean |
| Desktop `eslint --max-warnings 0` | ✅ clean |
| Desktop `tsc --noEmit` | ✅ pass |
| i18n locale sync (26 voice keys × 16 locales) | ✅ synced |

### Device Testing

| Target | Hardware | Status |
|--------|----------|--------|
| **Build host** (koero) | `172.16.1.124`, NVMe build tier | Release binary v1.43.0 built, deployed |
| **Test device** (z20) | Qualcomm handheld, bootc system | Binary deployed at `~/goose/target/release/goose`, `goose-dev` script configured |

### Test Coverage Gaps

- End-to-end voice pipeline on z20 (binary deployed, needs interactive testing)
- Multi-provider TTS comparison (OpenAI vs ElevenLabs latency/quality)
- Long-running conversation mode stability
- Silero VAD accuracy across ambient noise levels
- Echo cancellation effectiveness with speakers (not headphones)

---

## Branch Status

| Metric | Value |
|--------|-------|
| **Branch** | `feat/voice-audio-overhaul` |
| **Base** | upstream/main @ `7b879b407` (v1.44.0) |
| **Merge strategy** | Clean merge (not rebase — 2 conflicts vs 63+ rebase rounds) |
| **Commits ahead** | 65 |
| **Files changed** | 125 (+15,468 / −3,723) |
| **Remotes** | origin (Forgejo), github (GitHub fork), upstream (block/goose) |

### Known Issues (from REVISION_PLAN.md)

| ID | Severity | Issue |
|----|----------|-------|
| P0-1 | Critical | MIME type mismatches in TTS providers (ogg vs mpeg) |
| P0-2 | High | Browser TTS test button permanently disabled after first test |
| P0-3 | Critical | Path traversal in TTS profile ID |
| P0-4 | Critical | ElevenLabs voice_id URL injection |
| P0-5 | High | AudioContext created per chunk — resource exhaustion |
| P0-6 | High | Conversation mode loop — `handleStreamFinish` not wired |
| P0-7 | High | `unwrap()` panic in `get_tts_provider_def` |

See [`REVISION_PLAN.md`](REVISION_PLAN.md) for full details and fixes.

### Upstream PR Strategy

| PR | Scope | Files |
|----|-------|-------|
| **PR 1** | Rust backend: TTS + dictation + HONK extension + skills | `crates/goose/src/{tts,dictation,agents/platform_extensions/honk.rs,skills/builtins/honk-*}` |
| **PR 2** | Desktop UI: voice settings, hooks, Silero VAD, AEC worklet | `ui/desktop/src/{hooks/use{Audio,Silero,Conversation}*,services/{silero,voice,media}*,components/settings/voice/}` |
| **PR 3** | Text TUI: PipeWire backend, voice session, shared package | `ui/text/src/{services/media/,voiceSession,voiceState}`, `ui/shared/src/voice/` |

Commits will be squashed (65 → 2–3 logical commits per PR) before submission. CONTRIBUTING.md requires conventional commits and small first PRs.

---

## Building

```bash
# Setup
source bin/activate-hermit

# Debug build
cargo build

# Release build (for deployment)
cargo build --release -p goose-cli --bin goose

# Run desktop with voice
just run-ui

# Run TUI with voice
cargo run -p goose-cli -- session   # then /honk on
```

### Remote Build (koero)

```bash
ssh aenertia@172.16.1.124
cd /home/aenertia/builds/goose
git pull
cargo build --release -p goose-cli --bin goose
```

### Deploy to z20

```bash
scp target/release/goose a3d@z20:~/goose/target/release/goose
# goose-dev script at ~/bin/goose-dev already configured
```

---

## Maintaining This Documentation

### When to Update This README

- New voice feature implemented → add to Feature Matrix
- Bug fixed from REVISION_PLAN.md → update Known Issues
- Tested on new device → add to Device Testing table
- CI gate results change → update Testing section
- Commits squashed or PRs submitted → update Branch Status

### Updating the AGENTS.md Knowledge Base

The AGENTS.md hierarchy provides detailed architecture docs for AI agents working in this codebase. To regenerate after significant changes:

```
# In opencode session:
/init-deep
```

This re-discovers the codebase structure and updates:
- `AGENTS.md` — root (structure, commands, CI gates, conventions)
- `crates/goose/AGENTS.md` — core library architecture
- `ui/desktop/AGENTS.md` — Electron app details
- `ui/text/AGENTS.md` — TUI voice pipeline
- `ui/shared/AGENTS.md` — shared voice package

> **Note**: AGENTS.md files use `--skip-worktree` and `.git/info/exclude` to stay out of GitHub. They are local development aids, not upstream documentation.

---

<div align="center">

<sub>HONK is built on <a href="https://github.com/block/goose">goose</a> by the <a href="https://aaif.io/">Agentic AI Foundation</a> at the Linux Foundation.</sub>

</div>
