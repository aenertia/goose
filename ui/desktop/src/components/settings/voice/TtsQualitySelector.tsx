import { ChevronDown, Info } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip';

const QUALITY_OPTIONS = [
  {
    value: 'low',
    label: 'Low (32 kbps)',
    description: 'Smallest files, reduced clarity. Good for voice-only on slow connections.',
  },
  {
    value: 'medium',
    label: 'Medium (64 kbps)',
    description: 'Balanced quality and size. Recommended for most setups.',
  },
  {
    value: 'high',
    label: 'High (128 kbps)',
    description: 'Near-lossless quality. Use when bandwidth is not a concern.',
  },
] as const;

const SECTION_TOOLTIP =
  'Bitrate for compressed audio formats (Opus, MP3, OGG). Higher bitrate improves audio clarity but increases transfer size and may add encoding time. Has no effect on uncompressed formats (WAV, PCM) — those are always lossless.';

export interface TtsQualitySelectorProps {
  quality: string;
  onQualityChange: (quality: string) => void;
}

export function TtsQualitySelector({ quality, onQualityChange }: TtsQualitySelectorProps) {
  const selected = QUALITY_OPTIONS.find((o) => o.value === quality) ?? QUALITY_OPTIONS[1];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-text-primary text-sm">Audio Quality</h4>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-text-secondary cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>{SECTION_TOOLTIP}</p>
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
            <span>{selected.label}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-full min-w-[200px]">
          <DropdownMenuRadioGroup value={quality} onValueChange={onQualityChange}>
            {QUALITY_OPTIONS.map((opt) => (
              <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                {opt.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-xs text-text-secondary">{selected.description}</p>
    </div>
  );
}
