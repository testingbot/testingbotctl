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
}

export interface UploadResult {
  id: number;
}

export default class Upload {
  public async upload(options: UploadOptions): Promise<UploadResult> {
    const { filePath, url, credentials, showProgress = false } = options;

    await this.validateFile(filePath);

    const fileName = path.basename(filePath);
    const fileStats = await fs.promises.stat(filePath);
    const totalSize = fileStats.size;

    const progressTracker = progress({
      length: totalSize,
      time: 100, // Emit progress every 100ms
    });

    let lastPercent = 0;

    if (showProgress) {
      this.drawProgressBar(fileName, totalSize, 0);

      progressTracker.on('progress', (prog) => {
        const percent = Math.round(prog.percentage);
        if (percent !== lastPercent) {
          lastPercent = percent;
          this.drawProgressBar(fileName, totalSize, percent);
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
          this.drawProgressBar(fileName, totalSize, 100);
          console.log('');
        }
        return { id: result.id };
      } else {
        if (showProgress) {
          console.log(' Failed');
        }
        throw new TestingBotError(
          `Upload failed: ${result.error || 'Unknown error'}`,
        );
      }
    } catch (error) {
      if (showProgress) {
        console.log(' Failed');
      }
      if (error instanceof TestingBotError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
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
  ): void {
    const barWidth = 30;
    const filled = Math.round((barWidth * percent) / 100);
    const empty = barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    const transferredBytes = (percent / 100) * totalBytes;
    const transferred = this.formatFileSize(transferredBytes);
    const total = this.formatFileSize(totalBytes);

    process.stdout.write(
      `\r  ${fileName}: [${bar}] ${percent}% (${transferred}/${total})`,
    );
  }

  /**
   * Format file size in human-readable format (KB for small files, MB for larger)
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
  }

  private async validateFile(filePath: string): Promise<void> {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(`File not found or not readable: ${filePath}`);
    }
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
