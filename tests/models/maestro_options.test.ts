import MaestroOptions from '../../src/models/maestro_options';

describe('MaestroOptions', () => {
  describe('constructor', () => {
    it('should create options with required fields only', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8');

      expect(options.app).toBe('app.apk');
      expect(options.flows).toBe('./flows');
      expect(options.device).toBe('Pixel 8');
      expect(options.platformName).toBeUndefined();
      expect(options.version).toBeUndefined();
      expect(options.name).toBeUndefined();
      expect(options.build).toBeUndefined();
      expect(options.orientation).toBeUndefined();
      expect(options.locale).toBeUndefined();
      expect(options.timeZone).toBeUndefined();
      expect(options.throttleNetwork).toBeUndefined();
      expect(options.geoCountryCode).toBeUndefined();
      expect(options.env).toBeUndefined();
      expect(options.maestroVersion).toBeUndefined();
      expect(options.quiet).toBe(false);
      expect(options.async).toBe(false);
    });

    it('should create options with all optional fields', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        includeTags: ['smoke'],
        excludeTags: ['flaky'],
        platformName: 'Android',
        version: '14',
        name: 'Test Run',
        build: 'build-456',
        orientation: 'LANDSCAPE',
        locale: 'de_DE',
        timeZone: 'Europe/Berlin',
        throttleNetwork: '3G',
        geoCountryCode: 'DE',
        env: { API_URL: 'https://api.example.com', API_KEY: 'secret' },
        maestroVersion: '2.0.10',
        quiet: true,
        async: true,
      });

      expect(options.app).toBe('app.apk');
      expect(options.flows).toBe('./flows');
      expect(options.device).toBe('Pixel 8');
      expect(options.includeTags).toEqual(['smoke']);
      expect(options.excludeTags).toEqual(['flaky']);
      expect(options.platformName).toBe('Android');
      expect(options.version).toBe('14');
      expect(options.name).toBe('Test Run');
      expect(options.build).toBe('build-456');
      expect(options.orientation).toBe('LANDSCAPE');
      expect(options.locale).toBe('de_DE');
      expect(options.timeZone).toBe('Europe/Berlin');
      expect(options.throttleNetwork).toBe('3G');
      expect(options.geoCountryCode).toBe('DE');
      expect(options.env).toEqual({
        API_URL: 'https://api.example.com',
        API_KEY: 'secret',
      });
      expect(options.maestroVersion).toBe('2.0.10');
      expect(options.quiet).toBe(true);
      expect(options.async).toBe(true);
    });

    it('should default async to false when not specified', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        platformName: 'Android',
      });

      expect(options.async).toBe(false);
    });
  });

  describe('getCapabilities', () => {
    it('should infer Android platform and wildcard device for .apk when not provided', () => {
      const options = new MaestroOptions('app.apk', './flows');
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'Android',
      });
    });

    it('should infer Android platform and wildcard device for .apks when not provided', () => {
      const options = new MaestroOptions('app.apks', './flows');
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'Android',
      });
    });

    it('should infer iOS platform and wildcard device for .ipa when not provided', () => {
      const options = new MaestroOptions('app.ipa', './flows');
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'iOS',
      });
    });

    it('should infer iOS platform and wildcard device for .app when not provided', () => {
      const options = new MaestroOptions('app.app', './flows');
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'iOS',
      });
    });

    it('should infer iOS platform and wildcard device for .zip when not provided', () => {
      const options = new MaestroOptions('app.zip', './flows');
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'iOS',
      });
    });

    it('should infer platform but use provided device', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8');
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: 'Pixel 8',
        platformName: 'Android',
      });
    });

    it('should use provided platform but infer wildcard device', () => {
      const options = new MaestroOptions('app.apk', './flows', undefined, {
        platformName: 'iOS',
      });
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'iOS',
      });
    });

    it('should use both provided device and platform', () => {
      const options = new MaestroOptions('app.apk', './flows', 'iPhone 15', {
        platformName: 'iOS',
      });
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: 'iPhone 15',
        platformName: 'iOS',
      });
    });

    it('should return all capabilities when provided', () => {
      const options = new MaestroOptions('app.ipa', './flows', 'iPhone 15', {
        platformName: 'iOS',
        version: '17.2',
        name: 'iOS Test',
        build: 'ios-build-1',
        orientation: 'PORTRAIT',
        locale: 'en_GB',
        timeZone: 'Europe/London',
        throttleNetwork: 'Edge',
        geoCountryCode: 'GB',
      });
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: 'iPhone 15',
        platformName: 'iOS',
        version: '17.2',
        name: 'iOS Test',
        build: 'ios-build-1',
        orientation: 'PORTRAIT',
        locale: 'en_GB',
        timeZone: 'Europe/London',
        throttleNetwork: 'Edge',
        geoCountryCode: 'GB',
      });
    });

    it('should only include defined capabilities', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 6', {
        platformName: 'Android',
        version: '13',
        // Other options not provided
      });
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: 'Pixel 6',
        platformName: 'Android',
        version: '13',
      });
      expect(caps).not.toHaveProperty('name');
      expect(caps).not.toHaveProperty('build');
      expect(caps).not.toHaveProperty('orientation');
      expect(caps).not.toHaveProperty('locale');
      expect(caps).not.toHaveProperty('timeZone');
      expect(caps).not.toHaveProperty('throttleNetwork');
      expect(caps).not.toHaveProperty('geoCountryCode');
    });

    it('should not include includeTags and excludeTags in capabilities', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        includeTags: ['smoke', 'regression'],
        excludeTags: ['flaky'],
        platformName: 'Android',
      });
      const caps = options.getCapabilities();

      expect(caps).toEqual({
        deviceName: 'Pixel 8',
        platformName: 'Android',
      });
      expect(caps).not.toHaveProperty('includeTags');
      expect(caps).not.toHaveProperty('excludeTags');
    });

    it('should use detected platform when no platform provided', () => {
      const options = new MaestroOptions('app.zip', './flows');
      const caps = options.getCapabilities('Android');

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'Android',
      });
    });

    it('should prefer explicit platform over detected platform', () => {
      const options = new MaestroOptions('app.apk', './flows', undefined, {
        platformName: 'iOS',
      });
      const caps = options.getCapabilities('Android');

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'iOS',
      });
    });

    it('should fall back to extension when no platform provided and no detection', () => {
      const options = new MaestroOptions('app.apk', './flows');
      const caps = options.getCapabilities(undefined);

      expect(caps).toEqual({
        deviceName: '*',
        platformName: 'Android',
      });
    });
  });

  describe('getMaestroOptions', () => {
    it('should return undefined when no maestro options are set', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8');
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toBeUndefined();
    });

    it('should return includeTags when set', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        includeTags: ['smoke', 'regression'],
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        includeTags: ['smoke', 'regression'],
      });
    });

    it('should return excludeTags when set', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        excludeTags: ['flaky'],
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        excludeTags: ['flaky'],
      });
    });

    it('should return env when set', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        env: {
          API_URL: 'https://api.example.com',
          API_KEY: 'secret123',
        },
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        env: {
          API_URL: 'https://api.example.com',
          API_KEY: 'secret123',
        },
      });
    });

    it('should return all maestro options when set', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        includeTags: ['smoke'],
        excludeTags: ['flaky'],
        env: {
          API_URL: 'https://staging.example.com',
          TEST_USER: 'testuser@example.com',
          TEST_PASSWORD: 'secret123',
        },
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        includeTags: ['smoke'],
        excludeTags: ['flaky'],
        env: {
          API_URL: 'https://staging.example.com',
          TEST_USER: 'testuser@example.com',
          TEST_PASSWORD: 'secret123',
        },
      });
    });

    it('should not include empty arrays', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        includeTags: [],
        excludeTags: [],
        env: { API_KEY: 'secret' },
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        env: { API_KEY: 'secret' },
      });
    });

    it('should not include empty env object', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        includeTags: ['smoke'],
        env: {},
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        includeTags: ['smoke'],
      });
    });

    it('should not include capabilities in maestro options', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        platformName: 'Android',
        version: '14',
        name: 'Test',
        includeTags: ['smoke'],
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        includeTags: ['smoke'],
      });
      expect(maestroOpts).not.toHaveProperty('platformName');
      expect(maestroOpts).not.toHaveProperty('version');
      expect(maestroOpts).not.toHaveProperty('name');
    });

    it('should return maestroVersion when set', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        maestroVersion: '2.0.10',
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        version: '2.0.10',
      });
    });

    it('should return maestroVersion along with other options', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        includeTags: ['smoke'],
        excludeTags: ['flaky'],
        env: { API_KEY: 'secret' },
        maestroVersion: '2.0.10',
      });
      const maestroOpts = options.getMaestroOptions();

      expect(maestroOpts).toEqual({
        includeTags: ['smoke'],
        excludeTags: ['flaky'],
        env: { API_KEY: 'secret' },
        version: '2.0.10',
      });
    });
  });

  describe('report options', () => {
    it('should have undefined report and reportOutputDir by default', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8');

      expect(options.report).toBeUndefined();
      expect(options.reportOutputDir).toBeUndefined();
    });

    it('should store report format when provided', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        report: 'junit',
      });

      expect(options.report).toBe('junit');
    });

    it('should store html report format', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        report: 'html',
      });

      expect(options.report).toBe('html');
    });

    it('should store reportOutputDir when provided', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        reportOutputDir: './reports',
      });

      expect(options.reportOutputDir).toBe('./reports');
    });

    it('should store both report and reportOutputDir', () => {
      const options = new MaestroOptions('app.apk', './flows', 'Pixel 8', {
        report: 'junit',
        reportOutputDir: '/path/to/reports',
      });

      expect(options.report).toBe('junit');
      expect(options.reportOutputDir).toBe('/path/to/reports');
    });
  });
});
