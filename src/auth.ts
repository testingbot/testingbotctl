import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Credentials from './models/credentials';

export interface AuthOptions {
  apiKey?: string;
  apiSecret?: string;
}

export default class Auth {
  /**
   * Get credentials from multiple sources in order of precedence:
   * 1. CLI options (--api-key, --api-secret)
   * 2. Environment variables (TB_KEY, TB_SECRET)
   * 3. ~/.testingbot file
   */
  public static async getCredentials(
    options?: AuthOptions,
  ): Promise<Credentials | null> {
    // 1. Check CLI options first (highest precedence)
    if (options?.apiKey && options?.apiSecret) {
      return new Credentials(options.apiKey, options.apiSecret);
    }

    // 2. Check environment variables
    const envKey = process.env.TB_KEY;
    const envSecret = process.env.TB_SECRET;
    if (envKey && envSecret) {
      return new Credentials(envKey, envSecret);
    }

    // 3. Fall back to ~/.testingbot file
    return this.getCredentialsFromFile();
  }

  private static async getCredentialsFromFile(): Promise<Credentials | null> {
    try {
      const savedCredentials = (
        await fs.promises.readFile(path.join(os.homedir(), '.testingbot'))
      ).toString();
      if (savedCredentials.length > 0) {
        const [userName, accessKey] = savedCredentials.trim().split(':');
        if (userName && accessKey) {
          return new Credentials(userName, accessKey);
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
