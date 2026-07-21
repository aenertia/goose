import { useState, useEffect } from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { DictationSettings } from '../dictation/DictationSettings';
import { TtsSettings } from './TtsSettings';
import { SpellcheckToggle } from '../chat/SpellcheckToggle';
import { useConfig } from '../../ConfigContext';
import { defineMessages, useIntl } from '../../../i18n';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/tooltip';

const i18n = defineMessages({
  dictationTitle: {
    id: 'voiceSettings.dictationTitle',
    defaultMessage: 'Voice Input',
  },
  dictationDescription: {
    id: 'voiceSettings.dictationDescription',
    defaultMessage: 'Configure voice dictation provider and microphone settings',
  },
  silenceTitle: {
    id: 'voiceSettings.silenceTitle',
    defaultMessage: 'Silence Detection Threshold',
  },
  silenceDescription: {
    id: 'voiceSettings.silenceDescription',
    defaultMessage: 'How long to wait after you stop speaking before auto-submitting',
  },
  silenceTooltip: {
    id: 'voiceSettings.silenceTooltip',
    defaultMessage:
      'How long to wait after you stop speaking before auto-submitting in conversation mode. Longer values are more forgiving for natural pauses. (500ms\u20133000ms)',
  },
  silenceValue: {
    id: 'voiceSettings.silenceValue',
    defaultMessage: '{value}ms',
  },
  ttsTitle: {
    id: 'voiceSettings.ttsTitle',
    defaultMessage: 'Text-to-Speech',
  },
  ttsDescription: {
    id: 'voiceSettings.ttsDescription',
    defaultMessage: 'Configure how Goose speaks responses aloud',
  },
  splitStrategyLabel: {
    id: 'voiceSettings.splitStrategyLabel',
    defaultMessage: 'Split Strategy',
  },
  splitStrategyTooltip: {
    id: 'voiceSettings.splitStrategyTooltip',
    defaultMessage:
      "Controls how text is broken into audio chunks for speech. 'Punctuation' gives faster first-word playback. 'None' synthesizes the full response at once.",
  },
  splitNone: {
    id: 'voiceSettings.splitNone',
    defaultMessage: 'None',
  },
  splitPunctuation: {
    id: 'voiceSettings.splitPunctuation',
    defaultMessage: 'Punctuation',
  },
  splitParagraph: {
    id: 'voiceSettings.splitParagraph',
    defaultMessage: 'Paragraph',
  },
  autoSpeakLabel: {
    id: 'voiceSettings.autoSpeakLabel',
    defaultMessage: 'Auto-speak responses',
  },
  autoSpeakTooltip: {
    id: 'voiceSettings.autoSpeakTooltip',
    defaultMessage:
      'When enabled, Goose automatically reads assistant responses aloud after they finish generating.',
  },
});

const DEFAULT_SILENCE_THRESHOLD = '800';

export default function VoiceSettingsSection() {
  const intl = useIntl();
  const { read, upsert } = useConfig();
  const [silenceThreshold, setSilenceThreshold] = useState(DEFAULT_SILENCE_THRESHOLD);
  const [splitStrategy, setSplitStrategy] = useState('punctuation');
  const [autoSpeak, setAutoSpeak] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      const silenceVal = await read('voice_silence_threshold', false);
      if (silenceVal && typeof silenceVal === 'string') {
        setSilenceThreshold(silenceVal);
      }
      const splitVal = await read('voice_tts_split_on', false);
      if (splitVal && typeof splitVal === 'string') {
        setSplitStrategy(splitVal);
      }
      const autoSpeakVal = await read('voice_auto_speak', false);
      if (autoSpeakVal === 'true') {
        setAutoSpeak(true);
      }
    };
    loadSettings();
  }, [read]);

  const handleSilenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSilenceThreshold(value);
    upsert('voice_silence_threshold', value, false);
  };

  const handleSplitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSplitStrategy(value);
    upsert('voice_tts_split_on', value, false);
  };

  const handleAutoSpeakChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoSpeak(checked);
    upsert('voice_auto_speak', checked ? 'true' : 'false', false);
  };

  return (
    <div className="space-y-4 pr-4 pb-8 mt-1">
      <Card className="pb-2 rounded-lg">
        <CardHeader className="pb-0">
          <CardTitle>{intl.formatMessage(i18n.dictationTitle)}</CardTitle>
          <CardDescription>{intl.formatMessage(i18n.dictationDescription)}</CardDescription>
        </CardHeader>
        <CardContent className="px-2">
          <DictationSettings />
          <SpellcheckToggle />
        </CardContent>
      </Card>

      <Card className="pb-2 rounded-lg">
        <CardHeader className="pb-0">
          <CardTitle>{intl.formatMessage(i18n.ttsTitle)}</CardTitle>
          <CardDescription>{intl.formatMessage(i18n.ttsDescription)}</CardDescription>
        </CardHeader>
        <CardContent className="px-2">
          <TtsSettings />

          <div className="px-2 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">
                  {intl.formatMessage(i18n.splitStrategyLabel)}
                </label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-text-secondary cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>{intl.formatMessage(i18n.splitStrategyTooltip)}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <select
                value={splitStrategy}
                onChange={handleSplitChange}
                className="rounded-md border border-border-primary bg-bg-primary px-3 py-1.5 text-sm"
              >
                <option value="none">{intl.formatMessage(i18n.splitNone)}</option>
                <option value="punctuation">{intl.formatMessage(i18n.splitPunctuation)}</option>
                <option value="paragraph">{intl.formatMessage(i18n.splitParagraph)}</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label htmlFor="auto-speak-toggle" className="text-sm font-medium">
                  {intl.formatMessage(i18n.autoSpeakLabel)}
                </label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-text-secondary cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>{intl.formatMessage(i18n.autoSpeakTooltip)}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <input
                id="auto-speak-toggle"
                type="checkbox"
                checked={autoSpeak}
                onChange={handleAutoSpeakChange}
                className="h-4 w-4 rounded border-border-primary accent-accent-primary cursor-pointer"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="pb-2 rounded-lg">
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <CardTitle>{intl.formatMessage(i18n.silenceTitle)}</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-text-secondary cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>{intl.formatMessage(i18n.silenceTooltip)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <CardDescription>{intl.formatMessage(i18n.silenceDescription)}</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pt-4">
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={500}
              max={3000}
              step={100}
              value={silenceThreshold}
              onChange={handleSilenceChange}
              className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-accent-primary"
            />
            <span className="text-sm text-text-secondary min-w-[60px] text-right">
              {intl.formatMessage(i18n.silenceValue, { value: silenceThreshold })}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
