export interface MediaControlService {
  pauseAll(): Promise<string[]>;
  resumePaused(tokens: string[]): Promise<void>;
  dispose(): Promise<void>;
}
