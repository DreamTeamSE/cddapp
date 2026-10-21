import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';
import type { BlePlatformAdapter } from './ble-handler-service.ts';
import {
  ESP32_PPG_CHARACTERISTIC_UUID,
  ESP32_PPG_DEVICE_NAME,
  ESP32_PPG_SERVICE_UUID,
} from './esp32-packet-decoder';

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Native react-native-ble-plx adapter for the CDD ESP32 firmware. */
export function createEsp32BlePlatformAdapter(): BlePlatformAdapter {
  const manager = new BleManager();
  let monitoredDevice: Device | null = null;
  let notificationSubscription: Subscription | null = null;

  return {
    async scan(onDevice, signal) {
      const stop = () => {
        manager.stopDeviceScan();
      };
      if (signal?.aborted) {
        stop();
        throw new Error('BLE scan cancelled.');
      }
      const abort = () => stop();
      signal?.addEventListener('abort', abort, { once: true });

      manager.startDeviceScan([ESP32_PPG_SERVICE_UUID], null, (error, device) => {
        if (error) {
          stop();
          return;
        }
        if (device && (device.name === ESP32_PPG_DEVICE_NAME || device.localName === ESP32_PPG_DEVICE_NAME)) {
          onDevice({ id: device.id, name: device.name ?? device.localName, rssi: device.rssi ?? null });
        }
      });

      return async () => {
        signal?.removeEventListener('abort', abort);
        stop();
      };
    },

    async connect(deviceId, onNotification, signal) {
      if (signal?.aborted) throw new Error('BLE connection cancelled.');
      const device = await manager.connectToDevice(deviceId);
      if (signal?.aborted) {
        await manager.cancelDeviceConnection(device.id);
        throw new Error('BLE connection cancelled.');
      }
      monitoredDevice = await device.discoverAllServicesAndCharacteristics();
      notificationSubscription = monitoredDevice.monitorCharacteristicForService(
        ESP32_PPG_SERVICE_UUID,
        ESP32_PPG_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          try {
            onNotification(decodeBase64(characteristic.value));
          } catch {
            // The handler reports decoder failures through its normal error event.
            onNotification(new Uint8Array());
          }
        },
      );
    },

    async disconnect() {
      notificationSubscription?.remove();
      notificationSubscription = null;
      if (monitoredDevice) await manager.cancelDeviceConnection(monitoredDevice.id);
      monitoredDevice = null;
    },
  };
}
