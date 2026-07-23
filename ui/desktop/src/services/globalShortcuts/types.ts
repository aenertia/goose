export interface ShortcutBinding {
  id: string;
  description: string;
  accelerator: string;
  callback: () => void;
}

export interface ShortcutService {
  register(bindings: ShortcutBinding[]): Promise<void>;
  unregisterAll(): Promise<void>;
  dispose(): Promise<void>;
}
