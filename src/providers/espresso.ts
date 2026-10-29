import EspressoOptions from '../models/espresso_options';
import logger from '../logger';
import Credentials from '../models/credentials';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { io, Socket } from 'socket.io-client';
import { proxyAgent } from '../utils/proxy';
import TestingBotError from '../models/testingbot_error';
import utils from '../utils';
import BaseProvider, { ProviderResult } from './base_provider';
import { setTitle } from '../ui/terminal-title';
import { HTTP, SOCKET } from '../config/constants';
import { downloadSessionArtifacts } from '../utils/session_artifacts';

export interface EspressoRunEnvironment {
  device?: string;
  name?: string;
  version?: string;
}

export interface EspressoRunInfo {
  id: number;
  status: 'WAITING' | 'READY' | 'DONE' | 'FAILED';
  capabilities: {
    deviceName: string;
    platformName: string;
    version?: string;
  };
  environment?: EspressoRunEnvironment;
  // The API serializes this as a boolean (test_case.success?); older/other
  // endpoints may use 1/0. Compare via isRunSuccessful, not `=== 1`.
  success: number | boolean;
  /** This run's own JUnit XML. */
  report?: string;
  test?: {
    sessionId?: string;
  };
}

export interface EspressoStatusResponse {
  runs: EspressoRunInfo[];
  success: boolean;
  completed: boolean;
}

export type EspressoResult = ProviderResult<EspressoRunInfo>;

export interface EspressoSocketMessage {
  id: number;
  payload: string;
}

export default class Espresso extends BaseProvider<EspressoOptions> {
  protected readonly URL =
    'https://api.testingbot.com/v1/app-automate/espresso';
  protected readonly jsonProvider = 'espresso' as const;

  private socket: Socket | null = null;
  private updateServer: string | null = null;
  private updateKey: string | null = null;
  private socketFallbackWarned = false;

  public constructor(credentials: Credentials, options: EspressoOptions) {
    super(credentials, options);
  }

  private async validate(): Promise<boolean> {
    if (this.options.app === undefined) {
      throw new TestingBotError(`app option is required`);
    }

    if (this.options.testApp === undefined) {
      throw new TestingBotError(`testApp option is required`);
    }

    // Validate report options. The Espresso API only serves a JUnit report.
    if (this.options.report && this.options.report !== 'junit') {
      throw new TestingBotError(
        `--report ${this.options.report} is not supported for Espresso; use --report junit`,
      );
    }

    if (this.options.timeout && this.options.async) {
      throw new TestingBotError(
        'Cannot use --timeout with --async mode. The CLI does not wait for results in async mode.',
      );
    }

    if (this.options.retry > 0 && this.options.async) {
      throw new TestingBotError(
        'Cannot use --retry with --async mode. Retrying a failed test requires waiting for results.',
      );
    }

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

    if (this.options.downloadArtifacts && this.options.artifactsOutputDir) {
      fileChecks.push(
        this.ensureOutputDirectory(this.options.artifactsOutputDir),
      );
    }

    await Promise.all(fileChecks);

    return true;
  }

  public async run(): Promise<EspressoResult> {
    if (!(await this.validate())) {
      return {
        success: false,
        outcome: 'error',
        error: 'Validation failed',
        runs: [],
      };
    }

    if (this.options.dryRun) {
      const capabilities = this.options.getCapabilities();
      const espressoOptions = this.options.getEspressoOptions();
      const metadata = this.options.metadata;

      this.printDryRunSummary({
        provider: 'Espresso',
        apiUrl: this.URL,
        uploads: [
          {
            label: 'App',
            filePath: this.options.app,
            endpoint: `${this.URL}/app`,
          },
          {
            label: 'Test App',
            filePath: this.options.testApp,
            endpoint: `${this.URL}/<appId>/tests`,
          },
        ],
        runPayload: {
          capabilities: [capabilities],
          ...(espressoOptions && { espressoOptions }),
          ...(metadata && { metadata }),
        },
      });

      return { success: true, outcome: 'dry-run', runs: [] };
    }

    try {
      setTitle('espresso');
      // Quick connectivity check before starting uploads
      await this.ensureConnectivity();

      if (!this.options.quiet) {
        logger.info('Uploading Espresso App');
      }
      setTitle('espresso · uploading app');
      await this.uploadApp();

      if (!this.options.quiet) {
        logger.info('Uploading Espresso Test App');
      }
      setTitle('espresso · uploading test app');
      await this.uploadTestApp();

      if (this.options.tunnel && this.options.async) {
        throw new TestingBotError(
          'Cannot use --tunnel with --async mode. The tunnel would close when the CLI exits. Use a standalone tunnel instead.',
        );
      }

      await this.startTunnel();

      if (!this.options.quiet) {
        logger.info('Running Espresso Tests');
      }
      setTitle('espresso · queued');
      await this.runTests();

      if (this.options.async) {
        if (!this.options.quiet) {
          logger.info(`Tests started in async mode. Project ID: ${this.appId}`);
        }
        return { success: true, outcome: 'started', runs: [] };
      }

      // Set up signal handlers before waiting for completion
      this.setupSignalHandlers();

      // Connect to real-time update server (unless --quiet is specified)
      this.connectToUpdateServer();

      if (!this.options.quiet) {
        logger.info('Waiting for test results...');
      }
      const result = await this.retryFailedRuns(await this.waitForCompletion());

      // Reports and artifacts describe the final attempt of each run.
      if (this.options.report && this.options.reportOutputDir) {
        await this.fetchReports(result.runs);
      }
      if (this.options.downloadArtifacts) {
        await downloadSessionArtifacts({
          provider: 'espresso',
          credentials: this.credentials,
          runs: result.runs.map((run) => ({
            id: run.id,
            passed: this.isRunSuccessful(run.success),
            sessionId: run.test?.sessionId,
            device: this.getRunDisplayName(run),
          })),
          mode: this.options.downloadArtifacts,
          outputDir: this.options.artifactsOutputDir || process.cwd(),
          name: this.options.name,
          quiet: this.options.quiet,
        });
      }

      // Clean up
      this.disconnectFromUpdateServer();
      this.removeSignalHandlers();
      await this.stopTunnel();

      return result;
    } catch (error) {
      // Clean up on error
      this.spinner.stop();
      this.disconnectFromUpdateServer();
      this.removeSignalHandlers();
      await this.stopTunnel();
      setTitle('espresso · ✘ error');

      logger.error(error instanceof Error ? error.message : error);
      if (error instanceof Error && error.cause) {
        const causeMessage = this.extractErrorMessage(error.cause);
        if (causeMessage) {
          logger.error(`  Reason: ${causeMessage}`);
        }
      }
      return {
        success: false,
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error),
        runs: [],
      };
    }
  }

  private async uploadApp() {
    const result = await this.upload.upload({
      filePath: this.options.app,
      url: `${this.URL}/app`,
      credentials: this.credentials,
      contentType: 'application/vnd.android.package-archive',
      showProgress: !this.options.quiet,
      validateZipFormat: true,
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
      validateZipFormat: true,
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
          timeout: HTTP.TIMEOUT_MS,
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
      throw await this.handleErrorWithDiagnostics(
        error,
        'Running Espresso test failed',
      );
    }
  }

  private async getStatus(): Promise<EspressoStatusResponse> {
    try {
      return await this.withRetry('Getting Espresso test status', async () => {
        const response = await axios.get(`${this.URL}/${this.appId}`, {
          headers: {
            'User-Agent': utils.getUserAgent(),
          },
          auth: {
            username: this.credentials.userName,
            password: this.credentials.accessKey,
          },
          timeout: HTTP.TIMEOUT_MS,
        });

        // Check for version update notification
        const latestVersion = response.headers?.['x-testingbotctl-version'];
        utils.checkForUpdate(latestVersion);

        if (this.options.debug) {
          logger.debug(
            `API response: ${JSON.stringify(response.data, null, 2)}`,
          );
        }

        return response.data;
      });
    } catch (error) {
      throw await this.handleErrorWithDiagnostics(
        error,
        'Failed to get Espresso test status',
      );
    }
  }

  private async waitForCompletion(): Promise<EspressoResult> {
    this.startWaitClock();
    const startTime = Date.now();
    const previousStatus: Map<number, EspressoRunInfo['status']> = new Map();
    let pollInterval = this.MIN_POLL_INTERVAL_MS;
    let previousSignature: string | null = null;

    while (true) {
      if (this.isShuttingDown) {
        throw new TestingBotError('Test run cancelled by user');
      }

      const status = await this.getStatus();
      const runs = this.currentRuns(status.runs);
      const completed =
        runs.length > 0 && !runs.some((run) => this.isRunBusy(run.status));

      // Track active run IDs for graceful shutdown
      this.activeRunIds = runs
        .filter((run) => run.status !== 'DONE' && run.status !== 'FAILED')
        .map((run) => run.id);

      // Log current status of runs (unless quiet mode)
      if (!this.options.quiet) {
        this.displayRunStatus(runs, startTime, previousStatus);
      }

      // Terminal-tab title reflects the coarse phase, regardless of quiet.
      const running = runs.find((r) => r.status === 'READY');
      if (running) {
        const device =
          running.environment?.name || running.capabilities.deviceName;
        setTitle(`espresso · running · ${device}`);
      }

      if (completed) {
        // Stop the spinner and print final status
        if (!this.options.quiet) {
          this.spinner.stop();
          for (const run of runs) {
            const passed = this.isRunSuccessful(run.success);
            const symbol = passed ? pc.green('✔') : pc.red('✘');
            const statusText = passed
              ? pc.green('Test completed successfully')
              : pc.red('Test failed');
            console.log(
              `  ${symbol} Run ${run.id} ${pc.dim(`(${this.getRunDisplayName(run)})`)}: ${statusText}`,
            );
          }
        }

        const allSucceeded = runs.every((run) =>
          this.isRunSuccessful(run.success),
        );

        if (allSucceeded) {
          setTitle('espresso · ✔ passed');
          if (!this.options.quiet) {
            logger.info('All tests completed successfully!');
          }
        } else {
          const failedRuns = runs.filter(
            (run) => !this.isRunSuccessful(run.success),
          );
          setTitle(`espresso · ✘ ${failedRuns.length} failed`);
          logger.error(`${failedRuns.length} test run(s) failed:`);
          for (const run of failedRuns) {
            logger.error(
              `  - Run ${run.id} (${this.getRunDisplayName(run)}): ${run.report || 'No report available'}`,
            );
          }
        }

        return {
          success: allSucceeded,
          outcome: allSucceeded ? 'passed' : 'failed',
          runs,
        };
      }

      // Checked after getStatus() so a run that completes during the final
      // sleep is returned as success on the next iteration instead of being
      // misreported as a timeout.
      if (this.waitTimedOut()) {
        const error = await this.stopTimedOutRuns();
        setTitle('espresso · ✘ timed out');
        return { success: false, outcome: 'failed', error, runs };
      }

      const signature = JSON.stringify(
        runs.map((r) => [r.id, r.status, r.success]),
      );
      const changed = signature !== previousSignature;
      previousSignature = signature;
      pollInterval = this.computeNextPollInterval(pollInterval, changed);
      await this.sleep(pollInterval);
    }
  }

  /**
   * --retry: starts each failed run again on the same app, up to N times, and
   * waits for it. The failed attempt is superseded, so the result, reports and
   * artifacts are those of the last attempt.
   */
  private async retryFailedRuns(
    result: EspressoResult,
  ): Promise<EspressoResult> {
    const retries = this.options.retry;
    for (
      let attempt = 1;
      attempt <= retries && result.outcome === 'failed' && !result.error;
      attempt++
    ) {
      const failed = result.runs.filter(
        (run) => !this.isRunSuccessful(run.success),
      );
      for (const run of failed) this.supersededRunIds.add(run.id);
      if (!this.options.quiet) {
        logger.info(
          `Retrying ${failed.length} failed run(s) (attempt ${attempt}/${retries})...`,
        );
      }
      setTitle(`espresso · retry ${attempt}/${retries}`);
      for (let i = 0; i < failed.length; i++) await this.runTests();
      result = await this.waitForCompletion();
    }
    return result;
  }

  private displayRunStatus(
    runs: EspressoRunInfo[],
    startTime: number,
    previousStatus: Map<number, EspressoRunInfo['status']>,
  ): void {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = this.formatElapsedTime(elapsedSeconds);

    const activeMessages: string[] = [];

    for (const run of runs) {
      const prevStatus = previousStatus.get(run.id);
      const statusChanged = prevStatus !== run.status;
      previousStatus.set(run.id, run.status);

      const statusInfo = this.getStatusInfo(run.status);

      if (run.status === 'WAITING' || run.status === 'READY') {
        const label =
          run.status === 'WAITING'
            ? pc.yellow(statusInfo.text)
            : pc.cyan(statusInfo.text);
        activeMessages.push(
          `${label} ${pc.dim(`• Run ${run.id} (${this.getRunDisplayName(run)}) • ${elapsedStr}`)}`,
        );
      } else if (statusChanged) {
        // Transitioned to a terminal state — print a permanent line above the
        // spinner without disturbing its animation below.
        this.spinner.clearLine();
        console.log(
          `  ${statusInfo.symbol} Run ${run.id} ${pc.dim(`(${this.getRunDisplayName(run)})`)}: ${statusInfo.text}`,
        );
      }
    }

    if (activeMessages.length > 0) {
      this.spinner.setMessage(activeMessages.join(pc.dim(' ┊ ')));
    } else {
      this.spinner.stop();
    }
  }

  /**
   * Get the display name for a run, preferring environment.name over capabilities.deviceName
   * This shows the actual device used when a wildcard (*) was specified
   */
  private getRunDisplayName(run: EspressoRunInfo): string {
    return run.environment?.name || run.capabilities.deviceName;
  }

  private getStatusInfo(status: EspressoRunInfo['status']): {
    symbol: string;
    text: string;
  } {
    switch (status) {
      case 'WAITING':
        return { symbol: pc.yellow('◐'), text: 'Waiting for test to start' };
      case 'READY':
        return { symbol: pc.cyan('◑'), text: 'Running test' };
      case 'DONE':
        return { symbol: pc.green('✔'), text: 'Test has finished running' };
      case 'FAILED':
        return { symbol: pc.red('✘'), text: 'Test failed' };
      default:
        return { symbol: pc.dim('?'), text: status };
    }
  }

  /** The runs' own <testsuite> reports in one <testsuites> document. */
  private combinedReport(runs: EspressoRunInfo[]): string {
    const suites = runs
      .map((run) => (run.report ?? '').replace(/^\s*<\?xml[^>]*\?>\s*/, ''))
      .filter(Boolean);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
  }

  private async writeReport(content: string, outputDir: string) {
    const filePath = path.join(outputDir, `espresso_report_${this.appId}.xml`);
    await fs.promises.writeFile(filePath, content, 'utf-8');
    if (!this.options.quiet) {
      logger.info(`  Saved report: ${filePath}`);
    }
  }

  private async fetchReports(runs: EspressoRunInfo[]): Promise<void> {
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

    // The project report covers every run in the project, superseded --retry
    // attempts included. After a retry, combine the final runs' own reports.
    if (this.supersededRunIds.size > 0) {
      await this.writeReport(this.combinedReport(runs), outputDir);
      return;
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
        timeout: HTTP.TIMEOUT_MS,
      });

      // Check for version update notification
      const latestVersion = response.headers?.['x-testingbotctl-version'];
      utils.checkForUpdate(latestVersion);

      const reportContent = response.data;

      if (!reportContent) {
        logger.error('No report content received');
        return;
      }

      await this.writeReport(reportContent, outputDir);
    } catch (error) {
      logger.error(
        `Failed to fetch report: ${error instanceof Error ? error.message : error}`,
      );
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
        reconnectionAttempts: SOCKET.RECONNECTION_ATTEMPTS,
        reconnectionDelay: SOCKET.RECONNECTION_DELAY_MS,
        timeout: SOCKET.TIMEOUT_MS,
        // The WebSocket bypasses the global agent that --proxy installs.
        ...(proxyAgent() && { agent: proxyAgent() as unknown as string }),
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

      this.socket.on('connect_error', (err: Error) => {
        if (!this.socketFallbackWarned) {
          this.socketFallbackWarned = true;
          logger.warn(
            'Real-time log stream unavailable, falling back to polling.',
          );
          logger.debug(
            `Socket connect_error: ${err?.message ?? 'unknown error'}`,
          );
        }
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
        // Clear the spinner line before printing output
        this.spinner.clearLine();
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
        // Clear the spinner line before printing error
        this.spinner.clearLine();
        // Print the error output
        process.stderr.write(message.payload);
      }
    } catch {
      // Invalid JSON, ignore
    }
  }
}
