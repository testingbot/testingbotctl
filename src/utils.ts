import packageJson from '../package.json';
import logger from './logger';
import pc from 'picocolors';

let versionCheckDisplayed = false;
let realDeviceFlowsInfoDisplayed = false;

export default {
  getUserAgent(): string {
    return `TestingBot-CTL-${packageJson.version}`;
  },

  getCurrentVersion(): string {
    return packageJson.version;
  },

  /**
   * Compare two semver version strings
   * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    return 0;
  },

  /**
   * Check if a device specification is a wildcard or regex pattern
   */
  isWildcardDevice(device: string | undefined): boolean {
    if (!device) return true;
    // Check for common wildcard/regex characters
    return device === '*' || device.includes('*') || device.includes('?') || device.includes('.*');
  },

  /**
   * Check if a version specification is a wildcard or regex pattern
   */
  isWildcardVersion(version: string | undefined): boolean {
    if (!version) return true;
    // Check for common wildcard/regex characters
    return version === '*' || version.includes('*') || version.includes('?') || version.includes('.*');
  },

  /**
   * Show info message when running many flows on a specific real device without sharding
   */
  showRealDeviceFlowsInfo(options: {
    realDevice: boolean;
    device?: string;
    version?: string;
    flowCount: number;
    shardSplit?: number;
  }): void {
    // Only show once
    if (realDeviceFlowsInfoDisplayed) {
      return;
    }

    // Check conditions: real device, specific device, more than 2 flows, no shards
    if (
      !options.realDevice ||
      this.isWildcardDevice(options.device) ||
      options.flowCount <= 2 ||
      options.shardSplit
    ) {
      return;
    }

    realDeviceFlowsInfoDisplayed = true;
    const border = '─'.repeat(80);

    logger.info('');
    logger.info(pc.cyan(border));
    logger.info(pc.cyan('ℹ  Performance Tip'));
    logger.info(
      pc.cyan(
        `   Running ${options.flowCount} flows on a specific device (${options.device}) in real device mode.`,
      ),
    );
    logger.info(
      pc.cyan(
        '   Each flow runs in its own session on that device, which may be slow.',
      ),
    );
    logger.info(pc.cyan(''));
    logger.info(pc.cyan('   Consider these alternatives for faster execution:'));
    logger.info(
      pc.cyan(
        `   • Use ${pc.white('--shard-split <n>')} to run multiple flows in the same session`,
      ),
    );
    logger.info(
      pc.cyan(
        `   • Use wildcards for device (e.g., ${pc.white('"Pixel.*"')}) to parallelize across devices`,
      ),
    );
    if (!this.isWildcardVersion(options.version)) {
      logger.info(
        pc.cyan(
          `   • Use wildcards for version (e.g., ${pc.white('"15.*"')}) for broader device selection`,
        ),
      );
    }
    logger.info(pc.cyan(border));
    logger.info('');
  },

  /**
   * Check if a newer version is available and display update notice
   */
  checkForUpdate(latestVersion: string | undefined): void {
    if (!latestVersion || versionCheckDisplayed) {
      return;
    }

    const currentVersion = this.getCurrentVersion();
    if (this.compareVersions(currentVersion, latestVersion) < 0) {
      versionCheckDisplayed = true;
      const border = '─'.repeat(80);

      logger.info(`\nCLI Version: ${pc.cyan(currentVersion)}\n`);
      logger.warn(pc.yellow(border));
      logger.warn(pc.yellow('⚠  Update Available'));
      logger.warn(
        pc.yellow(
          `   A new version of the TestingBot CLI is available: ${pc.green(latestVersion)}`,
        ),
      );
      logger.warn(
        pc.yellow(
          `   Run: ${pc.cyan('npm install -g @testingbot/cli@latest')}`,
        ),
      );
      logger.warn(pc.yellow(border) + '\n');
    }
  },
};
