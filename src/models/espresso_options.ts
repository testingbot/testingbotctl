export type TestSize = 'small' | 'medium' | 'large';
export type ReportFormat = 'html' | 'junit';
export type ThrottleNetwork = '4G' | '3G' | 'Edge' | 'airplane';

export interface RunMetadata {
  commitSha?: string;
  pullRequestId?: string;
  repoName?: string;
  repoOwner?: string;
}

export interface CustomNetworkProfile {
  uploadSpeed: number; // kbps
  downloadSpeed: number; // kbps
  latency: number; // ms
  loss: number; // percentage
}

export interface EspressoCapabilities {
  platformName: 'Android';
  deviceName: string;
  version?: string;
  realDevice?: string;
  tabletOnly?: boolean;
  phoneOnly?: boolean;
  name?: string;
  build?: string;
}

export interface EspressoRunOptions {
  testRunner?: string;
  class?: string[];
  notClass?: string[];
  package?: string[];
  notPackage?: string[];
  annotation?: string[];
  notAnnotation?: string[];
  size?: TestSize[];
  // Localization
  language?: string;
  locale?: string;
  timeZone?: string;
  // Geolocation
  geoLocation?: string;
  // Network throttling
  throttle_network?: ThrottleNetwork | CustomNetworkProfile;
}

export default class EspressoOptions {
  private _app: string;
  private _testApp: string;
  private _device?: string;
  private _version?: string;
  private _realDevice: boolean;
  private _tabletOnly: boolean;
  private _phoneOnly: boolean;
  private _name?: string;
  private _build?: string;
  // Espresso-specific options
  private _testRunner?: string;
  private _class?: string[];
  private _notClass?: string[];
  private _package?: string[];
  private _notPackage?: string[];
  private _annotation?: string[];
  private _notAnnotation?: string[];
  private _size?: TestSize[];
  // Localization
  private _language?: string;
  private _locale?: string;
  private _timeZone?: string;
  // Geolocation
  private _geoLocation?: string;
  // Network throttling
  private _throttleNetwork?: ThrottleNetwork | CustomNetworkProfile;
  // Execution mode
  private _quiet: boolean;
  private _async: boolean;
  private _report?: ReportFormat;
  private _reportOutputDir?: string;
  // Metadata
  private _metadata?: RunMetadata;

  public constructor(
    app: string,
    testApp: string,
    device?: string,
    options?: {
      version?: string;
      realDevice?: boolean;
      tabletOnly?: boolean;
      phoneOnly?: boolean;
      name?: string;
      build?: string;
      testRunner?: string;
      class?: string[];
      notClass?: string[];
      package?: string[];
      notPackage?: string[];
      annotation?: string[];
      notAnnotation?: string[];
      size?: TestSize[];
      language?: string;
      locale?: string;
      timeZone?: string;
      geoLocation?: string;
      throttleNetwork?: ThrottleNetwork | CustomNetworkProfile;
      quiet?: boolean;
      async?: boolean;
      report?: ReportFormat;
      reportOutputDir?: string;
      metadata?: RunMetadata;
    },
  ) {
    this._app = app;
    this._testApp = testApp;
    this._device = device;
    this._version = options?.version;
    this._realDevice = options?.realDevice ?? false;
    this._tabletOnly = options?.tabletOnly ?? false;
    this._phoneOnly = options?.phoneOnly ?? false;
    this._name = options?.name;
    this._build = options?.build;
    this._testRunner = options?.testRunner;
    this._class = options?.class;
    this._notClass = options?.notClass;
    this._package = options?.package;
    this._notPackage = options?.notPackage;
    this._annotation = options?.annotation;
    this._notAnnotation = options?.notAnnotation;
    this._size = options?.size;
    this._language = options?.language;
    this._locale = options?.locale;
    this._timeZone = options?.timeZone;
    this._geoLocation = options?.geoLocation;
    this._throttleNetwork = options?.throttleNetwork;
    this._quiet = options?.quiet ?? false;
    this._async = options?.async ?? false;
    this._report = options?.report;
    this._reportOutputDir = options?.reportOutputDir;
    this._metadata = options?.metadata;
  }

  public get app(): string {
    return this._app;
  }

  public get testApp(): string {
    return this._testApp;
  }

  public get device(): string | undefined {
    return this._device;
  }

  public get version(): string | undefined {
    return this._version;
  }

  public get realDevice(): boolean {
    return this._realDevice;
  }

  public get tabletOnly(): boolean {
    return this._tabletOnly;
  }

  public get phoneOnly(): boolean {
    return this._phoneOnly;
  }

  public get name(): string | undefined {
    return this._name;
  }

  public get build(): string | undefined {
    return this._build;
  }

  public get testRunner(): string | undefined {
    return this._testRunner;
  }

  public get class(): string[] | undefined {
    return this._class;
  }

  public get notClass(): string[] | undefined {
    return this._notClass;
  }

  public get package(): string[] | undefined {
    return this._package;
  }

  public get notPackage(): string[] | undefined {
    return this._notPackage;
  }

  public get annotation(): string[] | undefined {
    return this._annotation;
  }

  public get notAnnotation(): string[] | undefined {
    return this._notAnnotation;
  }

  public get size(): TestSize[] | undefined {
    return this._size;
  }

  public get language(): string | undefined {
    return this._language;
  }

  public get locale(): string | undefined {
    return this._locale;
  }

  public get timeZone(): string | undefined {
    return this._timeZone;
  }

  public get geoLocation(): string | undefined {
    return this._geoLocation;
  }

  public get throttleNetwork():
    | ThrottleNetwork
    | CustomNetworkProfile
    | undefined {
    return this._throttleNetwork;
  }

  public get quiet(): boolean {
    return this._quiet;
  }

  public get async(): boolean {
    return this._async;
  }

  public get report(): ReportFormat | undefined {
    return this._report;
  }

  public get reportOutputDir(): string | undefined {
    return this._reportOutputDir;
  }

  public get metadata(): RunMetadata | undefined {
    return this._metadata;
  }

  public getCapabilities(): EspressoCapabilities {
    const caps: EspressoCapabilities = {
      platformName: 'Android',
      deviceName: this._device || '*',
    };

    if (this._version) caps.version = this._version;
    if (this._realDevice) caps.realDevice = 'true';
    if (this._tabletOnly) caps.tabletOnly = true;
    if (this._phoneOnly) caps.phoneOnly = true;
    if (this._name) caps.name = this._name;
    if (this._build) caps.build = this._build;

    return caps;
  }

  public getEspressoOptions(): EspressoRunOptions | undefined {
    const opts: EspressoRunOptions = {};

    if (this._testRunner) opts.testRunner = this._testRunner;
    if (this._class && this._class.length > 0) opts.class = this._class;
    if (this._notClass && this._notClass.length > 0)
      opts.notClass = this._notClass;
    if (this._package && this._package.length > 0) opts.package = this._package;
    if (this._notPackage && this._notPackage.length > 0)
      opts.notPackage = this._notPackage;
    if (this._annotation && this._annotation.length > 0)
      opts.annotation = this._annotation;
    if (this._notAnnotation && this._notAnnotation.length > 0)
      opts.notAnnotation = this._notAnnotation;
    if (this._size && this._size.length > 0) opts.size = this._size;
    // Localization
    if (this._language) opts.language = this._language;
    if (this._locale) opts.locale = this._locale;
    if (this._timeZone) opts.timeZone = this._timeZone;
    // Geolocation
    if (this._geoLocation) opts.geoLocation = this._geoLocation;
    // Network throttling
    if (this._throttleNetwork) opts.throttle_network = this._throttleNetwork;

    return Object.keys(opts).length > 0 ? opts : undefined;
  }
}
