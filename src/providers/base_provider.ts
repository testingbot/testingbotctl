import Credentials from '../models/credentials';
import axios from 'axios';
import fs from 'node:fs';
import TestingBotError from '../models/testingbot_error';
import utils from '../utils';
import Upload from '../upload';
import platform from '../utils/platform';
import logger from '../logger';
import { handleAxiosError, isNetworkError } from '../utils/error-helpers';
import {
  checkInternetConnectivity,
  formatConnectivityResults,
} from '../utils/connectivity';

/**
 * Common interface for run information shared by all providers
 */
export interface BaseRunInfo {
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

/**
 * Common interface for provider options
 */
export interface BaseProviderOptions {
  quiet?: boolean;
  reportOutputDir?: string;
}

/**
 * Abstract base class for test providers (Espresso, XCUITest, Maestro)
 * Contains common functionality shared across all providers.
 */
export default abstract class BaseProvider<
  TOptions extends BaseProviderOptions,
> {
  protected readonly POLL_INTERVAL_MS = 5000;
  protected readonly MAX_POLL_ATTEMPTS = 720; // 1 hour max with 5s interval

  protected credentials: Credentials;
  protected options: TOptions;
  protected upload: Upload;

  protected appId: number | undefined = undefined;
  protected activeRunIds: number[] = [];
  protected isShuttingDown = false;
  protected signalHandler: (() => void) | null = null;

  /**
   * The base URL for the provider's API endpoint
   */
  protected abstract readonly URL: string;

  public constructor(credentials: Credentials, options: TOptions) {
    this.credentials = credentials;
    this.options = options;
    this.upload = new Upload();
  }

  /**
   * Ensures an output directory exists, creating it if necessary.
   */
  protected async ensureOutputDirectory(dirPath: string): Promise<void> {
    try {
      const stat = await fs.promises.stat(dirPath);
      if (!stat.isDirectory()) {
        throw new TestingBotError(
          `Report output path exists but is not a directory: ${dirPath}`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
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

  /**
   * Sets up signal handlers for graceful shutdown (SIGINT, SIGTERM)
   */
  protected setupSignalHandlers(): void {
    this.signalHandler = () => {
      this.handleShutdown();
    };

    platform.setupSignalHandlers(this.signalHandler);
  }

  /**
   * Removes signal handlers
   */
  protected removeSignalHandlers(): void {
    if (this.signalHandler) {
      platform.removeSignalHandlers(this.signalHandler);
      this.signalHandler = null;
    }
  }

  /**
   * Handles graceful shutdown when interrupt signal is received
   */
  protected handleShutdown(): void {
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

  /**
   * Stops all active test runs
   */
  protected async stopActiveRuns(): Promise<void> {
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

  /**
   * Stops a specific test run
   */
  protected async stopRun(runId: number): Promise<void> {
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
        logger.info(`Stopped run ${runId}`);
      }
    } catch {
      // Ignore errors when stopping runs (may already be stopped)
    }
  }

  /**
   * Clears the current line in the terminal
   */
  protected clearLine(): void {
    platform.clearLine();
  }

  /**
   * Sleeps for the specified number of milliseconds
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extracts an error message from various error types.
   * For Axios errors, uses enhanced error handling with diagnostics.
   */
  protected extractErrorMessage(cause: unknown): string | null {
    if (typeof cause === 'string') {
      return cause;
    }

    if (Array.isArray(cause)) {
      return cause.join('\n');
    }

    if (cause && typeof cause === 'object') {
      // Use enhanced error handling for real Axios errors
      if (axios.isAxiosError(cause)) {
        const enhanced = handleAxiosError(cause, 'Request failed');
        return enhanced.message;
      }

      // Handle error-like objects with response property (for backwards compatibility)
      const axiosLikeError = cause as {
        response?: {
          status?: number;
          data?: { error?: string; errors?: string[]; message?: string };
        };
        message?: string;
      };

      // Check for 429 status code (credits depleted)
      if (axiosLikeError.response?.status === 429) {
        return 'Your TestingBot credits are depleted. Please upgrade your plan at https://testingbot.com/pricing';
      }

      // Extract error message from response data
      if (axiosLikeError.response?.data?.errors) {
        return axiosLikeError.response.data.errors.join('\n');
      }
      if (axiosLikeError.response?.data?.error) {
        return axiosLikeError.response.data.error;
      }
      if (axiosLikeError.response?.data?.message) {
        return axiosLikeError.response.data.message;
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

  /**
   * Checks internet connectivity and logs diagnostic information.
   * Useful when network errors occur to help users troubleshoot.
   */
  protected async checkAndReportConnectivity(): Promise<boolean> {
    logger.info('Checking internet connectivity...');
    const result = await checkInternetConnectivity();
    logger.info(formatConnectivityResults(result));
    return result.connected;
  }

  /**
   * Performs a quick connectivity check before starting operations.
   * Throws an error with diagnostics if no connection is available.
   */
  protected async ensureConnectivity(): Promise<void> {
    const result = await checkInternetConnectivity();
    if (!result.connected) {
      logger.error('No internet connection detected.');
      logger.error(formatConnectivityResults(result));
      throw new TestingBotError(
        'No internet connection. Please check your network and try again.',
      );
    }
  }

  /**
   * Handles errors with enhanced diagnostics.
   * For network errors, performs connectivity check.
   */
  protected async handleErrorWithDiagnostics(
    error: unknown,
    operation: string,
  ): Promise<TestingBotError> {
    if (axios.isAxiosError(error)) {
      // For network errors, check connectivity
      if (isNetworkError(error)) {
        await this.checkAndReportConnectivity();
      }
      return handleAxiosError(error, operation);
    }

    if (error instanceof TestingBotError) {
      return error;
    }

    return new TestingBotError(
      `${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }

  /**
   * Formats elapsed time in human-readable format
   */
  protected formatElapsedTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
}
