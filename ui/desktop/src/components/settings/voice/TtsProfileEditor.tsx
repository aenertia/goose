import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import type { TtsProfile } from '../../../types/tts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  browser: 'Browser',
  model: 'Model (Native Audio)',
};

interface TtsProfileEditorProps {
  profile: TtsProfile;
  onSave: (profile: TtsProfile, apiKey?: string) => Promise<void>;
  onCancel: () => void;
}

export function TtsProfileEditor({ profile, onSave, onCancel }: TtsProfileEditorProps) {
  const [editingProfile, setEditingProfile] = useState<TtsProfile>({ ...profile });
  const [profileApiKey, setProfileApiKey] = useState('');

  return (
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
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(editingProfile, profileApiKey.trim() || undefined)}
          disabled={!editingProfile.name.trim()}
        >
          Save Profile
        </Button>
      </div>
    </div>
  );
}
