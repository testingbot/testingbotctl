import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Credentials from './models/credentials';

export interface AuthOptions {
  apiKey?: string;
  apiSecret?: string;
}

export type CredentialSource = 'options' | 'env' | 'file';

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
    return (await this.resolveCredentials(options))?.credentials ?? null;
  }

  /** Like getCredentials, and also says where the credentials came from. */
  public static async resolveCredentials(
    options?: AuthOptions,
  ): Promise<{ credentials: Credentials; source: CredentialSource } | null> {
    // 1. Check CLI options first (highest precedence)
    if (options?.apiKey && options?.apiSecret) {
      return {
        credentials: new Credentials(options.apiKey, options.apiSecret),
        source: 'options',
      };
    }

    // 2. Check environment variables
    const envKey = process.env.TB_KEY;
    const envSecret = process.env.TB_SECRET;
    if (envKey && envSecret) {
      return {
        credentials: new Credentials(envKey, envSecret),
        source: 'env',
      };
    }

    // 3. Fall back to ~/.testingbot file
    const fromFile = await this.getCredentialsFromFile();
    return fromFile ? { credentials: fromFile, source: 'file' } : null;
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
