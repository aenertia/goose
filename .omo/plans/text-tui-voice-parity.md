# Text TUI Voice Parity — GStreamer + PipeWire Media Architecture

**Status**: Plan  
**Branch**: feat/voice-audio-overhaul  
**Depends on**: Streaming TTS pipeline (complete), HONK conversation mode (complete)  
**Target platforms**: RHEL 10.2, Fedora 42+ (primary); macOS, Windows (secondary)  
**Required formats**: opus, wav (mandatory); mp3, ogg, flac, pcm (optional, free via GStreamer)  
**New npm dependencies**: NONE — all media I/O via system GStreamer CLI + child_process spawn  
**Principle**: Detect capabilities at runtime, hide unavailable features in UI

## Goal

Bring full voice/TTS/STT parity to the Goose text TUI (`ui/text/`), using GStreamer as the primary media framework with PipeWire integration. Behave as a proper desktop application — persistent named audio streams, per-app volume control via KDE/GNOME mixer, no pop-in/pop-out. Architecture the media layer as a reusable pattern extensible to screen capture, camera, and other media I/O.

## Why GStreamer over pacat/pw-play

| Concern | pacat/pw-play approach | GStreamer approach |
|---|---|---|
| **Format support** | PCM only — must decode opus/wav before feeding | Handles opus, wav, mp3, ogg, flac natively via plugins |
| **Codec management** | We decode (opusscript WASM? ffmpeg spawn?) | GStreamer's `decodebin` auto-detects and decodes |
| **RHEL/Fedora presence** | pacat: `pulseaudio-utils` package | GStreamer 1.24+: ships with desktop install |
| **Persistent stream** | Spawn pacat once, feed stdin | Pipeline stays in PLAYING/PAUSED, single PipeWire node |
| **PipeWire naming** | `--client-name` flag | `pipewiresink` properties: `client-name`, `stream-properties` |
| **Extensibility** | Audio only | Same pipeline model for video (screen capture), camera |
| **Node.js integration** | stdin pipe (simple but fragile) | `gst-kit` N-API bindings or `gst-play-1.0` spawn |
| **Volume control** | pactl set-sink-input-volume | GStreamer `volume` element in pipeline |
| **Format switching** | Kill and restart pacat with new format | Reconfigure `appsrc` caps, `decodebin` adapts |

### RHEL 10.2 / Fedora 42+ GStreamer packages (all in base repos)

| Package | Provides | Installed by default? |
|---|---|---|
| `gstreamer1` | Core framework, `gst-launch-1.0`, `gst-inspect-1.0` | Yes (GNOME/KDE dep) |
| `gstreamer1-plugins-base` | `wavparse`, `opusdec`, `vorbisdec`, `audioconvert`, `audioresample`, `autoaudiosink`, `playbin` | Yes |
| `gstreamer1-plugins-good` | `pulsesink`, `flacparse`, `wavenc` | Yes |
| `pipewire-gstreamer` | `pipewiresink`, `pipewiresrc` | Yes (PipeWire dep) |
| `gstreamer1-plugins-bad-free` | Extra decoders | Usually yes |
| `gstreamer1-plugins-ugly-free` | MP3 (`mpg123audiodec`) | Optional |

opus and wav decoding are in `gstreamer1-plugins-base` — guaranteed present on any RHEL/Fedora desktop.

## Architecture Decision: GStreamer Persistent Pipeline

### The Problem (same as before)

Spawning `pw-play`/`ffplay`/`gst-play-1.0` per TTS chunk creates ephemeral PipeWire nodes. Mixer entries flicker, volume resets, audible gaps.

### The Solution

Create a **persistent GStreamer pipeline** at app startup with `appsrc` as the input element. The pipeline stays alive for the session. Each TTS chunk (opus or wav bytes) is pushed into `appsrc` as a GStreamer buffer. `decodebin` auto-detects the format and decodes. Audio flows through `audioconvert` → `audioresample` → `pipewiresink` which registers a single persistent PipeWire node named "Goose".

### Pipeline Architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │              GStreamer Pipeline (persistent)         │
                    │                                                     │
  TTS chunk ───►  [appsrc] ──► [decodebin] ──► [audioconvert] ──►       │
  (opus/wav        name=src     auto-detect     normalize to             │
   bytes)          caps=ANY     opus→PCM        pipeline format          │
                               wav→PCM                                   │
                               mp3→PCM          [volume] ──►             │
                                                 gain=1.0                │
                                                                         │
                                                [audioresample] ──►      │
                                                 match sink rate         │
                                                                         │
                                                [pipewiresink] ──►  🔊  │
                                                 client-name=Goose       │
                                                 stream-properties=      │
                                                   media.name=Goose TTS  │
                                                   media.role=Communic.  │
                    └─────────────────────────────────────────────────────┘

  KDE/GNOME mixer shows:
  ┌──────────────────────┐
  │ 🔊 Goose             │
  │ Goose TTS            │
  │ ████████████░░░ 80%  │  ← user adjusts, persists across chunks
  └──────────────────────┘
```

### Chunk Feed Model

Each TTS response from the ACP server is a complete encoded audio file (opus-in-ogg or wav). These arrive as base64 strings. The feed model:

1. Base64 decode → `Buffer` of encoded audio bytes
2. Create GstBuffer, set caps hint (`audio/ogg` for opus, `audio/x-wav` for wav)
3. Push buffer into `appsrc` via `push-buffer` signal
4. `decodebin` probes format, selects decoder, outputs raw PCM
5. PCM flows through `audioconvert` → `volume` → `audioresample` → `pipewiresink`
6. Between chunks: pipeline stays in PLAYING state (PipeWire node stays registered)
7. On silence (no chunks for >2s): pipeline can PAUSE (PipeWire node stays visible but corked)

### Format Switching

When the user changes TTS format (opus↔wav) mid-session, `decodebin` handles it automatically — each chunk is a self-contained file with its own headers. No pipeline reconfiguration needed.

## Node.js GStreamer Integration (zero npm deps)

All media I/O is via `child_process.spawn()` of system-installed GStreamer CLI tools. No native addons, no N-API bindings, no build-time dev headers. Runtime detection only.

### Primary: Persistent `gst-launch-1.0` pipeline (spawn once, feed stdin)

Spawn a single long-lived `gst-launch-1.0` process per audio direction (playback/capture). Feed encoded audio bytes to stdin. The process registers a persistent PipeWire node that lives for the session.

**Playback pipeline** (TTS output — accepts opus/wav/mp3 on stdin):

```bash
gst-launch-1.0 -q \
  fdsrc fd=0 \
  ! decodebin \
  ! audioconvert \
  ! audioresample \
  ! volume name=vol \
  ! pipewiresink client-name=Goose \
     stream-properties="props,media.name=Goose TTS,media.role=Communication"
```

**Capture pipeline** (mic input — emits PCM on stdout):

```bash
gst-launch-1.0 -q \
  pipewiresrc client-name=Goose \
    stream-properties="props,media.name=Goose Mic" \
  ! audioconvert \
  ! audioresample \
  ! audio/x-raw,format=S16LE,rate=16000,channels=1 \
  ! level interval=100000000 \
  ! fdsink fd=1
```

**How chunk feeding works with fdsrc + decodebin:**

Each TTS chunk is a self-contained encoded file (opus-in-ogg has ogg framing headers, wav has RIFF headers). `decodebin` auto-detects format per-segment. For sequential chunks of the same format, the stream is continuous. For format switches (opus→wav), `decodebin` re-probes on the next file header.

If `fdsrc ! decodebin` can't handle concatenated files cleanly (format boundary detection issue), the fallback is per-chunk `gst-launch-1.0` with a shared `PIPEWIRE_NODE` to reattach to the same PipeWire node:

```typescript
// Per-chunk spawn, but reuse PipeWire node via media.name matching
const play = spawn('gst-launch-1.0', ['-q',
  'fdsrc', 'fd=0',
  '!', 'decodebin',
  '!', 'audioconvert',
  '!', 'pipewiresink', 'client-name=Goose',
  `stream-properties=props,media.name=Goose TTS,media.role=Communication`,
], { stdio: ['pipe', 'ignore', 'ignore'] });
play.stdin.write(audioBuffer);
play.stdin.end();
```

WirePlumber groups streams by `application.name` + `media.name` — even if the process is new, the mixer entry identity is preserved if properties match. This gives near-persistent behavior without a truly long-lived process.

### Fallback: `pacat` persistent stdin (no GStreamer)

If `gst-launch-1.0` is not available (unusual on RHEL/Fedora desktop):

```bash
# Playback — PCM only, requires pre-decoding opus→PCM via opusdec CLI
pacat --playback --rate=24000 --channels=1 --format=s16le \
  --client-name=Goose --stream-name="Goose TTS"

# Capture — emits PCM on stdout
pacat --record --rate=16000 --channels=1 --format=s16le \
  --client-name=Goose --stream-name="Goose Mic"
```

When using `pacat`, opus chunks must be decoded first via the `opusdec` CLI tool (from `opus-tools` package):

```bash
opusdec --rate 24000 --force-wav - - < chunk.opus | pacat --playback ...
```

### Last resort: platform-native per-file players

| Platform | Command | Persistent? | Formats |
|---|---|---|---|
| macOS | `afplay <tmpfile>` | No | wav, mp3, aac |
| Windows | `powershell -c "(New-Object Media.SoundPlayer '$f').PlaySync()"` | No | wav only |
| Linux (ALSA only) | `aplay -t raw -f S16_LE -r 24000 -c 1 -` | Persistent stdin | PCM only |

## PipeWire Properties for Mixer Integration

| Property | Value | Effect |
|---|---|---|
| `application.name` | `Goose` | Bold label in mixer |
| `media.name` | `Goose TTS` | Sub-label / stream name |
| `media.class` | `Audio/Playback` | Stream type (auto-set by pipewiresink) |
| `media.role` | `Communication` | KDE/GNOME ducks other media during TTS |
| `application.icon_name` | `goose` | Icon in mixer (if XDG icon installed) |
| `node.name` | `goose-tts-playback` | PipeWire graph node identifier |

Setting `media.role=Communication` gives Goose the same audio priority as Discord/Zoom — the desktop automatically lowers other media volume during TTS.

## Mic Capture (STT Input)

### GStreamer recording pipeline (symmetric with playback)

```
[pipewiresrc] ──► [audioconvert] ──► [audioresample] ──► [appsink]
 client-name=Goose                    rate=16000            emit PCM
 stream-name=Goose Mic                channels=1            to Node.js
                                      format=S16LE          for VAD + Whisper
```

`pipewiresrc` registers a persistent capture node — "Goose Mic" appears in the mixer's Recording tab. Users select which mic input to route to Goose through standard DE audio controls.

### VAD options (zero npm deps)

| Approach | Dependency | Integration |
|---|---|---|
| GStreamer `level` element | System GStreamer (`gstreamer1-plugins-good`) | Pipeline: `pipewiresrc ! level ! fdsink` — emits RMS/peak on stderr, PCM on stdout |
| RMS energy threshold | None (pure JS) | 10 lines of math on PCM samples from stdout |
| SoX `silence` effect | System `sox` | `rec` with built-in silence detection args |

For RHEL/Fedora: GStreamer `level` element is the primary — zero npm deps, already installed, emits structured level messages that Node.js parses from stderr. Fallback to pure-JS RMS calculation on the raw PCM stream from stdout.

### Fallback chain (mic capture)

| Priority | Backend | npm deps | Platform |
|---|---|---|---|
| 1 | GStreamer `pipewiresrc ! level ! fdsink` spawn | None | Linux (RHEL/Fedora) |
| 2 | `pacat --record` spawn + JS RMS VAD | None | Linux (PulseAudio) |
| 3 | `sox rec` spawn with silence effect | None | macOS/Linux |
| 4 | `ffmpeg -f avfoundation` spawn | None | macOS |

## Text TUI Architecture (Current State)

- **Framework**: Ink 6 + React 19 (terminal renderer)
- **ACP Connection**: NDJSON over stdio pipes (default) or HTTP Streamable
- **Entry point**: `ui/text/src/tui.tsx` (1424 lines)
- **Message flow**: `sessionUpdate` callback → `agent_message_chunk` → `appendAgent()` → `buildContentLines()` → `<Viewport>`
- **Overlays**: configure (Ctrl+P/M), extensions (Ctrl+E), diff (/diff)
- **Slash commands**: Extensible via `COMMANDS` record in `slashCommands.tsx`
- **Audio**: Zero. Only a text placeholder for `audio` content blocks in ToolCallExpanded.

## What's Already Portable (zero changes needed)

- All ACP RPCs (`tts/synthesize`, `dictationTranscribe`, `tts/voices`, `tts/profiles/*`)
- HONK state machine (idle→listening→transcribing→submitting→speaking)
- Adaptive text chunking (sentence/clause/CJK boundary detection)
- VAD algorithm (RMS energy threshold on PCM samples)
- Silence detection timer (configurable 500-3000ms)
- All config keys and semantics (`voice_tts_*`, `voice_dictation_*`, `voice_mode`, etc.)
- HONK prompt injection (HONK_FULL_CONTEXT, HONK_REINFORCEMENT)

## Shared Media Service Layer

### Design Pattern

Follow the existing desktop `services/` pattern (interface → platform resolver → backend):

```
ui/shared/services/media/
├── types.ts                # AudioPlayer, AudioRecorder, MediaCapabilities, ScreenCapture
├── index.ts                # Platform resolver (detectMediaBackend) — ALL detection logic here
├── gstreamerBackend.ts     # gst-launch-1.0 spawn — persistent pipeline, Linux primary
├── pacatBackend.ts         # pacat spawn — persistent stdin, Linux fallback (no GStreamer)
├── afplayBackend.ts        # afplay spawn — macOS (per-file, no persistent stream)
├── powershellBackend.ts    # PowerShell SoundPlayer — Windows (per-file, wav only)
├── webAudioBackend.ts      # Electron/browser (existing useAudioPlayer.ts logic, Web Audio API)
├── noopBackend.ts          # Silent fallback (headless/CI/SSH without audio forwarding)
└── detection.ts            # Probe system: GStreamer plugins, PipeWire, pactl, codecs available
```

Zero npm dependencies added. Every backend spawns system-installed CLI tools via `child_process`.

### Core Interfaces

```typescript
interface AudioPlayer {
  readonly backend: string;           // 'gstreamer' | 'pacat' | 'afplay' | 'powershell' | 'webaudio'
  readonly persistent: boolean;       // true for GStreamer/pacat, false for per-file spawn

  connect(): Promise<void>;
  pushChunk(audio: Buffer, format: string): void;  // accepts encoded audio (opus/wav/mp3)
  setVolume(level: number): void;                   // 0.0–1.0
  stop(): void;                                     // stop current playback, keep pipeline alive
  drain(): Promise<void>;                           // wait for queued audio to finish
  dispose(): Promise<void>;                         // tear down pipeline, deregister from PipeWire
}

interface AudioRecorder {
  readonly backend: string;

  connect(opts: RecordOpts): Promise<void>;
  onData(cb: (pcm: Buffer) => void): void;
  onSpeech(cb: () => void): void;
  onSilence(cb: () => void): void;
  stop(): void;
  dispose(): Promise<void>;
}

interface RecordOpts {
  sampleRate: number;   // 16000 for Whisper
  channels: number;     // 1
  vadMethod: 'gst-level' | 'rms-energy' | 'none';
  silenceThresholdMs: number;  // from config: voice_silence_threshold
}

interface MediaCapabilities {
  audioPlayback: boolean;
  audioCapture: boolean;
  screenCapture: boolean;          // PipeWire ScreenCast portal available?
  persistentStreams: boolean;       // GStreamer/pacat available?
  formats: string[];               // detected supported formats
  devices: { inputs: DeviceInfo[]; outputs: DeviceInfo[] };
}

// Future — same interface pattern
interface ScreenCapture {
  readonly backend: string;
  connect(opts: ScreenCaptureOpts): Promise<void>;
  onFrame(cb: (frame: Buffer, meta: FrameMeta) => void): void;
  dispose(): Promise<void>;
}
```

### Runtime Capability Detection

At startup, probe the system for available tools and codecs. The result drives both backend selection AND UI visibility — features whose backend is `noop` are hidden from menus/settings entirely.

```typescript
interface MediaCapabilities {
  backend: 'gstreamer' | 'pacat' | 'afplay' | 'powershell' | 'noop';
  audioPlayback: boolean;
  audioCapture: boolean;
  persistentStreams: boolean;      // true = stable mixer entry, per-app volume
  screenCapture: boolean;         // PipeWire ScreenCast portal?
  supportedFormats: string[];     // ['opus', 'wav'] — only formats with decoders present
  gstreamerVersion: string | null;
  pipewire: boolean;
}

async function detectMediaCapabilities(): Promise<MediaCapabilities> {
  if (process.platform === 'darwin') {
    return {
      backend: 'afplay',
      audioPlayback: true,
      audioCapture: await commandExists('sox'),  // sox rec
      persistentStreams: false,
      screenCapture: false,
      supportedFormats: ['wav', 'mp3', 'aac'],   // afplay built-in
      gstreamerVersion: null,
      pipewire: false,
    };
  }
  if (process.platform === 'win32') {
    return {
      backend: 'powershell',
      audioPlayback: true,
      audioCapture: false,       // no zero-dep mic capture on Windows yet
      persistentStreams: false,
      screenCapture: false,
      supportedFormats: ['wav'],  // PowerShell SoundPlayer = wav only
      gstreamerVersion: null,
      pipewire: false,
    };
  }

  // Linux: probe GStreamer first
  const gstVersion = await tryExec('gst-launch-1.0 --version');
  if (gstVersion) {
    const hasPWSink = await tryExec('gst-inspect-1.0 pipewiresink');
    const hasPWSrc = await tryExec('gst-inspect-1.0 pipewiresrc');
    const formats = await probeGStreamerFormats(); // ['opus', 'wav', 'mp3', ...]

    return {
      backend: 'gstreamer',
      audioPlayback: true,
      audioCapture: !!hasPWSrc,
      persistentStreams: !!hasPWSink,
      screenCapture: await checkScreenCastPortal(),
      supportedFormats: formats,
      gstreamerVersion: gstVersion.split('\n')[0] ?? null,
      pipewire: !!hasPWSink,
    };
  }

  // Fallback: pacat
  if (await commandExists('pacat')) {
    return {
      backend: 'pacat',
      audioPlayback: true,
      audioCapture: true,
      persistentStreams: true,
      screenCapture: false,
      supportedFormats: ['wav'],  // pacat = PCM only, wav after header strip
      gstreamerVersion: null,
      pipewire: await tryExec('pactl info').then(s => s?.includes('PipeWire') ?? false),
    };
  }

  return {
    backend: 'noop', audioPlayback: false, audioCapture: false,
    persistentStreams: false, screenCapture: false,
    supportedFormats: [], gstreamerVersion: null, pipewire: false,
  };
}

// Probe GStreamer for installed decoders → derive supported format list
async function probeGStreamerFormats(): Promise<string[]> {
  const formats: string[] = [];
  const probes: Array<[string, string]> = [
    ['opusdec',          'opus'],
    ['wavparse',         'wav'],
    ['mpg123audiodec',   'mp3'],
    ['vorbisdec',        'ogg'],
    ['flacdec',          'flac'],
  ];
  for (const [element, format] of probes) {
    if (await tryExec(`gst-inspect-1.0 ${element}`)) {
      formats.push(format);
    }
  }
  // PCM (raw) always works if audioconvert is present
  if (await tryExec('gst-inspect-1.0 audioconvert')) {
    formats.push('pcm');
  }
  return formats;
}
```

### Format Detection via GStreamer

```bash
# Check what decoders are available
gst-inspect-1.0 --print-plugin-auto-install-info | grep decoder
# Or check specific format support
gst-inspect-1.0 opusdec   # opus — in gstreamer1-plugins-base
gst-inspect-1.0 wavparse  # wav — in gstreamer1-plugins-base
gst-inspect-1.0 mpg123audiodec  # mp3 — in gstreamer1-plugins-ugly-free
gst-inspect-1.0 flacdec   # flac — in gstreamer1-plugins-good
```

The `AudioPlayer.supportedFormats` array is populated at startup by probing GStreamer for available decoders.

## Integration Points in Text TUI

### 1. Streaming TTS (hook into sessionUpdate)

In `tui.tsx`, the `sessionUpdate` callback receives `agent_message_chunk` notifications:

- Buffer text fragments using adaptive chunking regex (already portable from desktop)
- On sentence boundary: call ACP `tts/synthesize` → base64 decode → `audioPlayer.pushChunk(bytes, format)`
- GStreamer `decodebin` handles opus/wav/mp3 automatically
- Persistent pipeline plays chunks seamlessly

### 2. Voice Input (keyboard shortcut)

New keybinding (Ctrl+V or F5):
- `audioRecorder.connect({ sampleRate: 16000, vadMethod: 'gst-level' })`
- GStreamer `pipewiresrc ! level ! appsink` captures mic with VAD
- Show 🎤 status in Header
- On silence: encode captured PCM as WAV, POST to Whisper via ACP
- Inject transcript into input state

### 3. HONK Mode (`/honk` slash command)

Port the two-axis state machine from `useConversationMode.ts`:
- `honkActive` toggle via `/honk`
- `isListening` toggle via keybinding
- Full listen→transcribe→submit→speak→listen loop
- HONK_FULL_CONTEXT prompt injection on turn 0

### 4. Settings Overlay (capability-gated)

New `voice` overlay — every element gated on `MediaCapabilities`:

```
┌── Voice Settings ──────────────────────────────────────┐
│                                                        │
│  TTS Provider:  [OpenAI ▾]        ← always shown       │
│  Voice:         [northern_english ▾]  ← ACP RPC        │
│  Speed:         [████████░░] 1.10x                     │
│                                                        │
│  Format:        [opus ▾]          ← ONLY shows formats  │
│                                      in caps.formats    │
│  Quality:       [medium ▾]        ← hidden if format    │
│                                      is wav/pcm         │
│                                                        │
│  Mic Input:     [Default ▾]       ← hidden if           │
│                                      !caps.audioCapture │
│  Voice Mode:    ○ Standard  ● HONK  ← HONK hidden if   │
│                                        !caps.audioCapture│
│  Silence:       [████░░] 1000ms   ← hidden if           │
│                                      !caps.audioCapture │
│                                                        │
│  [▶ Test TTS]   [● Test Mic]      ← buttons hidden per │
│                                      capability         │
└────────────────────────────────────────────────────────┘
```

Rules:
- Format dropdown: populated from `capabilities.supportedFormats` — only codecs with GStreamer decoders present
- Quality selector: hidden when format is `wav` or `pcm` (uncompressed = no quality knob)
- Mic input / Voice mode / Silence threshold: entire section hidden when `!capabilities.audioCapture`
- HONK mode: requires both `audioPlayback` AND `audioCapture` — hidden otherwise
- Test buttons: individually gated on their respective capability
- `/honk` slash command: returns "Voice input not available — GStreamer pipewiresrc not found" when `!audioCapture`
- `/tts` slash command: returns "Audio playback not available — GStreamer not found" when `!audioPlayback`

### 5. Status Indicators

Extend the `<Header>` component:
- 🔊 Speaking (TTS pipeline PLAYING)
- 🎤 Listening (capture pipeline active)
- ⏳ Transcribing (Whisper processing)
- 🤔 Thinking (LLM processing — already exists)

## Future Extensions (Same Architecture)

### Screen Capture (Computer Controller)

GStreamer pipeline for screen capture via PipeWire ScreenCast portal:

```
Portal D-Bus → CreateSession → SelectSources → Start → PipeWire node ID
                                                         ↓
[pipewiresrc path=<node_id>] ──► [videoconvert] ──► [appsink]
                                                      ↓
                                                   Node.js frame callback
```

Same `MediaPipeline` interface, same lifecycle. The `pipewiresrc` element connects to the portal-granted PipeWire node. Video frames arrive as GstBuffers in the `appsink` callback.

### Camera Capture

Identical pattern: `org.freedesktop.portal.Camera` → PipeWire fd → `pipewiresrc` → `appsink`.

### Kitty Terminal Audio Protocol (Future)

When the Kitty audio protocol ships (APC-based streaming PCM):
- Detect via query: `ESC _Aa=q;ESC \`
- If supported: stream base64 PCM through terminal (audio plays locally over SSH)
- Add as `kittyProtocolBackend.ts` — same `AudioPlayer` interface

## Platform Fallback Summary (zero npm deps — all spawn-based)

| Priority | Backend | npm deps | Formats | Persistent? | Platform |
|---|---|---|---|---|---|
| 1 | `gst-launch-1.0` spawn (pipewiresink) | None | opus, wav, + whatever GStreamer plugins installed | Yes | RHEL 10.2 / Fedora 42+ |
| 2 | `pacat --playback` spawn | None | wav/PCM only (opus needs `opusdec` pipe) | Yes | Linux (no GStreamer) |
| 3 | `afplay` spawn (per-file) | None | wav, mp3, aac, m4a | No | macOS (built-in) |
| 4 | PowerShell `SoundPlayer` | None | wav only | No | Windows (built-in) |
| 5 | Noop (silent, features hidden) | None | — | — | Headless/CI/SSH |

## Phases

### Phase 1: Detection + GStreamer Audio Playback (TTS Output)
- [x] Create `ui/shared/services/media/` directory structure
- [x] `detection.ts`: probe GStreamer version, pipewiresink/pipewiresrc, codec plugins at startup
- [x] `types.ts`: AudioPlayer, AudioRecorder, MediaCapabilities interfaces
- [x] `gstreamerBackend.ts`: spawn persistent `gst-launch-1.0` pipeline with pipewiresink
- [x] `pacatBackend.ts`: spawn persistent `pacat --playback` stdin stream (fallback)
- [x] `noopBackend.ts`: silent stub, logs warnings
- [x] `index.ts`: resolver — select backend based on detected capabilities
- [x] Hook into text TUI `sessionUpdate` → `agent_message_chunk` for streaming TTS
- [x] Add `/tts on|off` slash command (gated: hidden when `!capabilities.audioPlayback`)
- [x] Add 🔊 status indicator in Header
- [x] Format selector populated from `capabilities.supportedFormats` only
- [x] Test on RHEL 10.2 and Fedora 42+ with opus and wav

### Phase 2: GStreamer Mic Capture (STT Input)
- [ ] `gstreamerBackend.ts` AudioRecorder: spawn `gst-launch-1.0` with `pipewiresrc ! level ! fdsink`
- [ ] Parse GStreamer `level` messages from stderr for VAD
- [ ] Fallback: `pacat --record` spawn + pure-JS RMS energy VAD on stdout PCM
- [ ] Whisper endpoint integration via ACP `dictationTranscribe`
- [ ] Keybinding to toggle listening (gated: hidden when `!capabilities.audioCapture`)
- [ ] 🎤 status indicator
- [ ] "Goose Mic" appears in mixer Recording tab via pipewiresrc client-name

### Phase 3: HONK Conversation Mode
- [ ] Port state machine from useConversationMode.ts (pure logic, zero deps)
- [ ] `/honk` slash command (gated: requires BOTH `audioPlayback` AND `audioCapture`)
- [ ] Full listen→transcribe→submit→speak→listen loop
- [x] Streaming TTS during LLM response (150ms polling, adaptive chunking)
- [x] HONK prompt injection (HONK_FULL_CONTEXT on turn 0)

### Phase 4: Capability-Gated Settings + Polish
- [ ] Voice settings overlay — every element gated on MediaCapabilities
- [ ] Format dropdown: only shows formats in `capabilities.supportedFormats`
- [ ] Quality selector: hidden when format is wav/pcm
- [ ] Mic/HONK/silence sections: hidden when `!capabilities.audioCapture`
- [ ] Device selection via `pactl list sources/sinks short` parse
- [ ] Media inhibit spawn (`systemd-inhibit` Linux / `caffeinate` macOS)
- [ ] Media ducking via `media.role=Communication` on pipewiresink

### Phase 5: macOS/Windows Backends + Shared Layer
- [ ] `afplayBackend.ts`: macOS spawn (per-file, wav/mp3/aac)
- [ ] `powershellBackend.ts`: Windows spawn (per-file, wav only)
- [ ] Extract desktop `useAudioPlayer.ts` Web Audio logic into `webAudioBackend.ts`
- [ ] Both `ui/desktop` and `ui/text` use shared `AudioPlayer` interface
- [ ] Electron Flatpak optionally uses GStreamer backend instead of Web Audio

### Phase 6: Screen/Video Capture (Computer Controller)
- [ ] ScreenCapture interface (same pattern as AudioPlayer)
- [ ] `gst-launch-1.0` with `pipewiresrc path=<node_id>` + ScreenCast portal D-Bus flow
- [ ] Frame callback → computer controller vision pipeline

## Key Decisions

1. **Zero npm dependencies for media layer**: All audio I/O via `child_process.spawn()` of system CLI tools (`gst-launch-1.0`, `pacat`, `afplay`, PowerShell). No native addons, no N-API bindings, no build-time dev headers required. Pure TypeScript + spawn.

2. **GStreamer primary on Linux**: Natively decodes opus+wav (mandatory) plus mp3/ogg/flac. On RHEL 10.2 / Fedora 42+, all required packages ship in base repos. `decodebin` auto-detects format — no client-side codec management.

3. **Runtime capability detection drives UI**: `detectMediaCapabilities()` runs at startup, probes for GStreamer, PipeWire, installed codecs. The result gates every voice-related UI element — format dropdown only shows installed codecs, HONK mode hidden without mic capture, `/tts` command unavailable without audio playback. No broken buttons, no confusing error states.

4. **`pipewiresink` with named properties**: Direct PipeWire integration. `client-name=Goose` + `media.name=Goose TTS` + `media.role=Communication` gives stable mixer presence, per-app volume, and media ducking. Same behavior as Discord/Zoom.

5. **Format-agnostic `pushChunk(bytes, format)`**: Accepts encoded audio (opus/wav/mp3), not raw PCM. GStreamer decodes. The format dropdown "just works" — user picks opus for bandwidth or wav for zero-decode-latency, player handles both without code changes.

6. **Same pattern extends to screen/video capture**: `pipewiresrc` connects to ScreenCast portal PipeWire nodes. The `MediaStream` abstraction (connect → receive data → dispose) is identical across audio playback, mic capture, screen capture, and camera.

7. **RHEL 10.2 / Fedora 42+ as primary target**: GStreamer 1.24+, PipeWire, all required plugins in base repos. macOS/Windows are secondary with simpler per-file-spawn backends and reduced feature sets (no persistent streams, fewer formats).
