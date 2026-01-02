import packageJson from '../package.json';
import logger from './logger';
import pc from 'picocolors';

let versionCheckDisplayed = false;

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
