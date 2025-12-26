import EspressoOptions from '../models/espresso_options';
import logger from '../logger';
import Credentials from '../models/credentials';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { io, Socket } from 'socket.io-client';
import TestingBotError from '../models/testingbot_error';
import utils from '../utils';
import Upload from '../upload';
import platform from '../utils/platform';

export interface EspressoRunInfo {
  id: number;
  status: 'WAITING' | 'READY' | 'DONE' | 'FAILED';
  capabilities: {
    deviceName: string;
    platformName: string;
    version?: string;
  };
  success: number;
  report?: string;
}

export interface EspressoStatusResponse {
  runs: EspressoRunInfo[];
  success: boolean;
  completed: boolean;
}

export interface EspressoResult {
  success: boolean;
  runs: EspressoRunInfo[];
}

export interface EspressoSocketMessage {
  id: number;
  payload: string;
}

export default class Espresso {
  private readonly URL = 'https://api.testingbot.com/v1/app-automate/espresso';
  private readonly POLL_INTERVAL_MS = 5000;
  private readonly MAX_POLL_ATTEMPTS = 720; // 1 hour max with 5s interval

  private credentials: Credentials;
  private options: EspressoOptions;
  private upload: Upload;

  private appId: number | undefined = undefined;
  private activeRunIds: number[] = [];
  private isShuttingDown = false;
  private signalHandler: (() => void) | null = null;
  private socket: Socket | null = null;
  private updateServer: string | null = null;
  private updateKey: string | null = null;

  public constructor(credentials: Credentials, options: EspressoOptions) {
    this.credentials = credentials;
    this.options = options;
    this.upload = new Upload();
  }

  private async validate(): Promise<boolean> {
    if (this.options.app === undefined) {
      throw new TestingBotError(`app option is required`);
    }

    try {
      await fs.promises.access(this.options.app, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(
        `Provided app path does not exist ${this.options.app}`,
      );
    }

    if (this.options.testApp === undefined) {
      throw new TestingBotError(`testApp option is required`);
    }

    try {
      await fs.promises.access(this.options.testApp, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(
        `testApp path does not exist ${this.options.testApp}`,
      );
    }

    // Validate report options
    if (this.options.report && !this.options.reportOutputDir) {
      throw new TestingBotError(
        `--report-output-dir is required when --report is specified`,
      );
    }

    if (this.options.reportOutputDir) {
      await this.ensureOutputDirectory(this.options.reportOutputDir);
    }

    return true;
  }

  private async ensureOutputDirectory(dirPath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(dirPath);
      if (!stat.isDirectory()) {
        throw new TestingBotError(
          `Report output path exists but is not a directory: ${dirPath}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          await fs.promises.mkdir(dirPath, { recursive: true });
        } catch (mkdirError) {
          throw new TestingBotError(
            `Failed to create report output directory: ${dirPath}`,
            { cause: mkdirError },
          );
        }
      } else if (error instanceof TestingBotError) {
        throw error;
      } else {
        throw new TestingBotError(
          `Failed to access report output directory: ${dirPath}`,
          { cause: error },
        );
      }
    }
  }

  public async run(): Promise<EspressoResult> {
    if (!(await this.validate())) {
      return { success: false, runs: [] };
    }

    try {
      if (!this.options.quiet) {
        logger.info('Uploading Espresso App');
      }
      await this.uploadApp();

      if (!this.options.quiet) {
        logger.info('Uploading Espresso Test App');
      }
      await this.uploadTestApp();

      if (!this.options.quiet) {
        logger.info('Running Espresso Tests');
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
      contentType: 'application/vnd.android.package-archive',
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
      contentType: 'application/vnd.android.package-archive',
      showProgress: !this.options.quiet,
    });

    return true;
  }

  private async runTests() {
    try {
      const capabilities = this.options.getCapabilities();
      const espressoOptions = this.options.getEspressoOptions();
      const metadata = this.options.metadata;

      const response = await axios.post(
        `${this.URL}/${this.appId}/run`,
        {
          capabilities: [capabilities],
          ...(espressoOptions && { espressoOptions }),
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
        throw new TestingBotError(`Running Espresso test failed`, {
          cause: errorMessage,
        });
      }

      return true;
    } catch (error) {
      if (error instanceof TestingBotError) {
        throw error;
      }
      throw new TestingBotError(`Running Espresso test failed`, {
        cause: error,
      });
    }
  }

  private async getStatus(): Promise<EspressoStatusResponse> {
    try {
      const response = await axios.get(`${this.URL}/${this.appId}`, {
        headers: {
          'User-Agent': utils.getUserAgent(),
        },
        auth: {
          username: this.credentials.userName,
          password: this.credentials.accessKey,
        },
      });

      // Check for version update notification
      const latestVersion = response.headers?.['x-testingbotctl-version'];
      utils.checkForUpdate(latestVersion);

      return response.data;
    } catch (error) {
      throw new TestingBotError(`Failed to get Espresso test status`, {
        cause: error,
      });
    }
  }

  private async waitForCompletion(): Promise<EspressoResult> {
    let attempts = 0;
    const startTime = Date.now();
    const previousStatus: Map<number, EspressoRunInfo['status']> = new Map();

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
              `  ${statusEmoji} Run ${run.id} (${run.capabilities.deviceName}): ${statusText}`,
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
              `  - Run ${run.id} (${run.capabilities.deviceName}): ${run.report || 'No report available'}`,
            );
          }
        }

        // Fetch reports if requested
        if (this.options.report && this.options.reportOutputDir) {
          await this.fetchReports();
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
    runs: EspressoRunInfo[],
    startTime: number,
    previousStatus: Map<number, EspressoRunInfo['status']>,
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
        const message = `  ${statusInfo.emoji} Run ${run.id} (${run.capabilities.deviceName}): ${statusInfo.text} (${elapsedStr})`;
        process.stdout.write(`\r${message}`);
      } else if (statusChanged) {
        console.log(
          `  ${statusInfo.emoji} Run ${run.id} (${run.capabilities.deviceName}): ${statusInfo.text}`,
        );
      }
    }
  }

  private clearLine(): void {
    platform.clearLine();
  }

  private formatElapsedTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  private getStatusInfo(status: EspressoRunInfo['status']): {
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

  private async fetchReports(): Promise<void> {
    const reportFormat = this.options.report;
    const outputDir = this.options.reportOutputDir;

    if (!reportFormat || !outputDir) {
      return;
    }

    // Espresso only supports junit report format via the project-level /report endpoint
    if (reportFormat !== 'junit') {
      logger.warn('Espresso only supports junit report format');
      return;
    }

    if (!this.options.quiet) {
      logger.info('Fetching junit report...');
    }

    try {
      const response = await axios.get(`${this.URL}/${this.appId}/report`, {
        headers: {
          'User-Agent': utils.getUserAgent(),
        },
        auth: {
          username: this.credentials.userName,
          password: this.credentials.accessKey,
        },
      });

      // Check for version update notification
      const latestVersion = response.headers?.['x-testingbotctl-version'];
      utils.checkForUpdate(latestVersion);

      const reportContent = response.data;

      if (!reportContent) {
        logger.error('No report content received');
        return;
      }

      const fileName = `espresso_report_${this.appId}.xml`;
      const filePath = path.join(outputDir, fileName);

      await fs.promises.writeFile(filePath, reportContent, 'utf-8');

      if (!this.options.quiet) {
        logger.info(`  Saved report: ${filePath}`);
      }
    } catch (error) {
      logger.error(
        `Failed to fetch report: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractErrorMessage(cause: unknown): string | null {
    if (typeof cause === 'string') {
      return cause;
    }

    if (Array.isArray(cause)) {
      return cause.join('\n');
    }

    if (cause && typeof cause === 'object') {
      const axiosError = cause as {
        response?: {
          data?: { error?: string; errors?: string[]; message?: string };
        };
        message?: string;
      };
      if (axiosError.response?.data?.errors) {
        return axiosError.response.data.errors.join('\n');
      }
      if (axiosError.response?.data?.error) {
        return axiosError.response.data.error;
      }
      if (axiosError.response?.data?.message) {
        return axiosError.response.data.message;
      }

      if (cause instanceof Error) {
        return cause.message;
      }

      const obj = cause as {
        errors?: string[];
        error?: string;
        message?: string;
      };
      if (obj.errors) {
        return obj.errors.join('\n');
      }
      if (obj.error) {
        return obj.error;
      }
      if (obj.message) {
        return obj.message;
      }
    }

    return null;
  }

  private setupSignalHandlers(): void {
    this.signalHandler = () => {
      this.handleShutdown();
    };

    platform.setupSignalHandlers(this.signalHandler);
  }

  private removeSignalHandlers(): void {
    if (this.signalHandler) {
      platform.removeSignalHandlers(this.signalHandler);
      this.signalHandler = null;
    }
  }

  private handleShutdown(): void {
    if (this.isShuttingDown) {
      logger.warn('Force exiting...');
      process.exit(1);
    }

    this.isShuttingDown = true;
    this.clearLine();
    logger.info('Received interrupt signal, stopping test runs...');

    this.stopActiveRuns()
      .then(() => {
        logger.info('All test runs have been stopped.');
        process.exit(1);
      })
      .catch((error) => {
        logger.error(
          `Failed to stop some test runs: ${error instanceof Error ? error.message : error}`,
        );
        process.exit(1);
      });
  }

  private async stopActiveRuns(): Promise<void> {
    if (!this.appId || this.activeRunIds.length === 0) {
      return;
    }

    const stopPromises = this.activeRunIds.map((runId) =>
      this.stopRun(runId).catch((error) => {
        logger.error(
          `Failed to stop run ${runId}: ${error instanceof Error ? error.message : error}`,
        );
      }),
    );

    await Promise.all(stopPromises);
  }

  private async stopRun(runId: number): Promise<void> {
    if (!this.appId) {
      return;
    }

    try {
      await axios.post(
        `${this.URL}/${this.appId}/${runId}/stop`,
        {},
        {
          headers: {
            'User-Agent': utils.getUserAgent(),
          },
          auth: {
            username: this.credentials.userName,
            password: this.credentials.accessKey,
          },
        },
      );

      if (!this.options.quiet) {
        logger.info(`  Stopped run ${runId}`);
      }
    } catch (error) {
      throw new TestingBotError(`Failed to stop run ${runId}`, {
        cause: error,
      });
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

      this.socket.on('espresso_data', (data: string) => {
        this.handleEspressoData(data);
      });

      this.socket.on('espresso_error', (data: string) => {
        this.handleEspressoError(data);
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

  private handleEspressoData(data: string): void {
    try {
      const message: EspressoSocketMessage = JSON.parse(data);
      if (message.payload) {
        // Clear the status line before printing output
        this.clearLine();
        // Print the Espresso output
        process.stdout.write(message.payload);
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  private handleEspressoError(data: string): void {
    try {
      const message: EspressoSocketMessage = JSON.parse(data);
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
