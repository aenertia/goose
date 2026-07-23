export type DisplayServer = 'wayland' | 'x11' | 'unknown';

export function getDisplayServer(): DisplayServer {
  if (process.platform !== 'linux') return 'unknown';

  if (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland') {
    return 'wayland';
  }
  if (process.env.DISPLAY || process.env.XDG_SESSION_TYPE === 'x11') {
    return 'x11';
  }
  return 'unknown';
}

export function isWayland(): boolean {
  return getDisplayServer() === 'wayland';
}

export function isX11(): boolean {
  return getDisplayServer() === 'x11';
}
