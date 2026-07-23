# ADR-001: Desktop Accessibility Integration with Voice I/O Pipeline

**Status**: Proposed  
**Date**: 2026-07-23  
**Author**: aenertia (via Sisyphus research session)  
**Scope**: Voice pipeline (TUI + Electron), Platform Extensions, HONK Conversation Skill  
**Depends on**: pw-loopback architecture, Silero VAD, module-echo-cancel, voice.rs Platform Extension

## Context

The goose voice pipeline now provides full-duplex voice I/O: PipeWire pw-loopback persistent nodes, module-echo-cancel (WebRTC AEC3), Silero VAD, NLMS adaptive echo canceller (Electron), barge-in with echo-suspect classification, and a voice Platform Extension with `voice_status`/`voice_announce`/`voice_mode` tools. The HONK conversation skill instructs the LLM to produce plain spoken text with escalating tool confirmation tiers.

This ADR evaluates how the voice pipeline interacts with — and could integrate with — desktop accessibility interfaces across platforms. The question is bidirectional:

1. **Goose as accessibility OUTPUT**: Can goose act as a screen reader alternative, reading UI content and speaking it via Piper TTS through our PipeWire pipeline?
2. **Goose as accessibility INPUT**: Can goose act as a voice control system, interpreting natural language commands and dispatching them as AT-SPI2 actions, uinput events, or AXUIElement operations?
3. **Goose as accessibility-AWARE**: Should goose detect active screen readers and adapt its behavior (switch from HONK always-listening to push-to-talk, route responses as accessibility announcements)?

## Decision

**Adopt a three-layer architecture: new `accessibility.rs` Platform Extension + `accessible-conversation.md` builtin skill + voice extension coordination via shared session state.**

Voice and accessibility are orthogonal concerns that coordinate through the existing MOIM (Message Of Immediate Moment) system and session `extension_data`. They should NOT be merged into a single extension.

## Platform Analysis (Priority Order)

### 1. Linux (Wayland) — Primary Target

#### AT-SPI2 (all desktops)

AT-SPI2 runs on a dedicated D-Bus bus (not the session bus). Applications register as providers via `org.a11y.atspi.Accessible` interfaces; AT clients register via `org.a11y.atspi.Registry.RegisterEvent`. The protocol is **fully bidirectional** — an application can simultaneously be a provider (exposing its own UI) and a client (reading other apps' UIs).

**Key D-Bus interfaces for goose:**

| Interface | Use as OUTPUT (reading) | Use as INPUT (controlling) |
|---|---|---|
| `org.a11y.atspi.Text` | Read text content of focused element | — |
| `org.a11y.atspi.Accessible` | Get Name, Role, State of any element | — |
| `org.a11y.atspi.Component` | Get screen position, size | GrabFocus on target element |
| `org.a11y.atspi.Action` | — | DoAction (click, activate) |
| `org.a11y.atspi.EditableText` | — | InsertText, SetTextContents |
| `org.a11y.atspi.DeviceEventController` | — | generate_keyboard_event (synthesize keys) |
| `org.a11y.atspi.Collection` | Query elements by role/state criteria | — |

**AT-SPI2 works on Wayland today** — it's D-Bus-based, display-server-independent. Gaps exist only for keyboard event interception (requires Mutter's `org.freedesktop.a11y.KeyboardMonitor`) and pointer location tracking.

**Newton project** (GNOME STF funded): Next-generation Wayland-native accessibility replacing AT-SPI2. Push-based, per-surface trees, compositor-mediated, synchronized with visual frames. Currently a working prototype — monitor but don't target yet.

**Voice control integration**: Two layers available:
- **Semantic actions via AT-SPI2**: "Click Save" → find element with Name="Save", Role=BUTTON → `DoAction(0)`
- **Raw input via `/dev/uinput`**: "Press Ctrl+S" → emit kernel input events (works on X11, Wayland, and TTYs). Tools: `dotool`, `ydotool`. User must be in `input` group.

#### Speech-Dispatcher

Speech-dispatcher is the standard Linux speech synthesis abstraction. Orca sends text to speechd, which routes to output modules (espeak, piper, etc.).

**Three integration paths for Piper TTS as speechd module:**

| Path | Complexity | Latency |
|---|---|---|
| `sd_generic` module with `pw-play` shell command | Low — config file only | High — process spawn per utterance |
| Native C module implementing `module_speak_sync()` | Medium — C/Rust FFI | Low — direct audio output |
| Pipe protocol module (any language) | Medium — stdin/stdout protocol | Medium |

**Recommended**: `sd_generic` with `pw-play` for initial integration. The config is a single file:
```ini
GenericExecuteSynth "printf %s '$DATA' | piper --model /path/$VOICE --output-raw | pw-play --rate 22050 --channel-map LE --properties='media.role=Accessibility' -"
```

This routes Orca's speech through Piper → PipeWire with accessibility media role.

#### PipeWire Accessibility Audio

PipeWire has a **first-class `media.role = "Accessibility"` value**. WirePlumber's role-based routing policy can:
- Duck all lower-priority audio when accessibility TTS speaks
- Mix with other accessibility streams (e.g., Orca + goose both speaking)
- Cork (pause) music/games during screen reader output

**Recommendation**: Set `media.role = "Accessibility"` on goose's TTS PipeWire streams when screen reader integration is active. This gives proper audio priority without the problems `media.role = "Communication"` caused (Sunshine re-negotiation).

#### GNOME vs KDE

Both use AT-SPI2. KDE's Qt accessibility bridge (`qt-at-spi`) translates `QAccessible` to AT-SPI2 D-Bus. KDE recommends Orca as the screen reader. Jovie (KDE TTS) is unmaintained — KDE uses `QTextToSpeech` which backends to speech-dispatcher. **Integration strategy is identical for both desktops.**

### 2. macOS

- **VoiceOver**: Uses `NSAccessibilityProtocol`. Electron apps are accessible out of the box (Chromium maps DOM to NSAccessibility).
- **AXUIElement API**: C-level API for reading any app's accessibility tree. Requires Accessibility permission in System Settings. Can traverse elements, read attributes, perform actions, subscribe to notifications. **This is how goose could read screen content on macOS.**
- **Cannot intercept VoiceOver speech** — no public API. But can inject announcements via `NSAccessibilityPostNotification(.announcementRequested)`.
- **Cannot register Piper as system TTS** — no public API for third-party TTS engines on macOS/iOS.
- **Voice Control**: Ships `.voicecommands` files (property lists). No direct API to register commands. Goose could ship a commands file users import.
- **Integration**: Use `AXUIElement` reader (native addon) for screen context. When VoiceOver is active, switch HONK to push-to-talk to avoid audio conflicts.

### 3. Android

- **TalkBack**: Uses `AccessibilityService` API. An app can **both produce and consume** accessibility events. Full capabilities: `getRootInActiveWindow()`, `dispatchGesture()`, `TYPE_ACCESSIBILITY_OVERLAY`, `STREAM_ACCESSIBILITY` for independent volume control.
- **Piper as system TTS engine**: **Fully supported.** Extend `TextToSpeechService`, implement `onSynthesizeText()`, register in manifest. NekoSpeak already demonstrates Piper as Android TTS via ONNX Runtime. Once registered, TalkBack and all apps use it.
- **Integration**: Register Piper as `TextToSpeechService` (P1). Full `AccessibilityService` for screen reading (P2). Use `STREAM_ACCESSIBILITY` for independent volume control.

### 4. iOS

- **VoiceOver**: Uses `UIAccessibility` protocol. Standard UIKit controls are accessible by default.
- **Cannot read other apps' accessibility trees** — no equivalent to `AXUIElement` or `AccessibilityService`.
- **Cannot register third-party TTS engine** — no public API.
- **Magic Tap**: `accessibilityPerformMagicTap()` (two-finger double-tap) is the standard "do the obvious thing" gesture. Map this to HONK toggle.
- **SpeechAnalyzer** (iOS 26, WWDC 2025): New on-device STT API — potential Whisper alternative on Apple platforms.
- **When VoiceOver is active**: Disable HONK always-listening (audio conflicts). Use push-to-talk. Route responses via `UIAccessibility.post(notification: .announcement)`.

### 5. Windows

- **Screen readers (NVDA, JAWS)**: Use IAccessible2 (primary) for Chromium/Electron. UIA is secondary. Electron apps work with screen readers out of the box.
- **SAPI 5 TTS engine registration**: Possible but requires COM `ISpTTSEngine` implementation in C/C++. VoiceBroker project demonstrates bridging external engines to SAPI.
- **OneCore TTS**: Microsoft-signed voices only — cannot register third-party engines.
- **Practical approach**: Run Piper internally in Electron (as we already do). Only pursue SAPI registration for system-wide availability.

## Architecture

### Layer 1: `accessibility.rs` Platform Extension (new)

**Why separate from voice.rs**: Voice (TTS/STT providers, audio streams, PipeWire) and accessibility (AT-SPI2 D-Bus, UI element trees, screen reader detection) are different domains. A user may want accessibility without voice (screen reader + keyboard), or voice without accessibility (sighted user with voice control). Independent enablement, independent MOIM context.

```rust
// crates/goose/src/agents/platform_extensions/accessibility.rs
pub static EXTENSION_NAME: &str = "accessibility";

// Tools:
// a11y_status — detect screen reader, platform, capabilities
// a11y_focused_element — get focused element's name/role/state via AT-SPI2 or platform API
// a11y_screen_context — get accessible tree summary of active window
// a11y_announce — send screen reader announcement

// MOIM injection:
// "Screen reader detected (Orca). Adapt output for screen reader consumption."

// ExtensionState:
pub struct AccessibilityExtState {
    pub screen_reader_active: bool,
    pub screen_reader_name: Option<String>,
    pub platform: String, // "at-spi2", "uia", "nsaccessibility", "none"
}
```

**Implementation approach on Linux**: Use `zbus` crate for direct D-Bus access to the AT-SPI2 accessibility bus (same pattern as the Odilia screen reader). No dependency on pyatspi2 or libatspi.

### Layer 2: `accessible-conversation.md` Builtin Skill (new)

Co-loads with `honk-conversation.md` via the existing skill attachment contract:

```markdown
---
name: accessible-conversation
description: Accessibility-aware conversation mode. Adapts output when screen readers are active.
---

When a11y_status indicates an active screen reader:
- Describe visual elements verbally (images, diagrams, UI layouts)
- Use semantic structure: "heading: ..., paragraph: ..., list item: ..."
- Announce focus changes: "Focus moved to the terminal"
- When reading code, describe structure before content
- Avoid raw formatting that screen readers would read literally
- Use the voice_announce tool to send important updates as screen reader announcements
```

### Layer 3: Voice + Accessibility Coordination

The voice extension's `get_moim()` reads accessibility state from shared session `extension_data`:

```rust
// In voice.rs get_moim():
if let Some(a11y) = AccessibilityExtState::from_extension_data(&session.extension_data) {
    if a11y.screen_reader_active {
        parts.push("Screen reader active. Voice output also sent as announcements.");
    }
}
```

Both extensions inject into the same MOIM `<turn-context>` block. The agent sees both voice and accessibility context on every turn.

### Behavioral Adaptation When Screen Reader Detected

| Behavior | Without Screen Reader | With Screen Reader |
|---|---|---|
| HONK mic mode | Always-listening (barge-in) | Push-to-talk (avoids VoiceOver/Orca audio conflicts) |
| TTS audio role | `media.role = "Music"` (default) | `media.role = "Accessibility"` (priority, ducks other audio) |
| Response routing | TTS only | TTS + platform accessibility announcement |
| Output format | Plain spoken text | Semantically structured spoken text |
| Code display | Verbal description + offer text mode | Always describe structure first |

## Bidirectional Capability Matrix

### Goose as Accessibility SOURCE (providing accessibility services)

| Capability | Linux | macOS | Android | iOS | Windows |
|---|---|---|---|---|---|
| System TTS engine (Piper) | Via speech-dispatcher module | No public API | `TextToSpeechService` | No public API | SAPI 5 (complex COM) |
| Screen reader replacement | AT-SPI2 client (full) | AXUIElement (full) | `AccessibilityService` (full) | Not possible | UIA client (partial) |
| Voice control | AT-SPI2 Actions + uinput | AXUIElement + CGEvent | `dispatchGesture()` | Not possible | UIA + SendInput |

### Goose as Accessibility RECIPIENT (consuming accessibility services)

| Capability | Linux | macOS | Android | iOS | Windows |
|---|---|---|---|---|---|
| Detect screen reader active | `org.a11y.Status.ScreenReaderEnabled` | `AXIsProcessTrusted()` | `AccessibilityManager` | `UIAccessibility.isVoiceOverRunning` | `SystemParametersInfo(SPI_GETSCREENREADER)` |
| Read UI element info | AT-SPI2 `Accessible.Name/Role` | `AXUIElementCopyAttributeValue` | `getRootInActiveWindow()` | Not possible | UIA `IUIAutomation` |
| Receive focus change events | AT-SPI2 `object:state-changed:focused` | `AXObserver` notification | `onAccessibilityEvent` | `voiceOverStatusDidChangeNotification` | UIA event handler |

## HONK Skill vs Extension Decision

| Concern | Extension (Rust, `accessibility.rs`) | Skill (Markdown, `accessible-conversation.md`) | Both |
|---|---|---|---|
| Screen reader detection | D-Bus/API calls — **Extension** | — | Extension detects, skill reacts |
| AT-SPI2 tree traversal | Tool implementation — **Extension** | — | Extension provides tools |
| Output format adaptation | — | Behavioral instructions — **Skill** | Skill adapts based on extension state |
| Speech-dispatcher integration | System config — **Extension** | — | Extension manages module |
| Voice command interpretation | — | LLM reasoning — **Skill** | Skill guides command parsing |
| PipeWire media.role | Audio pipeline — **Extension** | — | Extension sets role |

**Verdict**: Both. Extension handles platform APIs and system integration. Skill handles LLM behavioral adaptation. They coordinate via session `extension_data` and MOIM context injection.

## Implementation Priority

### P0 — Immediate (detect and adapt)
1. Detect screen reader via `org.a11y.Status.ScreenReaderEnabled` (Linux), `isAccessibilitySupportEnabled()` (Electron)
2. Switch HONK to push-to-talk when screen reader active
3. ARIA live regions for conversation output in Electron
4. Set `media.role = "Accessibility"` on TTS PipeWire streams when appropriate

### P1 — Short-term (provide services)
5. `accessibility.rs` Platform Extension with `a11y_status` and `a11y_focused_element` tools
6. `accessible-conversation.md` builtin skill
7. Speech-dispatcher `sd_generic` module config for Piper → PipeWire
8. Android `TextToSpeechService` registration for Piper

### P2 — Medium-term (bidirectional integration)
9. AT-SPI2 client for screen reading (via `zbus` crate)
10. Voice command → AT-SPI2 Action dispatch
11. macOS `AXUIElement` reader (native addon)
12. Full `AccessibilityService` on Android

### P3 — Future
13. Newton protocol support (when GNOME ships it)
14. SAPI 5 engine registration on Windows
15. iOS `SpeechAnalyzer` as Whisper alternative
16. macOS Voice Control `.voicecommands` file

## Risks

1. **AT-SPI2 security on Wayland**: Sandboxed apps (Flatpak) may be denied access to the accessibility bus. Newton addresses this with compositor-mediated access control.
2. **Audio conflicts**: Screen reader + HONK TTS simultaneously is confusing. Must reliably detect and switch to push-to-talk.
3. **Performance**: AT-SPI2 tree traversal can be slow for large UIs (hundreds of elements). Cache aggressively, query only the focused subtree.
4. **Orca interaction**: If both Orca and goose are reading the screen, the user hears double. Need clear mode switching — goose replaces OR supplements Orca, never duplicates.

## References

- [AT-SPI2 D-Bus interfaces](https://github.com/GNOME/at-spi2-core/tree/main/xml)
- [Odilia screen reader (Rust, direct D-Bus)](https://github.com/odilia-app/atspi)
- [Newton accessibility project](https://blogs.gnome.org/a11y/2024/06/18/update-on-newton-the-wayland-native-accessibility-project/)
- [Speech-dispatcher output module protocol](https://github.com/brailcom/speechd)
- [PipeWire media.role values](https://docs.pipewire.org/page_man_pipewire-props_7.html)
- [WirePlumber role-based routing](https://pipewire.pages.freedesktop.org/wireplumber/)
- [Apple AXUIElement API](https://developer.apple.com/documentation/applicationservices/axuielement_h)
- [Android TextToSpeechService](https://developer.android.com/reference/android/speech/tts/TextToSpeechService)
- [NekoSpeak — Piper as Android TTS](https://github.com/siva-sub/NekoSpeak)
- [Numen voice control (Linux)](https://sr.ht/~geb/numen/)
- [Electron accessibility](https://github.com/electron/electron/blob/main/docs/tutorial/accessibility.md)
