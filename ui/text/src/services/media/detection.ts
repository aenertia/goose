import { spawnSync } from 'node:child_process';
import type { MediaCapabilities } from './types.js';

let cached: MediaCapabilities | null = null;

function probe(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return result.status === 0;
}

function probeOutput(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
  });
  if (result.status !== 0) return null;
  return result.stdout?.trim() ?? null;
}

function detectDarwin(): MediaCapabilities {
  return {
    backend: 'afplay',
    audioPlayback: true,
    audioCapture: false,
    persistentStreams: false,
    screenCapture: false,
    supportedFormats: ['wav', 'mp3', 'aac'],
    gstreamerVersion: null,
    pipewire: false,
  };
}

function detectWin32(): MediaCapabilities {
  return {
    backend: 'powershell',
    audioPlayback: true,
    audioCapture: false,
    persistentStreams: false,
    screenCapture: false,
    supportedFormats: ['wav'],
    gstreamerVersion: null,
    pipewire: false,
  };
}

function probeGStreamerFormats(): string[] {
  const elementToFormat: ReadonlyArray<readonly [string, string]> = [
    ['opusdec', 'opus'],
    ['wavparse', 'wav'],
    ['mpg123audiodec', 'mp3'],
    ['vorbisdec', 'ogg'],
    ['flacdec', 'flac'],
    ['audioconvert', 'pcm'],
  ];

  const formats: string[] = [];
  for (const [element, format] of elementToFormat) {
    if (probe('gst-inspect-1.0', [element])) {
      formats.push(format);
    }
  }
  return formats;
}

function detectLinux(): MediaCapabilities {
  // Try GStreamer first
  const gstVersion = probeOutput('gst-launch-1.0', ['--version']);
  if (gstVersion !== null) {
    const hasPWSink = probe('gst-inspect-1.0', ['pipewiresink']);
    const hasPWSrc = probe('gst-inspect-1.0', ['pipewiresrc']);
    const formats = probeGStreamerFormats();

    return {
      backend: 'gstreamer',
      audioPlayback: hasPWSink || formats.length > 0,
      audioCapture: hasPWSrc,
      persistentStreams: hasPWSink,
      screenCapture: false,
      supportedFormats: formats,
      gstreamerVersion: gstVersion,
      pipewire: hasPWSink || hasPWSrc,
    };
  }

  // Fallback: pacat (PulseAudio)
  if (probe('pacat', ['--version'])) {
    return {
      backend: 'pacat',
      audioPlayback: true,
      audioCapture: true,
      persistentStreams: false,
      screenCapture: false,
      supportedFormats: ['wav'],
      gstreamerVersion: null,
      pipewire: false,
    };
  }

  // No audio backend
  return {
    backend: 'noop',
    audioPlayback: false,
    audioCapture: false,
    persistentStreams: false,
    screenCapture: false,
    supportedFormats: [],
    gstreamerVersion: null,
    pipewire: false,
  };
}

export function detectMediaCapabilities(): Promise<MediaCapabilities> {
  if (cached !== null) return Promise.resolve(cached);

  switch (process.platform) {
    case 'darwin':
      cached = detectDarwin();
      break;
    case 'win32':
      cached = detectWin32();
      break;
    default:
      cached = detectLinux();
      break;
  }

  return Promise.resolve(cached);
}

export { probeGStreamerFormats };
