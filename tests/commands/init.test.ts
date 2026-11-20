import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  detectProject,
  initSummary,
  renderConfig,
  runInit,
} from '../../src/commands/init';
import { loadProjectConfig } from '../../src/config/project_config';
import { cacheDevices } from '../../src/utils/device_check';

let dir: string;

function touch(rel: string, content = 'x') {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tb-init-')));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('detectProject', () => {
  it('finds a Maestro project: debug APK and .maestro', async () => {
    touch('app/build/outputs/apk/debug/app-debug.apk');
    touch('app/build/outputs/apk/release/app-release.apk');
    touch('.maestro/login.yaml', 'appId: com.example\n---\n- launchApp\n');
    touch('node_modules/x/huge.apk');
    const d = await detectProject(dir);
    expect(d).toEqual({
      framework: 'maestro',
      app: 'app/build/outputs/apk/debug/app-debug.apk',
      flows: '.maestro',
      device: 'Pixel 9',
    });
  });

  it('recognises flows outside .maestro by their content', async () => {
    touch('e2e/flows/login.yaml', 'appId: com.example\n---\n- launchApp\n');
    touch('docker-compose.yml', 'services: {}\n');
    expect((await detectProject(dir)).flows).toBe('e2e/flows');
  });

  it('finds an Espresso project: app and androidTest APKs', async () => {
    touch('app/build/outputs/apk/debug/app-debug.apk');
    touch('app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk');
    const d = await detectProject(dir);
    expect(d.framework).toBe('espresso');
    expect(d.app).toBe('app/build/outputs/apk/debug/app-debug.apk');
    expect(d.testApp).toBe(
      'app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
    );
  });

  it('picks an iPhone for an iOS-only Maestro project', async () => {
    fs.mkdirSync(path.join(dir, 'MyApp.xcodeproj'));
    touch('.maestro/a.yaml', 'appId: x\n---\n');
    const d = await detectProject(dir);
    expect(d.framework).toBe('maestro');
    expect(d.device).toBe('iPhone 16');
  });

  it('prefers the newest Pixel from the cached catalog', async () => {
    cacheDevices('maestro', false, [
      {
        name: 'Galaxy S24',
        platform: 'Android',
        versions: ['14'],
        type: 'phone',
        real: false,
      },
      {
        name: 'Pixel 8',
        platform: 'Android',
        versions: ['14'],
        type: 'phone',
        real: false,
      },
      {
        name: 'Pixel 10',
        platform: 'Android',
        versions: ['16'],
        type: 'phone',
        real: false,
      },
      {
        name: 'Pixel Tablet',
        platform: 'Android',
        versions: ['14'],
        type: 'tablet',
        real: false,
      },
    ]);
    expect((await detectProject(dir, 'maestro')).device).toBe('Pixel 10');
    cacheDevices('maestro', false, []);
  });

  it('honours an explicit framework', async () => {
    expect((await detectProject(dir, 'xcuitest')).framework).toBe('xcuitest');
  });
});

describe('renderConfig', () => {
  it('produces a file the CLI reads back, with comments for the rest', () => {
    const content = renderConfig({
      framework: 'maestro',
      app: 'build/app 1.apk',
      flows: '.maestro',
      device: 'Pixel 9',
    });
    expect(content).toContain('# retry: 1');
    expect(yaml.load(content)).toEqual({
      maestro: {
        app: 'build/app 1.apk',
        flows: ['.maestro'],
        device: 'Pixel 9',
      },
    });
  });

  it('leaves a commented placeholder when no app was found', () => {
    const content = renderConfig({ framework: 'espresso', device: 'Pixel 9' });
    expect(content).toContain('# app: path/to/your/app');
    expect(yaml.load(content)).toEqual({ espresso: { device: 'Pixel 9' } });
  });
});

describe('runInit', () => {
  it('writes .testingbot.yml and a GitHub workflow, and never overwrites without --force', async () => {
    touch('.maestro/a.yaml', 'appId: x\n---\n');
    const result = await runInit({ cwd: dir, ci: 'github' });
    expect(result.written).toEqual([
      path.join(dir, '.testingbot.yml'),
      path.join(dir, '.github/workflows/testingbot.yml'),
    ]);
    const config = loadProjectConfig(path.join(dir, '.testingbot.yml'));
    expect(config.commands.maestro.flows).toEqual(['.maestro']);
    const workflow = yaml.load(
      fs.readFileSync(
        path.join(dir, '.github/workflows/testingbot.yml'),
        'utf8',
      ),
    ) as { jobs: Record<string, { steps: Array<{ run?: string }> }> };
    expect(
      workflow.jobs.maestro.steps.some((s) =>
        s.run?.startsWith('npx --yes @testingbot/cli maestro'),
      ),
    ).toBe(true);

    await expect(runInit({ cwd: dir })).rejects.toThrow(/already exists/);
    await expect(runInit({ cwd: dir, force: true })).resolves.toBeDefined();
  });

  it('writes nothing when one of the files already exists', async () => {
    touch('.github/workflows/testingbot.yml', 'keep');
    await expect(runInit({ cwd: dir, ci: 'github' })).rejects.toThrow(
      /already exists/,
    );
    expect(fs.existsSync(path.join(dir, '.testingbot.yml'))).toBe(false);
  });

  it('rejects unknown CI providers', async () => {
    await expect(runInit({ cwd: dir, ci: 'jenkins' })).rejects.toThrow(
      /only "github"/,
    );
  });

  it('summarises what it found and what to do next', async () => {
    const result = await runInit({ cwd: dir, framework: 'maestro' });
    const text = initSummary(result, dir).join('\n');
    expect(text).toContain('Detected a maestro project');
    expect(text).toContain('not found');
    expect(text).toContain('Wrote .testingbot.yml');
    expect(text).toContain('testingbot maestro');
  });
});
