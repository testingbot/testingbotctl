import XCUITestOptions from '../models/xcuitest_options';
import logger from '../logger';
import Credentials from '../models/credentials';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { io, Socket } from 'socket.io-client';
import TestingBotError from '../models/testingbot_error';
import utils from '../utils';
import BaseProvider from './base_provider';

export interface XCUITestRunEnvironment {
  device?: string;
  name?: string;
  version?: string;
}

export interface XCUITestRunInfo {
  id: number;
  status: 'WAITING' | 'READY' | 'DONE' | 'FAILED';
  capabilities: {
    deviceName: string;
    platformName: string;
    version?: string;
  };
  environment?: XCUITestRunEnvironment;
  success: number;
  report?: string;
}

export interface XCUITestStatusResponse {
  runs: XCUITestRunInfo[];
  success: boolean;
  completed: boolean;
}

export interface XCUITestResult {
  success: boolean;
  runs: XCUITestRunInfo[];
}

export interface XCUITestSocketMessage {
  id: number;
  payload: string;
}

export default class XCUITest extends BaseProvider<XCUITestOptions> {
  protected readonly URL =
    'https://api.testingbot.com/v1/app-automate/xcuitest';

  private socket: Socket | null = null;
  private updateServer: string | null = null;
  private updateKey: string | null = null;

  public constructor(credentials: Credentials, options: XCUITestOptions) {
    super(credentials, options);
  }

  private async validate(): Promise<boolean> {
    if (this.options.app === undefined) {
      throw new TestingBotError(`app option is required`);
    }

    if (this.options.testApp === undefined) {
      throw new TestingBotError(`testApp option is required`);
    }

    // Validate report options
    if (this.options.report && !this.options.reportOutputDir) {
      throw new TestingBotError(
        `--report-output-dir is required when --report is specified`,
      );
    }

    // Validate file access in parallel for better performance
    const fileChecks = [
      fs.promises.access(this.options.app, fs.constants.R_OK).catch(() => {
        throw new TestingBotError(
          `Provided app path does not exist ${this.options.app}`,
        );
      }),
      fs.promises.access(this.options.testApp, fs.constants.R_OK).catch(() => {
        throw new TestingBotError(
          `testApp path does not exist ${this.options.testApp}`,
        );
      }),
    ];

    if (this.options.reportOutputDir) {
      fileChecks.push(this.ensureOutputDirectory(this.options.reportOutputDir));
    }

    await Promise.all(fileChecks);

    return true;
  }

  public async run(): Promise<XCUITestResult> {
    if (!(await this.validate())) {
      return { success: false, runs: [] };
    }

    try {
      // Quick connectivity check before starting uploads
      await this.ensureConnectivity();

      if (!this.options.quiet) {
        logger.info('Uploading XCUITest App');
      }
      await this.uploadApp();

      if (!this.options.quiet) {
        logger.info('Uploading XCUITest Test App');
      }
      await this.uploadTestApp();

      if (!this.options.quiet) {
        logger.info('Running XCUITests');
      }
      await this.runTests();

      if (this.options.async) {
        if (!this.options.quiet) {
          logger.info(`Tests started in async mode. Project ID: ${this.appId}`);
        }
        return { success: true, runs: [] };
      }

      // Set up signal handlers before waiting for completion
      this.setupSignalHandlers();

      // Connect to real-time update server (unless --quiet is specified)
      this.connectToUpdateServer();

      if (!this.options.quiet) {
        logger.info('Waiting for test results...');
      }
      const result = await this.waitForCompletion();

      // Clean up
      this.disconnectFromUpdateServer();
      this.removeSignalHandlers();

      return result;
    } catch (error) {
      // Clean up on error
      this.disconnectFromUpdateServer();
      this.removeSignalHandlers();

      logger.error(error instanceof Error ? error.message : error);
      if (error instanceof Error && error.cause) {
        const causeMessage = this.extractErrorMessage(error.cause);
        if (causeMessage) {
          logger.error(`  Reason: ${causeMessage}`);
        }
      }
      return { success: false, runs: [] };
    }
  }

  private async uploadApp() {
    const result = await this.upload.upload({
      filePath: this.options.app,
      url: `${this.URL}/app`,
      credentials: this.credentials,
      contentType: 'application/octet-stream',
      showProgress: !this.options.quiet,
    });

    this.appId = result.id;
    return true;
  }

  private async uploadTestApp() {
    await this.upload.upload({
      filePath: this.options.testApp,
      url: `${this.URL}/${this.appId}/tests`,
      credentials: this.credentials,
      contentType: 'application/zip',
      showProgress: !this.options.quiet,
    });

    return true;
  }

  private async runTests() {
    try {
      const capabilities = this.options.getCapabilities();
      const xcuitestOptions = this.options.getXCUITestOptions();
      const metadata = this.options.metadata;

      const response = await axios.post(
        `${this.URL}/${this.appId}/run`,
        {
          capabilities: [capabilities],
          ...(xcuitestOptions && { options: xcuitestOptions }),
          ...(metadata && { metadata }),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': utils.getUserAgent(),
          },
          auth: {
            username: this.credentials.userName,
            password: this.credentials.accessKey,
          },
          timeout: 30000, // 30 second timeout
        },
      );

      // Check for version update notification
      const latestVersion = response.headers?.['x-testingbotctl-version'];
      utils.checkForUpdate(latestVersion);

      const result = response.data;

      // Capture real-time update server info
      if (result.update_server && result.update_key) {
        this.updateServer = result.update_server;
        this.updateKey = result.update_key;
      }

      if (result.success === false) {
        const errorMessage =
          result.errors?.join('\n') || result.error || 'Unknown error';
        throw new TestingBotError(`Running XCUITest failed`, {
          cause: errorMessage,
        });
      }

      return true;
    } catch (error) {
      if (error instanceof TestingBotError) {
        throw error;
      }
      throw await this.handleErrorWithDiagnostics(
        error,
        'Running XCUITest failed',
      );
    }
  }

  private async getStatus(): Promise<XCUITestStatusResponse> {
    try {
      return await this.withRetry('Getting XCUITest status', async () => {
        const response = await axios.get(`${this.URL}/${this.appId}`, {
          headers: {
            'User-Agent': utils.getUserAgent(),
          },
          auth: {
            username: this.credentials.userName,
            password: this.credentials.accessKey,
          },
          timeout: 30000, // 30 second timeout
        });

        // Check for version update notification
        const latestVersion = response.headers?.['x-testingbotctl-version'];
        utils.checkForUpdate(latestVersion);

        return response.data;
      });
    } catch (error) {
      throw await this.handleErrorWithDiagnostics(
        error,
        'Failed to get XCUITest status',
      );
    }
  }

  private async waitForCompletion(): Promise<XCUITestResult> {
    let attempts = 0;
    const startTime = Date.now();
    const previousStatus: Map<number, XCUITestRunInfo['status']> = new Map();

    while (attempts < this.MAX_POLL_ATTEMPTS) {
      if (this.isShuttingDown) {
        throw new TestingBotError('Test run cancelled by user');
      }

      const status = await this.getStatus();

      // Track active run IDs for graceful shutdown
      this.activeRunIds = status.runs
        .filter((run) => run.status !== 'DONE' && run.status !== 'FAILED')
        .map((run) => run.id);

      // Log current status of runs (unless quiet mode)
      if (!this.options.quiet) {
        this.displayRunStatus(status.runs, startTime, previousStatus);
      }

      if (status.completed) {
        // Clear the updating line and print final status
        if (!this.options.quiet) {
          this.clearLine();
          for (const run of status.runs) {
            const statusEmoji = run.success === 1 ? '✅' : '❌';
            const statusText =
              run.success === 1 ? 'Test completed successfully' : 'Test failed';
            console.log(
              `  ${statusEmoji} Run ${run.id} (${this.getRunDisplayName(run)}): ${statusText}`,
            );
          }
        }

        const allSucceeded = status.runs.every((run) => run.success === 1);

        if (allSucceeded) {
          if (!this.options.quiet) {
            logger.info('All tests completed successfully!');
          }
        } else {
          const failedRuns = status.runs.filter((run) => run.success !== 1);
          logger.error(`${failedRuns.length} test run(s) failed:`);
          for (const run of failedRuns) {
            logger.error(
              `  - Run ${run.id} (${this.getRunDisplayName(run)}): ${run.report || 'No report available'}`,
            );
          }
        }

        // Fetch reports if requested
        if (this.options.report && this.options.reportOutputDir) {
          await this.fetchReports(status.runs);
        }

        return {
          success: status.success,
          runs: status.runs,
        };
      }

      attempts++;
      await this.sleep(this.POLL_INTERVAL_MS);
    }

    throw new TestingBotError(
      `Test timed out after ${(this.MAX_POLL_ATTEMPTS * this.POLL_INTERVAL_MS) / 1000 / 60} minutes`,
    );
  }

  private displayRunStatus(
    runs: XCUITestRunInfo[],
    startTime: number,
    previousStatus: Map<number, XCUITestRunInfo['status']>,
  ): void {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = this.formatElapsedTime(elapsedSeconds);

    for (const run of runs) {
      const prevStatus = previousStatus.get(run.id);
      const statusChanged = prevStatus !== run.status;

      if (
        statusChanged &&
        prevStatus &&
        (prevStatus === 'WAITING' || prevStatus === 'READY')
      ) {
        this.clearLine();
      }

      previousStatus.set(run.id, run.status);

      const statusInfo = this.getStatusInfo(run.status);

      if (run.status === 'WAITING' || run.status === 'READY') {
        const message = `  ${statusInfo.emoji} Run ${run.id} (${this.getRunDisplayName(run)}): ${statusInfo.text} (${elapsedStr})`;
        process.stdout.write(`\r${message}`);
      } else if (statusChanged) {
        console.log(
          `  ${statusInfo.emoji} Run ${run.id} (${this.getRunDisplayName(run)}): ${statusInfo.text}`,
        );
      }
    }
  }

  /**
   * Get the display name for a run, preferring environment.name over capabilities.deviceName
   * This shows the actual device used when a wildcard (*) was specified
   */
  private getRunDisplayName(run: XCUITestRunInfo): string {
    return run.environment?.name || run.capabilities.deviceName;
  }

  private getStatusInfo(status: XCUITestRunInfo['status']): {
    emoji: string;
    text: string;
  } {
    switch (status) {
      case 'WAITING':
        return { emoji: '⏳', text: 'Waiting for test to start' };
      case 'READY':
        return { emoji: '🔄', text: 'Running test' };
      case 'DONE':
        return { emoji: '✅', text: 'Test has finished running' };
      case 'FAILED':
        return { emoji: '❌', text: 'Test failed' };
      default:
        return { emoji: '❓', text: status };
    }
  }

  private async fetchReports(runs: XCUITestRunInfo[]): Promise<void> {
    const reportFormat = this.options.report;
    const outputDir = this.options.reportOutputDir;

    if (!reportFormat || !outputDir) {
      return;
    }

    if (!this.options.quiet) {
      logger.info(`Fetching ${reportFormat} report(s)...`);
    }

    for (const run of runs) {
      try {
        const endpoint =
          reportFormat === 'junit'
            ? `${this.URL}/${this.appId}/${run.id}/junit_report`
            : `${this.URL}/${this.appId}/${run.id}/html_report`;

        const response = await axios.get(endpoint, {
          headers: {
            'User-Agent': utils.getUserAgent(),
          },
          auth: {
            username: this.credentials.userName,
            password: this.credentials.accessKey,
          },
          responseType: reportFormat === 'html' ? 'arraybuffer' : 'text',
          timeout: 30000, // 30 second timeout
        });

        // Check for version update notification
        const latestVersion = response.headers?.['x-testingbotctl-version'];
        utils.checkForUpdate(latestVersion);

        const reportContent = response.data;

        if (!reportContent) {
          logger.error(`No report content received for run ${run.id}`);
          continue;
        }

        const extension = reportFormat === 'junit' ? 'xml' : 'html';
        const fileName = `xcuitest_report_${this.appId}_${run.id}.${extension}`;
        const filePath = path.join(outputDir, fileName);

        await fs.promises.writeFile(filePath, reportContent);

        if (!this.options.quiet) {
          logger.info(`  Saved report: ${filePath}`);
        }
      } catch (error) {
        logger.error(
          `Failed to fetch report for run ${run.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private connectToUpdateServer(): void {
    if (!this.updateServer || !this.updateKey || this.options.quiet) {
      return;
    }

    try {
      this.socket = io(this.updateServer, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000,
      });

      this.socket.on('connect', () => {
        // Join the room for this test run
        this.socket?.emit('join', this.updateKey);
      });

      this.socket.on('xcuitest_data', (data: string) => {
        this.handleXCUITestData(data);
      });

      this.socket.on('xcuitest_error', (data: string) => {
        this.handleXCUITestError(data);
      });

      this.socket.on('connect_error', () => {
        // Silently fail - real-time updates are optional
        this.disconnectFromUpdateServer();
      });
    } catch {
      // Socket connection failed, continue without real-time updates
      this.socket = null;
    }
  }

  private disconnectFromUpdateServer(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private handleXCUITestData(data: string): void {
    try {
      const message: XCUITestSocketMessage = JSON.parse(data);
      if (message.payload) {
        // Clear the status line before printing output
        this.clearLine();
        // Print the XCUITest output
        process.stdout.write(message.payload);
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  private handleXCUITestError(data: string): void {
    try {
      const message: XCUITestSocketMessage = JSON.parse(data);
      if (message.payload) {
        // Clear the status line before printing error
        this.clearLine();
        // Print the error output
        process.stderr.write(message.payload);
      }
    } catch {
      // Invalid JSON, ignore
    }
  }
}
