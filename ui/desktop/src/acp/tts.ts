import { getAcpClient } from './acpConnection';
import type { TtsProfile } from '../types/tts';

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
  speed: number,
  profileId?: string,
  responseFormat?: string,
  quality?: string,
): Promise<{ audio: string; mimeType: string }> {
  const client = await getAcpClient();
  const params: Record<string, unknown> = { text, provider, voice, speed };
  if (profileId) {
    params.profileId = profileId;
  }
  if (responseFormat) {
    params.responseFormat = responseFormat;
  }
  if (quality) {
    params.quality = quality;
  }
  const response = await client.extMethod('_goose/unstable/tts/synthesize', params);
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

export async function listTtsProfiles(): Promise<TtsProfile[]> {
  const client = await getAcpClient();
  const response = await client.extMethod('_goose/unstable/tts/profiles/list', {});
  return (response.profiles as TtsProfile[]) ?? [];
}

export async function getTtsProfile(profileId: string): Promise<TtsProfile | null> {
  const client = await getAcpClient();
  const response = await client.extMethod('_goose/unstable/tts/profiles/get', { profileId });
  return (response.profile as TtsProfile) ?? null;
}

export async function saveTtsProfile(
  profile: TtsProfile,
  apiKey?: string
): Promise<TtsProfile> {
  const client = await getAcpClient();
  const params: Record<string, unknown> = { profile };
  if (apiKey !== undefined) {
    params.apiKey = apiKey;
  }
  const response = await client.extMethod('_goose/unstable/tts/profiles/save', params);
  return response.profile as TtsProfile;
}

export async function deleteTtsProfile(profileId: string): Promise<void> {
  const client = await getAcpClient();
  await client.extMethod('_goose/unstable/tts/profiles/delete', { profileId });
}
