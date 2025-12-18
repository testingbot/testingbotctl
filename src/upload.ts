import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import progress from 'progress-stream';
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
  public async upload(options: UploadOptions): Promise<UploadResult> {
    const {
      filePath,
      url,
      credentials,
      showProgress = false,
    } = options;

    await this.validateFile(filePath);

    const fileName = path.basename(filePath);
    const fileStats = await fs.promises.stat(filePath);
    const totalSize = fileStats.size;
    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);

    // Create progress tracker
    const progressTracker = progress({
      length: totalSize,
      time: 100, // Emit progress every 100ms
    });

    let lastPercent = 0;

    if (showProgress) {
      // Draw initial progress bar
      this.drawProgressBar(fileName, sizeMB, 0);

      progressTracker.on('progress', (prog) => {
        const percent = Math.round(prog.percentage);
        if (percent !== lastPercent) {
          lastPercent = percent;
          this.drawProgressBar(fileName, sizeMB, percent);
        }
      });
    }

    // Create file stream and pipe through progress tracker
    const fileStream = fs.createReadStream(filePath);
    const trackedStream = fileStream.pipe(progressTracker);

    const formData = new FormData();
    formData.append('file', trackedStream, {
      filename: fileName,
      contentType: options.contentType,
      knownLength: totalSize,
    });

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

      const result = response.data;
      if (result.id) {
        if (showProgress) {
          this.drawProgressBar(fileName, sizeMB, 100);
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

  private drawProgressBar(
    fileName: string,
    sizeMB: string,
    percent: number,
  ): void {
    const barWidth = 30;
    const filled = Math.round((barWidth * percent) / 100);
    const empty = barWidth - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const transferred = ((percent / 100) * parseFloat(sizeMB)).toFixed(2);

    process.stdout.write(
      `\r  ${fileName}: [${bar}] ${percent}% (${transferred}/${sizeMB} MB)`,
    );
  }

  private async validateFile(filePath: string): Promise<void> {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(`File not found or not readable: ${filePath}`);
    }
  }
}
