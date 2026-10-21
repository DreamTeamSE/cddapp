import { createBleHandlerService, type BleHandlerService } from './ble-handler-service.ts';
import { createEsp32BlePlatformAdapter } from './esp32-ble';
import { createEsp32PacketDecoder } from './esp32-packet-decoder';
import { createSystemMeasurementClock } from '../measurement/clock.ts';
import { createPacketValidator } from '../measurement/packet-validation.ts';

/**
 * The existing checked BLE pipeline, configured for the current ESP32 firmware.
 * Consumers receive validated `window` events containing one red and one infrared
 * sample, which can be added to LivePpgBuffer for rolling inference.
 */
export function createEsp32BleHandler(deviceId: string): BleHandlerService {
  return createBleHandlerService(
    createEsp32BlePlatformAdapter(),
    createEsp32PacketDecoder({ deviceId }),
    createPacketValidator({
      maxPacketsPerWindow: 1,
      maxChannelsPerWindow: 2,
      maxSamplesPerChannel: 1,
      maxSamplesPerPacket: 2,
      maxIdentifierLength: 128,
    }),
    createSystemMeasurementClock(),
  );
}
