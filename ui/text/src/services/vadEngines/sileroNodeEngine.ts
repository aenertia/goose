import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { VadEngine, VadEngineId } from '@aaif/voice-shared/voice/vadEngine.js';
import { SAMPLE_RATE, SILERO_FRAME_SIZE, SILERO_STATE_DIM } from '@aaif/voice-shared/voice/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODEL_PATH = join(__dirname, 'models', 'silero_vad_v6.onnx');
const STATE_SHAPE: [number, number, number] = [2, 1, SILERO_STATE_DIM];

export class SileroNodeEngine implements VadEngine {
  readonly name: VadEngineId = 'silero-v6';
  readonly frameSamples = SILERO_FRAME_SIZE;

  private ort: typeof import('onnxruntime-node') | null = null;
  private session: InstanceType<typeof import('onnxruntime-node').InferenceSession> | null = null;
  private state = new Float32Array(2 * SILERO_STATE_DIM);
  private _isReady = false;

  async init(): Promise<boolean> {
    try {
      this.ort = await import('onnxruntime-node');
      const modelBuffer = readFileSync(MODEL_PATH);
      this.session = await this.ort.InferenceSession.create(modelBuffer.buffer);
      this._isReady = true;
      return true;
    } catch (err) {
      console.warn('[SileroNodeEngine] init failed:', err);
      return false;
    }
  }

  async processFrame(samples: Float32Array): Promise<number> {
    if (!this.session || !this.ort) return 0;
    const input = new this.ort.Tensor('float32', samples, [1, SILERO_FRAME_SIZE]);
    const sr = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
    const state = new this.ort.Tensor('float32', this.state, STATE_SHAPE);
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
    this.ort = null;
    this._isReady = false;
  }
}
