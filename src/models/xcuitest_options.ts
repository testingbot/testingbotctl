export default class XCUITestOptions {
  private _app: string;
  private _testApp: string;
  private _device: string;

  public constructor(app: string, testApp: string, device: string) {
    this._app = app;
    this._testApp = testApp;
    this._device = device;
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
}
