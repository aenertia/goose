# Voice Audio Architecture: AudioContext and Output Device Routing

## Why Goose Uses AudioContext for TTS Playback

Goose's desktop app runs on Electron, which enforces a strict Content Security Policy (CSP) on renderer processes. This CSP blocks `blob:` and `data:` URIs from being used as media element sources. The straightforward approach fails:

```js
// Triggers a CSP violation in Electron's renderer
const audio = new Audio();
audio.src = URL.createObjectURL(ttsBlob); // blocked
```

The TTS pipeline receives synthesized audio as base64-encoded data from the backend (via `synthesizeTts()`). To play it, the code in `useAudioPlayer.ts` decodes the base64 into a raw `ArrayBuffer`, then hands it to the Web Audio API:

```ts
// From useAudioPlayer.ts — simplified
const ctx = getSharedCtx();           // returns a singleton AudioContext
const arrayBuf = b64ToArrayBuffer(audio);
const audioBuffer = await ctx.decodeAudioData(arrayBuf);

const source = ctx.createBufferSource();
source.buffer = audioBuffer;
source.connect(ctx.destination);      // routes to system default output
source.start();
```

This works because `AudioContext.decodeAudioData()` operates entirely in JavaScript memory. It never creates a DOM media element, never loads a URI, and never triggers CSP checks. Audio flows from `ArrayBuffer` to decoded `AudioBuffer` to the system's audio output, all within the Web Audio API's processing graph.

The hook maintains a shared `AudioContext` singleton (`globalSharedCtx`) that gets reused across utterances, plus an LRU cache of up to 50 decoded `AudioBuffer` objects keyed by `provider:voice:speed:text`. Text is split into chunks (by punctuation or paragraph boundaries), and the next chunk is pre-fetched while the current one plays. A module-level `globalSource` reference tracks the active `AudioBufferSourceNode` so playback can be interrupted mid-utterance.

For the "browser" TTS provider, Goose uses the `SpeechSynthesis` API instead, which has its own audio routing and isn't affected by this limitation.


## The setSinkId Gap: Why Output Device Selection Has No Effect

The TTS settings UI (`TtsSettings.tsx`) includes an "Audio Output Device" dropdown. It enumerates available output devices via `navigator.mediaDevices.enumerateDevices()`, filters for `audiooutput` kind, and renders them in a selector. When the user picks a device, the component calls `setAudioOutputDevice(deviceId)` from `useAudioPlayer.ts`:

```ts
// useAudioPlayer.ts, lines 30-38
let _selectedOutputDeviceId: string | null = null;

export function setAudioOutputDevice(deviceId: string | null) {
  _selectedOutputDeviceId = deviceId;
}

export function getAudioOutputDevice(): string | null {
  return _selectedOutputDeviceId;
}
```

The selected device ID is stored in a module-level variable. That's all that happens. The `playBuffer` function and the test playback code in `TtsSettings.tsx` both create or reuse an `AudioContext` and connect sources directly to `ctx.destination` without ever reading `_selectedOutputDeviceId`.

The Web Audio API's `AudioContext` does not support `setSinkId()`. That method only exists on `HTMLMediaElement` (the `<audio>` and `<video>` elements). When the playback code connects a source to `ctx.destination`, audio always routes to the operating system's default output device. There is no standard, widely-supported Web API to redirect an `AudioContext`'s output to a specific device.

The `AudioContext` constructor does accept a `sinkId` option in Chrome 110+, but the current codebase doesn't use it, and Electron's Chromium version support for this feature varies.

The practical result: users can select a non-default audio device in settings, the selection is stored in memory, but TTS audio continues playing through whatever device the OS considers "default." The `getAudioOutputDevice()` export exists but is only called once, to initialize the dropdown's selected state on mount. It's never consulted during actual playback.


## Workaround Options

Three paths forward exist, each with different tradeoffs.

### Option 1: MediaStreamDestination Bridge

Route the `AudioContext` output through a `MediaStreamDestination` node, then pipe that `MediaStream` into an `HTMLAudioElement` that supports `setSinkId()`:

```ts
const ctx = getSharedCtx();
const dest = ctx.createMediaStreamDestination();
source.connect(dest);           // instead of source.connect(ctx.destination)

const audio = new Audio();
audio.srcObject = dest.stream;  // MediaStream, not a blob: URI — no CSP issue
await audio.setSinkId(selectedDeviceId);
audio.play();
```

This preserves the CSP-safe `AudioContext` decoding while gaining device routing through the `HTMLAudioElement` at the end of the chain. The `srcObject` property accepts `MediaStream` objects directly, bypassing the CSP restrictions that block `blob:` URIs.

Downsides: adds complexity to `playBuffer()`, introduces a small amount of latency from the extra routing hop, and requires careful lifecycle management of both the `AudioContext` source node and the `HTMLAudioElement`. The `onended` event handling would need to coordinate between the two.

### Option 2: HTMLAudioElement with CSP Relaxation

Switch back to `HTMLAudioElement` for playback and modify Electron's CSP to allow `blob:` URIs in the `media-src` directive. This would let the simpler `new Audio(blobURL)` approach work, and `setSinkId()` would be available natively.

This is generally not recommended. Relaxing CSP weakens the app's security boundary. Adding `blob:` to `media-src` opens attack surface that the current strict policy intentionally closes. For a desktop app that processes untrusted content from AI model outputs, keeping CSP tight matters.

### Option 3: Accept the Limitation and Clean Up the UI

Remove the non-functional output device selector from `TtsSettings.tsx` entirely. Delete the `setAudioOutputDevice` / `getAudioOutputDevice` exports from `useAudioPlayer.ts`. Document that TTS audio plays through the system default output device, and let users who need specific device routing change their OS-level default instead.

This is the simplest option. It eliminates a misleading UI element, removes dead code, and avoids introducing new complexity or security tradeoffs. The "Test TTS" button and all other TTS settings (provider, voice, speed, endpoint URL, API keys, profiles) continue working exactly as they do today.

### Recommendation

Option 3 is the pragmatic choice for now. Option 1 is worth pursuing if users report that OS-level device switching is insufficient, but it should be implemented carefully with latency testing across platforms. Option 2 should be avoided unless there's a compelling reason to weaken CSP.
