import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Credentials from './models/credentials';

export default class Auth {
  public static async getCredentials(): Promise<Credentials | null> {
    const savedCredentials = (
      await fs.promises.readFile(path.join(os.homedir(), '.testingbot'))
    ).toString();
    if (savedCredentials.length > 0) {
      const [userName, accessKey] = savedCredentials.split(':');
      return new Credentials(userName, accessKey);
    }
    return null;
  }
}
