import utils from '../src/utils';
import logger from '../src/logger';

jest.mock('../src/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
}));

describe('utils', () => {
  describe('getUserAgent', () => {
    it('should return user agent with version', () => {
      const userAgent = utils.getUserAgent();
      expect(userAgent).toMatch(/^TestingBot-CTL-\d+\.\d+\.\d+$/);
    });
  });

  describe('getCurrentVersion', () => {
    it('should return current version from package.json', () => {
      const version = utils.getCurrentVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('compareVersions', () => {
    it('should return 0 for equal versions', () => {
      expect(utils.compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(utils.compareVersions('2.1.3', '2.1.3')).toBe(0);
    });

    it('should return -1 when first version is lower', () => {
      expect(utils.compareVersions('1.0.0', '1.0.1')).toBe(-1);
      expect(utils.compareVersions('1.0.0', '1.1.0')).toBe(-1);
      expect(utils.compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(utils.compareVersions('1.9.9', '2.0.0')).toBe(-1);
    });

    it('should return 1 when first version is higher', () => {
      expect(utils.compareVersions('1.0.1', '1.0.0')).toBe(1);
      expect(utils.compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(utils.compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(utils.compareVersions('2.0.0', '1.9.9')).toBe(1);
    });

    it('should handle versions with different lengths', () => {
      expect(utils.compareVersions('1.0', '1.0.0')).toBe(0);
      expect(utils.compareVersions('1.0.0', '1.0')).toBe(0);
      expect(utils.compareVersions('1.0', '1.0.1')).toBe(-1);
      expect(utils.compareVersions('1.0.1', '1.0')).toBe(1);
    });
  });

  describe('checkForUpdate', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Reset the versionCheckDisplayed flag by reimporting (or use a reset method if available)
    });

    it('should not warn when no latest version provided', () => {
      utils.checkForUpdate(undefined);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should not warn when current version equals latest version', () => {
      const currentVersion = utils.getCurrentVersion();
      utils.checkForUpdate(currentVersion);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should not warn when current version is higher than latest', () => {
      utils.checkForUpdate('0.0.1');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('isWildcardDevice', () => {
    it('should return true for undefined device', () => {
      expect(utils.isWildcardDevice(undefined)).toBe(true);
    });

    it('should return true for wildcard "*"', () => {
      expect(utils.isWildcardDevice('*')).toBe(true);
    });

    it('should return true for patterns containing "*"', () => {
      expect(utils.isWildcardDevice('Pixel*')).toBe(true);
      expect(utils.isWildcardDevice('Pixel 9*')).toBe(true);
      expect(utils.isWildcardDevice('*Pro')).toBe(true);
    });

    it('should return true for patterns containing ".*"', () => {
      expect(utils.isWildcardDevice('Pixel.*')).toBe(true);
      expect(utils.isWildcardDevice('iPhone.*Pro')).toBe(true);
    });

    it('should return true for patterns containing "?"', () => {
      expect(utils.isWildcardDevice('Pixel ?')).toBe(true);
      expect(utils.isWildcardDevice('iPhone 1?')).toBe(true);
    });

    it('should return false for specific device names', () => {
      expect(utils.isWildcardDevice('Pixel 9 Pro')).toBe(false);
      expect(utils.isWildcardDevice('iPhone 15')).toBe(false);
      expect(utils.isWildcardDevice('Samsung Galaxy S24')).toBe(false);
    });
  });

  describe('isWildcardVersion', () => {
    it('should return true for undefined version', () => {
      expect(utils.isWildcardVersion(undefined)).toBe(true);
    });

    it('should return true for wildcard "*"', () => {
      expect(utils.isWildcardVersion('*')).toBe(true);
    });

    it('should return true for patterns containing "*"', () => {
      expect(utils.isWildcardVersion('15*')).toBe(true);
      expect(utils.isWildcardVersion('15.*')).toBe(true);
    });

    it('should return true for patterns containing "?"', () => {
      expect(utils.isWildcardVersion('15.?')).toBe(true);
    });

    it('should return false for specific versions', () => {
      expect(utils.isWildcardVersion('15')).toBe(false);
      expect(utils.isWildcardVersion('15.0')).toBe(false);
      expect(utils.isWildcardVersion('15.0.1')).toBe(false);
    });
  });

  describe('showRealDeviceFlowsInfo', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should not show info when not using real device', () => {
      utils.showRealDeviceFlowsInfo({
        realDevice: false,
        device: 'Pixel 9 Pro',
        flowCount: 5,
      });
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should not show info when device is a wildcard', () => {
      utils.showRealDeviceFlowsInfo({
        realDevice: true,
        device: '*',
        flowCount: 5,
      });
      expect(logger.info).not.toHaveBeenCalled();

      utils.showRealDeviceFlowsInfo({
        realDevice: true,
        device: 'Pixel.*',
        flowCount: 5,
      });
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should not show info when flow count is 2 or less', () => {
      utils.showRealDeviceFlowsInfo({
        realDevice: true,
        device: 'Pixel 9 Pro',
        flowCount: 2,
      });
      expect(logger.info).not.toHaveBeenCalled();

      utils.showRealDeviceFlowsInfo({
        realDevice: true,
        device: 'Pixel 9 Pro',
        flowCount: 1,
      });
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should not show info when shardSplit is specified', () => {
      utils.showRealDeviceFlowsInfo({
        realDevice: true,
        device: 'Pixel 9 Pro',
        flowCount: 5,
        shardSplit: 2,
      });
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
