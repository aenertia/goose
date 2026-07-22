export * from './types.js';
export { detectMediaCapabilities } from './detection.js';
export { NoopAudioPlayer, NoopAudioRecorder } from './noopBackend.js';
export { GStreamerAudioPlayer, GStreamerAudioRecorder, loadEchoCancel, unloadEchoCancel, isEchoCancelLoaded } from './gstreamerBackend.js';
export { PacatAudioPlayer } from './pacatBackend.js';

import type { AudioPlayer, AudioRecorder, MediaCapabilities } from './types.js';
import { detectMediaCapabilities } from './detection.js';
import { NoopAudioPlayer, NoopAudioRecorder } from './noopBackend.js';
import { GStreamerAudioPlayer, GStreamerAudioRecorder, loadEchoCancel } from './gstreamerBackend.js';
import { PacatAudioPlayer } from './pacatBackend.js';

export async function createAudioPlayer(
  caps: MediaCapabilities,
): Promise<AudioPlayer> {
  switch (caps.backend) {
    case 'gstreamer':
      return new GStreamerAudioPlayer(caps.supportedFormats);
    case 'pacat':
      return new PacatAudioPlayer();
    case 'afplay':
      console.warn('[audio] afplay backend not yet implemented, using noop');
      return new NoopAudioPlayer();
    case 'powershell':
      console.warn('[audio] powershell backend not yet implemented, using noop');
      return new NoopAudioPlayer();
    case 'noop':
    default:
      return new NoopAudioPlayer();
  }
}

export function createAudioRecorder(
  caps: MediaCapabilities,
): AudioRecorder {
  if (!caps.audioCapture) return new NoopAudioRecorder();
  switch (caps.backend) {
    case 'gstreamer':
      return new GStreamerAudioRecorder();
    case 'pacat':
    case 'afplay':
    case 'powershell':
    case 'noop':
    default:
      return new NoopAudioRecorder();
  }
}

export async function detectAndCreateAudioPlayer(): Promise<{
  player: AudioPlayer;
  capabilities: MediaCapabilities;
}> {
  const capabilities = await detectMediaCapabilities();
  const player = await createAudioPlayer(capabilities);
  return { player, capabilities };
}

export async function detectAndCreateMedia(): Promise<{
  player: AudioPlayer;
  recorder: AudioRecorder;
  capabilities: MediaCapabilities;
}> {
  const capabilities = await detectMediaCapabilities();
  const player = await createAudioPlayer(capabilities);
  const recorder = createAudioRecorder(capabilities);
  if (capabilities.loopbackAvailable && capabilities.echoCancelAvailable) {
    loadEchoCancel();
  }
  return { player, recorder, capabilities };
}
