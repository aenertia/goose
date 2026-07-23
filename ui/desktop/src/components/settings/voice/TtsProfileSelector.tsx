import { ChevronDown, Info, Plus, Trash2, Save } from 'lucide-react';
import type { TtsProfile } from '../../../types/tts';
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

export interface TtsProfileSelectorProps {
  profiles: TtsProfile[];
  activeProfileId: string;
  onActiveProfileChange: (value: string) => void;
  onNewProfile: () => void;
  onEditProfile: (p: TtsProfile) => void;
  onDeleteProfile: (id: string) => void;
}

export function TtsProfileSelector({
  profiles,
  activeProfileId,
  onActiveProfileChange,
  onNewProfile,
  onEditProfile,
  onDeleteProfile,
}: TtsProfileSelectorProps) {
  return (
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
        <Button variant="outline" size="sm" onClick={onNewProfile}>
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
                onValueChange={onActiveProfileChange}
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
      {profiles.length > 0 && (
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
                  onClick={() => onEditProfile(p)}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                  onClick={() => onDeleteProfile(p.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
