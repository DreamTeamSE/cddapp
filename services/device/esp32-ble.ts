import type { BlePlatformAdapter } from './ble-handler-service.ts';

/** Web/simulator fallback. Real ESP32 BLE requires a custom native app build. */
export function createEsp32BlePlatformAdapter(): BlePlatformAdapter {
  throw new Error('ESP32 BLE is available only in an installed iOS or Android build.');
}
