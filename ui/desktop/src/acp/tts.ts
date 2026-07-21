import { getAcpClient } from './acpConnection';

export interface TtsProviderStatusEntry {
  configured: boolean;
  description: string;
  usesProviderConfig: boolean;
  settingsPath?: string;
}

export type TtsProviders = Record<string, TtsProviderStatusEntry>;

export interface TtsVoiceInfo {
  id: string;
  name: string;
  previewUrl?: string;
}

export async function getTtsConfig(): Promise<TtsProviders> {
  const client = await getAcpClient();
  const response = await client.goose.ttsConfig_unstable({});
  return response.providers ?? {};
}

export async function synthesizeTts(
  text: string,
  provider: string,
  voice: string,
  speed: number
): Promise<{ audio: string; mimeType: string }> {
  const client = await getAcpClient();
  const response = await client.goose.ttsSynthesize_unstable({
    text,
    provider,
    voice,
    speed,
  });
  return { audio: response.audio, mimeType: response.mimeType };
}

export async function listTtsVoices(provider: string): Promise<TtsVoiceInfo[]> {
  const client = await getAcpClient();
  const response = await client.goose.ttsVoices_unstable({ provider });
  return response.voices ?? [];
}

export async function saveTtsSecret(provider: string, value: string): Promise<void> {
  const client = await getAcpClient();
  await client.goose.ttsSecretSave_unstable({ provider, value });
}

export async function deleteTtsSecret(provider: string): Promise<void> {
  const client = await getAcpClient();
  await client.goose.ttsSecretDelete_unstable({ provider });
}
