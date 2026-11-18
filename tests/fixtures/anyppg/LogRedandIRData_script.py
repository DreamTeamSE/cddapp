import serial
import csv
import time

# Open serial connection (make sure COM port is correct)
ser = serial.Serial('COM4', 115200, timeout=1)

# Give Arduino time to reset after opening serial
time.sleep(2)

# File path: datalogs/FirstLast_MM_DD_YY_IndependentVariable_IterationNum.csv
csv_path = 'datalogs/example_capture.csv'

with open(csv_path, 'w', newline='') as file:
    writer = csv.writer(file)
    # Time in ms
    writer.writerow(['time_stamp_millis', 'RawRed', 'RawIR'])
    print("File opened!")

    try:
        while True:
            # Read one full line from Arduino
            line = ser.readline().decode('utf-8', errors='ignore').strip()

            # Skip empty lines or startup messages
            if not line or not line[0].isdigit():
                continue

            print(line)

            # Split CSV values
            data = line.split(',')

            # Ensure correct format
            if len(data) == 3:
                try:
                    # Convert to floats for clean data
                    row = [float(x) for x in data]
                    writer.writerow(row)
                    file.flush()  # save immediately
                except ValueError:
                    print("Skipped non-numeric row:", data)
            else:
                print("Skipped malformed line:", line)

    except KeyboardInterrupt:
        print("\nStopped logging.")

    finally:
        ser.close()

