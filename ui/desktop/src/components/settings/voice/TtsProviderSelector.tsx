import { ChevronDown, Info } from 'lucide-react';
import type { TtsProviderStatusEntry } from '../../../acp/tts';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  browser: 'Browser',
  model: 'Model (Native Audio)',
};

export interface TtsProviderSelectorProps {
  provider: string;
  providerStatuses: Record<string, TtsProviderStatusEntry>;
  onProviderChange: (value: string) => void;
}

export function TtsProviderSelector({
  provider,
  providerStatuses,
  onProviderChange,
}: TtsProviderSelectorProps) {
  const getProviderLabel = (p: string | null): string => {
    if (!p) return 'Disabled';
    return PROVIDER_LABELS[p] || p;
  };

  return (
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
            <span>{getProviderLabel(provider || null)}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-full min-w-[200px]">
          <DropdownMenuRadioGroup
            value={provider || '__disabled__'}
            onValueChange={onProviderChange}
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
  );
}
