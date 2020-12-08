# Sony DualSense Wireless Controller for PlayStation 5

[Product page](https://www.playstation.com/en-us/accessories/dualsense-wireless-controller/)

[DualSense explorer tool](dualsense-explorer.html)

## Inputs

* Thumbsticks (analog): **Left stick**, **Right stick**
* Action buttons: **Cross**, **Circle**, **Square**, **Triangle**
* Directional buttons: **Up**, **Down**, **Left**, **Right**
* Bumpers: **L1**, **R1**
* Triggers (pressure-sensitive): **L2**, **R2**
* Thumbstick buttons: **L3**, **R3**
* **Create** button
* **Options** button
* **PS** button
* **Mute** button
* **Touch pad** button (click)
* **Touch pad** multitouch (touchpoints)
* **Microphone** (audio input)
* **Headset jack** (audio input)
* **Accelerometer**
* **Gyroscope**
* **Battery status**

## Outputs

* **Haptic feedback** (dual linear resonant actuators)
* **Adaptive triggers** (adjustable force and tension)
* **Light bar** (RGB LED)
* **Speaker** (audio output)
* **Headset jack** (audio output)

## USB

Vendor ID: `0x054c`  
Product ID: `0x0ce6`  
Product name: Wireless Controller

[lsusb output](lsusb-descriptor-info.txt)

[Parsed HID report descriptor](report-descriptor-usb.txt)  
Raw HID report descriptor (273 bytes):

```
05 01 09 05 a1 01 85 01 09 30 09 31 09 32 09 35
09 33 09 34 15 00 26 ff 00 75 08 95 06 81 02 06
00 ff 09 20 95 01 81 02 05 01 09 39 15 00 25 07
35 00 46 3b 01 65 14 75 04 95 01 81 42 65 00 05
09 19 01 29 0f 15 00 25 01 75 01 95 0f 81 02 06
00 ff 09 21 95 0d 81 02 06 00 ff 09 22 15 00 26
ff 00 75 08 95 34 81 02 85 02 09 23 95 2f 91 02
85 05 09 33 95 28 b1 02 85 08 09 34 95 2f b1 02
85 09 09 24 95 13 b1 02 85 0a 09 25 95 1a b1 02
85 20 09 26 95 3f b1 02 85 21 09 27 95 04 b1 02
85 22 09 40 95 3f b1 02 85 80 09 28 95 3f b1 02
85 81 09 29 95 3f b1 02 85 82 09 2a 95 09 b1 02
85 83 09 2b 95 3f b1 02 85 84 09 2c 95 3f b1 02
85 85 09 2d 95 02 b1 02 85 a0 09 2e 95 01 b1 02
85 e0 09 2f 95 3f b1 02 85 f0 09 30 95 3f b1 02
85 f1 09 31 95 3f b1 02 85 f2 09 32 95 0f b1 02
85 f4 09 35 95 3f b1 02 85 f5 09 36 95 03 b1 02
c0
```

## Bluetooth

Vendor ID: `0x054c`  
Product ID: `0x0ce6`  
Product name: Wireless Controller

[Parsed HID report descriptor](report-descriptor-bluetooth.txt)  
Raw HID report descriptor (280 bytes):

```
05 01 09 05 a1 01 85 01 09 30 09 31 09 32 09 35
15 00 26 ff 00 75 08 95 04 81 02 09 39 15 00 25
07 35 00 46 3b 01 65 14 75 04 95 01 81 42 65 00
05 09 19 01 29 0e 15 00 25 01 75 01 95 0e 81 02
75 06 95 01 81 01 05 01 09 33 09 34 15 00 26 ff
00 75 08 95 02 81 02 06 00 ff 15 00 26 ff 00 75
08 95 4d 85 31 09 31 91 02 09 3b 81 02 85 32 09
32 95 8d 91 02 85 33 09 33 95 cd 91 02 85 34 09
34 96 0d 01 91 02 85 35 09 35 96 4d 01 91 02 85
36 09 36 96 8d 01 91 02 85 37 09 37 96 cd 01 91
02 85 38 09 38 96 0d 02 91 02 85 39 09 39 96 22
02 91 02 06 80 ff 85 05 09 33 95 28 b1 02 85 08
09 34 95 2f b1 02 85 09 09 24 95 13 b1 02 85 20
09 26 95 3f b1 02 85 22 09 40 95 3f b1 02 85 80
09 28 95 3f b1 02 85 81 09 29 95 3f b1 02 85 82
09 2a 95 09 b1 02 85 83 09 2b 95 3f b1 02 85 f1
09 31 95 3f b1 02 85 f2 09 32 95 0f b1 02 85 f0
09 30 95 3f b1 02 c0 00
```

## Input reports

Button and axis inputs are provided by the input report with report ID 0x01. DualSense uses slightly different input reports for USB and Bluetooth connection modes.

Sample USB input report, all inputs neutral (64 bytes):

```
01 7e 81 84 84 00 00 4b 08 00 00 00 ac 0a af 14
f2 ff 0a 00 f2 ff b8 ff ff 1d 9e 08 da 8f e8 ae
1b fc 3e 00 26 f9 7f 87 0b bd 09 09 00 00 00 00
00 92 a0 e8 ae 29 08 00 b0 7e c8 76 f8 cc a2 2b
```

USB report map (input report 0x01):

```
byte 0, bit 0: Report ID - 8 bits
    always 0x01
byte 1, bit 0: Generic Desktop / X - 8 bits - left stick X axis
    left: 0x00, right: 0xff, neutral: ~0x80
byte 2, bit 0: Generic Desktop / Y - 8 bits - left stick Y axis
    up: 0x00, down: 0xff, neutral: ~0x80
byte 3, bit 0: Generic Desktop / Z - 8 bits - right stick X axis
    left: 0x00, right: 0xff, neutral: ~0x80
byte 4, bit 0: Generic Desktop / Rz - 8 bits - right stick Y axis
    up: 0x00, down: 0xff, neutral: ~0x80
byte 5, bit 0: Generic Desktop / Rx - 8 bits - L2 trigger axis
    neutral: 0x00, pressed: 0xff
byte 6, bit 0: Generic Desktop / Ry - 8 bits - R2 trigger axis
    neutral: 0x00, pressed: 0xff
byte 7, bit 0: Vendor defined 0xFF00 / 0x20 - 8 bits
byte 8, bit 0: Generic Desktop / Hat switch - 4 bits - directional buttons
    neutral: 0x8, N: 0x0, NE: 0x1, E: 0x2, SE: 0x3, S: 0x4, SW: 0x5, W: 0x6, NW: 0x7
byte 8, bit 4: Button / 0x01 - 1 bit - Square button
byte 8, bit 5: Button / 0x02 - 1 bit - Cross button
byte 8, bit 6: Button / 0x03 - 1 bit - Circle button
byte 8, bit 7: Button / 0x04 - 1 bit - Triangle button
byte 9, bit 0: Button / 0x05 - 1 bit - L1 button
byte 9, bit 1: Button / 0x06 - 1 bit - R1 button
byte 9, bit 2: Button / 0x07 - 1 bit - L2 button
byte 9, bit 3: Button / 0x08 - 1 bit - R2 button
byte 9, bit 4: Button / 0x09 - 1 bit - Create button
byte 9, bit 5: Button / 0x0a - 1 bit - Options button
byte 9, bit 6: Button / 0x0b - 1 bit - L3 button
byte 9, bit 7: Button / 0x0c - 1 bit - R3 button
byte 10, bit 0: Button / 0x0d - 1 bit - PS button
byte 10, bit 1: Button / 0x0e - 1 bit - Touchpad button
byte 10, bit 2: Button / 0x0f - 1 bit - Mute button
byte 10, bit 3: Vendor defined 0xFF00 / 0x21 - 13 bits
byte 12, bit 0: Vendor defined 0xFF00 / 0x22 - 52 bytes
```

Sample Bluetooth input report, all inputs neutral (10 bytes):

```
01 7d 7e 83 82 08 00 00 00 00
```

Bluetooth report map (input report 0x01):

```
byte 0, bit 0: Report ID - 8 bits
    always 0x01
byte 1, bit 0: Generic Desktop / X - 8 bits - left stick X axis
    left: 0x00, right: 0xff, neutral: ~0x80
byte 2, bit 0: Generic Desktop / Y - 8 bits - left stick Y axis
    up: 0x00, down: 0xff, neutral: ~0x80
byte 3, bit 0: Generic Desktop / Z - 8 bits - right stick X axis
    left: 0x00, right: 0xff, neutral: ~0x80
byte 4, bit 0: Generic Desktop / Rz - 8 bits - right stick Y axis
    up: 0x00, down: 0xff, neutral: ~0x80
byte 5, bit 0: Generic Desktop / Hat switch - 4 bits - directional buttons
    neutral: 0x8, N: 0x0, NE: 0x1, E: 0x2, SE: 0x3, S: 0x4, SW: 0x5, W: 0x6, NW: 0x7
byte 5, bit 4: Button / 0x01 - 1 bit - Square button
byte 5, bit 5: Button / 0x02 - 1 bit - Cross button
byte 5, bit 6: Button / 0x03 - 1 bit - Circle button
byte 5, bit 7: Button / 0x04 - 1 bit - Triangle button
byte 6, bit 0: Button / 0x05 - 1 bit - L1 button
byte 6, bit 1: Button / 0x06 - 1 bit - R1 button
byte 6, bit 2: Button / 0x07 - 1 bit - L2 button
byte 6, bit 3: Button / 0x08 - 1 bit - R2 button
byte 6, bit 4: Button / 0x09 - 1 bit - Create button
byte 6, bit 5: Button / 0x0a - 1 bit - Options button
byte 6, bit 6: Button / 0x0b - 1 bit - L3 button
byte 6, bit 7: Button / 0x0c - 1 bit - R3 button
byte 7, bit 0: Button / 0x0d - 1 bit - PS button
byte 7, bit 1: Button / 0x0e - 1 bit - Touchpad button
byte 7, bit 2: Vendor defined 0xFF00 / 0x21 - 6 bits
byte 8, bit 0: Generic Desktop / Rx - 8 bits - L2 axis
    neutral: 0x00, pressed: 0xff
byte 9, bit 0: Generic Desktop / Ry - 8 bits - R2 axis
    neutral: 0x00, pressed: 0xff
```
