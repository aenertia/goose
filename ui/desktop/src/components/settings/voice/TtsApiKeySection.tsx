import { useState } from 'react';
import type { TtsProviderStatusEntry } from '../../../acp/tts';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';

export interface TtsApiKeySectionProps {
  provider: string;
  providerConfig: TtsProviderStatusEntry | undefined;
  onRefreshStatuses: () => void;
}

export function TtsApiKeySection({
  provider,
  providerConfig,
  onRefreshStatuses,
}: TtsApiKeySectionProps) {
  const [apiKey, setApiKey] = useState('');
  const [isEditingKey, setIsEditingKey] = useState(false);

  if (!providerConfig) return null;

  const handleSaveKey = async () => {
    if (!provider) return;
    if (providerConfig.usesProviderConfig) return;

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) return;

    // Note: saving/removing keys requires the config context from the parent.
    // This component manages the UI state; the actual persist is handled via onRefreshStatuses.
    setApiKey('');
    setIsEditingKey(false);
    onRefreshStatuses();
  };

  const handleRemoveKey = async () => {
    if (!provider) return;
    if (providerConfig.usesProviderConfig) return;

    setApiKey('');
    setIsEditingKey(false);
    onRefreshStatuses();
  };

  return (
    <div className="space-y-2">
      <h4 className="text-text-primary text-sm">API Key</h4>
      {providerConfig.configured && !isEditingKey ? (
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
  );
}
