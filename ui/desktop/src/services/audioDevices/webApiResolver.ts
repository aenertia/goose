import type { AudioDeviceResolver, StoredDevice } from './types';

export class WebApiResolver implements AudioDeviceResolver {
  async resolveOutputDevice(stored: StoredDevice | string | null): Promise<string> {
    if (!stored) return '';

    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === 'audiooutput');

    if (typeof stored === 'string') {
      // Old format: plain deviceId string
      return outputs.some((d) => d.deviceId === stored) ? stored : '';
    }

    // New format: StoredDevice with deviceId + label
    const exactMatch = outputs.find((d) => d.deviceId === stored.deviceId);
    if (exactMatch) return exactMatch.deviceId;

    // Fallback: label substring match (case-insensitive)
    if (stored.label) {
      const labelLower = stored.label.toLowerCase();
      const labelMatch = outputs.find((d) => d.label.toLowerCase().includes(labelLower));
      if (labelMatch) return labelMatch.deviceId;
    }

    return '';
  }

  async storeOutputDevice(deviceId: string): Promise<StoredDevice> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const match = devices.find((d) => d.deviceId === deviceId && d.kind === 'audiooutput');
    return { deviceId, label: match?.label ?? '' };
  }
}
