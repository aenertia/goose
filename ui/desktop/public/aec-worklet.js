class AecProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this._taps = 256;
    this._mu = 0.1;
    this._eps = 1e-8;
    this._w = new Float32Array(this._taps);
    this._xBuf = new Float32Array(this._taps);
    this._enabled = false;

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'setEnabled') {
        this._enabled = !!data.enabled;
        if (!this._enabled) {
          this._w.fill(0);
          this._xBuf.fill(0);
        }
      }
    };
  }

  process(inputs, _outputs) {
    const mic = inputs[0]?.[0];
    const ref = inputs[1]?.[0];

    if (!mic?.length) return true;

    if (this._enabled && ref?.length) {
      const out = new Float32Array(mic.length);
      for (let n = 0; n < mic.length; n++) {
        this._xBuf.copyWithin(1, 0, this._taps - 1);
        this._xBuf[0] = ref[n];

        let echo = 0;
        for (let k = 0; k < this._taps; k++) echo += this._w[k] * this._xBuf[k];

        const e = mic[n] - echo;
        out[n] = e;

        let xNorm = this._eps;
        for (let k = 0; k < this._taps; k++) xNorm += this._xBuf[k] * this._xBuf[k];
        const muNorm = this._mu / xNorm;
        for (let k = 0; k < this._taps; k++) this._w[k] += muNorm * e * this._xBuf[k];
      }
      this.port.postMessage(out);
    } else {
      this.port.postMessage(new Float32Array(mic));
    }

    return true;
  }
}

registerProcessor('aec-processor', AecProcessor);
