import axios from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import progress from 'progress-stream';
import Credentials from './models/credentials';
import TestingBotError from './models/testingbot_error';
import utils from './utils';
import { handleAxiosError } from './utils/error-helpers';

export type ContentType =
  | 'application/vnd.android.package-archive'
  | 'application/octet-stream'
  | 'application/zip';

export interface UploadOptions {
  filePath: string;
  url: string;
  credentials: Credentials;
  contentType: ContentType;
  showProgress?: boolean;
  checksum?: string;
  /** Validate that the file is a valid zip-based archive (APK, IPA, ZIP) */
  validateZipFormat?: boolean;
}

export interface UploadResult {
  id: number;
}

export default class Upload {
  public async upload(options: UploadOptions): Promise<UploadResult> {
    const { filePath, url, credentials, showProgress = false } = options;

    await this.validateFile(filePath);

    if (options.validateZipFormat) {
      await this.validateZipFormat(filePath);
    }

    const fileName = path.basename(filePath);
    const fileStats = await fs.promises.stat(filePath);
    const totalSize = fileStats.size;

    const progressTracker = progress({
      length: totalSize,
      time: 100, // Emit progress every 100ms
    });

    const interactive = utils.isInteractive();
    let lastPercent = -1;
    let lastBucket = -1;
    const BUCKET_SIZE = 10;

    if (showProgress) {
      if (interactive) {
        this.drawProgressBar(fileName, totalSize, 0);
      }

      progressTracker.on('progress', (prog) => {
        const percent = Math.round(prog.percentage);
        if (interactive) {
          // Redraw whenever percent changes; speed/ETA still update because
          // progress-stream emits every 100ms.
          if (percent !== lastPercent) {
            lastPercent = percent;
            this.drawProgressBar(
              fileName,
              totalSize,
              percent,
              prog.speed,
              prog.eta,
            );
          }
        } else {
          // Non-TTY: one line per 10% bucket, no ANSI, no \r. 100% is
          // reported by the success path.
          const bucket = Math.floor(percent / BUCKET_SIZE);
          if (bucket !== lastBucket && percent < 100) {
            lastBucket = bucket;
            const transferred = this.formatFileSize(
              (percent / 100) * totalSize,
            );
            const total = this.formatFileSize(totalSize);
            console.log(`  ${fileName}: ${percent}% (${transferred}/${total})`);
          }
        }
      });
    }

    const fileStream = fs.createReadStream(filePath);
    const trackedStream = fileStream.pipe(progressTracker);

    const formData = new FormData();
    formData.append('file', trackedStream, {
      filename: fileName,
      contentType: options.contentType,
      knownLength: totalSize,
    });

    if (options.checksum) {
      formData.append('checksum', options.checksum);
    }

    try {
      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'User-Agent': utils.getUserAgent(),
        },
        auth: {
          username: credentials.userName,
          password: credentials.accessKey,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        maxRedirects: 0, // Recommended for stream uploads to avoid buffering
      });

      // Check for version update notification
      const latestVersion = response.headers?.['x-testingbotctl-version'];
      utils.checkForUpdate(latestVersion);

      const result = response.data;
      if (result.id) {
        if (showProgress) {
          if (interactive) {
            this.drawProgressBar(fileName, totalSize, 100);
            console.log('');
          } else {
            console.log(
              `  ${fileName}: done (${this.formatFileSize(totalSize)})`,
            );
          }
        }
        return { id: result.id };
      } else {
        if (showProgress) {
          if (interactive) {
            console.log(' Failed');
          } else {
            console.log(`  ${fileName}: failed`);
          }
        }
        throw new TestingBotError(
          `Upload failed: ${result.error || 'Unknown error'}`,
        );
      }
    } catch (error) {
      if (showProgress) {
        if (interactive) {
          console.log(' Failed');
        } else {
          console.log(`  ${fileName}: failed`);
        }
      }
      if (error instanceof TestingBotError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        // Handle 400 errors specifically for file uploads
        if (error.response?.status === 400) {
          const serverMessage = this.extractErrorMessage(error.response.data);
          throw new TestingBotError(
            `Upload rejected: ${serverMessage || 'The file was not accepted by the server'}`,
            { cause: error },
          );
        }
        throw handleAxiosError(error, 'Upload failed');
      }
      throw new TestingBotError(
        `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  private drawProgressBar(
    fileName: string,
    totalBytes: number,
    percent: number,
    bytesPerSec?: number,
    etaSeconds?: number,
  ): void {
    const barWidth = 30;
    const filled = Math.round((barWidth * percent) / 100);
    const empty = barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    const transferredBytes = (percent / 100) * totalBytes;
    const transferred = this.formatFileSize(transferredBytes);
    const total = this.formatFileSize(totalBytes);

    let suffix = '';
    if (
      typeof bytesPerSec === 'number' &&
      Number.isFinite(bytesPerSec) &&
      bytesPerSec > 0
    ) {
      suffix += ` • ${this.formatFileSize(bytesPerSec)}/s`;
    }
    if (
      typeof etaSeconds === 'number' &&
      Number.isFinite(etaSeconds) &&
      etaSeconds > 0
    ) {
      suffix += ` • ETA ${this.formatDuration(etaSeconds)}`;
    }

    // `\x1b[K` clears from cursor to end of line so residue from a longer
    // previous frame (e.g. "ETA 16s" → "ETA 1s") can't leak through.
    process.stdout.write(
      `\r  ${fileName}: [${bar}] ${percent}% (${transferred}/${total})${suffix}\x1b[K`,
    );
  }

  /**
   * Format file size in human-readable format (KB for small files, MB for larger)
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${Math.round(bytes)} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
  }

  /**
   * Format seconds as compact duration: "12s" or "3m04s".
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m${s.toString().padStart(2, '0')}s`;
  }

  private async validateFile(filePath: string): Promise<void> {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(`File not found or not readable: ${filePath}`);
    }
  }

  /**
   * Validate that the file is a valid zip-based archive.
   * ZIP, APK, IPA files all start with the ZIP magic bytes (PK\x03\x04).
   */
  private async validateZipFormat(filePath: string): Promise<void> {
    const ZIP_MAGIC_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(4);
      const { bytesRead } = await fd.read(buffer, 0, 4, 0);

      if (bytesRead < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC_BYTES)) {
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        throw new TestingBotError(
          `Invalid file format: "${fileName}" is not a valid ${ext || 'archive'} file. ` +
            `The file does not appear to be a valid zip-based archive (APK, IPA, or ZIP).`,
        );
      }
    } finally {
      await fd.close();
    }
  }

  /**
   * Extract error message from server response data
   */
  private extractErrorMessage(data: unknown): string | undefined {
    if (!data) return undefined;

    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed.message || parsed.error || parsed.errors || data;
      } catch {
        return data;
      }
    }

    if (typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      if (typeof obj.error === 'string') return obj.error;
      if (typeof obj.errors === 'string') return obj.errors;
      if (Array.isArray(obj.errors)) return obj.errors.join(', ');
    }

    return undefined;
  }

  /**
   * Calculate MD5 checksum of a file, returning base64-encoded result
   * This matches ActiveStorage's checksum format
   */
  public async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('base64')));
      stream.on('error', (err) => reject(err));
    });
  }
}
