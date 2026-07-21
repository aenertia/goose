import { saveTtsProfile, getTtsConfig } from '../../../acp/tts';
import type { TtsProfile } from '../../../types/tts';
import { useTtsConfig } from './useTtsConfig';
import { TtsProviderSelector } from './TtsProviderSelector';
import { TtsEndpointUrlInput } from './TtsEndpointUrlInput';
import { TtsApiKeySection } from './TtsApiKeySection';
import { TtsVoiceSelector } from './TtsVoiceSelector';
import { TtsSpeedSlider } from './TtsSpeedSlider';
import { TtsTestAndOutput } from './TtsTestAndOutput';
import { TtsProfileSelector } from './TtsProfileSelector';
import { TtsProfileEditor } from './TtsProfileEditor';

export function TtsSettings() {
  const {
    provider,
    providerStatuses,
    setProviderStatuses,
    selectedVoice,
    speed,
    endpointUrl,
    profiles,
    activeProfileId,
    editingProfile,
    showProfileEditor,
    setShowProfileEditor,
    setEditingProfile,
    currentProviderConfig,
    showApiKeySection,
    showEndpointUrl,
    handleProviderChange,
    handleVoiceChange,
    handleSpeedChange,
    handleEndpointUrlChange,
    handleEndpointUrlBlur,
    handleActiveProfileChange,
    handleNewProfile,
    handleEditProfile,
    handleDeleteProfile,
    refreshProfiles,
  } = useTtsConfig();

  const refreshStatuses = async () => {
    try {
      const statuses = await getTtsConfig();
      setProviderStatuses(statuses);
    } catch (err) {
      console.error('Failed to load TTS config:', err);
    }
  };

  const handleProfileEditorSave = async (profile: TtsProfile, apiKey?: string) => {
    try {
      const saved = await saveTtsProfile(profile, apiKey);
      setShowProfileEditor(false);
      setEditingProfile(null);
      await refreshProfiles();
      if (!activeProfileId) {
        handleActiveProfileChange(saved.id);
      }
    } catch (err) {
      console.error('Failed to save TTS profile:', err);
    }
  };

  return (
    <div className="space-y-4 px-2 pt-4">
      <TtsProviderSelector
        provider={provider || ''}
        providerStatuses={providerStatuses}
        onProviderChange={handleProviderChange}
      />

      {provider && currentProviderConfig && (
        <p className="text-xs text-text-secondary">{currentProviderConfig.description}</p>
      )}

      {provider &&
        currentProviderConfig?.usesProviderConfig &&
        currentProviderConfig.settingsPath && (
          <p className="text-xs text-text-secondary">
            Configured in {currentProviderConfig.settingsPath}
          </p>
        )}

      {showEndpointUrl && (
        <TtsEndpointUrlInput
          endpointUrl={endpointUrl}
          onChange={handleEndpointUrlChange}
          onBlur={handleEndpointUrlBlur}
        />
      )}

      {showApiKeySection && provider && (
        <TtsApiKeySection
          provider={provider}
          providerConfig={currentProviderConfig}
          onRefreshStatuses={refreshStatuses}
        />
      )}

      {provider && (
        <TtsVoiceSelector
          provider={provider}
          selectedVoice={selectedVoice}
          onVoiceChange={handleVoiceChange}
        />
      )}

      {provider && (
        <TtsSpeedSlider speed={speed} onSpeedChange={handleSpeedChange} />
      )}

      {provider && (
        <TtsTestAndOutput
          provider={provider}
          selectedVoice={selectedVoice}
          speed={speed}
        />
      )}

      {provider && (
        <TtsProfileSelector
          profiles={profiles}
          activeProfileId={activeProfileId}
          onActiveProfileChange={handleActiveProfileChange}
          onNewProfile={handleNewProfile}
          onEditProfile={handleEditProfile}
          onDeleteProfile={handleDeleteProfile}
        />
      )}

      {showProfileEditor && editingProfile && (
        <TtsProfileEditor
          profile={editingProfile}
          onSave={handleProfileEditorSave}
          onCancel={() => {
            setShowProfileEditor(false);
            setEditingProfile(null);
          }}
        />
      )}
    </div>
  );
}
