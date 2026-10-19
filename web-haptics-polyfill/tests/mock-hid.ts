// Mock HIDDevice and environment for DualSense testing

export class MockHIDDevice extends EventTarget {
  opened = false;
  vendorId: number;
  productId: number;
  productName: string;
  collections: any[];

  sentReports: Array<{ reportId: number; data: Uint8Array }> = [];
  receivedFeatureReports: number[] = [];

  oninputreport: ((this: MockHIDDevice, ev: any) => any) | null = null;

  constructor(vendorId = 0x054c, productId = 0x0ce6, maxInputBits = 504) {
    super();
    this.vendorId = vendorId;
    this.productId = productId;
    this.productName = 'Mock Sony DualSense Wireless Controller';
    this.collections = [
      {
        usagePage: 0x0001,
        usage: 0x0005,
        inputReports: [
          {
            items: [
              {
                reportSize: 8,
                reportCount: maxInputBits / 8
              }
            ]
          }
        ]
      }
    ];
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    const arr = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    this.sentReports.push({ reportId, data: new Uint8Array(arr) });
  }

  async receiveFeatureReport(reportId: number): Promise<DataView> {
    this.receivedFeatureReports.push(reportId);
    return new DataView(new ArrayBuffer(64));
  }

  dispatchMockInputReport(reportId: number, payload: Uint8Array): void {
    const event = {
      device: this,
      reportId,
      data: new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    };
    if (this.oninputreport) {
      this.oninputreport.call(this, event as any);
    }
  }
}
