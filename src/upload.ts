import axios, { AxiosProgressEvent } from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import Credentials from './models/credentials';
import TestingBotError from './models/testingbot_error';
import utils from './utils';

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
}

export interface UploadResult {
  id: number;
}

export default class Upload {
  private lastProgressPercent: number = 0;

  public async upload(options: UploadOptions): Promise<UploadResult> {
    const {
      filePath,
      url,
      credentials,
      contentType,
      showProgress = false,
    } = options;

    await this.validateFile(filePath);

    const fileName = path.basename(filePath);
    const fileStats = await fs.promises.stat(filePath);
    const fileStream = fs.createReadStream(filePath);

    const formData = new FormData();
    formData.append('file', fileStream);

    try {
      const response = await axios.post(url, formData, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename=${fileName}`,
          'User-Agent': utils.getUserAgent(),
        },
        auth: {
          username: credentials.userName,
          password: credentials.accessKey,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        onUploadProgress: showProgress
          ? (progressEvent: AxiosProgressEvent) => {
              this.handleProgress(progressEvent, fileStats.size, fileName);
            }
          : undefined,
      });

      const result = response.data;
      if (result.id) {
        if (showProgress) {
          this.clearProgressLine();
        }
        return { id: result.id };
      } else {
        throw new TestingBotError(
          `Upload failed: ${result.error || 'Unknown error'}`,
        );
      }
    } catch (error) {
      if (error instanceof TestingBotError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new TestingBotError(
            'Invalid TestingBot credentials. Please check your API key and secret.\n' +
              'You can update your credentials by running "testingbot login" or by using:\n' +
              '  --api-key and --api-secret options\n' +
              '  TB_KEY and TB_SECRET environment variables\n' +
              '  ~/.testingbot file with content: key:secret',
          );
        }
        const message = error.response?.data?.error || error.message;
        throw new TestingBotError(`Upload failed: ${message}`);
      }
      throw new TestingBotError(
        `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async validateFile(filePath: string): Promise<void> {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(`File not found or not readable: ${filePath}`);
    }
  }

  private handleProgress(
    progressEvent: AxiosProgressEvent,
    totalSize: number,
    fileName: string,
  ): void {
    const loaded = progressEvent.loaded;
    const total = progressEvent.total || totalSize;
    const percent = Math.round((loaded / total) * 100);

    if (percent !== this.lastProgressPercent) {
      this.lastProgressPercent = percent;
      this.displayProgress(fileName, percent, loaded, total);
    }
  }

  private displayProgress(
    fileName: string,
    percent: number,
    loaded: number,
    total: number,
  ): void {
    const barWidth = 30;
    const filledWidth = Math.round((percent / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);

    const loadedMB = (loaded / (1024 * 1024)).toFixed(2);
    const totalMB = (total / (1024 * 1024)).toFixed(2);

    process.stdout.write(
      `\r  ${fileName}: [${bar}] ${percent}% (${loadedMB}/${totalMB} MB)`,
    );
  }

  private clearProgressLine(): void {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
    this.lastProgressPercent = 0;
  }
}
