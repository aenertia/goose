import { useState, useEffect, useCallback } from 'react';
import {
  getTtsConfig,
  listTtsVoices,
  listTtsProfiles,
  saveTtsProfile,
  deleteTtsProfile,
  synthesizeTts,
  TtsProviderStatusEntry,
  TtsVoiceInfo,
} from '../../../acp/tts';
import { useConfig } from '../../ConfigContext';
import { getAudioOutputDevice } from '../../../hooks/useAudioPlayer';
import type { TtsProvider, TtsProfile } from '../../../types/tts';

type TtsProviderOption = TtsProvider | null;

const DEFAULT_SPEED = '1.00';

function emptyProfile(): TtsProfile {
  return {
    id: '',
    name: '',
    provider: 'openai',
    endpointUrl: '',
    apiKeyEnv: '',
    voice: '',
    speed: 1.0,
  };
}

export interface UseTtsConfigReturn {
  // State values
  provider: TtsProviderOption;
  setProvider: React.Dispatch<React.SetStateAction<TtsProviderOption>>;
  providerStatuses: Record<string, TtsProviderStatusEntry>;
  setProviderStatuses: React.Dispatch<React.SetStateAction<Record<string, TtsProviderStatusEntry>>>;
  voices: TtsVoiceInfo[];
  setVoices: React.Dispatch<React.SetStateAction<TtsVoiceInfo[]>>;
  selectedVoice: string;
  setSelectedVoice: React.Dispatch<React.SetStateAction<string>>;
  speed: string;
  setSpeed: React.Dispatch<React.SetStateAction<string>>;
  apiKey: string;
  setApiKey: React.Dispatch<React.SetStateAction<string>>;
  isEditingKey: boolean;
  setIsEditingKey: React.Dispatch<React.SetStateAction<boolean>>;
  endpointUrl: string;
  setEndpointUrl: React.Dispatch<React.SetStateAction<string>>;

  // Profile state
  profiles: TtsProfile[];
  setProfiles: React.Dispatch<React.SetStateAction<TtsProfile[]>>;
  activeProfileId: string;
  setActiveProfileId: React.Dispatch<React.SetStateAction<string>>;
  editingProfile: TtsProfile | null;
  setEditingProfile: React.Dispatch<React.SetStateAction<TtsProfile | null>>;
  profileApiKey: string;
  setProfileApiKey: React.Dispatch<React.SetStateAction<string>>;
  showProfileEditor: boolean;
  setShowProfileEditor: React.Dispatch<React.SetStateAction<boolean>>;

  // Test state
  isTesting: boolean;
  setIsTesting: React.Dispatch<React.SetStateAction<boolean>>;
  testStatus: string;
  setTestStatus: React.Dispatch<React.SetStateAction<string>>;
  outputDevices: MediaDeviceInfo[];
  setOutputDevices: React.Dispatch<React.SetStateAction<MediaDeviceInfo[]>>;
  selectedOutputDevice: string;
  setSelectedOutputDevice: React.Dispatch<React.SetStateAction<string>>;
  browserTtsAvailable: boolean;

  // Functions
  runTtsTest: () => Promise<void>;
  refreshProfiles: () => Promise<void>;

  // Handler functions
  handleProviderChange: (value: string) => void;
  handleVoiceChange: (value: string) => void;
  handleSpeedChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleEndpointUrlChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleEndpointUrlBlur: () => void;
  handleSaveKey: () => Promise<void>;
  handleRemoveKey: () => Promise<void>;
  handleActiveProfileChange: (value: string) => void;
  handleNewProfile: () => void;
  handleEditProfile: (profile: TtsProfile) => void;
  handleSaveProfile: () => Promise<void>;
  handleDeleteProfile: (profileId: string) => Promise<void>;
  getProviderLabel: (p: TtsProviderOption) => string;

  // Computed values
  currentProviderConfig: TtsProviderStatusEntry | undefined;
  showApiKeySection: boolean;
  showEndpointUrl: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  browser: 'Browser',
  model: 'Model (Native Audio)',
};

export function useTtsConfig(): UseTtsConfigReturn {
  const { read, upsert, remove } = useConfig();
  const [provider, setProvider] = useState<TtsProviderOption>(null);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, TtsProviderStatusEntry>>(
    {}
  );
  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [apiKey, setApiKey] = useState('');
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState('');

  // Profile state
  const [profiles, setProfiles] = useState<TtsProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [editingProfile, setEditingProfile] = useState<TtsProfile | null>(null);
  const [profileApiKey, setProfileApiKey] = useState('');
  const [showProfileEditor, setShowProfileEditor] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>(
    getAudioOutputDevice() || ''
  );
  const [browserTtsAvailable, setBrowserTtsAvailable] = useState(true);

  useEffect(() => {
    if (!window.speechSynthesis) {
      setBrowserTtsAvailable(false);
      return;
    }
    const check = () => setBrowserTtsAvailable(window.speechSynthesis.getVoices().length > 0);
    check();
    window.speechSynthesis.addEventListener('voiceschanged', check);
    const fallbackTimer = window.setTimeout(() => {
      if (window.speechSynthesis.getVoices().length === 0) setBrowserTtsAvailable(false);
    }, 3000);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', check);
      window.clearTimeout(fallbackTimer);
    };
  }, []);

  const runTtsTest = async () => {
    if (!provider) {
      setTestStatus('No TTS provider selected');
      return;
    }
    if (provider === 'browser') {
      setTestStatus('Testing browser TTS...');
      try {
        const utterance = new SpeechSynthesisUtterance('Hello! This is a test. Honk!');
        utterance.onend = () => setTestStatus('Browser TTS played successfully');
        utterance.onerror = (e) => setTestStatus(`Browser TTS error: ${e.error}`);
        window.speechSynthesis.speak(utterance);
        setIsTesting(true);
        return;
      } catch (e) {
        setTestStatus(`Browser TTS failed: ${e}`);
        return;
      }
    }

    setIsTesting(true);
    setTestStatus('Synthesizing...');

    try {
      const voice = selectedVoice || '';
      const spd = parseFloat(speed) || 1.0;
      const result = await synthesizeTts(
        'Hello! This is a test of the text to speech system. Honk!',
        provider,
        voice,
        spd
      );

      const raw = atob(result.audio);
      const arrayBuf = new ArrayBuffer(raw.length);
      const view = new Uint8Array(arrayBuf);
      for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);

      setTestStatus('Playing...');
      const ctx = new AudioContext();
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          setIsTesting(false);
          setTestStatus('Test passed');
          ctx.close();
        };
        source.start();
      } catch (decodeErr) {
        setIsTesting(false);
        console.error('[TTS test] decodeAudioData failed:', decodeErr);
        setTestStatus('Failed — audio format not supported');
        ctx.close();
      }
    } catch (synthErr) {
      setIsTesting(false);
      console.error('[TTS test] synthesis failed:', synthErr);
      const msg = String(synthErr);
      if (msg.includes('not configured')) {
        setTestStatus('Failed — provider not configured');
      } else if (msg.includes('500') || msg.includes('engine failed')) {
        setTestStatus('Failed — TTS server error');
      } else {
        setTestStatus('Failed — check endpoint URL and voice');
      }
    }
  };

  const refreshStatuses = async () => {
    try {
      const statuses = await getTtsConfig();
      setProviderStatuses(statuses);
    } catch (err) {
      console.error('Failed to load TTS config:', err);
    }
  };

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await listTtsProfiles();
      setProfiles(list);
    } catch (err) {
      console.error('Failed to load TTS profiles:', err);
    }
  }, []);

  useEffect(() => {
    refreshStatuses();
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    const enumerateOutputs = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        setOutputDevices(all.filter((d) => d.kind === 'audiooutput'));
      } catch {
        console.warn('Could not enumerate audio output devices');
      }
    };
    enumerateOutputs();
    navigator.mediaDevices.addEventListener('devicechange', enumerateOutputs);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerateOutputs);
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      const savedProvider = await read('voice_tts_provider', false);
      if (savedProvider && typeof savedProvider === 'string' && savedProvider !== '__disabled__') {
        setProvider(savedProvider as TtsProvider);
      }
      const savedVoice = await read('voice_tts_voice', false);
      if (savedVoice && typeof savedVoice === 'string') {
        setSelectedVoice(savedVoice);
      }
      const savedSpeed = await read('voice_tts_speed', false);
      if (savedSpeed && typeof savedSpeed === 'string') {
        setSpeed(savedSpeed);
      }
      const savedEndpoint = await read('voice_tts_endpoint_url', false);
      if (savedEndpoint && typeof savedEndpoint === 'string') {
        setEndpointUrl(savedEndpoint);
      }
      const savedProfile = await read('voice_tts_active_profile', false);
      if (savedProfile && typeof savedProfile === 'string') {
        setActiveProfileId(savedProfile);
      }
    };
    loadSettings();
  }, [read]);

  useEffect(() => {
    if (!provider) {
      setVoices([]);
      return;
    }
    const loadVoices = async () => {
      try {
        if (provider === 'browser') {
          const browserVoices = window.speechSynthesis?.getVoices() ?? [];
          setVoices(
            browserVoices.map((v) => ({
              id: v.voiceURI,
              name: `${v.name} (${v.lang})`,
            }))
          );
        } else {
          const v = await listTtsVoices(provider);
          setVoices(v);
        }
      } catch (err) {
        console.error('Failed to load TTS voices:', err);
        setVoices([]);
      }
    };
    loadVoices();
  }, [provider]);

  const handleProviderChange = (value: string) => {
    if (value === '__disabled__') {
      setProvider(null);
      upsert('voice_tts_provider', '__disabled__', false);
    } else {
      setProvider(value as TtsProvider);
      upsert('voice_tts_provider', value, false);
    }
    setSelectedVoice('');
    setApiKey('');
    setIsEditingKey(false);
  };

  const handleVoiceChange = (value: string) => {
    setSelectedVoice(value);
    upsert('voice_tts_voice', value, false);
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSpeed(value);
    upsert('voice_tts_speed', parseFloat(value).toFixed(2), false);
  };

  const handleEndpointUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEndpointUrl(value);
  };

  const handleEndpointUrlBlur = () => {
    if (endpointUrl.trim()) {
      upsert('voice_tts_endpoint_url', endpointUrl.trim(), false);
    } else {
      remove('voice_tts_endpoint_url', false);
    }
  };

  const handleSaveKey = async () => {
    if (!provider) return;
    const providerConfig = providerStatuses[provider];
    if (!providerConfig || providerConfig.usesProviderConfig) return;

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) return;

    const keyName = provider === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'OPENAI_API_KEY';
    await upsert(keyName, trimmedKey, true);
    setApiKey('');
    setIsEditingKey(false);
    await refreshStatuses();
  };

  const handleRemoveKey = async () => {
    if (!provider) return;
    const providerConfig = providerStatuses[provider];
    if (!providerConfig || providerConfig.usesProviderConfig) return;

    const keyName = provider === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'OPENAI_API_KEY';
    await remove(keyName, true);
    setApiKey('');
    setIsEditingKey(false);
    await refreshStatuses();
  };

  const handleActiveProfileChange = (value: string) => {
    if (value === '__none__') {
      setActiveProfileId('');
      remove('voice_tts_active_profile', false);
    } else {
      setActiveProfileId(value);
      upsert('voice_tts_active_profile', value, false);
    }
  };

  const handleNewProfile = () => {
    setEditingProfile(emptyProfile());
    setProfileApiKey('');
    setShowProfileEditor(true);
  };

  const handleEditProfile = (profile: TtsProfile) => {
    setEditingProfile({ ...profile });
    setProfileApiKey('');
    setShowProfileEditor(true);
  };

  const handleSaveProfile = async () => {
    if (!editingProfile || !editingProfile.name.trim()) return;
    try {
      const saved = await saveTtsProfile(
        editingProfile,
        profileApiKey.trim() || undefined
      );
      setShowProfileEditor(false);
      setEditingProfile(null);
      setProfileApiKey('');
      await refreshProfiles();
      if (!activeProfileId) {
        setActiveProfileId(saved.id);
        upsert('voice_tts_active_profile', saved.id, false);
      }
    } catch (err) {
      console.error('Failed to save TTS profile:', err);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await deleteTtsProfile(profileId);
      if (activeProfileId === profileId) {
        setActiveProfileId('');
        remove('voice_tts_active_profile', false);
      }
      await refreshProfiles();
    } catch (err) {
      console.error('Failed to delete TTS profile:', err);
    }
  };

  const getProviderLabel = (p: TtsProviderOption): string => {
    if (!p) return 'Disabled';
    return PROVIDER_LABELS[p] || p;
  };

  const currentProviderConfig = provider ? providerStatuses[provider] : undefined;
  const showApiKeySection = !!(
    provider &&
    currentProviderConfig &&
    !currentProviderConfig.usesProviderConfig &&
    provider !== 'browser'
  );
  const showEndpointUrl = !!(
    provider && provider !== 'browser' && provider !== 'model'
  );

  return {
    // State values
    provider,
    setProvider,
    providerStatuses,
    setProviderStatuses,
    voices,
    setVoices,
    selectedVoice,
    setSelectedVoice,
    speed,
    setSpeed,
    apiKey,
    setApiKey,
    isEditingKey,
    setIsEditingKey,
    endpointUrl,
    setEndpointUrl,

    // Profile state
    profiles,
    setProfiles,
    activeProfileId,
    setActiveProfileId,
    editingProfile,
    setEditingProfile,
    profileApiKey,
    setProfileApiKey,
    showProfileEditor,
    setShowProfileEditor,

    // Test state
    isTesting,
    setIsTesting,
    testStatus,
    setTestStatus,
    outputDevices,
    setOutputDevices,
    selectedOutputDevice,
    setSelectedOutputDevice,
    browserTtsAvailable,

    // Functions
    runTtsTest,
    refreshProfiles,

    // Handlers
    handleProviderChange,
    handleVoiceChange,
    handleSpeedChange,
    handleEndpointUrlChange,
    handleEndpointUrlBlur,
    handleSaveKey,
    handleRemoveKey,
    handleActiveProfileChange,
    handleNewProfile,
    handleEditProfile,
    handleSaveProfile,
    handleDeleteProfile,
    getProviderLabel,

    // Computed values
    currentProviderConfig,
    showApiKeySection,
    showEndpointUrl,
  };
}
