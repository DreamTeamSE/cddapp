import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBleHandlerService } from '../../services/device/ble-handler-service.ts';
import { createEsp32PacketDecoder } from '../../services/device/esp32-packet-decoder.ts';
import { createManualMeasurementClock } from '../../services/measurement/clock.ts';
import { createPacketValidator } from '../../services/measurement/packet-validation.ts';

describe('ESP32 PPG packet decoder', () => {
  it('converts the firmware binary packet into checked red and infrared samples', () => {
    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1234, true);
    view.setFloat32(4, 15.5, true);
    view.setFloat32(8, -8.25, true);

    const decoder = createEsp32PacketDecoder({ deviceId: 'esp32-1', acquisitionId: 'test-session' });
    const packets = decoder.decode(bytes) as any[];

    assert.equal(packets.length, 1);
    assert.equal(packets[0].identity.deviceId, 'esp32-1');
    assert.equal(packets[0].acquisitionTime.ticks, 1234);
    assert.equal(packets[0].chunks[0].channelId, 'red-ac');
    assert.equal(packets[0].chunks[0].samples[0], 15.5);
    assert.equal(packets[0].chunks[1].channelId, 'infrared-ac');
    assert.equal(packets[0].chunks[1].samples[0], -8.25);
  });

  it('decodes every sample when a BLE notification contains more than one packet', () => {
    const bytes = new Uint8Array(24);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1000, true);
    view.setFloat32(4, 1, true);
    view.setFloat32(8, 2, true);
    view.setUint32(12, 1020, true);
    view.setFloat32(16, 3, true);
    view.setFloat32(20, 4, true);

    const decoder = createEsp32PacketDecoder({ deviceId: 'esp32-1', acquisitionId: 'test-session' });
    const packets = decoder.decode(bytes) as any[];

    assert.equal(packets.length, 2);
    assert.equal(packets[0].identity.windowId, 'sample-0');
    assert.equal(packets[1].identity.windowId, 'sample-1');
    assert.equal(packets[1].chunks[0].samples[0], 3);
  });

  it('passes real ESP32 bytes through the existing validation and reassembly pipeline', async () => {
    let notification: ((bytes: Uint8Array) => void) | undefined;
    const platform = {
      async scan() { return async () => {}; },
      async connect(_deviceId: string, onNotification: (bytes: Uint8Array) => void) { notification = onNotification; },
      async disconnect() {},
    };
    const service = createBleHandlerService(
      platform,
      createEsp32PacketDecoder({ deviceId: 'esp32-1', acquisitionId: 'test-session' }),
      createPacketValidator({ maxPacketsPerWindow: 1, maxChannelsPerWindow: 2, maxSamplesPerChannel: 1, maxSamplesPerPacket: 2, maxIdentifierLength: 128 }),
      createManualMeasurementClock(500),
    );
    const windows: any[] = [];
    service.subscribe((event) => { if (event.type === 'window') windows.push(event.window); });
    await service.connect('esp32-1');

    const bytes = new Uint8Array(12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 2222, true);
    view.setFloat32(4, 9.5, true);
    view.setFloat32(8, 12.5, true);
    notification?.(bytes);

    assert.equal(windows.length, 1);
    assert.equal(windows[0].channels[0].samples[0], 9.5);
    assert.equal(windows[0].channels[1].samples[0], 12.5);
  });
});
