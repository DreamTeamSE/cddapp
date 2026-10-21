import { Asset } from 'expo-asset';
import { standardizeWindow, applyHead } from './core';
import { createAdapter } from './ort';
import type { LiveChannelPrediction } from '../measurement/livePpgBuffer';

const head = require('../../assets/models/anyppg/ridge_head.json');

interface CachedAdapter {
  run: (window: Float32Array) => Promise<{ features: Float32Array; inferenceMs: number }>;
  release: () => Promise<void>;
}

let cachedAdapterPromise: Promise<CachedAdapter> | null = null;

async function getOrInitAdapter(): Promise<CachedAdapter> {
  if (cachedAdapterPromise) return cachedAdapterPromise;

  cachedAdapterPromise = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require('../../assets/models/anyppg/anyppg_encoder.onnx'));
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Bundled AnyPPG model is unavailable.');
    const ortModule = await import('onnxruntime-react-native');
    return createAdapter({ ort: ortModule, uri: asset.localUri });
  })();

  return cachedAdapterPromise;
}

export async function predictLiveChannel(window3750: Float32Array): Promise<LiveChannelPrediction> {
  const normalized = standardizeWindow(Float64Array.from(window3750));
  const adapter = await getOrInitAdapter();
  const result = await adapter.run(normalized);
  const bp = applyHead(result.features, head);
  return {
    sbp: bp[0],
    dbp: bp[1],
    inferenceMs: result.inferenceMs,
  };
}

export async function predictLiveChannels(
  redWindow: Float32Array,
  irWindow: Float32Array
): Promise<{ red: LiveChannelPrediction; infrared: LiveChannelPrediction }> {
  const red = await predictLiveChannel(redWindow);
  const infrared = await predictLiveChannel(irWindow);
  return { red, infrared };
}

export async function releaseLiveAdapter(): Promise<void> {
  if (cachedAdapterPromise) {
    try {
      const adapter = await cachedAdapterPromise;
      await adapter.release();
    } catch {
      // Ignored during shutdown
    } finally {
      cachedAdapterPromise = null;
    }
  }
}
