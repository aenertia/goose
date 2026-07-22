import * as ort from 'onnxruntime-web';
import { SAMPLE_RATE } from '@aaif/voice-shared/voice/constants.js';

const MODEL_URL = '/models/silero_vad_v5.onnx';
const FRAME_SIZE = 512;
const H_SHAPE: [number, number, number] = [2, 1, 64];
const H_DIM = 2 * 1 * 64;

export class SileroVAD {
  private session: ort.InferenceSession | null = null;
  private h = new Float32Array(H_DIM);
  private c = new Float32Array(H_DIM);
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
    const h = new ort.Tensor('float32', this.h, H_SHAPE);
    const c = new ort.Tensor('float32', this.c, H_SHAPE);
    const results = await this.session.run({ input, sr, h, c });
    this.h = new Float32Array(results.hn.data as ArrayLike<number>);
    this.c = new Float32Array(results.cn.data as ArrayLike<number>);
    return (results.output.data as Float32Array)[0];
  }

  reset(): void {
    this.h = new Float32Array(H_DIM);
    this.c = new Float32Array(H_DIM);
  }
}
