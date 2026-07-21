import { useState, useEffect } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { getTtsConfig, listTtsVoices, TtsProviderStatusEntry, TtsVoiceInfo } from '../../../acp/tts';
import { useConfig } from '../../ConfigContext';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import type { TtsProvider } from '../../../types/tts';
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

export function TtsSettings() {
  const { read, upsert, remove } = useConfig();
  const [provider, setProvider] = useState<TtsProviderOption>(null);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, TtsProviderStatusEntry>>({});
  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [apiKey, setApiKey] = useState('');
  const [isEditingKey, setIsEditingKey] = useState(false);

  const refreshStatuses = async () => {
    try {
      const statuses = await getTtsConfig();
      setProviderStatuses(statuses);
    } catch (err) {
      console.error('Failed to load TTS config:', err);
    }
  };

  useEffect(() => {
    refreshStatuses();
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
      {provider && currentProviderConfig?.usesProviderConfig && currentProviderConfig.settingsPath && (
        <p className="text-xs text-text-secondary">
          ✓ Configured in {currentProviderConfig.settingsPath}
        </p>
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
    </div>
  );
}
