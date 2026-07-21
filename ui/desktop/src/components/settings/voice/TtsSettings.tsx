import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Info, Plus, Trash2, Save, Volume2 } from 'lucide-react';
import {
  getTtsConfig,
  listTtsVoices,
  listTtsProfiles,
  saveTtsProfile,
  deleteTtsProfile,
  TtsProviderStatusEntry,
  TtsVoiceInfo,
} from '../../../acp/tts';
import { useConfig } from '../../ConfigContext';
import { useAudioPlayer, setAudioOutputDevice, getAudioOutputDevice } from '../../../hooks/useAudioPlayer';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import type { TtsProvider, TtsProfile } from '../../../types/tts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip';

type TtsProviderOption = TtsProvider | null;

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  browser: 'Browser',
  model: 'Model (Native Audio)',
};

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

export function TtsSettings() {
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

  const { speak: testSpeak, stop: testStop, isPlaying: isTesting } = useAudioPlayer();
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>(
    getAudioOutputDevice() || ''
  );

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
  const showApiKeySection =
    provider &&
    currentProviderConfig &&
    !currentProviderConfig.usesProviderConfig &&
    provider !== 'browser';
  const showEndpointUrl =
    provider && provider !== 'browser' && provider !== 'model';

  return (
    <div className="space-y-4 px-2 pt-4">
      {/* Provider dropdown */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h4 className="text-text-primary text-sm">TTS Provider</h4>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-text-secondary cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>
                  Choose how Goose speaks responses aloud. &apos;Browser&apos; uses your
                  system&apos;s built-in voices. &apos;Model&apos; uses models with native audio
                  output.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between text-text-primary bg-background-primary border-border-primary"
            >
              <span>{getProviderLabel(provider)}</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-full min-w-[200px]">
            <DropdownMenuRadioGroup
              value={provider || '__disabled__'}
              onValueChange={handleProviderChange}
            >
              <DropdownMenuRadioItem value="__disabled__">Disabled</DropdownMenuRadioItem>
              {Object.entries(providerStatuses).map(([key, status]) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {PROVIDER_LABELS[key] || key}
                  {!status.configured && ' (not configured)'}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Provider info */}
      {provider && currentProviderConfig && (
        <p className="text-xs text-text-secondary">{currentProviderConfig.description}</p>
      )}

      {/* Uses provider config notice */}
      {provider &&
        currentProviderConfig?.usesProviderConfig &&
        currentProviderConfig.settingsPath && (
          <p className="text-xs text-text-secondary">
            Configured in {currentProviderConfig.settingsPath}
          </p>
        )}

      {/* Endpoint URL */}
      {showEndpointUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-text-primary text-sm">Endpoint URL</h4>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-text-secondary cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    Custom TTS API endpoint. Leave empty to use the provider default. Use for
                    self-hosted TTS (e.g. F5-TTS, Piper, or OpenAI-compatible endpoints).
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Input
            type="url"
            placeholder="https://api.openai.com (default)"
            value={endpointUrl}
            onChange={handleEndpointUrlChange}
            onBlur={handleEndpointUrlBlur}
          />
        </div>
      )}

      {/* API key section */}
      {showApiKeySection && (
        <div className="space-y-2">
          <h4 className="text-text-primary text-sm">API Key</h4>
          {currentProviderConfig.configured && !isEditingKey ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsEditingKey(true)}>
                Update API Key
              </Button>
              <Button variant="outline" size="sm" onClick={handleRemoveKey}>
                Remove API Key
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Enter your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="flex-1"
              />
              <Button size="sm" onClick={handleSaveKey} disabled={!apiKey.trim()}>
                Save
              </Button>
              {isEditingKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setApiKey('');
                    setIsEditingKey(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Voice selector */}
      {provider && voices.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-text-primary text-sm">Voice</h4>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-text-secondary cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>
                    Select the voice for text-to-speech. Available voices depend on the selected
                    provider.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between text-text-primary bg-background-primary border-border-primary"
              >
                <span>
                  {selectedVoice
                    ? voices.find((v) => v.id === selectedVoice)?.name || selectedVoice
                    : 'Default'}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-full min-w-[200px] max-h-[300px] overflow-y-auto">
              <DropdownMenuRadioGroup value={selectedVoice} onValueChange={handleVoiceChange}>
                {voices.map((v) => (
                  <DropdownMenuRadioItem key={v.id} value={v.id}>
                    {v.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Speed slider */}
      {provider && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h4 className="text-text-primary text-sm">Speed</h4>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-text-secondary cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Playback speed for synthesized speech. 1.0 is normal speed.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0.25"
              max="4.0"
              step="0.25"
              value={speed}
              onChange={handleSpeedChange}
              className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-accent-primary"
            />
            <span className="text-sm text-text-secondary min-w-[40px] text-right">
              {parseFloat(speed).toFixed(2)}x
            </span>
          </div>
        </div>
      )}

      {/* Test TTS + Audio Output Device */}
      {provider && (
        <div className="space-y-3 pt-2 border-t border-border-primary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-text-primary text-sm">Test &amp; Output</h4>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-text-secondary cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>
                      Test your TTS configuration and select which audio output device to use for
                      speech playback.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (isTesting) {
                  testStop();
                } else {
                  testSpeak('Hello! This is a test of the text to speech system. Honk!');
                }
              }}
              className={isTesting ? 'text-blue-500 animate-pulse' : ''}
            >
              <Volume2 className="h-3.5 w-3.5 mr-1" />
              {isTesting ? 'Stop' : 'Test TTS'}
            </Button>
          </div>

          {outputDevices.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-text-primary text-xs">Audio Output Device</h4>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between text-text-primary bg-background-primary border-border-primary"
                  >
                    <span className="truncate">
                      {selectedOutputDevice
                        ? outputDevices.find((d) => d.deviceId === selectedOutputDevice)?.label ||
                          'Selected device'
                        : 'System Default'}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full min-w-[200px] max-h-[300px] overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={selectedOutputDevice || '__default__'}
                    onValueChange={(v) => {
                      const deviceId = v === '__default__' ? '' : v;
                      setSelectedOutputDevice(deviceId);
                      setAudioOutputDevice(deviceId || null);
                    }}
                  >
                    <DropdownMenuRadioItem value="__default__">System Default</DropdownMenuRadioItem>
                    {outputDevices.map((d, i) => (
                      <DropdownMenuRadioItem key={d.deviceId} value={d.deviceId}>
                        <span className="truncate">
                          {d.label || `Output ${i + 1}`}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}

      {/* Voice Profiles */}
      {provider && (
        <div className="space-y-3 pt-2 border-t border-border-primary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-text-primary text-sm font-medium">Voice Profiles</h4>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-text-secondary cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>
                      Save named TTS configurations with their own provider, endpoint, API key,
                      voice, and speed. Assign different profiles to different sessions.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Button variant="outline" size="sm" onClick={handleNewProfile}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>

          {/* Active profile selector */}
          {profiles.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-text-primary text-xs">Active Profile</h4>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between text-text-primary bg-background-primary border-border-primary"
                  >
                    <span>
                      {activeProfileId
                        ? profiles.find((p) => p.id === activeProfileId)?.name || 'Unknown'
                        : 'None (use settings above)'}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full min-w-[200px]">
                  <DropdownMenuRadioGroup
                    value={activeProfileId || '__none__'}
                    onValueChange={handleActiveProfileChange}
                  >
                    <DropdownMenuRadioItem value="__none__">
                      None (use settings above)
                    </DropdownMenuRadioItem>
                    {profiles.map((p) => (
                      <DropdownMenuRadioItem key={p.id} value={p.id}>
                        {p.name} ({PROVIDER_LABELS[p.provider] || p.provider})
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Profile list */}
          {profiles.length > 0 && !showProfileEditor && (
            <div className="space-y-1.5">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-sm border ${
                    p.id === activeProfileId
                      ? 'border-accent-primary bg-accent-primary/5'
                      : 'border-border-primary'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary truncate">{p.name}</div>
                    <div className="text-xs text-text-secondary truncate">
                      {PROVIDER_LABELS[p.provider] || p.provider}
                      {p.endpointUrl ? ` @ ${p.endpointUrl}` : ''}
                      {p.voice ? ` / ${p.voice}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleEditProfile(p)}
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                      onClick={() => handleDeleteProfile(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Profile editor */}
          {showProfileEditor && editingProfile && (
            <div className="space-y-3 rounded-md border border-border-primary p-3">
              <h4 className="text-text-primary text-sm font-medium">
                {editingProfile.id ? 'Edit Profile' : 'New Profile'}
              </h4>
              <Input
                placeholder="Profile name"
                value={editingProfile.name}
                onChange={(e) =>
                  setEditingProfile({ ...editingProfile, name: e.target.value })
                }
              />
              <div className="space-y-1">
                <label className="text-xs text-text-secondary">Provider</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between text-text-primary bg-background-primary border-border-primary"
                    >
                      <span>
                        {PROVIDER_LABELS[editingProfile.provider] || editingProfile.provider}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-full min-w-[200px]">
                    <DropdownMenuRadioGroup
                      value={editingProfile.provider}
                      onValueChange={(v) =>
                        setEditingProfile({ ...editingProfile, provider: v })
                      }
                    >
                      {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                        <DropdownMenuRadioItem key={key} value={key}>
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {editingProfile.provider !== 'browser' &&
                editingProfile.provider !== 'model' && (
                  <Input
                    placeholder="Endpoint URL (leave empty for default)"
                    value={editingProfile.endpointUrl}
                    onChange={(e) =>
                      setEditingProfile({ ...editingProfile, endpointUrl: e.target.value })
                    }
                  />
                )}
              {editingProfile.provider !== 'browser' &&
                editingProfile.provider !== 'model' && (
                  <Input
                    type="password"
                    placeholder={
                      editingProfile.apiKeyEnv
                        ? 'API key (leave empty to keep current)'
                        : 'API key'
                    }
                    value={profileApiKey}
                    onChange={(e) => setProfileApiKey(e.target.value)}
                  />
                )}
              <Input
                placeholder="Voice ID (e.g. alloy, nova)"
                value={editingProfile.voice}
                onChange={(e) =>
                  setEditingProfile({ ...editingProfile, voice: e.target.value })
                }
              />
              <div className="flex items-center gap-4">
                <label className="text-xs text-text-secondary shrink-0">Speed</label>
                <input
                  type="range"
                  min="0.25"
                  max="4.0"
                  step="0.25"
                  value={editingProfile.speed}
                  onChange={(e) =>
                    setEditingProfile({
                      ...editingProfile,
                      speed: parseFloat(e.target.value),
                    })
                  }
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
                <span className="text-sm text-text-secondary min-w-[40px] text-right">
                  {editingProfile.speed.toFixed(2)}x
                </span>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowProfileEditor(false);
                    setEditingProfile(null);
                    setProfileApiKey('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveProfile}
                  disabled={!editingProfile.name.trim()}
                >
                  Save Profile
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
