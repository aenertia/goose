import { Info } from 'lucide-react';
import { Input } from '../../ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip';

export interface TtsEndpointUrlInputProps {
  endpointUrl: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

export function TtsEndpointUrlInput({
  endpointUrl,
  onChange,
  onBlur,
}: TtsEndpointUrlInputProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-text-primary text-sm">Endpoint URL</h4>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-text-secondary cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>
                Custom TTS API endpoint. Leave empty to use the provider default. Use for
                self-hosted TTS (e.g. F5-TTS, Piper, or OpenAI-compatible endpoints).
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Input
        type="url"
        placeholder="https://api.openai.com (default)"
        value={endpointUrl}
        onChange={onChange}
        onBlur={onBlur}
      />
    </div>
  );
}
