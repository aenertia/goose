export interface StoredDevice {
  deviceId: string;
  label: string;
}

export interface AudioDeviceResolver {
  resolveOutputDevice(stored: StoredDevice | string | null): Promise<string>;
  storeOutputDevice(deviceId: string): Promise<StoredDevice>;
}
