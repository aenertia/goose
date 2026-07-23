<div align="center">

<table><tr>
<td><img src="documentation/static/img/goose-logo-black.png" width="400" alt="goose"/></td>
<td style="vertical-align: middle; font-size: 72px; line-height: 1; padding: 0 8px;">
<b><code>❗❗❗</code></b>
</td>
</tr></table>

# HONK!

**Full voice I/O for goose — TTS, dictation, conversation mode, echo cancellation, and accessibility — in both Electron and terminal.**

`feat/voice-audio-overhaul` · 73 commits ahead of upstream/main · 131 files changed

</div>

---

## What is HONK?

HONK is a platform extension that adds complete voice capabilities to [goose](https://github.com/block/goose), the open source AI agent from the Agentic AI Foundation. It enables hands-free voice conversation with goose in both the Electron desktop app and the Ink-based terminal UI.

This fork/branch implements:

- **Text-to-Speech (TTS)** — server-side synthesis via OpenAI, ElevenLabs, browser native, or model-native audio (GPT-4o-audio), with voice profiles, format selection (WAV/opus/mp3), and speed control
- **Speech-to-Text (STT/Dictation)** — transcription via OpenAI Whisper, ElevenLabs, Groq, model-native, or local Whisper (Candle GGUF, fully offline)
- **HONK Conversation Mode** — continuous listen→transcribe→respond→speak loop with automatic turn-taking
- **Voice Activity Detection (VAD)** — Silero v6 neural VAD (ONNX) on both frontends, behind a pluggable `VadEngine` interface, with RMS energy fallback
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
| **Silero VAD** | v6 via `SileroV6Engine` (`onnxruntime-web` WASM) | v6 via `SileroNodeEngine` (`onnxruntime-node` native) |
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
| **VadEngine abstraction** | `useVad(engine)` hook | Inline state machine with `SileroNodeEngine` |
| **macOS TUI audio** | N/A (Desktop works via Web Audio) | ⚠️ UNTESTED — `FfmpegAudioPlayer` + `FfmpegAudioRecorder` via `ffplay`/`ffmpeg -f avfoundation` |
| **Windows TUI audio** | N/A (Desktop works via Web Audio) | ⚠️ UNTESTED — `FfmpegAudioPlayer` + `FfmpegAudioRecorder` via `ffplay`/`ffmpeg -f dshow` |

### Shared Components (`@aaif/voice-shared`)

Both frontends import from `ui/shared/src/voice/`:

| Module | Exports |
|--------|---------|
| `constants.ts` | `SAMPLE_RATE` (16kHz), VAD thresholds, echo-suspect timing, `HONK_FULL_CONTEXT` system prompt |
| `types.ts` | `VoicePhase`, `VoiceConfig`, `VadConfig` |
| `vadEngine.ts` | `VadEngine` interface, `VadEngineId`, `VadEngineConfig`, `VAD_DEFAULTS` |
| `vadEngines/rmsEngine.ts` | `RmsEnergyEngine` — threshold-based VAD (no ML, zero deps) |
| `vadEngines/noopEngine.ts` | `NoopEngine` — silent stub for disabled VAD |
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
           │ useVad         │  │ (pw-cat)      │  │ vadEngine   │
           │ useConvMode    │  │ SileroNode    │  │ encoding    │
           │ SileroV6Eng.   │  │ voiceSession   │  │ vad         │
           │ AEC Worklet    │  │ echo-cancel   │  │ sentBound.  │
           └────────────────┘  └───────────────┘  └─────────────┘
```

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

### Desktop (Electron) — Linux, macOS, Windows
- Standard Electron requirements (no additional system deps)
- `onnxruntime-web` for Silero VAD v6 (bundled, WASM backend)
- Microphone entitlement already in `entitlements.plist` (macOS)
- Voice pipeline uses Web Audio API — works cross-platform

### Terminal (TUI) — Linux (tested)
- **PipeWire** with `pw-cat` (recording and playback)
- **GStreamer** with opus/mp3 codec plugins (for encoded formats)
- **PulseAudio** `pactl` (for echo cancellation module loading)
- `pw-loopback` (for virtual TTS sink and mic source nodes)
- `onnxruntime-node` for Silero VAD v6 (bundled model, no `avr-vad` dependency)

Fallback chain: GStreamer/PipeWire → PulseAudio `pacat` → noop (silent)

Detection is automatic — run `goose session` and voice capabilities are probed at startup.

### Terminal (TUI) — gnome-remote-desktop (RDP sessions)

HONK voice I/O works transparently over [gnome-remote-desktop](https://gitlab.gnome.org/GNOME/gnome-remote-desktop) (grd), including **headless servers with no physical display**. No code changes or extra configuration needed beyond installing grd.

**How it works**: grd uses FreeRDP as its RDP library and integrates with PipeWire for audio. When an RDP client connects with microphone and audio redirection enabled:

- **Playback** (server → client): grd monitors all PipeWire sinks and sends their audio via the RDPSND RDP channel (AAC/Opus/PCM negotiated). TTS audio playing through `pw-cat` flows to the client's speakers automatically.
- **Recording** (client → server): grd injects client microphone audio via the AUDIN RDP channel into a PipeWire node named `grd_remote_audio_source`. The TUI detects this node at startup and records from it directly.

**Automatic grd detection**: `detectMediaCapabilities()` probes `pactl list sources short` for `grd_remote_audio_source`. When found (`grdSession: true`):

- The PipeWire loopback (`goose-tts-sink`, `goose-mic-src`) is **not** created — unnecessary in RDP sessions
- `module-echo-cancel` is **not** loaded — server-side AEC can't cancel the client-side echo loop; the RDP client handles AEC
- `pw-cat --record` targets `grd_remote_audio_source` directly

**Requirements**: RHEL 10 / Fedora 41+ with gnome-remote-desktop ≥ 46, FreeRDP ≥ 3.24.1 (FreeRDP 3.24.0 had an AUDIN regression), PipeWire ≥ 1.2.0.

**Headless setup** (no physical monitor):
```bash
# System-level multi-user mode (GDM integration):
sudo dnf install gnome-remote-desktop gdm freerdp
sudo -u gnome-remote-desktop winpr-makecert -silent -rdp -path ~gnome-remote-desktop rdp-tls
sudo grdctl --system rdp set-tls-key ~gnome-remote-desktop/rdp-tls.key
sudo grdctl --system rdp set-tls-cert ~gnome-remote-desktop/rdp-tls.crt
sudo grdctl --system rdp set-credentials "username" "password"
sudo grdctl --system rdp enable
sudo systemctl enable --now gnome-remote-desktop.service
```

Connect from any RDP client with **audio playback** and **audio input (microphone)** redirection enabled, then run `goose session` → `/honk on`.

### Terminal (TUI) — macOS + Windows (⚠️ UNTESTED)

Both macOS and Windows TUI voice use `ffmpegBackend.ts` — a unified backend requiring `ffmpeg`/`ffplay` installed:

| | macOS | Windows |
|---|---|---|
| **Install** | `brew install ffmpeg` | `winget install Gyan.FFmpeg` |
| **Playback** | `ffplay -nodisp -autoexit` | `ffplay -nodisp -autoexit` |
| **Recording** | `ffmpeg -f avfoundation -i ":0"` | `ffmpeg -f dshow -i audio="Microphone"` |
| **VAD** | Silero v6 via `SileroNodeEngine` (onnxruntime-node) | Same |
| **AEC** | None (deferred) | None (WASAPI AEC is C++ only) |
| **Process cleanup** | `SIGTERM` | `taskkill /pid /f /t` |

Detection probes `ffplay -version` at startup. When not found, falls back to `afplay` (macOS, playback-only) or `powershell` (Windows, playback-only) stubs — both without recording capability.

**To test**: install ffmpeg, then `goose session` → `/honk on`

No macOS or Windows hardware is available for testing. Contributions welcome.

---

## Silero VAD: Why v6?

Both Desktop and TUI use Silero VAD v6. Previously, the TUI used v5 via the `avr-vad` npm package (which bundled v5 with no override path). We replaced `avr-vad` with a direct `onnxruntime-node` integration (`SileroNodeEngine`) loading the same v6 model.

| Metric | v5 | v6 | Delta |
|--------|-----|-----|-------|
| ONNX file size | 2,327,524 bytes | 2,327,524 bytes | identical |
| I/O contract | input/state/sr → output/stateN | identical | drop-in |
| Speech detection (ROC-AUC) | 0.96 | 0.97 | +0.01 |
| **Noise rejection (ESC-50)** | **0.61** | **0.87** | **+0.26** |
| **Noise rejection (private)** | **0.44** | **0.71** | **+0.27** |

v6 retrained 28/345 weight tensors with no architecture changes. The improvement is entirely in noise rejection — fewer false VAD triggers from environmental sounds, fans, keyboard clicks. Speech detection accuracy is unchanged. Same ONNX opset 16, same frame size (512 samples), same state dimensions ([2,1,128]).

Source: [snakers4/silero-vad Quality Metrics](https://github.com/snakers4/silero-vad/wiki/Quality-Metrics)

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

| Target | Hardware | OS | Status |
|--------|----------|----|--------|
| Build host | AMD Ryzen 7 9700X, 32GB DDR5, NVMe | Fedora 42 | Release binary built, deployed |
| Test workstation | AMD Ryzen 7 9700X, RX 9070 XT (RDNA 4), 32GB DDR5 | AEOS (Fedora 45 bootc), KDE Plasma/Wayland | Binary deployed, voice pipeline testing |

### Test Coverage Gaps

- End-to-end voice pipeline (binary deployed, needs interactive testing)
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
| **Commits ahead** | 73 |
| **Files changed** | 131 (+15,524 / −3,767) |
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

### Remote Build & Deploy

Build the release binary on the build host, then deploy to the test workstation:

```bash
# On build host
cd ~/builds/goose && git pull
cargo build --release -p goose-cli --bin goose

# Deploy to test workstation
scp target/release/goose <user>@<test-host>:~/goose/target/release/goose
```

---

## Maintaining This Documentation

### When to Update This README

- New voice feature implemented → add to Feature Matrix
- Bug fixed from REVISION_PLAN.md → update Known Issues
- Tested on new device → add to Device Testing table
- CI gate results change → update Testing section
- Commits squashed or PRs submitted → update Branch Status

---

<div align="center">

<sub>HONK is built on <a href="https://github.com/block/goose">goose</a> by the <a href="https://aaif.io/">Agentic AI Foundation</a> at the Linux Foundation.</sub>

</div>
