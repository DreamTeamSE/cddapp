#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <SparkFun_Bio_Sensor_Hub_Library.h>
#include <Wire.h>

// BLE UUID definitions (matching cddapp services/device/bleStreamService.ts)
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// Hardware pins for XIAO ESP32-C3 & MAX32664 Bio Sensor Hub
const int resPin = 2;
const int mfioPin = 1;
SparkFun_Bio_Sensor_Hub bioHub(resPin, mfioPin);
bioData body;

// Baseline tracking for AC signal calculation
float redBaseline = 0.0f;
float irBaseline  = 0.0f;
const float alpha = 0.01f;
bool baselineInitialized = false;

// 12-byte packed binary packet: uint32 + float32 + float32
struct __attribute__((packed)) PpgBlePacket {
    uint32_t timestamp_ms;
    float redAC;
    float irAC;
};

class BleServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
        deviceConnected = true;
        Serial.println("[BLE] Phone connected!");
    }

    void onDisconnect(BLEServer* pServer) {
        deviceConnected = false;
        Serial.println("[BLE] Phone disconnected.");
    }
};

void setup() {
    Serial.begin(115200);
    Wire.begin();

    Serial.println("\n--- Starting CDD Wearable PPG BLE System ---");

    // Initialize MAX32664 sensor
    int result = bioHub.begin();
    if (!result) {
        Serial.println("[Sensor] Sensor started successfully!");
    } else {
        Serial.println("[Sensor] ERROR: Could not communicate with sensor.");
    }

    int error = bioHub.configSensor();
    if (!error) {
        Serial.println("[Sensor] Sensor configured for Red/IR readout.");
    } else {
        Serial.print("[Sensor] Error configuring sensor: ");
        Serial.println(error);
    }

    // Initialize BLE
    BLEDevice::init("CDD-Wearable");
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new BleServerCallbacks());

    BLEService *pService = pServer->createService(SERVICE_UUID);
    pCharacteristic = pService->createCharacteristic(
        CHARACTERISTIC_UUID,
        BLECharacteristic::PROPERTY_READ |
        BLECharacteristic::PROPERTY_NOTIFY
    );

    pCharacteristic->addDescriptor(new BLE2902());
    pService->start();

    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(true);
    pAdvertising->setMinPreferred(0x06); // functions that help with iPhone connections
    pAdvertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("[BLE] Advertising as 'CDD-Wearable'. Ready to stream!");
    delay(4000); // Allow sensor FIFO to begin accumulating
}

void loop() {
    // Read raw sensor FIFO
    if (bioHub.numSamplesOutFifo() > 0) {
        body = bioHub.readSensor();

        uint32_t redRaw = body.redLed;
        uint32_t irRaw  = body.irLed;

        if (!baselineInitialized) {
            redBaseline = (float)redRaw;
            irBaseline  = (float)irRaw;
            baselineInitialized = true;
            return;
        }

        // Exponential moving average baseline removal
        redBaseline += alpha * ((float)redRaw - redBaseline);
        irBaseline  += alpha * ((float)irRaw  - irBaseline);

        float redAC = (float)redRaw - redBaseline;
        float irAC  = (float)irRaw  - irBaseline;
        uint32_t nowMs = millis();

        // 1. Also print to USB Serial for debugging/logging
        Serial.print(nowMs);
        Serial.print(',');
        Serial.print(redAC);
        Serial.print(',');
        Serial.println(irAC);

        // 2. Transmit over BLE notification to phone if connected
        if (deviceConnected) {
            PpgBlePacket packet;
            packet.timestamp_ms = nowMs;
            packet.redAC = redAC;
            packet.irAC  = irAC;

            pCharacteristic->setValue((uint8_t*)&packet, sizeof(PpgBlePacket));
            pCharacteristic->notify();
        }
    }

    // Manage reconnection advertising
    if (!deviceConnected && oldDeviceConnected) {
        delay(500); // give the bluetooth stack the chance to get things ready
        pServer->startAdvertising(); // restart advertising
        Serial.println("[BLE] Restarted advertising.");
        oldDeviceConnected = deviceConnected;
    }
    if (deviceConnected && !oldDeviceConnected) {
        oldDeviceConnected = deviceConnected;
    }

    delay(2);
}
