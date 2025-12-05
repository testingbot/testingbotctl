import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import logger from '../logger';

const AUTH_URL = 'https://testingbot.com/auth';

export interface LoginResult {
  success: boolean;
  message: string;
}

export default class Login {
  private server: http.Server | null = null;
  private port: number = 0;

  public async run(): Promise<LoginResult> {
    try {
      // Start local server to receive callback
      this.port = await this.startServer();

      // Open browser to auth URL
      const authUrl = `${AUTH_URL}?port=${this.port}&identifier=testingbotctl`;
      logger.info('Opening browser for authentication...');
      logger.info(
        `\nIf the browser does not open automatically, visit:\n\n    ${authUrl}\n`,
      );

      await this.openBrowser(authUrl);

      // Wait for callback (handled by server)
      const credentials = await this.waitForCallback();

      // Save credentials
      await this.saveCredentials(credentials.key, credentials.secret);

      logger.info('Authentication successful!');
      logger.info(`Credentials saved to ~/.testingbot`);

      return { success: true, message: 'Authentication successful' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Authentication failed: ${message}`);
      return { success: false, message };
    } finally {
      this.stopServer();
    }
  }

  private startServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer();

      this.server.on('error', (err) => {
        reject(new Error(`Failed to start local server: ${err.message}`));
      });

      // Listen on random available port
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('Failed to get server port'));
        }
      });
    });
  }

  private stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private waitForCallback(): Promise<{ key: string; secret: string }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          reject(new Error('Authentication timed out after 5 minutes'));
        },
        5 * 60 * 1000,
      );

      this.server?.on('request', async (req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end('Bad request');
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${this.port}`);

        if (url.pathname === '/callback') {
          try {
            // Try to get credentials from query params (GET) or body (POST)
            let key = url.searchParams.get('key');
            let secret = url.searchParams.get('secret');
            let error = url.searchParams.get('error');

            // If not in query params and this is a POST request, parse the body
            if (!key && !secret && !error && req.method === 'POST') {
              const body = await this.parseRequestBody(req);
              key = body.get('key');
              secret = body.get('secret');
              error = body.get('error');
            }

            if (error) {
              clearTimeout(timeout);
              this.sendErrorResponse(res, error);
              reject(new Error(error));
              return;
            }

            if (key && secret) {
              clearTimeout(timeout);
              this.sendSuccessResponse(res);
              resolve({ key, secret });
            } else {
              res.writeHead(400);
              res.end('Missing credentials');
            }
          } catch (err) {
            res.writeHead(400);
            res.end('Failed to parse request');
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
    });
  }

  private parseRequestBody(
    req: http.IncomingMessage,
  ): Promise<URLSearchParams> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        const contentType = req.headers['content-type'] || '';

        if (contentType.includes('application/json')) {
          // Parse JSON body
          try {
            const json = JSON.parse(body);
            const params = new URLSearchParams();
            if (json.key) params.set('key', json.key);
            if (json.secret) params.set('secret', json.secret);
            if (json.error) params.set('error', json.error);
            resolve(params);
          } catch {
            reject(new Error('Invalid JSON body'));
          }
        } else {
          // Parse URL-encoded body (application/x-www-form-urlencoded)
          resolve(new URLSearchParams(body));
        }
      });

      req.on('error', reject);
    });
  }

  private sendSuccessResponse(res: http.ServerResponse): void {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Authentication Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 400px;
            text-align: center;
        }
        .icon {
            width: 64px;
            height: 64px;
            margin-bottom: 1rem;
        }
        h1 {
            color: #333;
            margin-bottom: 0.5rem;
        }
        p {
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <svg class="icon" fill="none" stroke="#22c55e" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        <h1>Authentication Successful!</h1>
        <p>You can close this window and return to the CLI.</p>
    </div>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private sendErrorResponse(res: http.ServerResponse, error: string): void {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Authentication Failed</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
        }
        .container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 400px;
            text-align: center;
        }
        .icon {
            width: 64px;
            height: 64px;
            margin-bottom: 1rem;
        }
        h1 {
            color: #333;
            margin-bottom: 0.5rem;
        }
        p {
            color: #666;
        }
        .error {
            color: #ef4444;
        }
    </style>
</head>
<body>
    <div class="container">
        <svg class="icon" fill="none" stroke="#ef4444" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
        <h1>Authentication Failed</h1>
        <p class="error">${error}</p>
        <p>Please try again or contact support.</p>
    </div>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private async saveCredentials(key: string, secret: string): Promise<void> {
    const filePath = path.join(os.homedir(), '.testingbot');
    await fs.promises.writeFile(filePath, `${key}:${secret}`, { mode: 0o600 });
  }

  private async openBrowser(url: string): Promise<void> {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        await execAsync(`open "${url}"`);
      } else if (platform === 'win32') {
        await execAsync(`start "" "${url}"`);
      } else {
        // Linux and others
        await execAsync(`xdg-open "${url}"`);
      }
    } catch {
      // Browser open failed, user will need to open manually
      // Message already displayed in run()
    }
  }
}
