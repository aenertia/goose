export interface MediaInhibitService {
  inhibit(reason: string): Promise<void>;
  release(): Promise<void>;
  dispose(): Promise<void>;
}
