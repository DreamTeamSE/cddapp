export interface LivePpgSample {
  readonly timestampMs: number;
  readonly redAC: number;
  readonly irAC: number;
}

export interface LiveChannelPrediction {
  readonly sbp: number;
  readonly dbp: number;
  readonly inferenceMs: number;
}

export interface LivePredictionResult {
  readonly timestampMs: number;
  readonly bufferedSeconds: number;
  readonly red: LiveChannelPrediction;
  readonly infrared: LiveChannelPrediction;
}

/**
 * LivePpgBuffer manages a rolling window of PPG samples received from
 * an ESP32 stream (via BLE or WebSocket). It retains recent history and provides
 * 125 Hz linearly-resampled 3,750-sample windows compatible with AnyPPG.
 */
export class LivePpgBuffer {
  private samples: LivePpgSample[] = [];
  private readonly maxRetentionMs: number;

  constructor(maxRetentionMs = 45000) {
    this.maxRetentionMs = maxRetentionMs;
  }

  addSample(sample: LivePpgSample): void {
    if (!Number.isFinite(sample.timestampMs) || !Number.isFinite(sample.redAC) || !Number.isFinite(sample.irAC)) {
      return;
    }
    this.samples.push(sample);
    const cutoff = sample.timestampMs - this.maxRetentionMs;
    while (this.samples.length > 0 && this.samples[0].timestampMs < cutoff) {
      this.samples.shift();
    }
  }

  addSamples(newSamples: readonly LivePpgSample[]): void {
    for (const sample of newSamples) {
      this.addSample(sample);
    }
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get durationMs(): number {
    if (this.samples.length < 2) return 0;
    return this.samples[this.samples.length - 1].timestampMs - this.samples[0].timestampMs;
  }

  get durationSeconds(): number {
    return this.durationMs / 1000;
  }

  isReady(minSeconds = 30): boolean {
    return this.durationSeconds >= minSeconds;
  }

  /**
   * Resamples the most recent 30 seconds of the requested channel to a uniform 125 Hz grid
   * (3,750 samples, one sample every 8 ms), matching AnyPPG's prepareRecording linear interpolation.
   */
  getLatestWindow(channel: 'red' | 'infrared', windowSeconds = 30): Float32Array | null {
    if (!this.isReady(windowSeconds) || this.samples.length < 2) return null;

    const targetSamples = windowSeconds * 125; // 3750 samples for 30s
    const lastSample = this.samples[this.samples.length - 1];
    const endT = lastSample.timestampMs;
    const startT = endT - (targetSamples - 1) * 8; // 8ms intervals

    const signal = new Float32Array(targetSamples);
    let right = 1;

    for (let i = 0; i < targetSamples; i++) {
      const t = startT + i * 8;
      while (right < this.samples.length - 1 && this.samples[right].timestampMs < t) {
        right++;
      }
      const left = Math.max(0, right - 1);
      const tLeft = this.samples[left].timestampMs;
      const tRight = this.samples[right].timestampMs;
      const valLeft = channel === 'red' ? this.samples[left].redAC : this.samples[left].irAC;
      const valRight = channel === 'red' ? this.samples[right].redAC : this.samples[right].irAC;

      if (tRight === tLeft) {
        signal[i] = valLeft;
      } else {
        const slope = (valRight - valLeft) / (tRight - tLeft);
        signal[i] = valLeft + slope * (t - tLeft);
      }
    }

    return signal;
  }

  /**
   * Returns recent normalized points for rendering a live waveform sparkline/graph in the UI.
   */
  getRecentWaveform(pointCount = 50): { red: number[]; infrared: number[] } {
    if (this.samples.length === 0) return { red: [], infrared: [] };
    const slice = this.samples.slice(-pointCount);
    return {
      red: slice.map((s) => s.redAC),
      infrared: slice.map((s) => s.irAC),
    };
  }

  clear(): void {
    this.samples = [];
  }
}
