import * as ort from 'onnxruntime-web';
import { SAMPLE_RATE } from '@aaif/voice-shared/voice/constants.js';

// Silero VAD v6 — upgraded from v5 for +26% noise rejection (ESC-50: 0.61→0.87).
// Same ONNX opset 16, same I/O contract, same frame size. Only retrained weights.
const MODEL_URL = '/models/silero_vad_v6.onnx';
const FRAME_SIZE = 512;
const STATE_SHAPE: [number, number, number] = [2, 1, 128];
const STATE_DIM = 2 * 1 * 128;

export class SileroVAD {
  private session: ort.InferenceSession | null = null;
  private state = new Float32Array(STATE_DIM);
  private _isReady = false;

  get isReady(): boolean { return this._isReady; }
  static readonly FRAME_SIZE = FRAME_SIZE;

  async init(): Promise<boolean> {
    try {
      this.session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      this._isReady = true;
      return true;
    } catch (err) {
      console.warn('[SileroVAD] init failed:', err);
      return false;
    }
  }

  async processFrame(samples: Float32Array): Promise<number> {
    if (!this.session) return 0;
    const input = new ort.Tensor('float32', samples, [1, FRAME_SIZE]);
    const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
    const state = new ort.Tensor('float32', this.state, STATE_SHAPE);
    const results = await this.session.run({ input, sr, state });
    this.state = new Float32Array(results.stateN.data as ArrayLike<number>);
    return (results.output.data as Float32Array)[0];
  }

  reset(): void {
    this.state = new Float32Array(STATE_DIM);
  }
}
