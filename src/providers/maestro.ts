import MaestroOptions, { MaestroConfig } from '../models/maestro_options';
import logger from '../logger';
import Credentials from '../models/credentials';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { glob } from 'glob';
import * as yaml from 'js-yaml';
import archiver from 'archiver';
import { io, Socket } from 'socket.io-client';
import TestingBotError from '../models/testingbot_error';
import utils from '../utils';
import Upload from '../upload';
import { detectPlatformFromFile } from '../utils/file-type-detector';

export interface MaestroRunAssets {
  logs?: string[];
  video?: string | false;
  screenshots?: string[];
}

export interface MaestroRunInfo {
  id: number;
  status: 'WAITING' | 'READY' | 'DONE' | 'FAILED';
  capabilities: {
    deviceName: string;
    platformName: string;
    version?: string;
  };
  success: number;
  report?: string;
  options?: Record<string, unknown>;
  assets?: MaestroRunAssets;
}

export interface MaestroRunDetails extends MaestroRunInfo {
  completed: boolean;
  assets_synced: boolean;
}

export interface MaestroStatusResponse {
  runs: MaestroRunInfo[];
  success: boolean;
  completed: boolean;
}

export interface MaestroResult {
  success: boolean;
  runs: MaestroRunInfo[];
}

export interface MaestroSocketMessage {
  id: number;
  payload: string;
}

export default class Maestro {
  private readonly URL = 'https://api.testingbot.com/v1/app-automate/maestro';
  private readonly POLL_INTERVAL_MS = 5000;
  private readonly MAX_POLL_ATTEMPTS = 720; // 1 hour max with 5s interval

  private credentials: Credentials;
  private options: MaestroOptions;
  private upload: Upload;

  private appId: number | undefined = undefined;
  private detectedPlatform: 'Android' | 'iOS' | undefined = undefined;
  private activeRunIds: number[] = [];
  private isShuttingDown = false;
  private signalHandler: (() => void) | null = null;
  private socket: Socket | null = null;
  private updateServer: string | null = null;
  private updateKey: string | null = null;

  public constructor(credentials: Credentials, options: MaestroOptions) {
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

    if (this.options.flows === undefined || this.options.flows.length === 0) {
      throw new TestingBotError(`flows option is required`);
    }

    // Check if all flows paths exist (can be files, directories, or glob patterns)
    for (const flowsPath of this.options.flows) {
      const isGlobPattern =
        flowsPath.includes('*') ||
        flowsPath.includes('?') ||
        flowsPath.includes('{');

      if (!isGlobPattern) {
        try {
          await fs.promises.access(flowsPath, fs.constants.R_OK);
        } catch {
          throw new TestingBotError(`flows path does not exist ${flowsPath}`);
        }
      }
    }

    // Device is optional - will be inferred from app file type if not provided

    // Validate report options
    if (this.options.report && !this.options.reportOutputDir) {
      throw new TestingBotError(
        `--report-output-dir is required when --report is specified`,
      );
    }

    if (this.options.reportOutputDir) {
      await this.ensureOutputDirectory(this.options.reportOutputDir);
    }

    // Validate artifact download options - output dir defaults to current directory
    if (this.options.downloadArtifacts && this.options.artifactsOutputDir) {
      await this.ensureOutputDirectory(this.options.artifactsOutputDir);
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
        // Directory doesn't exist, try to create it
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
   * Detect platform from app file content using magic bytes
   */
  private async detectPlatform(): Promise<'Android' | 'iOS' | undefined> {
    const appPath = this.options.app;
    if (!appPath) return undefined;

    return detectPlatformFromFile(appPath);
  }

  public async run(): Promise<MaestroResult> {
    if (!(await this.validate())) {
      return { success: false, runs: [] };
    }
    try {
      // Detect platform from file content if not explicitly provided
      if (!this.options.platformName) {
        this.detectedPlatform = await this.detectPlatform();
      }

      if (!this.options.quiet) {
        logger.info('Uploading Maestro App');
      }
      await this.uploadApp();

      if (!this.options.quiet) {
        logger.info('Uploading Maestro Flows');
      }
      await this.uploadFlows();

      if (!this.options.quiet) {
        logger.info('Running Maestro Tests');
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
      // Display the cause if available
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
    const appPath = this.options.app;
    const ext = path.extname(appPath).toLowerCase();

    let contentType:
      | 'application/vnd.android.package-archive'
      | 'application/octet-stream'
      | 'application/zip';
    if (ext === '.apk') {
      contentType = 'application/vnd.android.package-archive';
    } else if (ext === '.ipa' || ext === '.app') {
      contentType = 'application/octet-stream';
    } else if (ext === '.zip') {
      contentType = 'application/zip';
    } else {
      contentType = 'application/octet-stream';
    }

    const result = await this.upload.upload({
      filePath: appPath,
      url: `${this.URL}/app`,
      credentials: this.credentials,
      contentType,
      showProgress: !this.options.quiet,
    });

    this.appId = result.id;
    return true;
  }

  private async uploadFlows() {
    const flowsPaths = this.options.flows;

    let zipPath: string;
    let shouldCleanup = false;

    // Special case: single zip file - upload directly
    if (flowsPaths.length === 1) {
      const singlePath = flowsPaths[0];
      const stat = await fs.promises.stat(singlePath).catch(() => null);
      if (stat?.isFile() && path.extname(singlePath).toLowerCase() === '.zip') {
        zipPath = singlePath;
        // Upload the zip directly without cleanup
        await this.upload.upload({
          filePath: zipPath,
          url: `${this.URL}/${this.appId}/tests`,
          credentials: this.credentials,
          contentType: 'application/zip',
          showProgress: !this.options.quiet,
        });
        return true;
      }
    }

    // Collect all flow files from all paths
    const allFlowFiles: string[] = [];
    const baseDirs: string[] = [];

    for (const flowsPath of flowsPaths) {
      const stat = await fs.promises.stat(flowsPath).catch(() => null);

      if (stat?.isFile()) {
        const ext = path.extname(flowsPath).toLowerCase();
        if (ext === '.yaml' || ext === '.yml') {
          allFlowFiles.push(flowsPath);
        } else if (ext === '.zip') {
          throw new TestingBotError(
            `Cannot combine .zip files with other flow paths. Use a single .zip file or provide directories/patterns.`,
          );
        } else {
          throw new TestingBotError(
            `Invalid flow file format. Expected .yaml, .yml, or .zip, got ${ext}`,
          );
        }
      } else if (stat?.isDirectory()) {
        // Directory of flows
        const flowFiles = await this.discoverFlows(flowsPath);
        if (flowFiles.length === 0 && flowsPaths.length === 1) {
          throw new TestingBotError(
            `No flow files (.yaml, .yml) found in directory ${flowsPath}`,
          );
        }
        allFlowFiles.push(...flowFiles);
        baseDirs.push(flowsPath);
      } else {
        // Treat as glob pattern
        const flowFiles = await glob(flowsPath);
        const yamlFiles = flowFiles.filter((f) => {
          const ext = path.extname(f).toLowerCase();
          return ext === '.yaml' || ext === '.yml';
        });
        if (yamlFiles.length === 0 && flowsPaths.length === 1) {
          throw new TestingBotError(
            `No flow files found matching pattern ${flowsPath}`,
          );
        }
        allFlowFiles.push(...yamlFiles);
      }
    }

    if (allFlowFiles.length === 0) {
      throw new TestingBotError(
        `No flow files (.yaml, .yml) found in the provided paths`,
      );
    }

    // Determine base directory for zip structure
    // If we have a single directory, use it as base; otherwise use common ancestor or flatten
    const baseDir = baseDirs.length === 1 ? baseDirs[0] : undefined;
    zipPath = await this.createFlowsZip(allFlowFiles, baseDir);
    shouldCleanup = true;

    try {
      await this.upload.upload({
        filePath: zipPath,
        url: `${this.URL}/${this.appId}/tests`,
        credentials: this.credentials,
        contentType: 'application/zip',
        showProgress: !this.options.quiet,
      });
    } finally {
      if (shouldCleanup) {
        await fs.promises.unlink(zipPath).catch(() => {});
      }
    }

    return true;
  }

  private async discoverFlows(directory: string): Promise<string[]> {
    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true,
    });

    const flowFiles: string[] = [];
    const configPath = path.join(directory, 'config.yaml');
    let config: MaestroConfig | null = null;

    // Check for config.yaml
    try {
      const configContent = await fs.promises.readFile(configPath, 'utf-8');
      config = yaml.load(configContent) as MaestroConfig;
    } catch {
      // No config.yaml, that's fine
    }

    // If config specifies flows, use those
    if (config?.flows && config.flows.length > 0) {
      for (const flowPattern of config.flows) {
        const matches = await glob(path.join(directory, flowPattern));
        flowFiles.push(...matches);
      }
    } else {
      // Otherwise, get all yaml files in the directory (not subdirectories)
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (
            (ext === '.yaml' || ext === '.yml') &&
            entry.name !== 'config.yaml'
          ) {
            flowFiles.push(path.join(directory, entry.name));
          }
        }
      }
    }

    // Also discover dependencies (runFlow, runScript, addMedia)
    const allFiles = new Set(flowFiles);
    for (const flowFile of flowFiles) {
      const dependencies = await this.discoverDependencies(flowFile, directory);
      dependencies.forEach((dep) => allFiles.add(dep));
    }

    return Array.from(allFiles);
  }

  private async discoverDependencies(
    flowFile: string,
    baseDir: string,
  ): Promise<string[]> {
    const dependencies: string[] = [];

    try {
      const content = await fs.promises.readFile(flowFile, 'utf-8');
      const flowData = yaml.load(content);

      if (Array.isArray(flowData)) {
        for (const step of flowData) {
          if (typeof step === 'object' && step !== null) {
            // Check for runFlow
            if ('runFlow' in step) {
              const runFlowValue = step.runFlow;
              const refFile =
                typeof runFlowValue === 'string'
                  ? runFlowValue
                  : runFlowValue?.file;
              if (refFile) {
                const depPath = path.resolve(path.dirname(flowFile), refFile);
                if (
                  (await fs.promises.access(depPath).catch(() => false)) ===
                  undefined
                ) {
                  dependencies.push(depPath);
                  const nestedDeps = await this.discoverDependencies(
                    depPath,
                    baseDir,
                  );
                  dependencies.push(...nestedDeps);
                }
              }
            }
            // Check for runScript
            if ('runScript' in step) {
              const scriptFile = step.runScript?.file;
              if (scriptFile) {
                const depPath = path.resolve(
                  path.dirname(flowFile),
                  scriptFile,
                );
                if (
                  (await fs.promises.access(depPath).catch(() => false)) ===
                  undefined
                ) {
                  dependencies.push(depPath);
                }
              }
            }
            // Check for addMedia
            if ('addMedia' in step) {
              const mediaFiles = Array.isArray(step.addMedia)
                ? step.addMedia
                : [step.addMedia];
              for (const mediaFile of mediaFiles) {
                if (typeof mediaFile === 'string') {
                  const depPath = path.resolve(
                    path.dirname(flowFile),
                    mediaFile,
                  );
                  if (
                    (await fs.promises.access(depPath).catch(() => false)) ===
                    undefined
                  ) {
                    dependencies.push(depPath);
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Ignore parsing errors
    }

    return dependencies;
  }

  private async createFlowsZip(
    files: string[],
    baseDir?: string,
  ): Promise<string> {
    const tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'maestro-'),
    );
    const zipPath = path.join(tmpDir, 'flows.zip');

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve(zipPath));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      for (const file of files) {
        // Determine the name in the archive
        let archiveName: string;
        if (baseDir) {
          archiveName = path.relative(baseDir, file);
        } else {
          archiveName = path.basename(file);
        }
        archive.file(file, { name: archiveName });
      }

      archive.finalize();
    });
  }

  private async runTests() {
    try {
      const capabilities = this.options.getCapabilities(this.detectedPlatform);
      const maestroOptions = this.options.getMaestroOptions();
      const response = await axios.post(
        `${this.URL}/${this.appId}/run`,
        {
          capabilities: [capabilities],
          ...(maestroOptions && { maestroOptions }),
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
        // API returns errors as an array
        const errorMessage =
          result.errors?.join('\n') || result.error || 'Unknown error';
        throw new TestingBotError(`Running Maestro test failed`, {
          cause: errorMessage,
        });
      }

      return true;
    } catch (error) {
      if (error instanceof TestingBotError) {
        throw error;
      }
      throw new TestingBotError(`Running Maestro test failed`, {
        cause: error,
      });
    }
  }

  private async getStatus(): Promise<MaestroStatusResponse> {
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

      return response.data;
    } catch (error) {
      throw new TestingBotError(`Failed to get Maestro test status`, {
        cause: error,
      });
    }
  }

  private async waitForCompletion(): Promise<MaestroResult> {
    let attempts = 0;
    const startTime = Date.now();
    const previousStatus: Map<number, MaestroRunInfo['status']> = new Map();

    while (attempts < this.MAX_POLL_ATTEMPTS) {
      // Check if we're shutting down
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
              `  - Run ${run.id} (${run.capabilities.deviceName}): ${run.report}`,
            );
          }
        }

        // Fetch reports if requested
        if (this.options.report && this.options.reportOutputDir) {
          await this.fetchReports(status.runs);
        }

        // Download artifacts if requested
        if (this.options.downloadArtifacts && this.options.artifactsOutputDir) {
          await this.downloadArtifacts(status.runs);
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
    runs: MaestroRunInfo[],
    startTime: number,
    previousStatus: Map<number, MaestroRunInfo['status']>,
  ): void {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = this.formatElapsedTime(elapsedSeconds);

    for (const run of runs) {
      const prevStatus = previousStatus.get(run.id);
      const statusChanged = prevStatus !== run.status;

      // If status changed from WAITING/READY to something else, clear the updating line
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
        // Update the same line for WAITING and READY states
        const message = `  ${statusInfo.emoji} Run ${run.id} (${run.capabilities.deviceName}): ${statusInfo.text} (${elapsedStr})`;
        process.stdout.write(`\r${message}`);
      } else if (statusChanged) {
        // For other states (DONE, FAILED), print on a new line only when status changes
        console.log(
          `  ${statusInfo.emoji} Run ${run.id} (${run.capabilities.deviceName}): ${statusInfo.text}`,
        );
      }
    }
  }

  private clearLine(): void {
    process.stdout.write('\r\x1b[K');
  }

  private formatElapsedTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  private getStatusInfo(status: MaestroRunInfo['status']): {
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

  private async fetchReports(runs: MaestroRunInfo[]): Promise<void> {
    const reportFormat = this.options.report;
    const outputDir = this.options.reportOutputDir;

    if (!reportFormat || !outputDir) {
      return;
    }

    if (!this.options.quiet) {
      logger.info(`Fetching ${reportFormat} reports...`);
    }

    for (const run of runs) {
      try {
        const reportEndpoint =
          reportFormat === 'junit' ? 'junit_report' : 'html_report';
        const response = await axios.get(
          `${this.URL}/${this.appId}/${run.id}/${reportEndpoint}`,
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

        // Extract the report content from the JSON response
        const reportKey =
          reportFormat === 'junit' ? 'junit_report' : 'html_report';
        const reportContent = response.data[reportKey];

        if (!reportContent) {
          logger.error(`No ${reportFormat} report found for run ${run.id}`);
          continue;
        }

        const fileExtension = reportFormat === 'junit' ? 'xml' : 'html';
        const fileName = `report_run_${run.id}.${fileExtension}`;
        const filePath = path.join(outputDir, fileName);

        await fs.promises.writeFile(filePath, reportContent, 'utf-8');

        if (!this.options.quiet) {
          logger.info(`  Saved report for run ${run.id}: ${filePath}`);
        }
      } catch (error) {
        logger.error(
          `Failed to fetch report for run ${run.id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private async getRunDetails(runId: number): Promise<MaestroRunDetails> {
    try {
      const response = await axios.get(`${this.URL}/${this.appId}/${runId}`, {
        headers: {
          'User-Agent': utils.getUserAgent(),
        },
        auth: {
          username: this.credentials.userName,
          password: this.credentials.accessKey,
        },
      });

      return response.data;
    } catch (error) {
      throw new TestingBotError(`Failed to get run details for run ${runId}`, {
        cause: error,
      });
    }
  }

  private async waitForArtifactsSync(
    runId: number,
  ): Promise<MaestroRunDetails> {
    const maxAttempts = 60; // 5 minutes max wait for artifacts
    let attempts = 0;

    while (attempts < maxAttempts) {
      const details = await this.getRunDetails(runId);
      if (details.assets_synced) {
        return details;
      }
      attempts++;
      await this.sleep(this.POLL_INTERVAL_MS);
    }

    throw new TestingBotError(
      `Timed out waiting for artifacts to sync for run ${runId}`,
    );
  }

  private async downloadFile(url: string, filePath: string): Promise<void> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': utils.getUserAgent(),
        }
      });

      await fs.promises.writeFile(filePath, response.data);
    } catch (error) {
      throw new TestingBotError(`Failed to download file from ${url}`, {
        cause: error,
      });
    }
  }

  private generateArtifactZipName(): string {
    // Use --build option if provided, otherwise generate timestamp-based name
    if (this.options.build) {
      const sanitizedBuild = this.options.build.replace(/[^a-zA-Z0-9_-]/g, '_');
      return `${sanitizedBuild}.zip`;
    }

    // Generate unique name with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `maestro_artifacts_${timestamp}.zip`;
  }

  private async downloadArtifacts(runs: MaestroRunInfo[]): Promise<void> {
    if (!this.options.downloadArtifacts) return;

    if (!this.options.quiet) {
      logger.info('Downloading artifacts...');
    }

    const outputDir = this.options.artifactsOutputDir || process.cwd();

    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'testingbot-maestro-artifacts-'),
    );

    try {
      for (const run of runs) {
        try {
          if (!this.options.quiet) {
            logger.info(`  Waiting for artifacts sync for run ${run.id}...`);
          }

          const runDetails = await this.waitForArtifactsSync(run.id);

          if (!runDetails.assets) {
            if (!this.options.quiet) {
              logger.info(`  No artifacts available for run ${run.id}`);
            }
            continue;
          }

          const runDir = path.join(tempDir, `run_${run.id}`);
          await fs.promises.mkdir(runDir, { recursive: true });

          // Download logs
          if (runDetails.assets.logs && runDetails.assets.logs.length > 0) {
            const logsDir = path.join(runDir, 'logs');
            await fs.promises.mkdir(logsDir, { recursive: true });

            for (let i = 0; i < runDetails.assets.logs.length; i++) {
              const logUrl = runDetails.assets.logs[i];
              const logFileName = path.basename(logUrl) || `log_${i}.txt`;
              const logPath = path.join(logsDir, logFileName);

              try {
                await this.downloadFile(logUrl, logPath);
                if (!this.options.quiet) {
                  logger.info(`    Downloaded log: ${logFileName}`);
                }
              } catch (error) {
                logger.error(
                  `    Failed to download log ${logFileName}: ${error instanceof Error ? error.message : error}`,
                );
              }
            }
          }

          if (
            runDetails.assets.video &&
            typeof runDetails.assets.video === 'string'
          ) {
            const videoDir = path.join(runDir, 'video');
            await fs.promises.mkdir(videoDir, { recursive: true });

            const videoUrl = runDetails.assets.video;
            const videoFileName = path.basename(videoUrl) || 'video.mp4';
            const videoPath = path.join(videoDir, videoFileName);

            try {
              await this.downloadFile(videoUrl, videoPath);
              if (!this.options.quiet) {
                logger.info(`    Downloaded video: ${videoFileName}`);
              }
            } catch (error) {
              logger.error(
                `    Failed to download video: ${error instanceof Error ? error.message : error}`,
              );
            }
          }

          if (
            runDetails.assets.screenshots &&
            runDetails.assets.screenshots.length > 0
          ) {
            const screenshotsDir = path.join(runDir, 'screenshots');
            await fs.promises.mkdir(screenshotsDir, { recursive: true });

            for (let i = 0; i < runDetails.assets.screenshots.length; i++) {
              const screenshotUrl = runDetails.assets.screenshots[i];
              const screenshotFileName =
                path.basename(screenshotUrl) || `screenshot_${i}.png`;
              const screenshotPath = path.join(
                screenshotsDir,
                screenshotFileName,
              );

              try {
                await this.downloadFile(screenshotUrl, screenshotPath);
                if (!this.options.quiet) {
                  logger.info(
                    `    Downloaded screenshot: ${screenshotFileName}`,
                  );
                }
              } catch (error) {
                logger.error(
                  `    Failed to download screenshot ${screenshotFileName}: ${error instanceof Error ? error.message : error}`,
                );
              }
            }
          }

          if (runDetails.report) {
            const reportPath = path.join(runDir, 'report.xml');
            try {
              await fs.promises.writeFile(
                reportPath,
                runDetails.report,
                'utf-8',
              );
              if (!this.options.quiet) {
                logger.info(`    Saved report.xml`);
              }
            } catch (error) {
              logger.error(
                `    Failed to save report.xml: ${error instanceof Error ? error.message : error}`,
              );
            }
          }

          if (!this.options.quiet) {
            logger.info(`  Artifacts for run ${run.id} downloaded`);
          }
        } catch (error) {
          logger.error(
            `Failed to download artifacts for run ${run.id}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }

      const zipFileName = this.generateArtifactZipName();
      const zipFilePath = path.join(outputDir, zipFileName);

      if (!this.options.quiet) {
        logger.info(`Creating artifacts zip: ${zipFileName}`);
      }

      await this.createZipFromDirectory(tempDir, zipFilePath);

      if (!this.options.quiet) {
        logger.info(`Artifacts saved to: ${zipFilePath}`);
      }
    } finally {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async createZipFromDirectory(
    sourceDir: string,
    zipPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private extractErrorMessage(cause: unknown): string | null {
    if (typeof cause === 'string') {
      return cause;
    }

    // Handle arrays of errors
    if (Array.isArray(cause)) {
      return cause.join('\n');
    }

    if (cause && typeof cause === 'object') {
      // Handle axios errors which have response.data
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

      // Handle standard Error objects
      if (cause instanceof Error) {
        return cause.message;
      }

      // Handle plain objects with errors array, error, or message property
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

    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);
  }

  private removeSignalHandlers(): void {
    if (this.signalHandler) {
      process.removeListener('SIGINT', this.signalHandler);
      process.removeListener('SIGTERM', this.signalHandler);
      this.signalHandler = null;
    }
  }

  private handleShutdown(): void {
    if (this.isShuttingDown) {
      // Already shutting down, force exit on second signal
      logger.warn('Force exiting...');
      process.exit(1);
    }

    this.isShuttingDown = true;
    this.clearLine();
    logger.warn('Received interrupt signal, stopping test runs...');

    // Stop all active runs
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

      this.socket.on('maestro_data', (data: string) => {
        this.handleMaestroData(data);
      });

      this.socket.on('maestro_error', (data: string) => {
        this.handleMaestroError(data);
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

  private handleMaestroData(data: string): void {
    try {
      const message: MaestroSocketMessage = JSON.parse(data);
      if (message.payload) {
        // Clear the status line before printing output
        this.clearLine();
        // Print the Maestro output, trimming trailing newlines
        process.stdout.write(message.payload);
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  private handleMaestroError(data: string): void {
    try {
      const message: MaestroSocketMessage = JSON.parse(data);
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
