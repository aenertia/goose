export type { StoredDevice, AudioDeviceResolver } from './types';
export { WebApiResolver } from './webApiResolver';

import type { AudioDeviceResolver } from './types';
import { WebApiResolver } from './webApiResolver';

export function createAudioDeviceResolver(): AudioDeviceResolver {
  return new WebApiResolver();
}
