import type { SensorPacket } from '../../types/measurement.ts';
import type { BlePacketDecoder } from './ble-handler-service.ts';

/** The UUIDs and twelve-byte notification layout used by CDD_BleDataCollection.ino. */
export const ESP32_PPG_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const ESP32_PPG_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const ESP32_PPG_DEVICE_NAME = 'CDD-Wearable';

const PACKET_BYTES = 12;

export interface Esp32PacketDecoderOptions {
  readonly deviceId: string;
  /** A new identifier for each phone-to-wearable connection. */
  readonly acquisitionId?: string;
}

/**
 * Converts the ESP32 firmware's packed notifications into the existing checked
 * SensorPacket shape. One notification sample becomes one complete, validated
 * two-channel window; the live buffer is responsible for combining those
 * samples into its rolling 30-second model window.
 */
export function createEsp32PacketDecoder(options: Esp32PacketDecoderOptions): BlePacketDecoder {
  if (!options.deviceId.trim()) throw new RangeError('deviceId is required.');
  const acquisitionId = options.acquisitionId ?? `phone-session-${Date.now()}`;
  let sequence = 0;

  return {
    decode(bytes: Uint8Array): readonly unknown[] {
      if (bytes.length === 0 || bytes.length % PACKET_BYTES !== 0) {
        throw new Error(`ESP32 PPG notification must contain one or more ${PACKET_BYTES}-byte samples.`);
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const packets: SensorPacket[] = [];
      for (let offset = 0; offset < bytes.length; offset += PACKET_BYTES) {
        const timestampMs = view.getUint32(offset, true);
        const redAc = view.getFloat32(offset + 4, true);
        const infraredAc = view.getFloat32(offset + 8, true);
        if (!Number.isFinite(redAc) || !Number.isFinite(infraredAc)) {
          throw new Error('ESP32 PPG notification contains a non-finite sample.');
        }

        const windowId = `sample-${sequence++}`;
        packets.push({
          identity: { source: 'bracelet', deviceId: options.deviceId, acquisitionId, windowId },
          manifest: {
            contractVersion: 'cdd-esp32-ppg-v1',
            packetCount: 1,
            channels: [
              { channelId: 'red-ac', sampleCount: 1 },
              { channelId: 'infrared-ac', sampleCount: 1 },
            ],
          },
          packetIndex: 0,
          chunks: [
            { channelId: 'red-ac', sampleOffset: 0, samples: [redAc], unit: 'sensor-ac-counts', timing: { sampleRateHz: null, firstSampleOffsetMs: 0 } },
            { channelId: 'infrared-ac', sampleOffset: 0, samples: [infraredAc], unit: 'sensor-ac-counts', timing: { sampleRateHz: null, firstSampleOffsetMs: 0 } },
          ],
          receivedAtMs: Date.now(),
          acquisitionTime: { kind: 'device-ticks', ticks: timestampMs, ticksPerSecond: 1000, clockId: 'esp32-millis-v1' },
        });
      }
      return packets;
    },
  };
}
