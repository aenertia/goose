# Voice/Audio Overhaul — Revised Plan

**Branch:** `feat/voice-audio-overhaul`  
**Date:** 2026-07-23  
**Basis:** Full `git diff upstream/main..HEAD` review (145 files, +16314/−3976, 79 commits)  
**Supersedes:** Previous REVISION_PLAN.md (surface-scanner/arch-critic/deep-diver synthesis)

---

## Previous P0 Status (from prior REVISION_PLAN)

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| P0-1 | MIME type mismatch (ElevenLabs returns mpeg, code says ogg) | **OPEN** | `tts/providers.rs:579` returns `"audio/ogg"`, ElevenLabs default is `audio/mpeg` |
| P0-2 | `isTesting` never reset in browser TTS test | **UNVERIFIED** | Needs Desktop UI check |
| P0-3 | Path traversal in profile ID | **FIXED** | `validate_profile_id()` added at `profiles.rs:46-58`, tests at lines 163-179 |
| P0-4 | ElevenLabs voice_id URL injection | **FIXED** | `urlencoding::encode(voice_id)` at `tts/providers.rs:557` |
| P0-5 | AudioContext created per chunk | **PARTIALLY FIXED** | Singleton `globalSharedCtx` exists (`useAudioPlayer.ts:32-36`), but verify chunk reuse |
| P0-6 | Conversation mode loop — `handleStreamFinish` never wired | **UNVERIFIED** | Needs Desktop integration test |
| P0-7 | `unwrap()` panic in `get_tts_provider_def` | **OPEN** | `tts/providers.rs:85` still uses `.unwrap()` |

---

## Phase 1 — Code Consolidation (reduce complexity before PR)

### C1: Extract shared TLS/HTTP client builder ★ MUST-FIX

**Problem:** Identical ~22-line TLS client construction block copy-pasted 4 times:
- `tts/providers.rs:441-462` (`synthesize_openai_compatible`)
- `tts/providers.rs:605-627` (`synthesize_with_model`)
- `dictation/providers.rs:300` (OpenAI transcription)
- `dictation/providers.rs:406-427` (model-native transcription)

Each block: `provider_tls_config_from_config()` → `ca_cert_path` → `Certificate::from_pem_bundle` → `client_identity` → `Identity::from_pem`. Character-for-character identical except timeout value.

**Fix:** Extract to `crates/goose/src/providers/http_client.rs`:
```rust
pub fn build_provider_client(config: &Config, timeout: Duration) -> Result<reqwest::Client>
```

**Impact:** −80 lines, single maintenance point for TLS changes.

### C2: Extract shared `ModelNativeResolved` + resolver ★ MUST-FIX

**Problem:** Identical struct + identical resolution function duplicated:
- `tts/providers.rs:696-774` — `struct ModelNativeResolved` + `fn resolve_model_native_config()`
- `dictation/providers.rs:19-23` — `struct ModelNativeResolved` (identical)
- `dictation/providers.rs:492-655` — `fn resolve_model_native_config()` (functionally identical, more match arms)

**Fix:** Move to `crates/goose/src/providers/native_audio.rs` (or `providers/model_resolve.rs`). Both `tts/providers.rs` and `dictation/providers.rs` import from there.

**Impact:** −100 lines, single source of truth for model-native provider resolution.

### C3: MediaCapabilities defaults factory ★ SHOULD-FIX

**Problem:** `detection.ts` repeats all 12 `MediaCapabilities` fields in every platform-specific return (6 return sites). Fields like `pipewire: false, loopbackAvailable: false, echoCancelAvailable: false, grdSession: false, sshAudioSession: false` are identical defaults in 5 of 6 sites.

Additionally, indentation is inconsistent: `grdSession`/`sshAudioSession` fields have 2-space, 6-space, and 10-space indentation across different return objects (lines 72-73 vs 87-88 vs 120-121 vs 204-205).

**Fix:** Extract a `defaultCapabilities(backend, overrides)` factory function. Each platform detector overrides only the non-default fields.

**Impact:** −50 lines, consistent formatting, easier to add new capability fields.

### C4: Consolidate HONK skills (5 → 2) ★ SHOULD-FIX

**Problem:** 5 skill files totaling 102 lines:
- `honk-core.md` (28 lines) — core conversation behavior
- `honk-tool-protocol.md` (16 lines) — tool confirmation tiers
- `honk-precision.md` (18 lines) — precise speech instructions
- `honk-styles.md` (22 lines) — output style guidance
- `honk-accessible.md` (18 lines) — accessibility adaptations

Upstream has 1 builtin skill (`goose_doc_guide`). 5 micro-skills for one feature is over-decomposed — the LLM loads all 5 anyway when HONK is active.

**Fix:** Merge into 2 files:
- `honk-conversation.md` — merge core + tool-protocol + precision + styles
- `honk-accessible.md` — keep separate (orthogonal concern, loaded conditionally)

**Impact:** −3 files, −20 lines (dedup headers), simpler skill discovery.

### C5: Config value resolution helper ★ NICE-TO-HAVE

**Problem:** Pattern `config.get_param::<String>(key).ok().filter(|u| !u.trim().is_empty())` or `.unwrap_or_default()` repeated 10+ times across tts/dictation providers and honk.rs.

**Fix:** Add `Config::get_nonempty_param(&self, key) -> Option<String>` or a standalone helper.

---

## Phase 2 — Bug Fixes (remaining P0/P1 from prior review + new findings)

### B1: MIME type mismatches ★ MUST-FIX (prior P0-1, still open)

**Files:** `tts/providers.rs:579, 678`

| Function | Requests | Returns | Correct |
|----------|----------|---------|---------|
| `synthesize_elevenlabs` | (default ElevenLabs format) | `"audio/ogg"` | `"audio/mpeg"` |
| `synthesize_with_model` | `"format": "mp3"` | `"audio/ogg"` | `"audio/mpeg"` |

**Fix:** `synthesize_elevenlabs` → return `"audio/mpeg"`. `synthesize_with_model` → return `"audio/mpeg"` (matches requested mp3 format).

### B2: `get_tts_provider_def()` unwrap panic ★ MUST-FIX (prior P0-7, still open)

**File:** `tts/providers.rs:82-86`

```rust
PROVIDERS.iter().find(|def| def.provider == provider).unwrap()
```

**Fix:** Return `Option<&TtsProviderDef>` or match exhaustively. Current callers already handle Browser/ModelNative before reaching this — but a future provider addition would crash.

### B3: `honk_announce` ships dead functionality ★ MUST-FIX

**File:** `honk.rs:156`

The tool returns: `"HONK announce stored in session (UI consumer not yet implemented — message will not be spoken)"`. This is shipping a tool that explicitly does nothing. Either:
- **Remove** `honk_announce` tool until UI consumer is wired, or
- **Wire** the UI consumer (Desktop: poll `extension_data` for `announce_message`; TUI: check in session update handler)

Recommendation: Remove for PR1. Add in a follow-up PR with the UI consumer.

### B4: CLI pre-dispatch provider check ★ MUST-FIX

**File:** `cli.rs` — `--list-remote` and `--attach` run through the full CLI initialization which validates provider config (`GOOSE_PROVIDER` + `GOOSE_MODEL`). These commands only need `goose serve` health (HTTP GET `/health`), not a configured LLM provider.

**Fix:** In `cli.rs` dispatch (around line 2292), handle `list_remote` and `attach` branches **before** the provider initialization path. They call `ensure_serve_running()` which only needs `reqwest` — no provider config.

### B5: Hardcoded model/voice/format values ★ SHOULD-FIX (prior P1-4)

| Location | Hardcoded | Should be |
|----------|-----------|-----------|
| `tts/providers.rs:434` | `"model": "tts-1"` | Configurable via `voice.tts.model` |
| `tts/providers.rs:539` | `"21m00Tcm4TlvDq8ikWAM"` (Rachel) | Configurable via `voice.tts.elevenlabs_default_voice` |
| `tts/providers.rs:598` | `"voice": "alloy", "format": "mp3"` | Use config values |

**Fix:** Read from config with sensible defaults. At minimum, make OpenAI model configurable (some users want `tts-1-hd`).

### B6: ElevenLabs speed parameter silently dropped ★ SHOULD-FIX (prior P1-2)

**File:** `tts/providers.rs:516-579` — `synthesize_elevenlabs()` accepts but ignores `speed`. Either:
- Pass as query param if ElevenLabs supports it
- Disable speed slider when ElevenLabs selected

### B7: `afplay`/`powershell` backends log "not yet implemented" ★ NICE-TO-HAVE

**File:** `media/index.ts:23,28` — These fall through to `NoopAudioPlayer` with a `console.warn`. Acceptable for Linux-first PR but should be documented as known limitation.

---

## Phase 3 — Documentation Cleanup

### D1: Remove old REVISION_PLAN.md ★ DONE (this file replaces it)

### D2: Generalize README.md for upstream ★ MUST-FIX

**Current README** contains:
- Specific IPs: `172.16.1.132`
- Specific UIDs: `1000`
- Specific usernames: `aenertia`
- Specific hostnames: `awa`
- Specific FreeRDP version requirements tied to deployment

**Fix:** Replace all deployment-specific details with generic placeholders (`<remote-host>`, `<your-uid>`, `$(id -u)`) and move deployment examples to a separate `docs/deployment-examples.md` if needed. The upstream README should describe features and usage generically.

Also: the HONK README is appropriate for the **branch** but the upstream PR should integrate voice docs into the existing README structure, not replace the entire file. Keep upstream README format, add a "Voice I/O" section.

### D3: Generalize docs/ssh-audio-setup.md ★ MUST-FIX

Contains: `Host awa`, `HostName 172.16.1.132`, `User aenertia`, specific UID paths.

**Fix:** Replace with generic examples using `<remote-host>`, `<your-user>`, `$(id -u)`.

### D4: Generalize docs/persistent-sessions.md ★ SHOULD-FIX

Less deployment-specific but mentions the provider check limitation. If B4 is fixed, update the known limitation section.

### D5: Evaluate ADR-001 placement ★ SHOULD-FIX

`documentation/docs/ai/ADR-001-accessibility-voice-integration.md` (265 lines) is a forward-looking architectural decision record. Good content, but:
- References deployment-specific details (Sisyphus session author)
- May be premature for upstream PR (no implementation yet)
- Consider moving to a follow-up PR or keeping as a reference without including in the diff

### D6: Keep documentation/voice-audio-architecture.md ★ KEEP

Clean technical doc explaining AudioContext usage and the setSinkId gap. Good upstream content — no deployment-specific details.

### D7: Verify AGENTS.md exclusion ★ VERIFY

AGENTS.md files use `--skip-worktree` and `.git/info/exclude`. Verify they don't appear in the diff against upstream. They should NOT be in any PR.

---

## Phase 4 — PR Preparation

### Revised PR Split Strategy

**PR1: Rust Backend — TTS + Dictation + HONK Extension**

Scope: All `crates/` changes.

Files:
- `crates/goose/src/tts/` — providers.rs, profiles.rs, mod.rs
- `crates/goose/src/dictation/providers.rs` — enhanced with ElevenLabs, Groq, model-native, local
- `crates/goose/src/acp/server/tts.rs` — TTS ACP handlers
- `crates/goose/src/acp/server/dictation.rs` — dictation ACP handlers
- `crates/goose/src/acp/server/custom_dispatch.rs` — dispatch routing
- `crates/goose/src/agents/platform_extensions/honk.rs` — HONK extension
- `crates/goose/src/agents/platform_extensions/mod.rs` — registration
- `crates/goose/src/skills/builtins/honk-*.md` — conversation skills
- `crates/goose-sdk-types/src/custom_requests.rs` — ACP wire types
- `crates/goose-provider-types/src/formats/*.rs` — audio content support
- `crates/goose-provider-types/src/conversation/message.rs` — message types
- `crates/goose/src/providers/formats/bedrock.rs` — audio format support

Prerequisite work (do before PR1):
- [ ] C1: Extract shared HTTP client builder
- [ ] C2: Extract shared ModelNativeResolved
- [ ] B1: Fix MIME type mismatches
- [ ] B2: Fix unwrap panic
- [ ] B3: Remove or wire `honk_announce`
- [ ] B5: Make model/voice configurable (at minimum OpenAI TTS model)

Does NOT include: CLI changes, systemd, docs, UI.

**PR2: Desktop UI — Voice Settings + Hooks + Services**

Scope: All `ui/desktop/` changes.

Files:
- `ui/desktop/src/hooks/` — useAudioPlayer, useAudioRecorder, useVad, useConversationMode
- `ui/desktop/src/components/settings/voice/` — 13 settings components (2089 lines)
- `ui/desktop/src/components/settings/dictation/` — DictationSettings
- `ui/desktop/src/components/ChatInput.tsx` — voice button integration
- `ui/desktop/src/components/GooseMessage.tsx` — audio content rendering
- `ui/desktop/src/services/` — audioDevices, globalShortcuts, mediaControl, mediaInhibit, sileroVad, vadEngines, voiceIndicator
- `ui/desktop/src/acp/tts.ts` — TTS client
- `ui/desktop/src/types/` — tts.ts, dictation.ts, message.ts
- `ui/desktop/src/i18n/messages/*.json` — 16 locales with voice strings
- `ui/desktop/public/models/silero_vad_v6.onnx` — Silero v6 model
- `ui/desktop/public/aec-worklet.js` — echo cancellation worklet
- `ui/desktop/package.json` — new dependencies

Depends on: PR1 merged (backend ACP endpoints must exist).

**PR3: Text TUI + Shared Package + CLI + Docs**

Scope: `ui/text/`, `ui/shared/`, CLI changes, docs, contrib.

Files:
- `ui/shared/` — @aaif/voice-shared package (constants, types, vadEngine, encoding, vad, sentenceBoundary)
- `ui/text/src/services/media/` — detection, gstreamerBackend, ffmpegBackend, pacatBackend, noopBackend, types, index
- `ui/text/src/services/vadEngines/` — sileroNodeEngine + model
- `ui/text/src/tui.tsx` — voice lifecycle integration
- `ui/text/src/voiceSession.ts`, `voiceState.ts` — voice state management
- `ui/text/src/slashCommands.tsx` — /honk, /tts, /detach commands
- `ui/text/src/components/Header.tsx` — voice phase indicator
- `crates/goose-cli/src/cli.rs` — --attach, --serve-url, --list-remote flags
- `crates/goose-cli/src/commands/serve_ctl.rs` — ensure_serve_running()
- `contrib/systemd/` — goose-serve.service + install.sh
- `docs/` — ssh-audio-setup.md, persistent-sessions.md
- `ui/pnpm-workspace.yaml` — shared package registration
- `ui/pnpm-lock.yaml` — lockfile update

Prerequisite work (do before PR3):
- [ ] B4: Fix CLI pre-dispatch provider check
- [ ] C3: MediaCapabilities defaults factory
- [ ] D2: Generalize README voice sections
- [ ] D3: Generalize docs/ssh-audio-setup.md
- [ ] D4: Update docs/persistent-sessions.md

Depends on: PR1 merged (shared voice constants reference backend types).

### Commit Squash Strategy

79 commits → target 2-3 per PR:

**PR1:** 2 commits
1. `feat(voice): TTS + dictation providers with profile system`
2. `feat(voice): HONK platform extension with conversation skills`

**PR2:** 2 commits
1. `feat(desktop): voice settings UI with provider/profile management`
2. `feat(desktop): conversation mode, VAD, AEC, and voice hooks`

**PR3:** 3 commits
1. `feat(shared): @aaif/voice-shared constants, types, and VAD engine interface`
2. `feat(tui): PipeWire voice pipeline with GStreamer/ffmpeg/pacat backends`
3. `feat(cli): persistent sessions with --attach, --serve-url, --list-remote`

---

## Phase 5 — Testing Before PR Submission

### T1: Verify all prior P0 fixes ★ MUST

- [ ] P0-1 (MIME types) — after B1 fix, test ElevenLabs and model-native TTS playback
- [ ] P0-3 (path traversal) — already tested in unit tests at profiles.rs:163-179
- [ ] P0-4 (URL injection) — verify urlencoding works with special chars
- [ ] P0-5 (AudioContext reuse) — verify singleton pattern in useAudioPlayer.ts
- [ ] P0-7 (unwrap panic) — after B2 fix, test with invalid provider

### T2: End-to-end voice pipeline ★ MUST

- [ ] TUI voice on local Linux (PipeWire): record → transcribe → respond → speak
- [ ] Desktop voice: same flow in Electron
- [ ] /honk on → conversation loop → /honk off

### T3: SSH + persistent session flow ★ SHOULD

- [ ] `goose session --attach` without provider config (after B4 fix)
- [ ] `goose session --list-remote` without provider config
- [ ] SSH audio forwarding end-to-end
- [ ] `/detach` → reconnect cycle

### T4: CI gates ★ MUST

- [ ] `cargo fmt --check`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test` (expect 4 pre-existing GCP/JWT failures)
- [ ] `pnpm typecheck` + `eslint --max-warnings 0`
- [ ] `just check-acp-schema` (if ACP schema changed)

---

## Summary

| Phase | Items | Effort | Priority |
|-------|-------|--------|----------|
| **1. Consolidation** | C1-C5 | 2-3 hours | Before PR |
| **2. Bug Fixes** | B1-B7 | 3-4 hours | Before PR |
| **3. Docs Cleanup** | D1-D7 | 1-2 hours | Before PR |
| **4. PR Prep** | Squash + split | 2-3 hours | After 1-3 |
| **5. Testing** | T1-T4 | 2-3 hours | After 1-3 |

**Total estimated:** 10-15 hours of focused work before PR submission.

**Critical path:** C1 + C2 (consolidation) → B1-B4 (must-fix bugs) → D2-D3 (docs generalization) → squash → PR1 submission.
