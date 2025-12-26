export interface MaestroConfig {
  flows?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  executionOrder?: 'continue' | 'stop';
}

export type Orientation = 'PORTRAIT' | 'LANDSCAPE';
export type ThrottleNetwork = '4G' | '3G' | 'Edge' | 'airplane' | 'disable';
export type ReportFormat = 'html' | 'junit';

export interface MaestroCapabilities {
  platformName?: 'Android' | 'iOS';
  version?: string;
  deviceName: string;
  name?: string;
  orientation?: Orientation;
  locale?: string;
  timeZone?: string;
  throttleNetwork?: ThrottleNetwork;
  geoCountryCode?: string;
  realDevice?: string;
}

export interface MaestroRunOptions {
  includeTags?: string[];
  excludeTags?: string[];
  env?: Record<string, string>;
  version?: string;
}

export default class MaestroOptions {
  private _app: string;
  private _flows: string[];
  private _device?: string;
  private _includeTags?: string[];
  private _excludeTags?: string[];
  private _platformName?: 'Android' | 'iOS';
  private _version?: string;
  private _name?: string;
  private _orientation?: Orientation;
  private _locale?: string;
  private _timeZone?: string;
  private _throttleNetwork?: ThrottleNetwork;
  private _geoCountryCode?: string;
  private _env?: Record<string, string>;
  private _maestroVersion?: string;
  private _quiet: boolean;
  private _async: boolean;
  private _report?: ReportFormat;
  private _reportOutputDir?: string;
  private _realDevice: boolean;
  private _downloadArtifacts: boolean;
  private _artifactsOutputDir?: string;
  private _ignoreChecksumCheck: boolean;
  private _shardSplit?: number;

  public constructor(
    app: string,
    flows: string | string[],
    device?: string,
    options?: {
      includeTags?: string[];
      excludeTags?: string[];
      platformName?: 'Android' | 'iOS';
      version?: string;
      name?: string;
      orientation?: Orientation;
      locale?: string;
      timeZone?: string;
      throttleNetwork?: ThrottleNetwork;
      geoCountryCode?: string;
      env?: Record<string, string>;
      maestroVersion?: string;
      quiet?: boolean;
      async?: boolean;
      report?: ReportFormat;
      reportOutputDir?: string;
      realDevice?: boolean;
      downloadArtifacts?: boolean;
      artifactsOutputDir?: string;
      ignoreChecksumCheck?: boolean;
      shardSplit?: number;
    },
  ) {
    this._app = app;
    this._flows = flows ? (Array.isArray(flows) ? flows : [flows]) : [];
    this._device = device;
    this._includeTags = options?.includeTags;
    this._excludeTags = options?.excludeTags;
    this._platformName = options?.platformName;
    this._version = options?.version;
    this._name = options?.name;
    this._orientation = options?.orientation;
    this._locale = options?.locale;
    this._timeZone = options?.timeZone;
    this._throttleNetwork = options?.throttleNetwork;
    this._geoCountryCode = options?.geoCountryCode;
    this._env = options?.env;
    this._maestroVersion = options?.maestroVersion;
    this._quiet = options?.quiet ?? false;
    this._async = options?.async ?? false;
    this._report = options?.report;
    this._reportOutputDir = options?.reportOutputDir;
    this._realDevice = options?.realDevice ?? false;
    this._downloadArtifacts = options?.downloadArtifacts ?? false;
    this._artifactsOutputDir = options?.artifactsOutputDir;
    this._ignoreChecksumCheck = options?.ignoreChecksumCheck ?? false;
    this._shardSplit = options?.shardSplit;
  }

  public get app(): string {
    return this._app;
  }

  public get flows(): string[] {
    return this._flows;
  }

  public get device(): string | undefined {
    return this._device;
  }

  public get includeTags(): string[] | undefined {
    return this._includeTags;
  }

  public get excludeTags(): string[] | undefined {
    return this._excludeTags;
  }

  public get platformName(): 'Android' | 'iOS' | undefined {
    return this._platformName;
  }

  public get version(): string | undefined {
    return this._version;
  }

  public get name(): string | undefined {
    return this._name;
  }

  public get orientation(): Orientation | undefined {
    return this._orientation;
  }

  public get locale(): string | undefined {
    return this._locale;
  }

  public get timeZone(): string | undefined {
    return this._timeZone;
  }

  public get throttleNetwork(): ThrottleNetwork | undefined {
    return this._throttleNetwork;
  }

  public get geoCountryCode(): string | undefined {
    return this._geoCountryCode;
  }

  public get env(): Record<string, string> | undefined {
    return this._env;
  }

  public get maestroVersion(): string | undefined {
    return this._maestroVersion;
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

  public get realDevice(): boolean {
    return this._realDevice;
  }

  public get downloadArtifacts(): boolean {
    return this._downloadArtifacts;
  }

  public get artifactsOutputDir(): string | undefined {
    return this._artifactsOutputDir;
  }

  public get ignoreChecksumCheck(): boolean {
    return this._ignoreChecksumCheck;
  }

  public get shardSplit(): number | undefined {
    return this._shardSplit;
  }

  public getMaestroOptions(): MaestroRunOptions | undefined {
    const opts: MaestroRunOptions = {};

    if (this._includeTags && this._includeTags.length > 0) {
      opts.includeTags = this._includeTags;
    }
    if (this._excludeTags && this._excludeTags.length > 0) {
      opts.excludeTags = this._excludeTags;
    }
    if (this._env && Object.keys(this._env).length > 0) {
      opts.env = this._env;
    }
    if (this._maestroVersion) {
      opts.version = this._maestroVersion;
    }

    return Object.keys(opts).length > 0 ? opts : undefined;
  }

  public getCapabilities(
    detectedPlatform?: 'Android' | 'iOS',
  ): MaestroCapabilities {
    // Use provided platform, or detected platform, or default based on extension
    let platformName = this._platformName ?? detectedPlatform;
    let deviceName = this._device;

    // Fallback to extension-based detection if no platform determined
    if (!platformName) {
      const ext = this._app?.toLowerCase().split('.').pop();
      const isAndroid = ext === 'apk' || ext === 'apks';
      platformName = isAndroid ? 'Android' : 'iOS';
    }

    // Default device to wildcard if not specified
    if (!deviceName) {
      deviceName = '*';
    }

    const caps: MaestroCapabilities = {
      deviceName,
      platformName,
    };

    if (this._version) caps.version = this._version;
    if (this._name) caps.name = this._name;
    if (this._orientation) caps.orientation = this._orientation;
    if (this._locale) caps.locale = this._locale;
    if (this._timeZone) caps.timeZone = this._timeZone;
    if (this._throttleNetwork) caps.throttleNetwork = this._throttleNetwork;
    if (this._geoCountryCode) caps.geoCountryCode = this._geoCountryCode;
    if (this._realDevice) caps.realDevice = 'true';

    return caps;
  }
}
