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
  const response = await client.extMethod('_goose/unstable/tts/config', {});
  return (response.providers as TtsProviders) ?? {};
}

export async function synthesizeTts(
  text: string,
  provider: string,
  voice: string,
  speed: number
): Promise<{ audio: string; mimeType: string }> {
  const client = await getAcpClient();
  const response = await client.extMethod('_goose/unstable/tts/synthesize', {
    text,
    provider,
    voice,
    speed,
  });
  return { audio: response.audio as string, mimeType: response.mimeType as string };
}

export async function listTtsVoices(provider: string): Promise<TtsVoiceInfo[]> {
  const client = await getAcpClient();
  const response = await client.extMethod('_goose/unstable/tts/voices', { provider });
  return (response.voices as TtsVoiceInfo[]) ?? [];
}

export async function saveTtsSecret(provider: string, value: string): Promise<void> {
  const client = await getAcpClient();
  await client.extMethod('_goose/unstable/tts/secret/save', { provider, value });
}

export async function deleteTtsSecret(provider: string): Promise<void> {
  const client = await getAcpClient();
  await client.extMethod('_goose/unstable/tts/secret/delete', { provider });
}
