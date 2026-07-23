# HONK! Voice/TTS Revision Plan

Synthesized from adversarial review by 5-member team.

## TODOs

### P0 — Must Fix Before Merge

- [ ] P0-1+2: Fix AudioContext lifecycle — reuse single context across chunks, cache decoded AudioBuffer (not ArrayBuffer) to prevent buffer detachment after decodeAudioData()
- [ ] P0-3: Wire handleStreamFinish from useConversationMode into useChatSession's onStreamFinish so the conversation loop (speak→listen cycle) actually triggers
- [ ] P0-4: Harden profile API key storage — use opaque key (sha256 of id) not predictable name, set 0600 on profile JSON files

### P1 — Should Fix Before Merge

- [ ] P1-5: Remove HTTP calls during synthesis — move auto_detect_default_voice() to list_voices() / config time, never call during synthesize_openai()
- [ ] P1-6: Unify config key casing — all voice preferences must use the same casing path end-to-end (raw config lowercase matches what frontend writes)
- [ ] P1-7: Rename synthesize_openai to synthesize_openai_compatible, make model/response_format configurable per profile
- [ ] P1-8: Replace developer-facing test status with user-facing messages ("Playing..." / "Failed — check endpoint URL")

### P2 — Fix Soon After Merge

- [ ] P2-9: Extract TtsSettings.tsx sub-components (885 lines → ProfileEditor, ProviderSelector, TestSection, DeviceSelector)
- [ ] P2-10: Squash diagnostic commits before upstream PR
- [ ] P2-11: Document/fix AudioContext output device — setSinkId is HTMLAudioElement-only, document limitation or use AudioContext sinkId constructor option
- [ ] P2-12: Strip .wav/.mp3 extensions from voice display names in list_custom_endpoint_voices()

## Final Verification Wave

- [ ] FV-1: cargo clippy -- -D warnings passes clean on koero
- [ ] FV-2: pnpm typecheck passes clean on koero
- [ ] FV-3: Build Electron app and deploy to emiemi, verify HONK! conversation loop completes end-to-end
