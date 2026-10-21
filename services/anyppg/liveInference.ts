import type { LiveChannelPrediction } from '../measurement/livePpgBuffer';

export async function predictLiveChannel(_window3750: Float32Array): Promise<LiveChannelPrediction> {
  throw new Error('Live AnyPPG inference requires native ONNX Runtime. Run on physical iOS/Android build.');
}

export async function predictLiveChannels(
  _redWindow: Float32Array,
  _irWindow: Float32Array
): Promise<{ red: LiveChannelPrediction; infrared: LiveChannelPrediction }> {
  throw new Error('Live AnyPPG inference requires native ONNX Runtime. Run on physical iOS/Android build.');
}

export async function releaseLiveAdapter(): Promise<void> {
  // No-op on web/stub
}
