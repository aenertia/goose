import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip';

export interface TtsSpeedSliderProps {
  speed: string;
  onSpeedChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  provider?: string;
}

export function TtsSpeedSlider({ speed, onSpeedChange, provider }: TtsSpeedSliderProps) {
  const isDisabled = provider === 'elevenlabs';

  return (
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
          step="0.05"
          value={speed}
          onChange={onSpeedChange}
          disabled={isDisabled}
          className={`flex-1 h-2 rounded-lg appearance-none accent-accent-primary ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
        />
        <span className="text-sm text-text-secondary min-w-[40px] text-right">
          {parseFloat(speed).toFixed(2)}x
        </span>
      </div>
      {isDisabled && (
        <p className="text-xs text-text-secondary">
          Speed control is not supported by the ElevenLabs API.
        </p>
      )}
    </div>
  );
}
