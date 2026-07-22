import type { MediaCapabilities } from './services/media/types.js';

let _enabled = false;
let _capabilities: MediaCapabilities | null = null;
let _format = '';
let _voice = '';
let _speed = 1.0;

export function setTtsEnabled(v: boolean): void { _enabled = v; }
export function getTtsEnabled(): boolean { return _enabled; }
export function setTtsCapabilities(c: MediaCapabilities): void { _capabilities = c; }
export function getTtsCapabilities(): MediaCapabilities | null { return _capabilities; }
export function setTtsFormat(f: string): void { _format = f; }
export function getTtsFormat(): string { return _format; }
export function setTtsVoice(v: string): void { _voice = v; }
export function getTtsVoice(): string { return _voice; }
export function setTtsSpeed(s: number): void { _speed = s; }
export function getTtsSpeed(): number { return _speed; }
