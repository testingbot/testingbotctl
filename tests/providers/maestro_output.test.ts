import Maestro from '../../src/providers/maestro';
import MaestroOptions from '../../src/models/maestro_options';
import Credentials from '../../src/models/credentials';
import axios from 'axios';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Real files and a real tar: the bundle the node uploads (vm packMaestroOutput)
// has to come out with the paths commands.json references.
jest.mock('axios');
jest.mock('socket.io-client', () => ({ io: jest.fn() }));

describe('--maestro-output', () => {
  let sandbox: string;
  let bundle: Buffer;

  beforeAll(() => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-mo-src-'));
    fs.mkdirSync(path.join(src, 'login', 'screen-hierarchy'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(src, 'login', 'commands.json'), '[]');
    fs.writeFileSync(
      path.join(src, 'login', 'screen-hierarchy', 'step-086-tapOnElement.json'),
      '{}',
    );
    const tarPath = path.join(src, '..', `${path.basename(src)}.tar`);
    execFileSync('tar', ['-cf', tarPath, '-C', src, '.']);
    bundle = fs.readFileSync(tarPath);
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(tarPath, { force: true });
  });

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-mo-'));
    (axios.get as jest.Mock).mockReset();
    (axios.get as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('.tar') ? bundle : Buffer.from('log'),
      }),
    );
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const maestro = (maestroOutput: boolean) =>
    new Maestro(
      new Credentials('user', 'key'),
      MaestroOptions.forExistingProject({
        downloadArtifacts: 'all',
        maestroOutput,
        quiet: true,
      }),
    );
  const assets = {
    logs: { maestro: 'https://r2.example.com/abc_maestro.txt' },
    maestro_output: 'https://r2.example.com/abc_maestro_output.tar',
  };

  it('unpacks the bundle into maestro-output/ with its own paths', async () => {
    await maestro(true)['downloadAssetBundle'](assets, sandbox);

    const out = path.join(sandbox, 'maestro-output', 'login');
    expect(fs.readFileSync(path.join(out, 'commands.json'), 'utf8')).toBe('[]');
    expect(
      fs.existsSync(
        path.join(out, 'screen-hierarchy', 'step-086-tapOnElement.json'),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(sandbox, 'maestro-output.tar'))).toBe(false);
    expect(fs.existsSync(path.join(sandbox, 'logs', 'maestro.txt'))).toBe(true);
  });

  it('leaves the bundle alone without the flag', async () => {
    await maestro(false)['downloadAssetBundle'](assets, sandbox);

    expect(fs.existsSync(path.join(sandbox, 'maestro-output'))).toBe(false);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('reports a bundle that is not a tar without failing the download', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: Buffer.from('not a tar'),
    });

    await maestro(true)['downloadAssetBundle'](assets, sandbox);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to download Maestro output'),
    );
    expect(fs.existsSync(path.join(sandbox, 'maestro-output.tar'))).toBe(false);
  });
});
