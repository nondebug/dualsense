class DualSenseHid extends EventTarget {
    static FILTERS = [
        { vendorId: 0x054c, productId: 0x0ce6 },  // DualSense
        { vendorId: 0x054c, productId: 0x0df2 },  // DualSense Edge
    ];

    constructor() {
        super();
        this.device = null;
        
        this.input = {
            axes: [0, 0, 0, 0],
            buttons: Array(19).fill().map(() => ({ value: 0, pressed: false, touched: false })),
            touches: [],
        };

        this._handleInputReport = this._handleInputReport.bind(this);
    }

    async connect() {
        try {
            let devices = await navigator.hid.getDevices();
            devices = devices.filter(d => DualSenseHid.FILTERS.some(f => d.vendorId == f.vendorId && d.productId == f.productId));

            if (devices.length === 0) {
                devices = await navigator.hid.requestDevice({ filters: DualSenseHid.FILTERS });
            }

            if (devices.length === 0) return false;

            this.device = devices[0];
            if (!this.device.opened) {
                await this.device.open();
            }

            this.device.addEventListener('inputreport', this._handleInputReport);
            return true;
        } catch (error) {
            return false;
        }
    }

    disconnect() {
        if (this.device) {
            this.device.removeEventListener('inputreport', this._handleInputReport);
            try { this.device.close(); } catch (e) { }
            this.device = null;
        }
    }

    async initialize() {
        if (!this.device) return;

        // Send output report 0x02 with all zeros to disable rumble emulation mode.
        try {
            await this.device.sendReport(0x02, new Uint8Array(47));
        } catch (e) {
            console.error('Failed to send output report 0x02:', e);
        }
    }

    _normalizeThumbStickAxis(value) { return (2 * value / 0xFF) - 1.0; }
    _normalizeTriggerAxis(value) { return value / 0xFF; }
    _normalizeButton(value) { return value ? 1.0 : 0.0; }

    _handleInputReport(event) {
        const { data, reportId } = event;
        if (reportId !== 0x01) return;

        const dpad = data.getUint8(7) & 0x0f;
        const buttons0 = data.getUint8(7);
        const buttons1 = data.getUint8(8);
        const buttons2 = data.getUint8(9);

        // Axes
        this.input.axes = [
            this._normalizeThumbStickAxis(data.getUint8(0)), // Left Stick X
            this._normalizeThumbStickAxis(data.getUint8(1)), // Left Stick Y
            this._normalizeThumbStickAxis(data.getUint8(2)), // Right Stick X
            this._normalizeThumbStickAxis(data.getUint8(3))  // Right Stick Y
        ];

        const l2axis = this._normalizeTriggerAxis(data.getUint8(4));
        const r2axis = this._normalizeTriggerAxis(data.getUint8(5));

        // Buttons
        const buttonValues = [
            this._normalizeButton(buttons0 & 0x20), // 0: Cross
            this._normalizeButton(buttons0 & 0x40), // 1: Circle
            this._normalizeButton(buttons0 & 0x10), // 2: Square
            this._normalizeButton(buttons0 & 0x80), // 3: Triangle
            this._normalizeButton(buttons1 & 0x01), // 4: L1
            this._normalizeButton(buttons1 & 0x02), // 5: R1
            l2axis,                                 // 6: L2
            r2axis,                                 // 7: R2
            this._normalizeButton(buttons1 & 0x10), // 8: Create
            this._normalizeButton(buttons1 & 0x20), // 9: Options
            this._normalizeButton(buttons1 & 0x40), // 10: L3
            this._normalizeButton(buttons1 & 0x80), // 11: R3
            this._normalizeButton(dpad == 0 || dpad == 1 || dpad == 7), // 12: Up
            this._normalizeButton(dpad == 3 || dpad == 4 || dpad == 5), // 13: Down
            this._normalizeButton(dpad == 5 || dpad == 6 || dpad == 7), // 14: Left
            this._normalizeButton(dpad == 1 || dpad == 2 || dpad == 3), // 15: Right
            this._normalizeButton(buttons2 & 0x01), // 16: PS
            this._normalizeButton(buttons2 & 0x02), // 17: Touchpad Click
            this._normalizeButton(buttons2 & 0x04)  // 18: Mute
        ];

        this.input.buttons = buttonValues.map(b => ({ value: b, pressed: b > 0, touched: b > 0 }));

        // Touchpad
        this.input.touches = [];
        if (!(data.getUint8(32) & 0x80)) { // Touch 0 Active
            this.input.touches.push({
                id: data.getUint8(32) & 0x7F,
                x: ((data.getUint8(34) & 0x0F) << 8) | data.getUint8(33),
                y: (data.getUint8(35) << 4) | ((data.getUint8(34) & 0xF0) >> 4)
            });
        }
        if (!(data.getUint8(36) & 0x80)) { // Touch 1 Active
            this.input.touches.push({
                id: data.getUint8(36) & 0x7F,
                x: ((data.getUint8(38) & 0x0F) << 8) | data.getUint8(37),
                y: (data.getUint8(39) << 4) | ((data.getUint8(38) & 0xF0) >> 4)
            });
        }

        this.dispatchEvent(new CustomEvent('inputreport'));
    }
}
