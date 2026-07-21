import { useState, useEffect } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { listTtsVoices, type TtsVoiceInfo } from '../../../acp/tts';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip';

export interface TtsVoiceSelectorProps {
  provider: string;
  selectedVoice: string;
  onVoiceChange: (value: string) => void;
}

export function TtsVoiceSelector({
  provider,
  selectedVoice,
  onVoiceChange,
}: TtsVoiceSelectorProps) {
  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);

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

  if (voices.length === 0) return null;

  return (
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
          <DropdownMenuRadioGroup value={selectedVoice} onValueChange={onVoiceChange}>
            {voices.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id}>
                {v.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
