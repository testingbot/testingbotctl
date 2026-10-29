import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Credentials from '../../src/models/credentials';
import {
  downloadSessionArtifacts,
  safeName,
} from '../../src/utils/session_artifacts';

jest.mock('axios');
jest.mock('../../src/logger');

const mockGet = axios.get as jest.Mock;
const credentials = new Credentials('key', 'secret');

describe('downloadSessionArtifacts', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-artifacts-'));
    mockGet.mockReset();
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('https://api.testingbot.com/v1/tests/')) {
        return {
          data: {
            assets_available: true,
            video: 'https://cdn.test/video.mp4',
            logs: { appium: 'https://cdn.test/appium.log' },
            thumbs: ['https://cdn.test/0.png'],
          },
        };
      }
      return { data: Buffer.from(`bytes of ${url}`) };
    });
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  const runs = [
    { id: 1, passed: true, sessionId: 'sess-1', device: 'iPhone 15' },
    { id: 2, passed: false, sessionId: 'sess-2', device: 'iPhone 16' },
  ];

  test('zips the video, logs and screenshots of every run', async () => {
    const zip = await downloadSessionArtifacts({
      provider: 'xcuitest',
      credentials,
      runs,
      mode: 'all',
      outputDir,
      name: 'nightly ios',
      quiet: true,
    });

    expect(zip).toBe(path.join(outputDir, 'nightly_ios.zip'));
    expect(fs.statSync(zip!).size).toBeGreaterThan(0);
    const testsCalls = mockGet.mock.calls.filter(([url]) =>
      String(url).includes('/v1/tests/'),
    );
    expect(testsCalls.map(([url]) => url)).toEqual([
      'https://api.testingbot.com/v1/tests/sess-1',
      'https://api.testingbot.com/v1/tests/sess-2',
    ]);
    expect(testsCalls[0][1].auth).toEqual({
      username: 'key',
      password: 'secret',
    });
  });

  test('failed mode only fetches failed runs', async () => {
    await downloadSessionArtifacts({
      provider: 'espresso',
      credentials,
      runs,
      mode: 'failed',
      outputDir,
      quiet: true,
    });

    const sessions = mockGet.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/v1/tests/'));
    expect(sessions).toEqual(['https://api.testingbot.com/v1/tests/sess-2']);
  });

  test('waits for asset processing before downloading', async () => {
    let polls = 0;
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('/v1/tests/')) {
        polls++;
        return {
          data:
            polls < 3
              ? { assets_available: false }
              : { assets_available: true, video: 'https://cdn.test/v.mp4' },
        };
      }
      return { data: Buffer.from('video') };
    });

    const zip = await downloadSessionArtifacts({
      provider: 'xcuitest',
      credentials,
      runs: [runs[0]],
      mode: 'all',
      outputDir,
      quiet: true,
      pollMs: 1,
    });

    expect(polls).toBe(3);
    expect(zip).toBeDefined();
  });

  test('saves nothing when no run has assets, without throwing', async () => {
    mockGet.mockResolvedValue({ data: { assets_available: true, logs: [] } });

    const zip = await downloadSessionArtifacts({
      provider: 'xcuitest',
      credentials,
      runs: [{ id: 3, passed: false, device: 'x' }, runs[0]],
      mode: 'all',
      outputDir,
      quiet: true,
    });

    expect(zip).toBeUndefined();
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });

  test('safeName keeps file names portable', () => {
    expect(safeName('iPhone 15 Pro / iOS 18')).toBe('iPhone_15_Pro_iOS_18');
    expect(safeName('../..')).toBe('run');
  });
});
