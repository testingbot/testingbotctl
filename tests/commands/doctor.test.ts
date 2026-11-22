import {
  renderChecks,
  runChecks,
  type DoctorDeps,
} from '../../src/commands/doctor';
import Credentials from '../../src/models/credentials';

const account = {
  id: 42,
  name: 'Test User',
  plan: 'Team',
  minutesLeft: 2057,
  concurrency: {
    virtual: 5,
    physical: 3,
    runningVirtual: 2,
    runningPhysical: 1,
  },
};

function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  let t = 0;
  return {
    nodeVersion: '20.11.0',
    cliVersion: '1.5.0',
    latestVersion: async () => '1.5.0',
    resolveCredentials: async () => ({
      credentials: new Credentials('abcdef123', 'secret'),
      source: 'file',
    }),
    fetchAccount: async () => account,
    pingApi: async () => undefined,
    proxy: () => undefined,
    configFile: () => undefined,
    completionInstalled: () => false,
    now: () => (t += 120),
    ...overrides,
  };
}

const byName = (results: Awaited<ReturnType<typeof runChecks>>) =>
  Object.fromEntries(results.map((r) => [r.name, r]));

describe('doctor', () => {
  it('reports a healthy setup', async () => {
    const results = byName(await runChecks(deps()));
    expect(results.CLI).toMatchObject({
      status: 'ok',
      detail: '1.5.0 (latest)',
    });
    expect(results['Node.js'].status).toBe('ok');
    expect(results.Credentials).toMatchObject({
      status: 'ok',
      detail: '~/.testingbot · key abcd…',
    });
    expect(results.API).toMatchObject({
      status: 'ok',
      detail: 'api.testingbot.com reachable (120 ms)',
    });
    expect(results.Account.detail).toBe(
      'Test User · Team plan · 2,057 minutes left · 2/5 virtual, 1/3 real in use',
    );
    expect(results.Config).toMatchObject({
      status: 'info',
      hint: 'testingbot init',
    });
    expect(results.Completion).toMatchObject({
      status: 'info',
      hint: 'testingbot completion --help',
    });
    const text = renderChecks(Object.values(results)).join('\n');
    expect(text).toContain('Everything looks good.');
    // Never the full key.
    expect(text).not.toContain('abcdef123');
  });

  it('points to an update, and works offline from npm', async () => {
    let results = byName(
      await runChecks(deps({ latestVersion: async () => '1.6.0' })),
    );
    expect(results.CLI).toMatchObject({
      status: 'warn',
      hint: 'testingbot upgrade',
    });
    results = byName(
      await runChecks(
        deps({
          latestVersion: async () => {
            throw new Error('offline');
          },
        }),
      ),
    );
    expect(results.CLI).toMatchObject({ status: 'ok', detail: '1.5.0' });
  });

  it('fails without credentials but still checks the API', async () => {
    const ping = jest.fn().mockResolvedValue(undefined);
    const results = byName(
      await runChecks(
        deps({ resolveCredentials: async () => null, pingApi: ping }),
      ),
    );
    expect(results.Credentials).toMatchObject({
      status: 'fail',
      detail: 'none found',
    });
    expect(ping).toHaveBeenCalled();
    expect(results.API.status).toBe('ok');
    expect(renderChecks(Object.values(results)).join('\n')).toContain(
      '1 problem to fix.',
    );
  });

  it('tells rejected credentials apart from an unreachable API', async () => {
    let results = byName(
      await runChecks(
        deps({
          fetchAccount: async () => {
            throw new Error('Request failed with status code 401');
          },
        }),
      ),
    );
    expect(results.Credentials).toMatchObject({
      status: 'fail',
      detail: 'rejected by TestingBot',
    });

    results = byName(
      await runChecks(
        deps({
          proxy: () => 'http://user:pw@proxy:8080',
          fetchAccount: async () => {
            throw new Error('getaddrinfo ENOTFOUND api.testingbot.com');
          },
        }),
      ),
    );
    expect(results.API).toMatchObject({
      status: 'fail',
      hint: 'Check that the proxy allows *.testingbot.com',
    });
    expect(results.Proxy.detail).not.toContain('pw');
  });

  it('flags an old Node.js, an empty account and a broken config', async () => {
    const results = byName(
      await runChecks(
        deps({
          nodeVersion: '18.19.0',
          fetchAccount: async () => ({ ...account, minutesLeft: 0 }),
          configFile: () => '/nonexistent/.testingbot.yml',
        }),
      ),
    );
    expect(results['Node.js'].status).toBe('fail');
    expect(results.Account.status).toBe('warn');
    expect(results.Config.status).toBe('fail');
  });
});
