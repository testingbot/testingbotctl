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
import platformUtil from '../utils/platform';
import colors from 'colors';

export interface MaestroRunAssets {
  logs?: Record<string, string>;
  video?: string | false;
  screenshots?: string[];
}

export type MaestroFlowStatus = 'WAITING' | 'READY' | 'DONE' | 'FAILED';

export interface MaestroFlowInfo {
  id: number;
  name: string;
  report?: string;
  requested_at?: string;
  completed_at?: string;
  status: MaestroFlowStatus;
  success?: number;
  test_case_id?: number;
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
  flows?: MaestroFlowInfo[];
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
          logger.info(
            `View realtime results: https://testingbot.com/members/maestro/${this.appId}`,
          );
        }
        return { success: true, runs: [] };
      }

      // Set up signal handlers before waiting for completion
      this.setupSignalHandlers();

      // Connect to real-time update server (unless --quiet is specified)
      // this.connectToUpdateServer();

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

    // Check if app already exists (unless checksum check is disabled)
    if (!this.options.ignoreChecksumCheck) {
      const checksum = await this.upload.calculateChecksum(appPath);
      const existingApp = await this.checkAppChecksum(checksum);

      if (existingApp) {
        this.appId = existingApp.id;
        if (!this.options.quiet) {
          logger.info('  App already uploaded, skipping upload');
        }
        return true;
      }
    }

    if (!this.options.quiet) {
      logger.info('Uploading Maestro App');
    }

    // App doesn't exist (or checksum check skipped), upload it
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

  private async checkAppChecksum(
    checksum: string,
  ): Promise<{ id: number } | null> {
    try {
      const response = await axios.post(
        `${this.URL}/app/checksum`,
        { checksum },
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
      if (result.app_exists && result.id) {
        return { id: result.id };
      }

      return null;
    } catch {
      // If checksum check fails, proceed with upload
      return null;
    }
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

    // Log files being included in the zip
    if (!this.options.quiet) {
      this.logIncludedFiles(allFlowFiles, baseDir);
    }

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

    // Include config.yaml if it exists
    if (config) {
      allFiles.add(configPath);
    }

    return Array.from(allFiles);
  }

  private async discoverDependencies(
    flowFile: string,
    baseDir: string,
    visited: Set<string> = new Set(),
  ): Promise<string[]> {
    // Normalize path to handle different relative path references to same file
    const normalizedFlowFile = path.resolve(flowFile);

    // Prevent circular dependencies
    if (visited.has(normalizedFlowFile)) {
      return [];
    }
    visited.add(normalizedFlowFile);

    const dependencies: string[] = [];

    try {
      const content = await fs.promises.readFile(flowFile, 'utf-8');

      // Maestro YAML files can have front matter (metadata) followed by ---
      // and then the actual flow steps. Use loadAll to handle both cases.
      const documents: unknown[] = [];
      yaml.loadAll(content, (doc) => documents.push(doc));

      for (const flowData of documents) {
        if (flowData !== null && typeof flowData === 'object') {
          const deps = await this.extractPathsFromValue(
            flowData,
            flowFile,
            baseDir,
            visited,
          );
          dependencies.push(...deps);
        }
      }
    } catch {
      // Ignore parsing errors
    }

    return dependencies;
  }

  /**
   * Check if a string looks like a file path (relative path with extension)
   */
  private looksLikePath(value: string): boolean {
    // Must be a relative path (starts with . or contains /)
    const isRelative = value.startsWith('./') || value.startsWith('../');
    const hasPathSeparator = value.includes('/');

    // Must have a file extension
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(value);

    // Exclude URLs
    const isUrl =
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('file://');

    // Exclude template variables that are just ${...}
    const isOnlyVariable = /^\$\{[^}]+\}$/.test(value);

    return (isRelative || hasPathSeparator) && hasExtension && !isUrl && !isOnlyVariable;
  }

  /**
   * Try to add a file path as a dependency if it exists
   */
  private async tryAddDependency(
    filePath: string,
    flowFile: string,
    baseDir: string,
    dependencies: string[],
    visited: Set<string>,
  ): Promise<void> {
    const depPath = path.resolve(path.dirname(flowFile), filePath);

    // Check if already added (handles deduplication for non-YAML files)
    // YAML files are tracked by discoverDependencies to handle circular refs
    if (visited.has(depPath)) {
      return;
    }

    if (
      (await fs.promises.access(depPath).catch(() => false)) === undefined
    ) {
      dependencies.push(depPath);

      // If it's a YAML file, recursively discover its dependencies
      // discoverDependencies will add it to visited to prevent circular refs
      const ext = path.extname(depPath).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        const nestedDeps = await this.discoverDependencies(depPath, baseDir, visited);
        dependencies.push(...nestedDeps);
      } else {
        // For non-YAML files, add to visited here to prevent duplicates
        visited.add(depPath);
      }
    }
  }

  /**
   * Recursively extract file paths from any value in the YAML structure
   */
  private async extractPathsFromValue(
    value: unknown,
    flowFile: string,
    baseDir: string,
    visited: Set<string>,
  ): Promise<string[]> {
    const dependencies: string[] = [];

    if (typeof value === 'string') {
      // Check if this string looks like a file path
      if (this.looksLikePath(value)) {
        await this.tryAddDependency(value, flowFile, baseDir, dependencies, visited);
      }
    } else if (Array.isArray(value)) {
      // Recursively check array elements
      for (const item of value) {
        const deps = await this.extractPathsFromValue(item, flowFile, baseDir, visited);
        dependencies.push(...deps);
      }
    } else if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;

      // Track which keys we've handled specially to avoid double-processing
      const handledKeys = new Set<string>();

      // Handle known Maestro commands that reference files
      // These should always be treated as file paths, even without path separators

      // runScript: can be string or { file: "..." }
      if ('runScript' in obj) {
        handledKeys.add('runScript');
        const runScript = obj.runScript;
        const scriptFile =
          typeof runScript === 'string'
            ? runScript
            : (runScript as Record<string, unknown>)?.file;
        if (typeof scriptFile === 'string') {
          await this.tryAddDependency(scriptFile, flowFile, baseDir, dependencies, visited);
        }
      }

      // runFlow: can be string or { file: "...", commands: [...] }
      if ('runFlow' in obj) {
        handledKeys.add('runFlow');
        const runFlow = obj.runFlow;
        const flowRef =
          typeof runFlow === 'string'
            ? runFlow
            : (runFlow as Record<string, unknown>)?.file;
        if (typeof flowRef === 'string') {
          await this.tryAddDependency(flowRef, flowFile, baseDir, dependencies, visited);
        }
        // Recurse into runFlow for inline commands
        if (typeof runFlow === 'object' && runFlow !== null) {
          const deps = await this.extractPathsFromValue(runFlow, flowFile, baseDir, visited);
          dependencies.push(...deps);
        }
      }

      // addMedia: can be string or array of strings
      if ('addMedia' in obj) {
        handledKeys.add('addMedia');
        const addMedia = obj.addMedia;
        const mediaFiles = Array.isArray(addMedia) ? addMedia : [addMedia];
        for (const mediaFile of mediaFiles) {
          if (typeof mediaFile === 'string') {
            await this.tryAddDependency(mediaFile, flowFile, baseDir, dependencies, visited);
          }
        }
      }

      // onFlowStart: array of commands in frontmatter
      if ('onFlowStart' in obj) {
        handledKeys.add('onFlowStart');
        const onFlowStart = obj.onFlowStart;
        if (Array.isArray(onFlowStart)) {
          const deps = await this.extractPathsFromValue(onFlowStart, flowFile, baseDir, visited);
          dependencies.push(...deps);
        }
      }

      // onFlowComplete: array of commands in frontmatter
      if ('onFlowComplete' in obj) {
        handledKeys.add('onFlowComplete');
        const onFlowComplete = obj.onFlowComplete;
        if (Array.isArray(onFlowComplete)) {
          const deps = await this.extractPathsFromValue(onFlowComplete, flowFile, baseDir, visited);
          dependencies.push(...deps);
        }
      }

      // Generic handling for any command with nested 'commands' array
      // This covers repeat, retry, doubleTapOn, longPressOn, and any future commands
      // that use the commands pattern
      if ('commands' in obj) {
        handledKeys.add('commands');
        const commands = obj.commands;
        if (Array.isArray(commands)) {
          const deps = await this.extractPathsFromValue(commands, flowFile, baseDir, visited);
          dependencies.push(...deps);
        }
      }

      // Generic handling for 'file' property in any command (e.g., retry: { file: ... })
      if ('file' in obj && typeof obj.file === 'string') {
        handledKeys.add('file');
        await this.tryAddDependency(obj.file, flowFile, baseDir, dependencies, visited);
      }

      // Recursively check remaining object properties for nested structures
      for (const [key, propValue] of Object.entries(obj)) {
        if (!handledKeys.has(key)) {
          const deps = await this.extractPathsFromValue(
            propValue,
            flowFile,
            baseDir,
            visited,
          );
          dependencies.push(...deps);
        }
      }
    }

    return dependencies;
  }

  private logIncludedFiles(files: string[], baseDir?: string): void {
    // Get relative paths for display
    const relativePaths = files
      .map((f) => (baseDir ? path.relative(baseDir, f) : path.basename(f)))
      .sort();

    // Group by file type
    const groups: Record<string, string[]> = {
      'Flow files': [],
      'Scripts': [],
      'Media files': [],
      'Config files': [],
      'Other': [],
    };

    for (const filePath of relativePaths) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        if (filePath === 'config.yaml' || filePath.endsWith('/config.yaml')) {
          groups['Config files'].push(filePath);
        } else {
          groups['Flow files'].push(filePath);
        }
      } else if (ext === '.js' || ext === '.ts') {
        groups['Scripts'].push(filePath);
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov'].includes(ext)) {
        groups['Media files'].push(filePath);
      } else {
        groups['Other'].push(filePath);
      }
    }

    logger.info(`Bundling ${files.length} files into flows.zip:`);
    for (const [groupName, groupFiles] of Object.entries(groups)) {
      if (groupFiles.length > 0) {
        logger.info(`  ${groupName} (${groupFiles.length}):`);
        // Show first 10 files, then summarize if more
        const displayFiles = groupFiles.slice(0, 10);
        for (const file of displayFiles) {
          logger.info(`    - ${file}`);
        }
        if (groupFiles.length > 10) {
          logger.info(`    ... and ${groupFiles.length - 10} more`);
        }
      }
    }
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
          ...(this.options.shardSplit && { shardSplit: this.options.shardSplit }),
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

      // Check for version update notification
      const latestVersion = response.headers?.['x-testingbotctl-version'];
      utils.checkForUpdate(latestVersion);

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
    const previousFlowStatus: Map<number, MaestroFlowStatus> = new Map();
    let flowsTableDisplayed = false;
    let displayedLineCount = 0;

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
        // Check if any run has flows and display them
        const allFlows: MaestroFlowInfo[] = [];
        for (const run of status.runs) {
          if (run.flows && run.flows.length > 0) {
            allFlows.push(...run.flows);
          }
        }

        if (allFlows.length > 0) {
          if (!flowsTableDisplayed) {
            // First time showing flows - display header and initial state
            this.displayRunStatus(status.runs, startTime, previousStatus);
            console.log(); // Empty line before flows table
            this.displayFlowsTableHeader();
            displayedLineCount = this.displayFlowsWithLimit(allFlows, previousFlowStatus);
            flowsTableDisplayed = true;
          } else {
            // Update flows in place
            displayedLineCount = this.updateFlowsInPlace(allFlows, previousFlowStatus, displayedLineCount);
          }
        } else {
          // No flows yet, show run status
          this.displayRunStatus(status.runs, startTime, previousStatus);
        }
      }

      if (status.completed) {
        // Print final summary
        if (!this.options.quiet) {
          console.log(); // Empty line before summary

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
        if (this.options.downloadArtifacts) {
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

      // Show URL when test starts running (transitions from WAITING to READY)
      if (statusChanged && prevStatus === 'WAITING' && run.status === 'READY') {
        console.log(
          `  🚀 Run ${run.id} (${run.capabilities.deviceName}): Test started`,
        );
        console.log(
          `     Watch this test in realtime: https://testingbot.com/members/maestro/${this.appId}/runs/${run.id}`,
        );
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
    platformUtil.clearLine();
  }

  private displayFlowsProgress(
    flows: MaestroFlowInfo[],
    startTime: number,
    isUpdate: boolean,
  ): void {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const elapsedStr = this.formatElapsedTime(elapsedSeconds);

    // Count flows by status
    let waiting = 0;
    let running = 0;
    let passed = 0;
    let failed = 0;

    for (const flow of flows) {
      switch (flow.status) {
        case 'WAITING':
          waiting++;
          break;
        case 'READY':
          running++;
          break;
        case 'DONE':
          if (flow.success === 1) {
            passed++;
          } else {
            failed++;
          }
          break;
        case 'FAILED':
          failed++;
          break;
      }
    }

    const total = flows.length;
    const completed = passed + failed;

    // Build progress summary with colors
    const parts: string[] = [];
    if (waiting > 0) parts.push(colors.white(`${waiting} waiting`));
    if (running > 0) parts.push(colors.blue(`${running} running`));
    if (passed > 0) parts.push(colors.green(`${passed} passed`));
    if (failed > 0) parts.push(colors.red(`${failed} failed`));

    const progressBar = `[${completed}/${total}]`;
    const message = `  🔄 Flows ${progressBar}: ${parts.join(' | ')} (${elapsedStr})`;

    if (isUpdate) {
      // Clear current line and write new progress
      process.stdout.write(`\r\x1b[K${message}`);
    } else {
      process.stdout.write(message);
    }
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

  private getFlowStatusDisplay(flow: MaestroFlowInfo): { text: string; colored: string } {
    switch (flow.status) {
      case 'WAITING':
        return { text: 'WAITING', colored: colors.white('WAITING') };
      case 'READY':
        return { text: 'RUNNING', colored: colors.blue('RUNNING') };
      case 'DONE':
        if (flow.success === 1) {
          return { text: 'PASSED', colored: colors.green('PASSED') };
        } else {
          return { text: 'FAILED', colored: colors.red('FAILED') };
        }
      case 'FAILED':
        return { text: 'FAILED', colored: colors.red('FAILED') };
      default:
        return { text: flow.status, colored: flow.status };
    }
  }

  private calculateFlowDuration(flow: MaestroFlowInfo): string {
    if (!flow.requested_at) {
      return '-';
    }

    const startTime = new Date(flow.requested_at).getTime();
    let endTime: number;

    if (flow.completed_at) {
      endTime = new Date(flow.completed_at).getTime();
    } else {
      endTime = Date.now();
    }

    const durationSeconds = Math.floor((endTime - startTime) / 1000);
    return this.formatElapsedTime(durationSeconds);
  }

  private getTerminalHeight(): number {
    // Default to 24 if terminal height is not available
    return process.stdout.rows || 24;
  }

  private getMaxDisplayableFlows(): number {
    const terminalHeight = this.getTerminalHeight();
    // Reserve lines for: header (2) + summary line (1) + some padding (3)
    const reservedLines = 6;
    return Math.max(5, terminalHeight - reservedLines);
  }

  private getRemainingSummary(
    flows: MaestroFlowInfo[],
    displayedCount: number,
  ): string {
    const remaining = flows.slice(displayedCount);
    if (remaining.length === 0) {
      return '';
    }

    // Count statuses for remaining flows
    let waiting = 0;
    let running = 0;
    let passed = 0;
    let failed = 0;

    for (const flow of remaining) {
      switch (flow.status) {
        case 'WAITING':
          waiting++;
          break;
        case 'READY':
          running++;
          break;
        case 'DONE':
          if (flow.success === 1) {
            passed++;
          } else {
            failed++;
          }
          break;
        case 'FAILED':
          failed++;
          break;
      }
    }

    const parts: string[] = [];
    if (waiting > 0) parts.push(colors.white(`${waiting} waiting`));
    if (running > 0) parts.push(colors.blue(`${running} running`));
    if (passed > 0) parts.push(colors.green(`${passed} passed`));
    if (failed > 0) parts.push(colors.red(`${failed} failed`));

    return ` ... and ${remaining.length} more: ${parts.join(', ')}`;
  }

  private displayFlowsWithLimit(
    flows: MaestroFlowInfo[],
    previousFlowStatus: Map<number, MaestroFlowStatus>,
  ): number {
    const maxFlows = this.getMaxDisplayableFlows();
    const displayFlows = flows.slice(0, maxFlows);
    let linesWritten = 0;

    for (const flow of displayFlows) {
      this.displayFlowRow(flow, false);
      previousFlowStatus.set(flow.id, flow.status);
      linesWritten++;
    }

    // Show summary for remaining flows
    if (flows.length > maxFlows) {
      const summary = this.getRemainingSummary(flows, maxFlows);
      console.log(colors.dim(summary));
      linesWritten++;
    }

    return linesWritten;
  }

  private displayFlowsTableHeader(): void {
    const header = ` ${'Duration'.padEnd(10)} ${'Status'.padEnd(8)} Test`;
    const separator = ` ${'─'.repeat(10)} ${'─'.repeat(8)} ${'─'.repeat(40)}`;
    console.log(colors.dim(header));
    console.log(colors.dim(separator));
  }

  private displayFlowRow(flow: MaestroFlowInfo, isUpdate: boolean = false): void {
    const duration = this.calculateFlowDuration(flow).padEnd(10);
    const statusDisplay = this.getFlowStatusDisplay(flow);
    // Pad based on display text length, add extra for color codes
    const statusPadded = statusDisplay.colored + ' '.repeat(Math.max(0, 8 - statusDisplay.text.length));
    const name = flow.name;

    const row = ` ${duration} ${statusPadded} ${name}`;

    if (isUpdate) {
      // Move cursor up and clear line before writing
      process.stdout.write(`\r${row}`);
    } else {
      console.log(row);
    }
  }

  private displayFlowsTable(
    flows: MaestroFlowInfo[],
    previousFlowStatus: Map<number, MaestroFlowStatus>,
    showHeader: boolean,
  ): number {
    if (showHeader) {
      this.displayFlowsTableHeader();
    }

    let linesWritten = 0;

    for (const flow of flows) {
      const prevStatus = previousFlowStatus.get(flow.id);
      const isNewFlow = prevStatus === undefined;

      if (isNewFlow) {
        this.displayFlowRow(flow, false);
        linesWritten++;
      }

      previousFlowStatus.set(flow.id, flow.status);
    }

    return linesWritten;
  }

  private updateFlowsInPlace(
    flows: MaestroFlowInfo[],
    previousFlowStatus: Map<number, MaestroFlowStatus>,
    displayedLineCount: number,
  ): number {
    const maxFlows = this.getMaxDisplayableFlows();
    const displayFlows = flows.slice(0, maxFlows);
    const hasRemaining = flows.length > maxFlows;

    // Move cursor up by the number of lines we PREVIOUSLY displayed
    if (displayedLineCount > 0) {
      process.stdout.write(`\x1b[${displayedLineCount}A`);
    }

    let linesWritten = 0;

    // Redraw displayed flows
    for (const flow of displayFlows) {
      const duration = this.calculateFlowDuration(flow).padEnd(10);
      const statusDisplay = this.getFlowStatusDisplay(flow);
      const statusPadded = statusDisplay.colored + ' '.repeat(Math.max(0, 8 - statusDisplay.text.length));
      const name = flow.name;

      const row = ` ${duration} ${statusPadded} ${name}`;
      process.stdout.write(`\r\x1b[K${row}\n`);

      previousFlowStatus.set(flow.id, flow.status);
      linesWritten++;
    }

    // Update or add summary line for remaining flows
    if (hasRemaining) {
      const summary = this.getRemainingSummary(flows, maxFlows);
      process.stdout.write(`\r\x1b[K${colors.dim(summary)}\n`);
      linesWritten++;
    }

    // Return the number of lines we wrote
    return linesWritten;
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

        // Check for version update notification
        const latestVersion = response.headers?.['x-testingbotctl-version'];
        utils.checkForUpdate(latestVersion);

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

      // Check for version update notification
      const latestVersion = response.headers?.['x-testingbotctl-version'];
      utils.checkForUpdate(latestVersion);

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

  private async downloadFile(
    url: string,
    filePath: string,
    retries = 3,
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 60000, // 60 second timeout for large files
        });

        await fs.promises.writeFile(filePath, response.data);
        return;
      } catch (error) {
        lastError = error;

        // Don't retry on 4xx errors (client errors like 403, 404)
        if (axios.isAxiosError(error) && error.response?.status) {
          const status = error.response.status;
          if (status >= 400 && status < 500) {
            break;
          }
        }

        // Wait before retrying (exponential backoff)
        if (attempt < retries) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    // Extract detailed error message
    let errorDetail = '';
    if (axios.isAxiosError(lastError)) {
      if (lastError.response) {
        errorDetail = `HTTP ${lastError.response.status}: ${lastError.response.statusText}`;
      } else if (lastError.code) {
        errorDetail = lastError.code;
      } else if (lastError.message) {
        errorDetail = lastError.message;
      }
    } else if (lastError instanceof Error) {
      errorDetail = lastError.message;
    } else if (lastError) {
      errorDetail = String(lastError);
    }

    throw new TestingBotError(
      `Failed to download file${errorDetail ? `: ${errorDetail}` : ''}`,
      {
        cause: lastError,
      },
    );
  }

  private async generateArtifactZipName(outputDir: string): Promise<string> {
    if (!this.options.build) {
      // Generate unique name with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `maestro_artifacts_${timestamp}.zip`;
    }

    const baseName = this.options.build.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${baseName}.zip`;
    const filePath = path.join(outputDir, fileName);

    try {
      await fs.promises.access(filePath);
      // File exists, append timestamp
      return `${baseName}_${Date.now()}.zip`;
    } catch {
      // File doesn't exist, use base name
      return fileName;
    }
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
          if (
            runDetails.assets.logs &&
            Object.keys(runDetails.assets.logs).length > 0
          ) {
            const logsDir = path.join(runDir, 'logs');
            await fs.promises.mkdir(logsDir, { recursive: true });

            for (const [logName, logUrl] of Object.entries(
              runDetails.assets.logs,
            )) {
              const logFileName = `${logName}.txt`;
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
            const videoFileName = 'video.mp4';
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
              const screenshotFileName = `screenshot_${i}.png`;
              const screenshotPath = path.join(screenshotsDir, screenshotFileName);

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

      const zipFileName = await this.generateArtifactZipName(outputDir);
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

    platformUtil.setupSignalHandlers(this.signalHandler);
  }

  private removeSignalHandlers(): void {
    if (this.signalHandler) {
      platformUtil.removeSignalHandlers(this.signalHandler);
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
    logger.info('Received interrupt signal, stopping test runs...');

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
