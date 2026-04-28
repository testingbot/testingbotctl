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
import { detectPlatformFromFile } from '../utils/file-type-detector';
import pc from 'picocolors';
import BaseProvider from './base_provider';
import { setTitle } from '../ui/terminal-title';
import { HTTP, SOCKET } from '../config/constants';

const FLOW_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FLOW_ANIMATION_MS = 120;

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
  error_messages?: string[];
  assets?: MaestroRunAssets;
}

export interface MaestroRunEnvironment {
  device?: string;
  name?: string;
  version?: string;
}

export interface MaestroRunInfo {
  id: number;
  status: 'WAITING' | 'READY' | 'DONE' | 'FAILED';
  capabilities: {
    deviceName: string;
    platformName: string;
    version?: string;
  };
  environment?: MaestroRunEnvironment;
  success: number;
  report?: string;
  options?: Record<string, unknown>;
  assets?: MaestroRunAssets;
  flows?: MaestroFlowInfo[];
  error_messages?: string[];
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

export interface MissingFileReference {
  flowFile: string;
  referencedFile: string;
  resolvedPath: string;
}

export default class Maestro extends BaseProvider<MaestroOptions> {
  protected readonly URL = 'https://api.testingbot.com/v1/app-automate/maestro';

  private detectedPlatform: 'Android' | 'iOS' | undefined = undefined;
  private socket: Socket | null = null;
  private updateServer: string | null = null;
  private updateKey: string | null = null;
  private socketFallbackWarned = false;

  private flowAnimationFrame = 0;
  private flowAnimationTimer: NodeJS.Timeout | null = null;
  private latestFlows: MaestroFlowInfo[] = [];
  private latestDisplayedLineCount = 0;

  public constructor(credentials: Credentials, options: MaestroOptions) {
    super(credentials, options);
  }

  private static readonly SUPPORTED_APP_EXTENSIONS = [
    '.apk',
    '.apks',
    '.ipa',
    '.app',
    '.zip',
  ];

  private async validate(): Promise<boolean> {
    if (this.options.app === undefined) {
      throw new TestingBotError(`app option is required`);
    }

    // Validate app file extension
    const appExt = path.extname(this.options.app).toLowerCase();
    if (!Maestro.SUPPORTED_APP_EXTENSIONS.includes(appExt)) {
      throw new TestingBotError(
        `Unsupported app file format: ${appExt || '(no extension)'}. ` +
          `Supported formats: ${Maestro.SUPPORTED_APP_EXTENSIONS.join(', ')}`,
      );
    }

    if (this.options.flows === undefined || this.options.flows.length === 0) {
      throw new TestingBotError(`flows option is required`);
    }

    if (this.options.report && !this.options.reportOutputDir) {
      throw new TestingBotError(
        `--report-output-dir is required when --report is specified`,
      );
    }

    // Build list of all file checks to run in parallel
    const fileChecks: Promise<void>[] = [
      fs.promises.access(this.options.app, fs.constants.R_OK).catch(() => {
        throw new TestingBotError(
          `Provided app path does not exist ${this.options.app}`,
        );
      }),
    ];

    if (this.options.configFile) {
      fileChecks.push(
        fs.promises
          .access(this.options.configFile, fs.constants.R_OK)
          .catch(() => {
            throw new TestingBotError(
              `Specified config file does not exist: ${this.options.configFile}`,
            );
          }),
      );
    }

    // Check if all flows paths exist (can be files, directories or glob patterns)
    for (const flowsPath of this.options.flows) {
      const isGlobPattern =
        flowsPath.includes('*') ||
        flowsPath.includes('?') ||
        flowsPath.includes('{');

      if (!isGlobPattern) {
        fileChecks.push(
          fs.promises.access(flowsPath, fs.constants.R_OK).catch(() => {
            throw new TestingBotError(`flows path does not exist ${flowsPath}`);
          }),
        );
      }
    }

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

    if (this.options.dryRun) {
      // Detect platform for dry-run output (no network call needed)
      if (!this.options.platformName) {
        this.detectedPlatform = await this.detectPlatform();
      }

      const capabilities = this.options.getCapabilities(this.detectedPlatform);
      const maestroOptions = this.options.getMaestroOptions();
      const metadata = this.options.metadata;

      // Process flows to show actual zip structure
      const flowResult = await this.collectFlows();

      this.printDryRunSummary({
        provider: 'Maestro',
        apiUrl: this.URL,
        uploads: [
          {
            label: 'App',
            filePath: this.options.app,
            endpoint: `${this.URL}/app`,
          },
          {
            label: 'Flows',
            filePath: this.options.flows.join(', '),
            endpoint: `${this.URL}/<appId>/tests`,
          },
        ],
        runPayload: {
          capabilities: [capabilities],
          ...(maestroOptions && { maestroOptions }),
          ...(this.options.shardSplit && {
            shardSplit: this.options.shardSplit,
          }),
          ...(metadata && { metadata }),
        },
      });

      // Show zip structure details
      if (flowResult) {
        const { allFlowFiles, baseDir } = flowResult;
        const effectiveBase =
          baseDir || this.computeCommonDirectory(allFlowFiles);
        logger.info(
          'Zip structure (files as they will appear in the archive):',
        );
        for (const file of allFlowFiles) {
          const archiveName = path.relative(effectiveBase, path.resolve(file));
          logger.info(`  ${archiveName}`);
        }
        logger.info(`  Base directory: ${path.resolve(effectiveBase)}`);
      } else {
        logger.info('Flows: single .zip file (uploaded as-is)');
      }

      return { success: true, runs: [] };
    }

    try {
      setTitle('maestro');
      // Quick connectivity check before starting uploads
      await this.ensureConnectivity();

      // Detect platform from file content if not explicitly provided
      if (!this.options.platformName) {
        this.detectedPlatform = await this.detectPlatform();
      }

      setTitle('maestro · uploading app');
      await this.uploadApp();

      if (!this.options.quiet) {
        logger.info('Uploading Maestro Flows');
      }
      setTitle('maestro · uploading flows');
      await this.uploadFlows();

      if (this.options.tunnel && this.options.async) {
        throw new TestingBotError(
          'Cannot use --tunnel with --async mode. The tunnel would close when the CLI exits. Use a standalone tunnel instead.',
        );
      }

      await this.startTunnel();

      if (!this.options.quiet) {
        logger.info('Running Maestro Tests');
      }
      setTitle('maestro · queued');
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
      await this.stopTunnel();

      return result;
    } catch (error) {
      // Clean up on error
      this.spinner.stop();
      this.stopFlowAnimation();
      this.disconnectFromUpdateServer();
      this.removeSignalHandlers();
      await this.stopTunnel();
      setTitle('maestro · ✘ error');

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
    let appPath = this.options.app;
    const ext = path.extname(appPath).toLowerCase();
    let tempZipDir: string | null = null;

    // If .app bundle (directory), zip it first
    if (ext === '.app') {
      const stat = await fs.promises.stat(appPath);
      if (stat.isDirectory()) {
        if (!this.options.quiet) {
          logger.info('Zipping .app bundle for upload');
        }
        const zipped = await this.zipAppBundle(appPath);
        tempZipDir = zipped.tmpDir;
        appPath = zipped.zipPath;
      }
    }

    try {
      let contentType:
        | 'application/vnd.android.package-archive'
        | 'application/octet-stream'
        | 'application/zip';
      if (ext === '.apk') {
        contentType = 'application/vnd.android.package-archive';
      } else if (ext === '.ipa') {
        contentType = 'application/octet-stream';
      } else if (ext === '.zip' || ext === '.app') {
        // .app bundles are zipped, so use application/zip
        contentType = 'application/zip';
      } else {
        contentType = 'application/octet-stream';
      }

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

      const result = await this.upload.upload({
        filePath: appPath,
        url: `${this.URL}/app`,
        credentials: this.credentials,
        contentType,
        showProgress: !this.options.quiet,
        validateZipFormat: true,
      });

      this.appId = result.id;

      return true;
    } finally {
      if (tempZipDir) {
        await fs.promises
          .rm(tempZipDir, { recursive: true, force: true })
          .catch((err) => {
            logger.debug(
              `Failed to clean up temporary app zip dir ${tempZipDir}: ${err instanceof Error ? err.message : err}`,
            );
          });
      }
    }
  }

  /**
   * Zip a .app bundle directory into a temporary zip file
   */
  private async zipAppBundle(
    appPath: string,
  ): Promise<{ zipPath: string; tmpDir: string }> {
    const appName = path.basename(appPath);
    const tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'testingbot-app-'),
    );
    const zipPath = path.join(tmpDir, `${appName}.zip`);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve({ zipPath, tmpDir }));
      output.on('error', (err) => reject(err));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      // Add the .app directory with its name preserved
      archive.directory(appPath, appName);
      archive.finalize();
    });
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

  /**
   * Collect and resolve all flow files, their dependencies, and determine the
   * base directory for the zip structure. This is shared by both uploadFlows
   * and the dry-run path.
   *
   * Returns null if the input is a single .zip file (direct upload, no processing).
   */
  async collectFlows(): Promise<{
    allFlowFiles: string[];
    baseDir: string | undefined;
  } | null> {
    const flowsPaths = this.options.flows;

    // Special case: single zip file - no processing needed
    if (flowsPaths.length === 1) {
      const singlePath = flowsPaths[0];
      const stat = await fs.promises.stat(singlePath).catch(() => null);
      if (stat?.isFile() && path.extname(singlePath).toLowerCase() === '.zip') {
        return null;
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
    // If we have a single directory, use it as base; otherwise try to find the Maestro project root
    let baseDir = baseDirs.length === 1 ? baseDirs[0] : undefined;

    // When individual files are passed (not a directory), search ancestor directories
    // for config.yaml to find the Maestro project root. This ensures the zip preserves
    // the full directory structure needed for relative runFlow paths (e.g., ../../screens/).
    if (!baseDir && allFlowFiles.length > 0) {
      const projectRoot = await this.findMaestroProjectRoot(allFlowFiles);
      if (projectRoot) {
        baseDir = projectRoot.dir;
        // Include config.yaml and discover its dependencies
        const configResolved = path.resolve(projectRoot.configPath);
        if (!allFlowFiles.some((f) => path.resolve(f) === configResolved)) {
          allFlowFiles.push(projectRoot.configPath);
        }
      }
    }

    // Discover dependencies (addMedia, runScript, runFlow, etc.) for all flow files
    // This ensures referenced files are included even when individual YAML files are passed
    const allFilesSet = new Set(allFlowFiles.map((f) => path.resolve(f)));
    for (const flowFile of [...allFlowFiles]) {
      const ext = path.extname(flowFile).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        const deps = await this.discoverDependencies(
          flowFile,
          baseDir || path.dirname(flowFile),
        );
        for (const dep of deps) {
          const resolved = path.resolve(dep);
          if (!allFilesSet.has(resolved)) {
            allFilesSet.add(resolved);
            allFlowFiles.push(dep);
          }
        }
      }
    }

    // Apply --include-tags / --exclude-tags filtering: drop flow files whose
    // frontmatter tags don't match, and drop dependencies orphaned as a result.
    const configTags = baseDir
      ? await this.loadConfigTags(baseDir)
      : { includeTags: undefined, excludeTags: undefined };
    const effectiveIncludeTags =
      this.options.includeTags ?? configTags.includeTags;
    const effectiveExcludeTags =
      this.options.excludeTags ?? configTags.excludeTags;
    const filtered = await this.filterFlowsByTags(
      allFlowFiles,
      baseDir,
      effectiveIncludeTags,
      effectiveExcludeTags,
    );
    if (filtered !== allFlowFiles) {
      allFlowFiles.length = 0;
      allFlowFiles.push(...filtered);
    }

    if (!this.options.quiet) {
      this.logIncludedFiles(allFlowFiles, baseDir);

      // Show info about potential slow execution on specific real devices
      utils.showRealDeviceFlowsInfo({
        realDevice: this.options.realDevice,
        device: this.options.device,
        version: this.options.version,
        flowCount: allFlowFiles
          .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
          .filter((f) => !this.isConfigFile(f)).length,
        shardSplit: this.options.shardSplit,
      });
    }

    // Check for missing file references and warn the user
    const missingReferences = await this.findMissingReferences(
      allFlowFiles,
      allFlowFiles,
    );
    if (!this.options.quiet && missingReferences.length > 0) {
      this.logMissingReferences(missingReferences, baseDir);
    }

    return { allFlowFiles, baseDir };
  }

  private async uploadFlows() {
    const result = await this.collectFlows();

    if (result === null) {
      // Single zip file - upload directly
      const zipPath = this.options.flows[0];
      await this.upload.upload({
        filePath: zipPath,
        url: `${this.URL}/${this.appId}/tests`,
        credentials: this.credentials,
        contentType: 'application/zip',
        showProgress: !this.options.quiet,
        validateZipFormat: true,
      });
      return true;
    }

    const { allFlowFiles, baseDir } = result;
    const { zipPath, tmpDir } = await this.createFlowsZip(
      allFlowFiles,
      baseDir,
    );

    try {
      await this.upload.upload({
        filePath: zipPath,
        url: `${this.URL}/${this.appId}/tests`,
        credentials: this.credentials,
        contentType: 'application/zip',
        showProgress: !this.options.quiet,
      });
    } finally {
      await fs.promises
        .rm(tmpDir, { recursive: true, force: true })
        .catch((err) => {
          logger.debug(
            `Failed to clean up temporary flows zip dir ${tmpDir}: ${err instanceof Error ? err.message : err}`,
          );
        });
    }

    return true;
  }

  /**
   * Search ancestor directories of the given flow files for a Maestro config file
   * (config.yaml or config.yml). This identifies the project root so the zip
   * preserves the directory structure needed for relative paths like ../../screens/.
   */
  private async findMaestroProjectRoot(
    flowFiles: string[],
  ): Promise<{ dir: string; configPath: string } | null> {
    // Start from the first flow file and walk up
    const startDir = path.dirname(path.resolve(flowFiles[0]));
    const rootDir = path.parse(startDir).root;

    let currentDir = startDir;
    while (currentDir !== rootDir) {
      for (const configName of ['config.yaml', 'config.yml']) {
        const candidatePath = path.join(currentDir, configName);
        try {
          await fs.promises.access(candidatePath);
          return { dir: currentDir, configPath: candidatePath };
        } catch {
          // Config not found here, keep searching
        }
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  private async discoverFlows(directory: string): Promise<string[]> {
    const entries = await fs.promises.readdir(directory, {
      withFileTypes: true,
    });

    const flowFiles: string[] = [];
    let configPath: string | null = null;
    let config: MaestroConfig | null = null;

    // If a custom config file is specified, use it; otherwise check for config.yaml or config.yml
    const configCandidates = this.options.configFile
      ? [path.resolve(this.options.configFile)]
      : [
          path.join(directory, 'config.yaml'),
          path.join(directory, 'config.yml'),
        ];

    for (const candidatePath of configCandidates) {
      try {
        const configContent = await fs.promises.readFile(
          candidatePath,
          'utf-8',
        );
        config = yaml.load(configContent) as MaestroConfig;
        configPath = candidatePath;
        break; // Use the first config file found
      } catch {
        // Config file doesn't exist, try next
      }
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
            !this.isConfigFile(entry.name)
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

    // Include config file if it exists
    if (configPath) {
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
   * Check if a file path is a Maestro config file (config.yaml or config.yml)
   */
  private isConfigFile(filePath: string): boolean {
    const basename = path.basename(filePath);
    if (basename === 'config.yaml' || basename === 'config.yml') {
      return true;
    }
    if (this.options.configFile) {
      return basename === path.basename(this.options.configFile);
    }
    return false;
  }

  private async readFlowTags(flowFile: string): Promise<string[]> {
    try {
      const content = await fs.promises.readFile(flowFile, 'utf-8');
      const documents: unknown[] = [];
      yaml.loadAll(content, (doc) => documents.push(doc));
      for (const doc of documents) {
        if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
          const tags = (doc as Record<string, unknown>).tags;
          if (Array.isArray(tags)) {
            return tags.filter((t): t is string => typeof t === 'string');
          }
          return [];
        }
      }
    } catch {
      // ignore
    }
    return [];
  }

  /**
   * Load includeTags / excludeTags declared in the Maestro project's
   * config.yaml (or config.yml). Returns undefined fields when no config
   * exists or the values are not arrays.
   */
  private async loadConfigTags(
    baseDir: string,
  ): Promise<{ includeTags?: string[]; excludeTags?: string[] }> {
    const candidates = this.options.configFile
      ? [path.resolve(this.options.configFile)]
      : [path.join(baseDir, 'config.yaml'), path.join(baseDir, 'config.yml')];

    for (const candidate of candidates) {
      try {
        const content = await fs.promises.readFile(candidate, 'utf-8');
        const parsed = yaml.load(content) as MaestroConfig | null;
        if (parsed && typeof parsed === 'object') {
          const include = Array.isArray(parsed.includeTags)
            ? parsed.includeTags.filter(
                (t): t is string => typeof t === 'string',
              )
            : undefined;
          const exclude = Array.isArray(parsed.excludeTags)
            ? parsed.excludeTags.filter(
                (t): t is string => typeof t === 'string',
              )
            : undefined;
          return { includeTags: include, excludeTags: exclude };
        }
        return {};
      } catch {
        // try next candidate
      }
    }
    return {};
  }

  private async filterFlowsByTags(
    allFlowFiles: string[],
    baseDir: string | undefined,
    includeTagsArg?: string[],
    excludeTagsArg?: string[],
  ): Promise<string[]> {
    const includeTags = includeTagsArg ?? [];
    const excludeTags = excludeTagsArg ?? [];
    const hasInclude = includeTags.length > 0;
    const hasExclude = excludeTags.length > 0;
    if (!hasInclude && !hasExclude) {
      return allFlowFiles;
    }

    const yamlFlows: string[] = [];
    const configFiles: string[] = [];
    for (const f of allFlowFiles) {
      const ext = path.extname(f).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        if (this.isConfigFile(f)) {
          configFiles.push(f);
        } else {
          yamlFlows.push(f);
        }
      }
    }

    const keptYamlFlows: string[] = [];
    for (const flowFile of yamlFlows) {
      const tags = await this.readFlowTags(flowFile);
      if (hasInclude && !tags.some((t) => includeTags.includes(t))) {
        continue;
      }
      if (hasExclude && tags.some((t) => excludeTags.includes(t))) {
        continue;
      }
      keptYamlFlows.push(flowFile);
    }

    if (keptYamlFlows.length === 0) {
      throw new TestingBotError(
        `No flow files match the provided tag filters (--include-tags / --exclude-tags)`,
      );
    }

    const keptResolved = new Set<string>(
      [...keptYamlFlows, ...configFiles].map((f) => path.resolve(f)),
    );
    for (const flowFile of keptYamlFlows) {
      const deps = await this.discoverDependencies(
        flowFile,
        baseDir || path.dirname(flowFile),
      );
      for (const dep of deps) {
        keptResolved.add(path.resolve(dep));
      }
    }

    return allFlowFiles.filter((f) => keptResolved.has(path.resolve(f)));
  }

  /**
   * Check if a string looks like a file path (relative path with extension)
   */
  private looksLikePath(value: string): boolean {
    // Must be a relative path (starts with . or contains a path separator)
    const isRelative =
      value.startsWith('./') ||
      value.startsWith('../') ||
      value.startsWith('.\\') ||
      value.startsWith('..\\');
    const hasPathSeparator = value.includes('/') || value.includes('\\');

    // Must have a file extension
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(value);

    // Exclude URLs
    const isUrl =
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('file://');

    // Exclude template variables that are just ${...}
    const isOnlyVariable = /^\$\{[^}]+\}$/.test(value);

    return (
      (isRelative || hasPathSeparator) &&
      hasExtension &&
      !isUrl &&
      !isOnlyVariable
    );
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

    try {
      await fs.promises.access(depPath);
      dependencies.push(depPath);

      // If it's a YAML file, recursively discover its dependencies
      // discoverDependencies will add it to visited to prevent circular refs
      const ext = path.extname(depPath).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        const nestedDeps = await this.discoverDependencies(
          depPath,
          baseDir,
          visited,
        );
        dependencies.push(...nestedDeps);
      } else {
        // For non-YAML files, add to visited here to prevent duplicates
        visited.add(depPath);
      }
    } catch {
      // File doesn't exist, skip it
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
        await this.tryAddDependency(
          value,
          flowFile,
          baseDir,
          dependencies,
          visited,
        );
      }
    } else if (Array.isArray(value)) {
      // Recursively check array elements
      for (const item of value) {
        const deps = await this.extractPathsFromValue(
          item,
          flowFile,
          baseDir,
          visited,
        );
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
          await this.tryAddDependency(
            scriptFile,
            flowFile,
            baseDir,
            dependencies,
            visited,
          );
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
          await this.tryAddDependency(
            flowRef,
            flowFile,
            baseDir,
            dependencies,
            visited,
          );
        }
        // Recurse into runFlow for inline commands
        if (typeof runFlow === 'object' && runFlow !== null) {
          const deps = await this.extractPathsFromValue(
            runFlow,
            flowFile,
            baseDir,
            visited,
          );
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
            await this.tryAddDependency(
              mediaFile,
              flowFile,
              baseDir,
              dependencies,
              visited,
            );
          }
        }
      }

      // onFlowStart: array of commands in frontmatter
      if ('onFlowStart' in obj) {
        handledKeys.add('onFlowStart');
        const onFlowStart = obj.onFlowStart;
        if (Array.isArray(onFlowStart)) {
          const deps = await this.extractPathsFromValue(
            onFlowStart,
            flowFile,
            baseDir,
            visited,
          );
          dependencies.push(...deps);
        }
      }

      // onFlowComplete: array of commands in frontmatter
      if ('onFlowComplete' in obj) {
        handledKeys.add('onFlowComplete');
        const onFlowComplete = obj.onFlowComplete;
        if (Array.isArray(onFlowComplete)) {
          const deps = await this.extractPathsFromValue(
            onFlowComplete,
            flowFile,
            baseDir,
            visited,
          );
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
          const deps = await this.extractPathsFromValue(
            commands,
            flowFile,
            baseDir,
            visited,
          );
          dependencies.push(...deps);
        }
      }

      // Generic handling for 'file' property in any command (e.g., retry: { file: ... })
      if ('file' in obj && typeof obj.file === 'string') {
        handledKeys.add('file');
        await this.tryAddDependency(
          obj.file,
          flowFile,
          baseDir,
          dependencies,
          visited,
        );
      }

      // Recursively check remaining object properties for nested structures
      // Skip config-only keys that contain path-like strings but aren't runtime
      // file dependencies (e.g., executionOrder.flowsOrder, flows glob patterns)
      const configOnlyKeys = new Set([
        'executionOrder',
        'flows',
        'tags',
        'includeTags',
        'excludeTags',
        'env',
      ]);

      for (const [key, propValue] of Object.entries(obj)) {
        if (!handledKeys.has(key) && !configOnlyKeys.has(key)) {
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

  /**
   * Find all file references in flow files that don't exist on disk.
   * This validates that all referenced files (runScript, runFlow, addMedia, etc.)
   * will be included in the zip.
   */
  public async findMissingReferences(
    flowFiles: string[],
    allIncludedFiles: string[],
  ): Promise<MissingFileReference[]> {
    const missingReferences: MissingFileReference[] = [];
    const includedFilesSet = new Set(
      allIncludedFiles.map((f) => path.resolve(f)),
    );

    for (const flowFile of flowFiles) {
      const ext = path.extname(flowFile).toLowerCase();
      if (ext !== '.yaml' && ext !== '.yml') {
        continue;
      }

      try {
        const content = await fs.promises.readFile(flowFile, 'utf-8');
        const documents: unknown[] = [];
        yaml.loadAll(content, (doc) => documents.push(doc));

        for (const flowData of documents) {
          if (flowData !== null && typeof flowData === 'object') {
            const missing = await this.findMissingInValue(
              flowData,
              flowFile,
              includedFilesSet,
            );
            missingReferences.push(...missing);
          }
        }
      } catch {
        // Ignore parsing errors
      }
    }

    return missingReferences;
  }

  /**
   * Recursively find missing file references in a YAML value
   */
  private async findMissingInValue(
    value: unknown,
    flowFile: string,
    includedFiles: Set<string>,
  ): Promise<MissingFileReference[]> {
    const missingReferences: MissingFileReference[] = [];

    if (typeof value === 'string') {
      if (this.looksLikePath(value)) {
        const resolvedPath = path.resolve(path.dirname(flowFile), value);
        if (!includedFiles.has(resolvedPath)) {
          missingReferences.push({
            flowFile,
            referencedFile: value,
            resolvedPath,
          });
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        const missing = await this.findMissingInValue(
          item,
          flowFile,
          includedFiles,
        );
        missingReferences.push(...missing);
      }
    } else if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const handledKeys = new Set<string>();

      // Handle runScript - extract file reference but don't recurse
      // (runScript objects only contain file, env, when - no nested file refs)
      if ('runScript' in obj) {
        handledKeys.add('runScript');
        const runScript = obj.runScript;
        const scriptFile =
          typeof runScript === 'string'
            ? runScript
            : (runScript as Record<string, unknown>)?.file;
        if (typeof scriptFile === 'string') {
          const resolved = path.resolve(path.dirname(flowFile), scriptFile);
          if (!includedFiles.has(resolved)) {
            missingReferences.push({
              flowFile,
              referencedFile: scriptFile,
              resolvedPath: resolved,
            });
          }
        }
        // Don't recurse into runScript - it only has file, env, when (no nested file refs)
      }

      // Handle runFlow - extract file reference and recurse only into commands
      if ('runFlow' in obj) {
        handledKeys.add('runFlow');
        const runFlow = obj.runFlow;
        const flowRef =
          typeof runFlow === 'string'
            ? runFlow
            : (runFlow as Record<string, unknown>)?.file;
        if (typeof flowRef === 'string') {
          const resolved = path.resolve(path.dirname(flowFile), flowRef);
          if (!includedFiles.has(resolved)) {
            missingReferences.push({
              flowFile,
              referencedFile: flowRef,
              resolvedPath: resolved,
            });
          }
        }
        // Only recurse into 'commands' if present (for inline commands)
        if (
          typeof runFlow === 'object' &&
          runFlow !== null &&
          'commands' in (runFlow as Record<string, unknown>)
        ) {
          const commands = (runFlow as Record<string, unknown>).commands;
          if (Array.isArray(commands)) {
            const nestedMissing = await this.findMissingInValue(
              commands,
              flowFile,
              includedFiles,
            );
            missingReferences.push(...nestedMissing);
          }
        }
      }

      // Handle addMedia
      if ('addMedia' in obj) {
        handledKeys.add('addMedia');
        const addMedia = obj.addMedia;
        const mediaFiles = Array.isArray(addMedia) ? addMedia : [addMedia];
        for (const mediaFile of mediaFiles) {
          if (typeof mediaFile === 'string') {
            const resolved = path.resolve(path.dirname(flowFile), mediaFile);
            if (!includedFiles.has(resolved)) {
              missingReferences.push({
                flowFile,
                referencedFile: mediaFile,
                resolvedPath: resolved,
              });
            }
          }
        }
      }

      // Handle file property
      if ('file' in obj && typeof obj.file === 'string') {
        handledKeys.add('file');
        const resolved = path.resolve(path.dirname(flowFile), obj.file);
        if (!includedFiles.has(resolved)) {
          missingReferences.push({
            flowFile,
            referencedFile: obj.file,
            resolvedPath: resolved,
          });
        }
      }

      // Handle onFlowStart, onFlowComplete, commands
      for (const key of ['onFlowStart', 'onFlowComplete', 'commands']) {
        if (key in obj) {
          handledKeys.add(key);
          const nested = obj[key];
          if (Array.isArray(nested)) {
            const nestedMissing = await this.findMissingInValue(
              nested,
              flowFile,
              includedFiles,
            );
            missingReferences.push(...nestedMissing);
          }
        }
      }

      // Recursively check remaining properties
      // Skip config-only keys that contain path-like strings but aren't runtime
      // file dependencies (e.g., executionOrder.flowsOrder, flows glob patterns)
      const configOnlyKeys = new Set([
        'executionOrder',
        'flows',
        'tags',
        'includeTags',
        'excludeTags',
        'env',
      ]);

      for (const [key, propValue] of Object.entries(obj)) {
        if (!handledKeys.has(key) && !configOnlyKeys.has(key)) {
          const nestedMissing = await this.findMissingInValue(
            propValue,
            flowFile,
            includedFiles,
          );
          missingReferences.push(...nestedMissing);
        }
      }
    }

    return missingReferences;
  }

  /**
   * Log warnings for missing file references
   */
  private logMissingReferences(
    missingReferences: MissingFileReference[],
    baseDir?: string,
  ): void {
    if (missingReferences.length === 0) {
      return;
    }

    logger.warn(
      `Warning: ${missingReferences.length} referenced file(s) not found:`,
    );

    for (const ref of missingReferences) {
      const flowRelative = baseDir
        ? path.relative(baseDir, ref.flowFile)
        : path.basename(ref.flowFile);
      logger.warn(`  In ${flowRelative}: ${ref.referencedFile}`);
    }

    logger.warn(
      'These files will not be included in the upload and may cause test failures.',
    );
  }

  private logIncludedFiles(files: string[], baseDir?: string): void {
    // Get relative paths for display
    const effectiveBase = baseDir || this.computeCommonDirectory(files);
    const relativePaths = files
      .map((f) => path.relative(effectiveBase, f))
      .sort();

    // Group by file type
    const groups: Record<string, string[]> = {
      'Flow files': [],
      Scripts: [],
      'Media files': [],
      'Config files': [],
      Other: [],
    };

    for (const filePath of relativePaths) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.yaml' || ext === '.yml') {
        if (this.isConfigFile(filePath)) {
          groups['Config files'].push(filePath);
        } else {
          groups['Flow files'].push(filePath);
        }
      } else if (ext === '.js' || ext === '.ts') {
        groups['Scripts'].push(filePath);
      } else if (
        ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov'].includes(ext)
      ) {
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
  ): Promise<{ zipPath: string; tmpDir: string }> {
    const tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'maestro-'),
    );
    const zipPath = path.join(tmpDir, 'flows.zip');

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve({ zipPath, tmpDir }));
      output.on('error', (err) => reject(err));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      // Compute effective base directory for archive paths
      const effectiveBase = baseDir || this.computeCommonDirectory(files);

      for (const file of files) {
        const archiveName = path.relative(effectiveBase, file);
        archive.file(file, { name: archiveName });
      }

      archive.finalize();
    });
  }

  /**
   * Compute the common parent directory of all files
   */
  private computeCommonDirectory(files: string[]): string {
    if (files.length === 0) return process.cwd();
    if (files.length === 1) return path.dirname(files[0]);

    const dirs = files.map((f) => path.dirname(path.resolve(f)));
    const parts = dirs[0].split(path.sep);
    let commonLength = parts.length;

    for (let i = 1; i < dirs.length; i++) {
      const dirParts = dirs[i].split(path.sep);
      commonLength = Math.min(commonLength, dirParts.length);
      for (let j = 0; j < commonLength; j++) {
        if (parts[j] !== dirParts[j]) {
          commonLength = j;
          break;
        }
      }
    }

    return parts.slice(0, commonLength).join(path.sep) || path.sep;
  }

  private async runTests() {
    try {
      const capabilities = this.options.getCapabilities(this.detectedPlatform);
      const maestroOptions = this.options.getMaestroOptions();
      const metadata = this.options.metadata;
      const response = await axios.post(
        `${this.URL}/${this.appId}/run`,
        {
          capabilities: [capabilities],
          ...(maestroOptions && { maestroOptions }),
          ...(this.options.shardSplit && {
            shardSplit: this.options.shardSplit,
          }),
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
      throw await this.handleErrorWithDiagnostics(
        error,
        'Running Maestro test failed',
      );
    }
  }

  private async getStatus(): Promise<MaestroStatusResponse> {
    try {
      return await this.withRetry('Getting Maestro test status', async () => {
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
        'Failed to get Maestro test status',
      );
    }
  }

  private async waitForCompletion(): Promise<MaestroResult> {
    const startTime = Date.now();
    const previousStatus: Map<number, MaestroRunInfo['status']> = new Map();
    const previousFlowStatus: Map<number, MaestroFlowStatus> = new Map();
    const urlDisplayed: Set<number> = new Set();
    let flowsTableDisplayed = false;
    let displayedLineCount = 0;
    let pollInterval = this.MIN_POLL_INTERVAL_MS;
    let previousSignature: string | null = null;

    while (true) {
      // Check if we're shutting down
      if (this.isShuttingDown) {
        throw new TestingBotError('Test run cancelled by user');
      }

      const status = await this.getStatus();

      // Track active run IDs for graceful shutdown
      this.activeRunIds = status.runs
        .filter((run) => run.status !== 'DONE' && run.status !== 'FAILED')
        .map((run) => run.id);

      const running = status.runs.find((r) => r.status === 'READY');
      if (running) {
        const device =
          running.environment?.name || running.capabilities.deviceName;
        setTitle(`maestro · running · ${device}`);
      }

      // Log current status of runs (unless quiet mode)
      if (!this.options.quiet) {
        // Check if any run has flows and display them
        const allFlows: MaestroFlowInfo[] = [];
        for (const run of status.runs) {
          if (run.flows && run.flows.length > 0) {
            allFlows.push(...run.flows);
          }
        }

        // Show realtime URL once per run (before any in-place updates)
        for (const run of status.runs) {
          if (!urlDisplayed.has(run.id)) {
            console.log(
              `  🔗 Run ${run.id} (${this.getRunDisplayName(run)}): Watch in realtime:`,
            );
            console.log(
              `     https://testingbot.com/members/maestro/${this.appId}/runs/${run.id}`,
            );
            urlDisplayed.add(run.id);
          }
        }

        if (allFlows.length > 0) {
          // Check if any flow has failed (for showing error column)
          const hasFailures = this.hasAnyFlowFailed(allFlows);

          if (!flowsTableDisplayed) {
            // Flows have arrived — stop the run-level spinner so it doesn't
            // fight the flow table's cursor-based in-place updates.
            this.spinner.stop();
            // First time showing flows - display header and initial state
            console.log(); // Empty line before flows table
            this.displayFlowsTableHeader(hasFailures);
            displayedLineCount = this.displayFlowsWithLimit(
              allFlows,
              previousFlowStatus,
              hasFailures,
            );
            flowsTableDisplayed = true;
            this.latestFlows = allFlows;
            this.latestDisplayedLineCount = displayedLineCount;
            this.startFlowAnimation(previousFlowStatus);
          } else {
            // Update flows in place
            displayedLineCount = this.updateFlowsInPlace(
              allFlows,
              previousFlowStatus,
              displayedLineCount,
            );
            this.latestFlows = allFlows;
            this.latestDisplayedLineCount = displayedLineCount;
          }
        } else {
          // No flows yet, show run status
          this.displayRunStatus(status.runs, startTime, previousStatus);
        }
      }

      if (status.completed) {
        this.stopFlowAnimation();
        // Display final flows table with error messages if there are failures
        if (!this.options.quiet && flowsTableDisplayed) {
          const allFlows: MaestroFlowInfo[] = [];
          for (const run of status.runs) {
            if (run.flows && run.flows.length > 0) {
              allFlows.push(...run.flows);
            }
          }

          const hasFailures = this.hasAnyFlowFailed(allFlows);
          if (hasFailures) {
            // Move cursor up to overwrite the existing table
            // +2 for header and separator lines
            const linesToMove = displayedLineCount + 2;
            process.stdout.write(`\x1b[${linesToMove}A`);

            // Clear header line, write new header, then clear separator line
            process.stdout.write('\x1b[2K');
            console.log(
              pc.dim(
                ` ${'Duration'.padEnd(10)} ${'Status'.padEnd(10)} Flow                              Fail reason`,
              ),
            );
            process.stdout.write('\x1b[2K');
            console.log(
              pc.dim(
                ` ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(30)} ${'─'.repeat(80)}`,
              ),
            );

            // Redraw all flows with error messages
            for (const flow of allFlows) {
              // Clear the line before writing
              process.stdout.write('\x1b[2K');
              this.displayFlowRow(flow, false, true);
            }
          }
        }

        // Print final summary
        if (!this.options.quiet) {
          this.spinner.stop();
          console.log(); // Empty line before summary

          for (const run of status.runs) {
            const passed = run.success === 1;
            const symbol = passed ? pc.green('✔') : pc.red('✘');
            const statusText = passed
              ? pc.green('Test completed successfully')
              : pc.red('Test failed');
            console.log(
              `  ${symbol} Run ${run.id} ${pc.dim(`(${this.getRunDisplayName(run)})`)}: ${statusText}`,
            );
          }
        }

        const allSucceeded = status.runs.every((run) => run.success === 1);

        if (allSucceeded) {
          setTitle('maestro · ✔ passed');
          if (!this.options.quiet) {
            logger.info('All tests completed successfully!');
          }
        } else {
          const failedRuns = status.runs.filter((run) => run.success !== 1);
          setTitle(`maestro · ✘ ${failedRuns.length} failed`);
          logger.error(`${failedRuns.length} test run(s) failed`);
        }

        if (this.options.report && this.options.reportOutputDir) {
          await this.fetchReports(status.runs);
        }

        if (this.options.downloadArtifacts) {
          await this.downloadArtifacts(status.runs);
        }

        return {
          success: status.success,
          runs: status.runs,
        };
      }

      // Checked after getStatus() so a run that completes during the final
      // sleep is returned as success on the next iteration instead of being
      // misreported as a timeout.
      if (Date.now() - startTime >= this.MAX_POLL_DURATION_MS) {
        throw new TestingBotError(
          `Test timed out after ${this.MAX_POLL_DURATION_MS / 1000 / 60} minutes`,
        );
      }

      const signature = JSON.stringify(
        status.runs.map((r) => [
          r.id,
          r.status,
          r.success,
          r.flows?.map((f) => [f.id, f.status]) ?? [],
        ]),
      );
      const changed = signature !== previousSignature;
      previousSignature = signature;
      pollInterval = this.computeNextPollInterval(pollInterval, changed);
      await this.sleep(pollInterval);
    }
  }

  private displayRunStatus(
    runs: MaestroRunInfo[],
    startTime: number,
    previousStatus: Map<number, MaestroRunInfo['status']>,
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
  private getRunDisplayName(run: MaestroRunInfo): string {
    return run.environment?.name || run.capabilities.deviceName;
  }

  private getStatusInfo(status: MaestroRunInfo['status']): {
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

  private getFlowStatusDisplay(flow: MaestroFlowInfo): {
    text: string;
    colored: string;
  } {
    const frame = FLOW_SPINNER_FRAMES[this.flowAnimationFrame];
    switch (flow.status) {
      case 'WAITING':
        return {
          text: `${frame} WAITING`,
          colored: pc.yellow(`${frame} WAITING`),
        };
      case 'READY':
        return {
          text: `${frame} RUNNING`,
          colored: pc.cyan(`${frame} RUNNING`),
        };
      case 'DONE':
        if (flow.success === 1) {
          return { text: '✔ PASSED', colored: pc.green('✔ PASSED') };
        } else {
          return { text: '✘ FAILED', colored: pc.red('✘ FAILED') };
        }
      case 'FAILED':
        return { text: '✘ FAILED', colored: pc.red('✘ FAILED') };
      default:
        return { text: flow.status, colored: flow.status };
    }
  }

  private hasAnyFlowFailed(flows: MaestroFlowInfo[]): boolean {
    return flows.some(
      (flow) =>
        (flow.status === 'DONE' && flow.success !== 1) ||
        flow.status === 'FAILED' ||
        (flow.error_messages && flow.error_messages.length > 0),
    );
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

  private getTerminalWidth(): number {
    return process.stdout.columns || 200;
  }

  /**
   * Returns the maximum length of `flow.name` that keeps the rendered row
   * within the current terminal width, so the row does not visually wrap.
   * Wrapped rows break the `\x1b[NA` cursor-up math used by in-place updates,
   * which is what causes the table to repeat instead of refresh in place
   * (e.g. with --shard-split where the API returns long comma-joined names).
   *
   * Row layout is: " {duration:10} {status:10} {name}[ {error}]" — overhead
   * is 23 plain-width chars before `name`. `extra` reserves room for trailing
   * content like a fail-reason suffix.
   */
  private getMaxNameLength(extra: number = 0): number {
    const overhead = 23 + extra + 1;
    return Math.max(10, this.getTerminalWidth() - overhead);
  }

  private truncateForRow(name: string, max: number): string {
    if (name.length <= max) return name;
    if (max <= 1) return name.slice(0, max);
    return name.slice(0, max - 1) + '…';
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
    if (waiting > 0) parts.push(pc.white(`${waiting} waiting`));
    if (running > 0) parts.push(pc.blue(`${running} running`));
    if (passed > 0) parts.push(pc.green(`${passed} passed`));
    if (failed > 0) parts.push(pc.red(`${failed} failed`));

    return ` ... and ${remaining.length} more: ${parts.join(', ')}`;
  }

  private displayFlowsWithLimit(
    flows: MaestroFlowInfo[],
    previousFlowStatus: Map<number, MaestroFlowStatus>,
    hasFailures: boolean = false,
  ): number {
    const maxFlows = this.getMaxDisplayableFlows();
    const displayFlows = flows.slice(0, maxFlows);
    let linesWritten = 0;

    for (const flow of displayFlows) {
      linesWritten += this.displayFlowRow(flow, false, hasFailures);
      previousFlowStatus.set(flow.id, flow.status);
    }

    // Show summary for remaining flows
    if (flows.length > maxFlows) {
      const summary = this.getRemainingSummary(flows, maxFlows);
      console.log(pc.dim(summary));
      linesWritten++;
    }

    return linesWritten;
  }

  private displayFlowsTableHeader(hasFailures: boolean = false): void {
    let header = ` ${'Duration'.padEnd(10)} ${'Status'.padEnd(10)} Flow`;
    let separator = ` ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(30)}`;

    if (hasFailures) {
      header += '                              Fail reason';
      separator += ` ${'─'.repeat(80)}`;
    }

    console.log(pc.dim(header));
    console.log(pc.dim(separator));
  }

  private displayFlowRow(
    flow: MaestroFlowInfo,
    isUpdate: boolean = false,
    hasFailures: boolean = false,
  ): number {
    const duration = this.calculateFlowDuration(flow).padEnd(10);
    const statusDisplay = this.getFlowStatusDisplay(flow);
    // Pad based on display text length, add extra for color codes
    const statusPadded =
      statusDisplay.colored +
      ' '.repeat(Math.max(0, 10 - statusDisplay.text.length));

    let linesWritten = 0;
    const isFailed = flow.status === 'DONE' && flow.success !== 1;
    const errorMessages = flow.error_messages || [];
    const firstError =
      hasFailures && isFailed && errorMessages.length > 0
        ? errorMessages[0]
        : '';
    const errorReserve = firstError ? firstError.length + 1 : 0;
    const maxName = this.getMaxNameLength(errorReserve);
    const name = this.truncateForRow(flow.name, maxName).padEnd(
      Math.min(30, maxName),
    );

    // Build the main row
    let row = ` ${duration} ${statusPadded} ${name}`;

    // Add first error message on the same line if failed and has errors
    if (firstError) {
      row += ` ${pc.red(firstError)}`;
    }

    if (isUpdate) {
      process.stdout.write(`\r${row}`);
    } else {
      console.log(row);
    }
    linesWritten++;

    // Display remaining error messages on continuation lines
    if (!isUpdate && hasFailures && isFailed && errorMessages.length > 1) {
      // Indent to align with the Fail reason column: Duration(11) + Status(11) + Test(31) = 53 chars
      const indent = ' '.repeat(53);
      for (let i = 1; i < errorMessages.length; i++) {
        console.log(`${indent} ${pc.red(errorMessages[i])}`);
        linesWritten++;
      }
    }

    return linesWritten;
  }

  private displayFlowsTable(
    flows: MaestroFlowInfo[],
    previousFlowStatus: Map<number, MaestroFlowStatus>,
    showHeader: boolean,
    hasFailures: boolean = false,
  ): number {
    if (showHeader) {
      this.displayFlowsTableHeader(hasFailures);
    }

    let linesWritten = 0;

    for (const flow of flows) {
      const prevStatus = previousFlowStatus.get(flow.id);
      const isNewFlow = prevStatus === undefined;

      if (isNewFlow) {
        linesWritten += this.displayFlowRow(flow, false, hasFailures);
      }

      previousFlowStatus.set(flow.id, flow.status);
    }

    return linesWritten;
  }

  /**
   * Starts the flow-table animation loop. Re-renders the cached flow rows at
   * `FLOW_ANIMATION_MS` so WAITING/RUNNING spinner frames advance between
   * (much slower) polls. Calling while already running is a no-op.
   */
  private startFlowAnimation(
    previousFlowStatus: Map<number, MaestroFlowStatus>,
  ): void {
    if (this.flowAnimationTimer || !utils.isInteractive()) return;
    this.flowAnimationTimer = setInterval(() => {
      const hasActive = this.latestFlows.some(
        (f) => f.status === 'WAITING' || f.status === 'READY',
      );
      if (!hasActive) return;
      this.flowAnimationFrame =
        (this.flowAnimationFrame + 1) % FLOW_SPINNER_FRAMES.length;
      this.latestDisplayedLineCount = this.updateFlowsInPlace(
        this.latestFlows,
        previousFlowStatus,
        this.latestDisplayedLineCount,
      );
    }, FLOW_ANIMATION_MS);
    this.flowAnimationTimer.unref?.();
  }

  private stopFlowAnimation(): void {
    if (this.flowAnimationTimer) {
      clearInterval(this.flowAnimationTimer);
      this.flowAnimationTimer = null;
    }
  }

  protected stopAnimations(): void {
    this.stopFlowAnimation();
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
    const maxName = this.getMaxNameLength();
    for (const flow of displayFlows) {
      const duration = this.calculateFlowDuration(flow).padEnd(10);
      const statusDisplay = this.getFlowStatusDisplay(flow);
      const statusPadded =
        statusDisplay.colored +
        ' '.repeat(Math.max(0, 10 - statusDisplay.text.length));
      const name = this.truncateForRow(flow.name, maxName);

      const row = ` ${duration} ${statusPadded} ${name}`;
      process.stdout.write(`\r\x1b[2K${row}\n`);

      previousFlowStatus.set(flow.id, flow.status);
      linesWritten++;
    }

    // Update or add summary line for remaining flows
    if (hasRemaining) {
      const summary = this.getRemainingSummary(flows, maxFlows);
      process.stdout.write(`\r\x1b[K${pc.dim(summary)}\n`);
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
        let reportEndpoint: string;
        let reportKey: string;
        switch (reportFormat) {
          case 'junit':
            reportEndpoint = 'junit_report';
            reportKey = 'junit_report';
            break;
          case 'html-detailed':
            reportEndpoint = 'html_report_detailed';
            reportKey = 'html_report_detailed';
            break;
          case 'html':
          default:
            reportEndpoint = 'html_report';
            reportKey = 'html_report';
            break;
        }

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
            timeout: HTTP.TIMEOUT_MS,
          },
        );

        // Check for version update notification
        const latestVersion = response.headers?.['x-testingbotctl-version'];
        utils.checkForUpdate(latestVersion);

        // Extract the report content from the JSON response
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
      return await this.withRetry(
        `Getting run details for run ${runId}`,
        async () => {
          const response = await axios.get(
            `${this.URL}/${this.appId}/${runId}`,
            {
              headers: {
                'User-Agent': utils.getUserAgent(),
              },
              auth: {
                username: this.credentials.userName,
                password: this.credentials.accessKey,
              },
              timeout: HTTP.TIMEOUT_MS,
            },
          );

          const latestVersion = response.headers?.['x-testingbotctl-version'];
          utils.checkForUpdate(latestVersion);

          return response.data;
        },
      );
    } catch (error) {
      throw await this.handleErrorWithDiagnostics(
        error,
        `Failed to get run details for run ${runId}`,
      );
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
      await this.sleep(this.MIN_POLL_INTERVAL_MS);
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
    if (!this.options.name) {
      // Generate unique name with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `maestro_artifacts_${timestamp}.zip`;
    }

    const baseName = this.options.name.replace(/[^a-zA-Z0-9_-]/g, '_');
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

  private sanitizeFlowDirName(name: string | undefined): string {
    if (!name) return '';
    let s = name.replace(/[^A-Za-z0-9._-]+/g, '_');
    s = s.replace(/_+/g, '_');
    s = s.replace(/^[_.-]+|[_.-]+$/g, '');
    if (s.length > 64) s = s.slice(0, 64).replace(/[_.-]+$/, '');
    return s;
  }

  private buildFlowDirNames(flows: MaestroFlowInfo[]): Map<number, string> {
    const baseNames = new Map<number, string>();
    const counts = new Map<string, number>();

    for (const flow of flows) {
      const sanitized = this.sanitizeFlowDirName(flow.name);
      const base = sanitized ? `flow_${sanitized}` : `flow_${flow.id}`;
      baseNames.set(flow.id, base);
      counts.set(base, (counts.get(base) || 0) + 1);
    }

    const result = new Map<number, string>();
    for (const flow of flows) {
      const base = baseNames.get(flow.id)!;
      result.set(flow.id, (counts.get(base) || 0) > 1 ? `${base}_${flow.id}` : base);
    }
    return result;
  }

  private async downloadAssetBundle(
    assets: MaestroRunAssets,
    targetDir: string,
  ): Promise<void> {
    if (assets.logs && Object.keys(assets.logs).length > 0) {
      const logsDir = path.join(targetDir, 'logs');
      await fs.promises.mkdir(logsDir, { recursive: true });

      for (const [logName, logUrl] of Object.entries(assets.logs)) {
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

    if (assets.video && typeof assets.video === 'string') {
      const videoDir = path.join(targetDir, 'video');
      await fs.promises.mkdir(videoDir, { recursive: true });

      const videoPath = path.join(videoDir, 'video.mp4');
      try {
        await this.downloadFile(assets.video, videoPath);
        if (!this.options.quiet) {
          logger.info(`    Downloaded video: video.mp4`);
        }
      } catch (error) {
        logger.error(
          `    Failed to download video: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (assets.screenshots && assets.screenshots.length > 0) {
      const screenshotsDir = path.join(targetDir, 'screenshots');
      await fs.promises.mkdir(screenshotsDir, { recursive: true });

      for (let i = 0; i < assets.screenshots.length; i++) {
        const screenshotUrl = assets.screenshots[i];
        const screenshotFileName = `screenshot_${i}.png`;
        const screenshotPath = path.join(screenshotsDir, screenshotFileName);

        try {
          await this.downloadFile(screenshotUrl, screenshotPath);
          if (!this.options.quiet) {
            logger.info(`    Downloaded screenshot: ${screenshotFileName}`);
          }
        } catch (error) {
          logger.error(
            `    Failed to download screenshot ${screenshotFileName}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    }
  }

  private async downloadArtifacts(runs: MaestroRunInfo[]): Promise<void> {
    if (!this.options.downloadArtifacts) return;

    // Filter runs based on download mode
    const downloadMode = this.options.downloadArtifacts;
    const runsToDownload =
      downloadMode === 'failed'
        ? runs.filter((run) => run.success !== 1)
        : runs;

    if (runsToDownload.length === 0) {
      if (!this.options.quiet) {
        if (downloadMode === 'failed') {
          logger.info('No failed runs to download artifacts for.');
        } else {
          logger.info('No runs to download artifacts for.');
        }
      }
      return;
    }

    if (!this.options.quiet) {
      if (downloadMode === 'failed') {
        logger.info(
          `Downloading artifacts for ${runsToDownload.length} failed run(s)...`,
        );
      } else {
        logger.info('Downloading artifacts...');
      }
    }

    const outputDir = this.options.artifactsOutputDir || process.cwd();

    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'testingbot-maestro-artifacts-'),
    );

    try {
      for (const run of runsToDownload) {
        try {
          if (!this.options.quiet) {
            logger.info(`  Waiting for artifacts sync for run ${run.id}...`);
          }

          const runDetails = await this.waitForArtifactsSync(run.id);

          const flowsWithAssets = (runDetails.flows || []).filter(
            (flow) => flow.assets,
          );

          if (!runDetails.assets && flowsWithAssets.length === 0) {
            if (!this.options.quiet) {
              logger.info(`  No artifacts available for run ${run.id}`);
            }
            continue;
          }

          const runDir = path.join(tempDir, `run_${run.id}`);
          await fs.promises.mkdir(runDir, { recursive: true });

          if (runDetails.assets) {
            await this.downloadAssetBundle(runDetails.assets, runDir);
          }

          const flowDirNames = this.buildFlowDirNames(flowsWithAssets);

          for (const flow of flowsWithAssets) {
            const flowDirName = flowDirNames.get(flow.id)!;
            const flowDir = path.join(runDir, flowDirName);
            await fs.promises.mkdir(flowDir, { recursive: true });
            await this.downloadAssetBundle(flow.assets!, flowDir);

            if (flow.report) {
              const flowReportPath = path.join(flowDir, 'report.xml');
              try {
                await fs.promises.writeFile(
                  flowReportPath,
                  flow.report,
                  'utf-8',
                );
                if (!this.options.quiet) {
                  logger.info(`    Saved ${flowDirName} report.xml`);
                }
              } catch (error) {
                logger.error(
                  `    Failed to save report.xml for ${flowDirName}: ${error instanceof Error ? error.message : error}`,
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
      output.on('error', (err) => reject(err));
      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
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

  private handleMaestroData(data: string): void {
    try {
      const message: MaestroSocketMessage = JSON.parse(data);
      if (message.payload) {
        // Clear the spinner line before printing output
        this.spinner.clearLine();
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
