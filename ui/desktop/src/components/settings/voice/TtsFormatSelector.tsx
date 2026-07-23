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

const FORMAT_OPTIONS = [
  {
    value: 'opus',
    label: 'Opus (default)',
    description:
      'Compressed. Smallest size (~5KB/sentence). Higher latency due to server-side encoding (~360ms). Best for remote/cloud TTS endpoints.',
  },
  {
    value: 'wav',
    label: 'WAV',
    description:
      'Uncompressed. Lowest latency (~130ms) — no server encoding needed. Larger transfer size (~52KB/sentence). Best for local/LAN TTS endpoints.',
  },
  {
    value: 'mp3',
    label: 'MP3',
    description:
      'Compressed. Widest device compatibility. Similar latency to Opus. Larger than Opus at equivalent quality.',
  },
  {
    value: 'pcm',
    label: 'PCM',
    description:
      'Raw audio samples. Lowest latency (no container overhead). Very large. Requires matching sample rate between server and client.',
  },
  {
    value: 'ogg',
    label: 'OGG (Vorbis)',
    description: 'Ogg Vorbis container. Similar to Opus with broader legacy support.',
  },
] as const;

const SECTION_TOOLTIP =
  'Audio format requested from the TTS server. WAV gives the lowest latency on local networks — no server-side encoding step. Opus/MP3 reduce bandwidth for cloud endpoints but add ~200ms encoding overhead per sentence. Your TTS endpoint must support the chosen format.';

export interface TtsFormatSelectorProps {
  format: string;
  onFormatChange: (format: string) => void;
}

export function TtsFormatSelector({ format, onFormatChange }: TtsFormatSelectorProps) {
  const selected = FORMAT_OPTIONS.find((o) => o.value === format) ?? FORMAT_OPTIONS[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-text-primary text-sm">Audio Format</h4>
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
          <DropdownMenuRadioGroup value={format} onValueChange={onFormatChange}>
            {FORMAT_OPTIONS.map((opt) => (
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
