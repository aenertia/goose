export type TtsProvider = 'openai' | 'elevenlabs' | 'browser' | 'model';

export interface TtsProfile {
  id: string;
  name: string;
  provider: string;
  endpointUrl: string;
  apiKeyEnv: string;
  voice: string;
  speed: number;
}
