export * from './types.js';
export { detectMediaCapabilities } from './detection.js';
export { NoopAudioPlayer } from './noopBackend.js';
export { GStreamerAudioPlayer } from './gstreamerBackend.js';
export { PacatAudioPlayer } from './pacatBackend.js';

import type { AudioPlayer, MediaCapabilities } from './types.js';
import { detectMediaCapabilities } from './detection.js';
import { NoopAudioPlayer } from './noopBackend.js';
import { GStreamerAudioPlayer } from './gstreamerBackend.js';
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

export async function detectAndCreateAudioPlayer(): Promise<{
  player: AudioPlayer;
  capabilities: MediaCapabilities;
}> {
  const capabilities = await detectMediaCapabilities();
  const player = await createAudioPlayer(capabilities);
  return { player, capabilities };
}
