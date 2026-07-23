import { spawnSync } from 'node:child_process';
import type { MediaCapabilities } from './types.js';

let cached: MediaCapabilities | null = null;

function baseCaps(
  backend: MediaCapabilities['backend'],
  overrides: Partial<Omit<MediaCapabilities, 'backend'>> = {},
): MediaCapabilities {
  return {
    backend,
    audioPlayback: false,
    audioCapture: false,
    persistentStreams: false,
    screenCapture: false,
    supportedFormats: [],
    gstreamerVersion: null,
    pipewire: false,
    loopbackAvailable: false,
    echoCancelAvailable: false,
    grdSession: false,
    sshAudioSession: false,
    ...overrides,
  };
}

function probe(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
  });
  const out = (result.stdout ?? '') as string;
  // gst-inspect-1.0 exits 0 even for missing plugins — check stdout instead
  if (out.includes('No such element') || out.includes('No such plugin')) {
    return false;
  }
  // For other commands (e.g. pacat --version), rely on exit code
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

function hasPwLoopback(): boolean {
  return spawnSync('pw-loopback', ['--help'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  }).status !== null;
}

function hasEchoCancel(): boolean {
  const result = spawnSync('pactl', ['list', 'modules', 'short'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
  });
  if (result.status !== 0) return false;
  return (result.stdout ?? '').includes('module-echo-cancel');
}

function hasGrdAudioSource(): boolean {
  const result = spawnSync('pactl', ['list', 'sources', 'short'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
  });
  if (result.status !== 0) return false;
  return (result.stdout ?? '').includes('grd_remote_audio_source');
}

function hasSshAudioSocket(): boolean {
  if (!process.env.SSH_CONNECTION) return false;
  const pulseServer = process.env.PULSE_SERVER ?? '';
  return pulseServer.startsWith('unix:') || pulseServer.startsWith('/');
}

function detectDarwin(): MediaCapabilities {
  if (probe('ffplay', ['-version'])) {
    return baseCaps('ffmpeg', {
      audioPlayback: true,
      audioCapture: true,
      supportedFormats: ['wav', 'mp3', 'opus', 'ogg', 'flac'],
    });
  }
  return baseCaps('afplay', {
    audioPlayback: true,
    supportedFormats: ['wav', 'mp3', 'aac'],
  });
}

function detectWin32(): MediaCapabilities {
  if (probe('ffplay', ['-version'])) {
    return baseCaps('ffmpeg', {
      audioPlayback: true,
      audioCapture: true,
      supportedFormats: ['wav', 'mp3', 'opus', 'ogg', 'flac'],
    });
  }
  return baseCaps('powershell', {
    audioPlayback: true,
    supportedFormats: ['wav'],
  });
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

function hasPwCat(): boolean {
  return spawnSync('pw-cat', ['--help'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  }).status !== null;
}

function detectLinux(): MediaCapabilities {
  const pwCatAvailable = hasPwCat();
  const pwLoopback = hasPwLoopback();

  const gstVersion = probeOutput('gst-launch-1.0', ['--version']);
  if (gstVersion !== null) {
    const hasPWSink = probe('gst-inspect-1.0', ['pipewiresink']);
    const hasPWSrc = probe('gst-inspect-1.0', ['pipewiresrc']);
    const formats = probeGStreamerFormats();

    return baseCaps('gstreamer', {
      audioPlayback: hasPWSink || pwCatAvailable || formats.length > 0,
      audioCapture: hasPWSrc || pwCatAvailable,
      persistentStreams: pwLoopback || hasPWSink || pwCatAvailable,
      supportedFormats: formats,
      gstreamerVersion: gstVersion,
      pipewire: hasPWSink || hasPWSrc || pwCatAvailable,
      loopbackAvailable: pwLoopback,
      echoCancelAvailable: hasEchoCancel(),
      grdSession: hasGrdAudioSource(),
      sshAudioSession: hasSshAudioSocket(),
    });
  }

  if (probe('pacat', ['--version'])) {
    return baseCaps('pacat', {
      audioPlayback: true,
      audioCapture: true,
      supportedFormats: ['wav'],
    });
  }

  return baseCaps('noop');
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
