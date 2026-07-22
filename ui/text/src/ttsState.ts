import type { MediaCapabilities } from './services/media/types.js';

let _enabled = false;
let _capabilities: MediaCapabilities | null = null;

export function setTtsEnabled(v: boolean): void { _enabled = v; }
export function getTtsEnabled(): boolean { return _enabled; }
export function setTtsCapabilities(c: MediaCapabilities): void { _capabilities = c; }
export function getTtsCapabilities(): MediaCapabilities | null { return _capabilities; }
