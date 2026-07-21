# Voice/TTS Feature — Prioritized Revision Plan

**Branch:** `feat/voice-audio-overhaul`
**Synthesized from:** surface-scanner (34 issues), arch-critic (10 findings), deep-diver (14 findings), ux-challenger (18 issues)
**Cross-referenced, deduplicated, and validity-assessed by:** plan-synthesizer

---

## P0 — Must Fix Before Merge (7 items)

### P0-1: MIME type mismatches cause playback failures
**Found by:** surface-scanner (CRITICAL #4), deep-diver (#7, #8)
**Files:** `crates/goose/src/tts/providers.rs`
**What:** `synthesize_with_model()` (line 620) requests `"format": "mp3"` but returns `"audio/ogg"` (line 702). `synthesize_elevenlabs()` returns `"audio/ogg"` (line 603) but ElevenLabs actually returns `audio/mpeg` by default. AudioContext `decodeAudioData` may silently fail or produce garbled audio when the MIME type doesn't match the actual codec.
**Fix:** Return `"audio/mpeg"` from `synthesize_with_model()`. For ElevenLabs, return `"audio/mpeg"` (or better, read the `Content-Type` response header). For OpenAI with opus format, `"audio/ogg"` is correct — verify this is indeed the format returned.

### P0-2: `isTesting` state never reset for browser TTS — button permanently disabled
**Found by:** surface-scanner (CRITICAL #25)
**Files:** `ui/desktop/src/components/settings/voice/TtsSettings.tsx` (lines 82–94)
**What:** Browser TTS test path sets `setIsTesting(true)` (line 89) but `utterance.onend` only calls `setTestStatus(...)`, never `setIsTesting(false)`. After one browser TTS test, the "Test TTS" button stays disabled forever.
**Fix:** Add `setIsTesting(false)` to both `utterance.onend` and `utterance.onerror` callbacks.

### P0-3: Path traversal in profile ID — file read/write outside config dir
**Found by:** deep-diver (#4)
**Files:** `crates/goose/src/tts/profiles.rs` (lines 42–44, 77–87, 115–124)
**What:** `profile_path(id)` uses `profiles_dir().join(format!("{}.json", id))` without sanitizing `id`. A crafted ID like `../../etc/shadow` from the ACP client could read or delete files outside the profiles directory. `save_profile` auto-generates UUIDs for new profiles but `get_profile`/`delete_profile` accept arbitrary client-provided IDs.
**Fix:** Validate that `id` contains only `[a-zA-Z0-9_-]` characters, or canonicalize the path and verify it's within `profiles_dir()`. Add the same validation in `on_tts_profile_get` and `on_tts_profile_delete`.

### P0-4: ElevenLabs voice_id URL injection
**Found by:** deep-diver (#5)
**Files:** `crates/goose/src/tts/providers.rs` (lines 577–582)
**What:** `synthesize_elevenlabs` interpolates `voice_id` directly into the URL: `format!("{}/v1/text-to-speech/{}", base_url, voice_id)`. A voice ID containing `/../../admin/api` could redirect the request to arbitrary paths.
**Fix:** URL-encode `voice_id` using `urlencoding::encode()` or validate it contains only alphanumeric characters.

### P0-5: AudioContext created per chunk — resource exhaustion
**Found by:** arch-critic (CRITICAL #2), deep-diver (#12)
**Files:** `ui/desktop/src/hooks/useAudioPlayer.ts` (lines 110–143)
**What:** `playBuffer()` creates a new `AudioContext()` for every chunk. Browsers limit concurrent AudioContexts (typically 6). Rapid speak/stop cycles or long multi-chunk responses can exhaust the limit, causing silent failures. The `ctx.close()` in `source.onended` is async and may not complete before the next chunk starts.
**Fix:** Create a single `AudioContext` per `speak()` call and reuse it across chunks. Close it only after all chunks finish or on `stop()`. Consider using `ctx.suspend()`/`ctx.resume()` instead of close/recreate.

### P0-6: Conversation mode loop broken — `handleStreamFinish` never wired
**Found by:** surface-scanner (CRITICAL #30, #32)
**Files:** Multiple UI files in the chat/conversation flow
**What:** The conversation mode state machine relies on `handleStreamFinish` being called when the assistant finishes responding, to trigger auto-speak and re-listen. But the event handler is never connected in the streaming response handler, so conversation mode never progresses past the first turn.
**Fix:** Wire `handleStreamFinish` callback to the stream completion event in the chat message handler. Verify the full conversation loop: listen → transcribe → send → stream response → speak → re-listen.

### P0-7: `unwrap()` panic in `get_tts_provider_def`
**Found by:** surface-scanner (HIGH #5)
**Files:** `crates/goose/src/tts/providers.rs` (lines 82–86)
**What:** `PROVIDERS.iter().find(...).unwrap()` will panic if called with a provider not in `PROVIDERS` and not Browser/ModelNative. While current code paths check Browser/ModelNative first, any future provider addition could trigger this.
**Fix:** Return `Result<&'static TtsProviderDef>` instead of using `.unwrap()`, or add a comprehensive match.

---

## P1 — Should Fix Before Merge (15 items)

### P1-1: Concurrent `speak()` calls race on module-level globals
**Found by:** deep-diver (#1), arch-critic (#4)
**Files:** `ui/desktop/src/hooks/useAudioPlayer.ts` (lines 15–21)
**What:** `globalSource`, `globalCtx`, `globalStopped` are module-level mutable variables. If two components call `speak()` simultaneously, or `stop()` races with an in-progress synthesis, audio chunks from different calls can interleave. The `stop()` → `speak()` sequence has a TOCTOU window where `globalStopped` is set to `false` after `stop()` sets it to `true`.
**Fix:** Use an AbortController pattern or a monotonically increasing generation counter. Each `speak()` increments the counter; chunks check their generation before playing.

### P1-2: ElevenLabs speed parameter silently dropped
**Found by:** deep-diver (#9)
**Files:** `crates/goose/src/tts/providers.rs` (line 362, 540–604)
**What:** `synthesize_elevenlabs()` accepts `overrides` but ignores the `speed` parameter entirely. The ElevenLabs API supports `stability` and `similarity_boost` but not a direct speed parameter — the UI speed slider does nothing for ElevenLabs users.
**Fix:** Either pass speed as a query parameter if the ElevenLabs API supports it, or disable the speed slider when ElevenLabs is selected and show an explanatory message.

### P1-3: Auto-detect voice called in synthesis hot path
**Found by:** arch-critic (MAJOR #6), deep-diver (#11), surface-scanner (#8)
**Files:** `crates/goose/src/tts/providers.rs` (line 460)
**What:** `auto_detect_default_voice()` makes 2 HTTP requests to the custom endpoint on every synthesis call when no voice is selected. This adds 100ms+ latency per chunk, multiplied by the number of chunks.
**Fix:** Cache the auto-detected voice after first discovery (per endpoint URL). Clear cache when endpoint URL changes.

### P1-4: Hardcoded model and voice values not configurable
**Found by:** surface-scanner (#1, #2, #3)
**Files:** `crates/goose/src/tts/providers.rs` (lines 466, 562–564, 624)
**What:** OpenAI always uses `"tts-1"` model. ElevenLabs falls back to hardcoded voice ID `"21m00Tcm4TlvDq8ikWAM"`. Model-native TTS hardcodes `"alloy"` voice and `"mp3"` format.
**Fix:** Make model and default voice configurable via config params. At minimum, expose the OpenAI TTS model selection in settings.

### P1-5: Config key casing inconsistency creates split-brain risk
**Found by:** surface-scanner (#14), arch-critic (CRITICAL #3)
**Files:** `ui/desktop/src/components/settings/voice/TtsSettings.tsx`, `crates/goose/src/tts/providers.rs`
**What:** Frontend uses `voice_tts_endpoint_url` (snake_case) while some backend paths use `OPENAI_BASE_URL` (SCREAMING_CASE). The `handleSaveKey` function uses `upsert('OPENAI_API_KEY', ...)` directly via ConfigContext instead of the dedicated `saveTtsSecret` ACP endpoint, creating two parallel key-management paths.
**Fix:** Centralize all config key names in a shared constants module. Use the ACP endpoints consistently instead of direct ConfigContext access for secrets.

### P1-6: Debug/diagnostic output shown to end users in Test TTS
**Found by:** surface-scanner (#24), ux-challenger (MAJOR #4)
**Files:** `ui/desktop/src/components/settings/voice/TtsSettings.tsx` (lines 110–117)
**What:** Test TTS shows raw diagnostic info: `"Decoded 48230B, magic=[4f 67 67 53]. Creating AudioContext..."`. This is developer-facing output, not user-facing.
**Fix:** Show simple status messages: "Synthesizing...", "Playing...", "Success!", "Failed: [reason]". Move diagnostic details to console.log or a collapsible "Details" section.

### P1-7: Audio output device selection is dead code
**Found by:** surface-scanner (CRITICAL #17), deep-diver (bonus)
**Files:** `ui/desktop/src/hooks/useAudioPlayer.ts` (lines 22–30), `TtsSettings.tsx` (lines 617–656)
**What:** `setAudioOutputDevice`/`getAudioOutputDevice` store a device ID in a module variable, but `playBuffer()` never uses it — audio always plays through `ctx.destination` (system default). The UI selector is visible but non-functional.
**Fix:** Either implement `setSinkId()` on the AudioContext/HTMLAudioElement to actually route audio to the selected device, or remove the device selector UI until implementation is ready.

### P1-8: No conversation mode state indicator
**Found by:** ux-challenger (BLOCKER #3)
**Files:** Chat UI components
**What:** When conversation mode is active, there's no visual indicator of the current state (listening → processing → speaking → waiting). Users can't tell if the system is ready for input or still processing.
**Fix:** Add a state indicator (e.g., pulsing mic icon for listening, spinner for processing, speaker icon for speaking).

### P1-9: Two adjacent voice buttons confusing
**Found by:** ux-challenger (BLOCKER #2)
**Files:** Chat input area components
**What:** There are two voice-related buttons near the input area with similar icons, making it unclear which starts dictation vs. conversation mode vs. speak.
**Fix:** Consolidate into one primary voice button with a clear dropdown/long-press for mode selection.

### P1-10: Profile storage TOCTOU race condition
**Found by:** deep-diver (#3), arch-critic (#5)
**Files:** `crates/goose/src/tts/profiles.rs` (lines 115–124)
**What:** `delete_profile` checks `path.exists()` then calls `fs::remove_file()` without atomic guarantees. Concurrent profile operations from multiple UI windows could corrupt profile state.
**Fix:** Use file locking (e.g., `fs2::FileExt`) or atomic operations. For delete, just call `fs::remove_file` and handle `NotFound` gracefully.

### P1-11: Endpoint probe order inconsistency
**Found by:** deep-diver (#10)
**Files:** `crates/goose/src/tts/providers.rs`
**What:** `list_custom_endpoint_voices` probes `/v1/audio/voices` first then `/get_reference_files`, but `auto_detect_default_voice` probes `/get_reference_files` first then `/v1/audio/voices`. This inconsistency means the "default" voice discovered may come from a different endpoint than the voice list.
**Fix:** Standardize probe order in both functions to be identical.

### P1-12: No error boundary in conversation loop
**Found by:** arch-critic (#9)
**Files:** Conversation mode state machine
**What:** If TTS synthesis or playback throws during conversation mode, there's no recovery — the loop dies silently and the user is left in a broken state with no feedback.
**Fix:** Wrap the conversation loop body in try/catch. On failure, show an error toast, reset to idle state, and give the user a "Retry" option.

### P1-13: Unbounded audio sample accumulation in memory
**Found by:** deep-diver (#14)
**Files:** `ui/desktop/src/hooks/useAudioPlayer.ts` (lines 19–20, 95–101)
**What:** `globalCache` (Map) and `globalCacheOrder` (array) store decoded audio ArrayBuffers. The cache limit is 50 entries, but each entry can be megabytes of raw audio data. A long session could accumulate hundreds of MB.
**Fix:** Add a byte-size limit to the cache (e.g., 50MB total). Evict by size, not just count.

### P1-14: Auto-speak and conversation mode coupling hidden
**Found by:** ux-challenger (#13)
**Files:** `ui/desktop/src/components/settings/voice/VoiceSettingsSection.tsx`
**What:** Enabling conversation mode implicitly requires auto-speak to be on, but there's no UI indication of this dependency. A user could enable conversation mode but leave auto-speak off, resulting in a confusing experience.
**Fix:** When conversation mode is selected, auto-enable auto-speak and show a note explaining why. Or make auto-speak a sub-setting that's always on in conversation mode.

### P1-15: Speed validation inconsistency between frontend and backend
**Found by:** surface-scanner (HIGH #11)
**Files:** `TtsSettings.tsx` (slider min=0.25, max=4.0), `providers.rs` (line 38: `if req.speed <= 0.0 { 1.0 }`), `profiles.rs` (line 101: `clamp(0.25, 4.0)`)
**What:** Three different validation rules in three different places. Frontend allows 0.25–4.0, backend treats ≤0 as 1.0, profiles clamp to 0.25–4.0.
**Fix:** Centralize validation. Backend should clamp all speeds to 0.25–4.0 consistently, regardless of source.

---

## P2 — Fix Soon After Merge (14 items)

### P2-1: `TtsSettings.tsx` is an 885-line god component
**Found by:** arch-critic (MAJOR #7)
**Files:** `ui/desktop/src/components/settings/voice/TtsSettings.tsx`
**Fix:** Extract into: `ProviderSelector`, `ApiKeyManager`, `VoiceSelector`, `SpeedControl`, `TestTtsPanel`, `ProfileEditor`, `ProfileList`.

### P2-2: Duplicated TLS/HTTP client construction
**Found by:** surface-scanner (#6), arch-critic (#8)
**Files:** `crates/goose/src/tts/providers.rs` (lines 473–496 and 630–651)
**Fix:** Extract a `build_tts_http_client(config)` helper function.

### P2-3: Duplicated b64-to-ArrayBuffer logic
**Found by:** surface-scanner (#15)
**Files:** `TtsSettings.tsx` (lines 112–116), `useAudioPlayer.ts` (lines 32–37)
**Fix:** Extract to a shared utility function.

### P2-4: Edit profile button uses Save (floppy disk) icon
**Found by:** surface-scanner (#23), ux-challenger implied
**Files:** `TtsSettings.tsx` (line 751)
**Fix:** Replace `<Save>` with `<Pencil>` or `<Edit>` icon from lucide-react.

### P2-5: No delete confirmation for profiles
**Found by:** surface-scanner (#18)
**Files:** `TtsSettings.tsx` (line 342)
**Fix:** Add a confirmation dialog before profile deletion.

### P2-6: Profile editor uses free-text voice input instead of voice selector
**Found by:** Own analysis during synthesis
**Files:** `TtsSettings.tsx` (lines 832–837)
**Fix:** Reuse the voice list dropdown from the main settings, filtered by the profile's selected provider.

### P2-7: Weak provider typing — `string` used instead of union type
**Found by:** surface-scanner (#33, #34)
**Files:** `ui/desktop/src/types/tts.ts` (line 6: `provider: string`), multiple TS files
**Fix:** Use `TtsProvider` union type consistently throughout the codebase.

### P2-8: Config values stored as strings requiring constant parsing
**Found by:** surface-scanner (#16)
**Files:** `VoiceSettingsSection.tsx`, `useAudioPlayer.ts`
**Fix:** Store numeric config values as numbers, booleans as booleans.

### P2-9: Module-level mutable state in useAudioPlayer should use refs
**Found by:** arch-critic implied
**Files:** `ui/desktop/src/hooks/useAudioPlayer.ts` (lines 15–21)
**Fix:** Move `globalSource`, `globalCtx`, `globalStopped` into a React ref or a singleton class.

### P2-10: Cache key includes full text — no hashing
**Found by:** Own analysis
**Files:** `useAudioPlayer.ts` (line 80)
**Fix:** Hash the text portion of the cache key to avoid unbounded key sizes in the Map.

### P2-11: No user-facing error feedback on synthesis failure
**Found by:** surface-scanner (#27)
**Files:** `useAudioPlayer.ts` (line 103)
**Fix:** Surface errors as toast notifications instead of silent `console.error`.

### P2-12: Profiles section too complex for basic users
**Found by:** ux-challenger (MAJOR #6)
**Files:** `TtsSettings.tsx`
**Fix:** Hide profiles behind an "Advanced" toggle. Most users only need provider + voice + speed.

### P2-13: Audio device selector shown even when non-functional
**Found by:** ux-challenger (MAJOR #7)
**Fix:** Remove the device selector UI until P1-7 (actual device routing) is implemented.

### P2-14: "Model (Native Audio)" is jargon
**Found by:** ux-challenger (MINOR #11)
**Files:** `TtsSettings.tsx` (line 33)
**Fix:** Rename to "Your AI Model" or "Chat Model Voice" with a tooltip explaining it uses the active model's audio output.

---

## P3 — Backlog (12 items)

### P3-1: Voice preview/sample playback in voice selector
**Found by:** ux-challenger (#10)
**Fix:** Add a small play button next to each voice in the dropdown to preview it.

### P3-2: Silence threshold real-time preview
**Found by:** ux-challenger (#7)
**Fix:** Play a short audio clip showing what the silence threshold feels like.

### P3-3: Platform-specific microphone permission error handling
**Found by:** ux-challenger (#8)
**Fix:** Show OS-specific instructions when mic permission is denied.

### P3-4: Speed control audible preview
**Found by:** ux-challenger (#9)
**Fix:** Play a short sample at the selected speed when the slider changes.

### P3-5: "Settings > Models" text should be a clickable link
**Found by:** ux-challenger (MAJOR #5)
**Fix:** Make the settings path reference an actual navigation link.

### P3-6: No debounce on `beginListening` in conversation mode
**Found by:** surface-scanner (#29)
**Fix:** Add a 100ms debounce to prevent rapid re-listen triggers.

### P3-7: Tooltip text duplicated as inline description
**Found by:** surface-scanner (#22), ux-challenger (#15)
**Fix:** Show tooltip OR inline text, not both.

### P3-8: Unused `_isLoading` parameter
**Found by:** surface-scanner (#31)
**Fix:** Remove or use the parameter.

### P3-9: No limit on number of profiles
**Found by:** surface-scanner (#19)
**Fix:** Add a reasonable limit (e.g., 20 profiles) with a message.

### P3-10: No auth forwarding on custom endpoint probing
**Found by:** deep-diver (#6)
**Assessment:** Intentional design — probing endpoints that may not require auth. Low risk since endpoints are user-configured.
**Fix:** Optionally forward the configured API key as a Bearer token during voice discovery.

### P3-11: Split strategy in wrong architectural layer
**Found by:** arch-critic (#10)
**Fix:** Move split strategy logic entirely to the frontend (it's a UI concern about chunking, not a backend concern).

### P3-12: No retry logic on synthesis failures
**Found by:** Own analysis
**Fix:** Add 1 retry with exponential backoff on transient HTTP errors (5xx, timeout).

---

## Validity Assessment — Overblown Critiques

| Finding | Reviewer | Assessment |
|---------|----------|------------|
| "HONK! branding undiscoverable" | ux-challenger | **Overblown** — HONK! is easter-egg flavor text in test strings, not a user-facing brand. No action needed. |
| "No auth on custom endpoint probing" | deep-diver | **Overblown** — Custom endpoints are user-configured local services (F5-TTS, Piper). Unauthenticated probing is expected behavior. Downgraded to P3. |
| "Split strategy in wrong layer" | arch-critic | **Overblown** — While architecturally impure, the current approach works fine. The backend doesn't need to know about splitting; it's a frontend UX optimization. Downgraded to P3. |
| "No limit on profiles" | surface-scanner | **Overblown** — Profiles are stored as individual JSON files. Even 100 profiles is negligible disk usage. Downgraded to P3. |

---

## Summary

| Priority | Count | Theme |
|----------|-------|-------|
| **P0** | 7 | Security (path traversal, URL injection), correctness (MIME types, broken conversation loop, stuck UI), stability (AudioContext exhaustion, panic) |
| **P1** | 15 | Race conditions, UX confusion, dead code, data integrity, performance |
| **P2** | 14 | Code quality, component decomposition, typing, user experience polish |
| **P3** | 12 | Nice-to-haves, preview features, architectural purity |

**Recommended merge gate:** All P0 items fixed. P1-1 (race condition), P1-7 (dead code removal), and P1-8/P1-9 (UX blockers) should also be addressed before merge.
