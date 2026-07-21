import { useState, useEffect } from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { DictationSettings } from '../dictation/DictationSettings';
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
});

const DEFAULT_SILENCE_THRESHOLD = '800';

export default function VoiceSettingsSection() {
  const intl = useIntl();
  const { read, upsert } = useConfig();
  const [silenceThreshold, setSilenceThreshold] = useState(DEFAULT_SILENCE_THRESHOLD);

  useEffect(() => {
    const loadSettings = async () => {
      const value = await read('voice_silence_threshold', false);
      if (value && typeof value === 'string') {
        setSilenceThreshold(value);
      }
    };
    loadSettings();
  }, [read]);

  const handleSilenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSilenceThreshold(value);
    upsert('voice_silence_threshold', value, false);
  };

  return (
    <div className=space-y-4 pr-4 pb-8 mt-1>
      <Card className=pb-2 rounded-lg>
        <CardHeader className=pb-0>
          <CardTitle>{intl.formatMessage(i18n.dictationTitle)}</CardTitle>
          <CardDescription>{intl.formatMessage(i18n.dictationDescription)}</CardDescription>
        </CardHeader>
        <CardContent className=px-2>
          <DictationSettings />
          <SpellcheckToggle />
        </CardContent>
      </Card>

      <Card className=pb-2 rounded-lg>
        <CardHeader className=pb-0>
          <div className=flex items-center gap-2>
            <CardTitle>{intl.formatMessage(i18n.silenceTitle)}</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className=h-4 w-4 text-text-secondary cursor-help />
                </TooltipTrigger>
                <TooltipContent className=max-w-xs>
                  <p>{intl.formatMessage(i18n.silenceTooltip)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <CardDescription>{intl.formatMessage(i18n.silenceDescription)}</CardDescription>
        </CardHeader>
        <CardContent className=px-4 pt-4>
          <div className=flex items-center gap-4>
            <input
              type=range
              min=500
              max=3000
              step=100
              value={silenceThreshold}
              onChange={handleSilenceChange}
              className=flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-accent-primary
            />
            <span className=text-sm text-text-secondary min-w-[60px] text-right>
              {intl.formatMessage(i18n.silenceValue, { value: silenceThreshold })}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
