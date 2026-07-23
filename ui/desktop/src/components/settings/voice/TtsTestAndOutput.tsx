import { useState, useEffect } from 'react';
import { ChevronDown, Info, Volume2 } from 'lucide-react';
import { synthesizeTts } from '../../../acp/tts';
import { setAudioOutputDevice, getAudioOutputDevice } from '../../../hooks/useAudioPlayer';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip';

interface TtsTestAndOutputProps {
  provider: string;
  selectedVoice: string;
  speed: string;
}

export function TtsTestAndOutput({ provider, selectedVoice, speed }: TtsTestAndOutputProps) {
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState('');
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

  return (
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
          onClick={runTtsTest}
          disabled={isTesting}
          className={isTesting ? 'text-blue-500 animate-pulse' : ''}
        >
          <Volume2 className="h-3.5 w-3.5 mr-1" />
          {isTesting ? 'Testing...' : 'Test TTS'}
        </Button>
      </div>

      {testStatus && (
        <p className="text-xs text-text-secondary bg-background-secondary rounded px-2 py-1.5 font-mono break-all">
          {testStatus}
        </p>
      )}

      {/* NOTE: The audio output device selector below has no effect on AudioContext-based playback.
         AudioContext does not support setSinkId(). The selected device is stored but unused.
         See documentation/voice-audio-architecture.md for context and workaround options. */}
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
                  void setAudioOutputDevice(deviceId || null);
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
  );
}
