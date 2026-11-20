import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Opens a URL in the default browser. Resolves false when that is not
 * possible (no desktop, no opener); callers keep the URL visible anyway.
 */
export async function openUrl(url: string): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('open', [url]);
    } else if (process.platform === 'win32') {
      // `start` takes the first quoted argument (Node quotes '' as "") as the
      // window title; an unquoted & would end the cmd command.
      await execFileAsync('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]);
    } else {
      await execFileAsync('xdg-open', [url]);
    }
    return true;
  } catch {
    return false;
  }
}
