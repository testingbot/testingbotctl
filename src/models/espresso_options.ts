export default class EspressoOptions {
  private _app: string;
  private _testApp: string;
  private _device: string;
  private _emulator: string;

  public constructor(
    app: string,
    testApp: string,
    device: string,
    emulator: string,
  ) {
    this._app = app;
    this._testApp = testApp;
    this._device = device;
    this._emulator = emulator;
  }

  public get app(): string {
    return this._app;
  }

  public get testApp(): string {
    return this._testApp;
  }

  public get device(): string {
    return this._device;
  }

  public get emulator(): string {
    return this._emulator;
  }
}
