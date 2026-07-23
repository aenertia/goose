import * as ort from 'onnxruntime-web';
import type { VadEngine, VadEngineId } from '@aaif/voice-shared/voice/vadEngine.js';
import { SAMPLE_RATE, SILERO_FRAME_SIZE, SILERO_STATE_DIM } from '@aaif/voice-shared/voice/constants.js';

const MODEL_URL = '/models/silero_vad_v6.onnx';
const STATE_SHAPE: [number, number, number] = [2, 1, SILERO_STATE_DIM];

export class SileroV6Engine implements VadEngine {
  readonly name: VadEngineId = 'silero-v6';
  readonly frameSamples = SILERO_FRAME_SIZE;

  private session: ort.InferenceSession | null = null;
  private state = new Float32Array(2 * SILERO_STATE_DIM);
  private _isReady = false;

  get isReady(): boolean { return this._isReady; }

  async init(): Promise<boolean> {
    try {
      this.session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      this._isReady = true;
      return true;
    } catch (err) {
      console.warn('[SileroV6Engine] init failed:', err);
      return false;
    }
  }

  async processFrame(samples: Float32Array): Promise<number> {
    if (!this.session) return 0;
    const input = new ort.Tensor('float32', samples, [1, SILERO_FRAME_SIZE]);
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
    const state = new ort.Tensor('float32', this.state, STATE_SHAPE);
    const results = await this.session.run({ input, sr, state });
    this.state = new Float32Array(results.stateN.data as ArrayLike<number>);
    return (results.output.data as Float32Array)[0];
  }

  reset(): void {
    this.state = new Float32Array(2 * SILERO_STATE_DIM);
  }

  async destroy(): Promise<void> {
    await this.session?.release();
    this.session = null;
    this._isReady = false;
  }
}
