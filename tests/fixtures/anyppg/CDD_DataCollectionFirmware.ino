#include <SparkFun_Bio_Sensor_Hub_Library.h>
#include <Wire.h>

// No other address options..
#define DEF_ADDR 0x55

// Reset pin, MFIO pin
const int resPin = 2;
const int mfioPin = 1;

// Takes reset pin and MFIO pin.
SparkFun_Bio_Sensor_Hub bioHub(resPin, mfioPin);

bioData body;

// Slowly changing DC baselines
float redBaseline = 0.0f;
float irBaseline  = 0.0f;

// Baseline adaptation rate
// Smaller = slower/smoother baseline
const float alpha = 0.01f;

bool baselineInitialized = false;

// 5-second windows at approximately 50 samples/second
const int WINDOW_SIZE = 250;

float redWindow[WINDOW_SIZE];
float irWindow[WINDOW_SIZE];

int sampleIndex = 0;

// Normalizes one window to zero mean and unit standard deviation
void normalizeWindow(float data[], int size)
{
    float mean = 0.0f;

    for (int i = 0; i < size; i++)
    {
        mean += data[i];
    }

    mean /= size;

    float variance = 0.0f;

    for (int i = 0; i < size; i++)
    {
        float difference = data[i] - mean;
        variance += difference * difference;
    }

    variance /= size;

    float standardDeviation = sqrt(variance);

    // Prevent division by zero if the signal is constant
    if (standardDeviation < 0.001f)
    {
        standardDeviation = 1.0f;
    }

    for (int i = 0; i < size; i++)
    {
        data[i] = (data[i] - mean) / standardDeviation;
    }
}

void setup()
{
    Serial.begin(115200);

    Wire.begin();

    int result = bioHub.begin();

    if (!result)
        Serial.println("Sensor started!");
    else
        Serial.println("Could not communicate with the sensor!!!");

    Serial.println("Configuring Sensor....");

    // Configure both raw sensor and BPM algorithm data
    //int error = bioHub.configSensorBpm(MODE_TWO);
    int error = bioHub.configSensor();

    if (!error)
    {
        Serial.println("Sensor configured.");
    }
    else
    {
        Serial.println("Error configuring sensor.");
        Serial.print("Error: ");
        Serial.println(error);
    }

    // Allow sensor data to begin accumulating
    delay(4000);
}

void loop()
{
    // Read both raw LED and BPM algorithm data
    body = bioHub.readSensor();


    // --- Only tansmit data when new sample available, with DC offset removal ---
    if (bioHub.numSamplesOutFifo() > 0)
    {
        body = bioHub.readSensor();

        uint32_t redRaw = body.redLed;
        uint32_t irRaw  = body.irLed;

        if (!baselineInitialized)
        {
            redBaseline = redRaw;
            irBaseline  = irRaw;
            baselineInitialized = true;
            return;
        }

        redBaseline += alpha * ((float)redRaw - redBaseline);
        irBaseline  += alpha * ((float)irRaw - irBaseline);

        float redAC = (float)redRaw - redBaseline;
        float irAC  = (float)irRaw  - irBaseline;

        Serial.print(millis());
        Serial.print(',');
        Serial.print(redAC);
        Serial.print(',');
        Serial.println(irAC);
    }

    delay(1);

}