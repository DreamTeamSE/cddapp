import type { LivePpgSample } from '../measurement/livePpgBuffer';

export type BleStreamState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'simulating';

export interface BleStreamListener {
  onStateChange?: (state: BleStreamState) => void;
  onSample?: (sample: LivePpgSample) => void;
  onError?: (error: string) => void;
}

export const ESP32_DEFAULT_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const ESP32_DEFAULT_CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

export class BleStreamService {
  private state: BleStreamState = 'disconnected';
  private listeners: Set<BleStreamListener> = new Set();
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private simulationTimeMs = 0;
  private syntheticRows: readonly (readonly number[])[] | null = null;
  private syntheticRowIndex = 0;

  getState(): BleStreamState {
    return this.state;
  }

  subscribe(listener: BleStreamListener): () => void {
    this.listeners.add(listener);
    listener.onStateChange?.(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(newState: BleStreamState) {
    this.state = newState;
    for (const l of this.listeners) {
      l.onStateChange?.(newState);
    }
  }

  private emitSample(sample: LivePpgSample) {
    for (const l of this.listeners) {
      l.onSample?.(sample);
    }
  }

  private emitError(err: string) {
    for (const l of this.listeners) {
      l.onError?.(err);
    }
  }

  /**
   * Decodes notification bytes received from ESP32 characteristic.
   * Handles:
   * 1. 12-byte packed binary: [uint32 timestamp_ms, float32 redAC, float32 irAC]
   * 2. Multiple 12-byte binary samples in one MTU
   * 3. ASCII CSV fallback: "1002,-1.4,2.8"
   */
  handleNotificationBytes(bytes: Uint8Array): void {
    try {
      // Binary packet: multiple of 12 bytes
      if (bytes.length >= 12 && bytes.length % 12 === 0) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const count = bytes.length / 12;
        for (let i = 0; i < count; i++) {
          const offset = i * 12;
          const timestampMs = view.getUint32(offset, true); // little-endian
          const redAC = view.getFloat32(offset + 4, true);
          const irAC = view.getFloat32(offset + 8, true);
          this.emitSample({ timestampMs, redAC, irAC });
        }
        return;
      }

      // Text ASCII fallback
      const text = String.fromCharCode(...bytes).trim();
      const parts = text.split(',');
      if (parts.length === 3) {
        const timestampMs = parseInt(parts[0], 10);
        const redAC = parseFloat(parts[1]);
        const irAC = parseFloat(parts[2]);
        if (Number.isFinite(timestampMs) && Number.isFinite(redAC) && Number.isFinite(irAC)) {
          this.emitSample({ timestampMs, redAC, irAC });
        }
      }
    } catch (e) {
      this.emitError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Starts a simulated stream using realistic reference PPG signals.
   * Emits samples at ~50 Hz (20 ms interval) to simulate ESP32 transmission.
   */
  startSimulation(customRows?: readonly (readonly number[])[]): void {
    this.disconnect();
    this.setState('simulating');

    if (customRows && customRows.length > 0) {
      this.syntheticRows = customRows;
    } else {
      try {
        const ref = require('../../assets/models/anyppg/synthetic_reference.json');
        this.syntheticRows = ref.rows;
      } catch {
        this.syntheticRows = null;
      }
    }

    this.syntheticRowIndex = 0;
    this.simulationTimeMs = Date.now();

    this.simulationInterval = setInterval(() => {
      this.simulationTimeMs += 20;

      let redAC: number;
      let irAC: number;

      if (this.syntheticRows && this.syntheticRows.length > 0) {
        const row = this.syntheticRows[this.syntheticRowIndex];
        redAC = row[1];
        irAC = row[2];
        this.syntheticRowIndex = (this.syntheticRowIndex + 1) % this.syntheticRows.length;
      } else {
        // Procedural PPG pulse synthesis fallback
        const t = this.simulationTimeMs / 1000;
        const pulse = Math.sin(2 * Math.PI * 1.2 * t) + 0.35 * Math.sin(4 * Math.PI * 1.2 * t);
        redAC = pulse * 15.0;
        irAC = pulse * 22.0;
      }

      this.emitSample({
        timestampMs: this.simulationTimeMs,
        redAC,
        irAC,
      });
    }, 20); // 50 Hz streaming rate
  }

  /**
   * Connect to real ESP32 Bluetooth peripheral.
   */
  async connectBle(deviceName = 'CDD-Wearable'): Promise<void> {
    this.disconnect();
    this.setState('scanning');

    try {
      // Dynamic import to allow graceful fallback when testing on non-native or dev web
      let BleModule: any;
      try {
        // @ts-ignore dynamic import for optional native BLE package
        BleModule = await import('react-native-ble-plx');
      } catch {
        throw new Error(
          'Native BLE module (react-native-ble-plx) is not linked in this build. For instant verification on phone/simulator, use "Test with Demo Signal". To connect real ESP32, build the native app via Xcode/EAS with BLE plugin.'
        );
      }

      const manager = new BleModule.BleManager();
      this.setState('scanning');

      manager.startDeviceScan(null, null, async (error: any, device: any) => {
        if (error) {
          manager.stopDeviceScan();
          this.setState('disconnected');
          this.emitError(`BLE scan failed: ${error.message}`);
          return;
        }

        if (device && (device.name === deviceName || device.localName === deviceName)) {
          manager.stopDeviceScan();
          this.setState('connecting');

          try {
            const connectedDevice = await device.connect();
            await connectedDevice.discoverAllServicesAndCharacteristics();
            this.setState('connected');

            // Monitor characteristic for streaming notifications
            connectedDevice.monitorCharacteristicForService(
              ESP32_DEFAULT_SERVICE_UUID,
              ESP32_DEFAULT_CHARACTERISTIC_UUID,
              (charError: any, characteristic: any) => {
                if (charError) {
                  this.emitError(charError.message);
                  return;
                }
                if (characteristic?.value) {
                  // characteristic.value is base64 encoded
                  const binaryString = atob(characteristic.value);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  this.handleNotificationBytes(bytes);
                }
              }
            );
          } catch (connErr: any) {
            this.setState('disconnected');
            this.emitError(`Failed to connect to ${deviceName}: ${connErr.message}`);
          }
        }
      });
    } catch (e: any) {
      this.setState('disconnected');
      this.emitError(e.message || String(e));
    }
  }

  disconnect(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.setState('disconnected');
  }
}

export const bleStreamService = new BleStreamService();
