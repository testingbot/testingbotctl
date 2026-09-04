import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  appExtension,
  downloadApp,
  extractAppBundle,
  findAppBundle,
  isAppUrl,
  isSupportedAppExtension,
} from '../../src/utils/app_source';

jest.mock('axios');
jest.mock('../../src/utils', () => ({
  __esModule: true,
  default: { getUserAgent: jest.fn().mockReturnValue('TestingBot-CTL-test') },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function streamOf(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

describe('app_source helpers', () => {
  it('recognises URLs and app extensions, including .tar.gz', () => {
    expect(isAppUrl('https://expo.dev/x.tar.gz')).toBe(true);
    expect(isAppUrl('HTTP://x.test/app.apk')).toBe(true);
    expect(isAppUrl('./app.apk')).toBe(false);
    expect(isAppUrl(undefined)).toBe(false);
    expect(appExtension('Build.TAR.GZ')).toBe('.tar.gz');
    expect(appExtension('app.apk')).toBe('.apk');
    expect(appExtension('archive.gz')).toBe('.gz');
    expect(isSupportedAppExtension('a.tar.gz')).toBe(true);
    expect(isSupportedAppExtension('a.txt')).toBe(false);
  });
});

describe('downloadApp', () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    jest.resetAllMocks();
    for (const d of tmpDirs.splice(0)) {
      await fs.promises.rm(d, { recursive: true, force: true });
    }
  });

  it('saves the file with the extension from the URL path, ignoring the query', async () => {
    mockedAxios.get.mockResolvedValue({
      data: streamOf('apk-bytes'),
      headers: {},
    });
    const log = jest.fn();
    const result = await downloadApp(
      'https://cdn.test/builds/app-release.apk?X-Signature=abc',
      { log },
    );
    tmpDirs.push(result.tmpDir);
    expect(path.basename(result.filePath)).toBe('app-release.apk');
    expect(await fs.promises.readFile(result.filePath, 'utf8')).toBe(
      'apk-bytes',
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://cdn.test/builds/app-release.apk?X-Signature=abc',
      expect.objectContaining({ responseType: 'stream' }),
    );
    expect(log).toHaveBeenCalledWith('Downloading app from cdn.test...');
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^Downloaded app-release\.apk/),
    );
  });

  it('falls back to Content-Disposition, then Content-Type, for the extension', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: streamOf('x'),
      headers: { 'content-disposition': 'attachment; filename="build.tar.gz"' },
    });
    const a = await downloadApp('https://expo.dev/artifacts/eas/abc123', {
      quiet: true,
    });
    tmpDirs.push(a.tmpDir);
    expect(path.basename(a.filePath)).toBe('build.tar.gz');

    mockedAxios.get.mockResolvedValueOnce({
      data: streamOf('x'),
      headers: { 'content-type': 'application/vnd.android.package-archive' },
    });
    const b = await downloadApp('https://cdn.test/download/12345', {
      quiet: true,
    });
    tmpDirs.push(b.tmpDir);
    expect(path.basename(b.filePath)).toBe('app.apk');
  });

  it('rejects when no extension can be determined', async () => {
    mockedAxios.get.mockResolvedValue({
      data: streamOf('x'),
      headers: { 'content-type': 'text/html' },
    });
    await expect(
      downloadApp('https://cdn.test/download/12345', { quiet: true }),
    ).rejects.toThrow('Cannot tell the app type');
  });

  it('rejects an empty download', async () => {
    mockedAxios.get.mockResolvedValue({ data: streamOf(''), headers: {} });
    await expect(
      downloadApp('https://cdn.test/app.apk', { quiet: true }),
    ).rejects.toThrow('empty file');
  });

  it('explains expired signed URLs on 403 and reports 404s', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 403 } });
    await expect(
      downloadApp('https://expo.dev/artifacts/build.tar.gz', { quiet: true }),
    ).rejects.toThrow('expire after about an hour');
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(
      downloadApp('https://cdn.test/app.apk', { quiet: true }),
    ).rejects.toThrow('HTTP 404');
  });

  it('rejects non-http URLs and garbage', async () => {
    await expect(downloadApp('ftp://x.test/app.apk')).rejects.toThrow(
      'only http(s) URLs',
    );
    await expect(downloadApp('not a url')).rejects.toThrow('is not a URL');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});

describe('extractAppBundle', () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    for (const d of tmpDirs.splice(0)) {
      await fs.promises.rm(d, { recursive: true, force: true });
    }
  });

  async function makeArchive(
    layout: (root: string) => Promise<void>,
  ): Promise<string> {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tb-tar-'));
    tmpDirs.push(work);
    const src = path.join(work, 'src');
    await fs.promises.mkdir(src);
    await layout(src);
    const archive = path.join(work, 'build.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', src, '.']);
    return archive;
  }

  it('finds a root-level .app bundle', async () => {
    const archive = await makeArchive(async (root) => {
      await fs.promises.mkdir(path.join(root, 'MyApp.app'));
      await fs.promises.writeFile(
        path.join(root, 'MyApp.app', 'Info.plist'),
        'x',
      );
    });
    const { appPath, tmpDir } = await extractAppBundle(archive);
    tmpDirs.push(tmpDir);
    expect(path.basename(appPath)).toBe('MyApp.app');
    expect(fs.existsSync(path.join(appPath, 'Info.plist'))).toBe(true);
  });

  it('finds a nested Payload/*.app bundle and prefers the shallowest', async () => {
    const archive = await makeArchive(async (root) => {
      await fs.promises.mkdir(path.join(root, 'Payload', 'Deep.app'), {
        recursive: true,
      });
      await fs.promises.mkdir(
        path.join(root, 'Payload', 'Deep.app', 'Frameworks', 'Inner.app'),
        { recursive: true },
      );
    });
    const { appPath, tmpDir } = await extractAppBundle(archive);
    tmpDirs.push(tmpDir);
    expect(path.basename(appPath)).toBe('Deep.app');
  });

  it('fails clearly when the archive holds no .app', async () => {
    const archive = await makeArchive(async (root) => {
      await fs.promises.writeFile(
        path.join(root, 'readme.txt'),
        'nothing here',
      );
    });
    await expect(extractAppBundle(archive)).rejects.toThrow(
      'No .app bundle found',
    );
  });

  it('fails clearly on a corrupt archive', async () => {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tb-tar-'));
    tmpDirs.push(work);
    const bad = path.join(work, 'bad.tar.gz');
    await fs.promises.writeFile(bad, 'this is not gzip');
    await expect(extractAppBundle(bad)).rejects.toThrow(
      'Failed to extract bad.tar.gz',
    );
  });

  it('findAppBundle returns undefined for an empty tree', async () => {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tb-tar-'));
    tmpDirs.push(work);
    expect(await findAppBundle(work)).toBeUndefined();
  });
});
