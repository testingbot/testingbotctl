import logger from '../logger';
import Credentials from '../models/credentials';
import axios from 'axios';
import fs from 'node:fs';
import TestingBotError from '../models/testingbot_error';
import XCUITestOptions from '../models/xcuitest_options';
import utils from '../utils';
import Upload from '../upload';

export default class XCUITest {
  private readonly URL = 'https://api.testingbot.com/v1/app-automate/xcuitest';
  private credentials: Credentials;
  private options: XCUITestOptions;
  private upload: Upload;

  private appId: number | undefined = undefined;

  public constructor(credentials: Credentials, options: XCUITestOptions) {
    this.credentials = credentials;
    this.options = options;
    this.upload = new Upload();
  }

  private async validate(): Promise<boolean> {
    if (this.options.app === undefined) {
      throw new TestingBotError(`app is required`);
    }

    try {
      await fs.promises.access(this.options.app, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(`app path does not exist ${this.options.app}`);
    }

    if (this.options.testApp === undefined) {
      throw new TestingBotError(`testApp is required`);
    }

    try {
      await fs.promises.access(this.options.testApp, fs.constants.R_OK);
    } catch {
      throw new TestingBotError(
        `testApp path does not exist ${this.options.testApp}`,
      );
    }

    if (this.options.device === undefined) {
      throw new TestingBotError(`Please specify a device`);
    }

    return true;
  }

  public async run() {
    if (!(await this.validate())) {
      return;
    }

    try {
      logger.info('Uploading XCUITest App');
      await this.uploadApp();

      logger.info('Uploading XCUITest Test App');
      await this.uploadTestApp();

      logger.info('Running XCUITests');
      await this.runTests();
    } catch (error) {
      logger.error(error instanceof Error ? error.message : error);
    }
  }

  private async uploadApp() {
    const result = await this.upload.upload({
      filePath: this.options.app,
      url: `${this.URL}/app`,
      credentials: this.credentials,
      contentType: 'application/octet-stream',
      showProgress: true,
    });

    this.appId = result.id;
    return true;
  }

  private async uploadTestApp() {
    await this.upload.upload({
      filePath: this.options.testApp,
      url: `${this.URL}/${this.appId}/tests`,
      credentials: this.credentials,
      contentType: 'application/zip',
      showProgress: true,
    });

    return true;
  }

  private async runTests() {
    try {
      const response = await axios.post(
        `${this.URL}/${this.appId}/run`,
        {
          capabilities: [
            {
              deviceName: this.options.device,
            },
          ],
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
      if (result.success === false) {
        throw new TestingBotError(`Running XCUITest failed`, {
          cause: result.error,
        });
      }

      return true;
    } catch (error) {
      throw new TestingBotError(`Running XCUITest failed`, { cause: error });
    }
  }
}
