import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import Login from '../../src/providers/login';

jest.mock('node:fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    writeFile: jest.fn(),
    chmod: jest.fn(),
  },
}));

jest.mock('node:child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: jest.fn((_cmd, _args, cb) => {
    if (typeof cb === 'function') cb(null, '', '');
  }),
}));

jest.mock('../../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

function postCallback(
  port: number,
  body: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/callback',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload).toString(),
        },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getCallback(port: number, query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `/callback?${query}`,
        method: 'GET',
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function waitForPort(login: Login): Promise<number> {
  return new Promise<number>((resolve) => {
    const check = () => {
      const p = (login as unknown as { port: number }).port;
      if (p > 0) resolve(p);
      else setTimeout(check, 5);
    };
    check();
  });
}

function stateOf(login: Login): string {
  return (login as unknown as { state: string }).state;
}

async function findPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe('Login.run', () => {
  const writeFileMock = fs.promises.writeFile as jest.Mock;
  const chmodMock = fs.promises.chmod as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    writeFileMock.mockResolvedValue(undefined);
    chmodMock.mockResolvedValue(undefined);
  });

  it('completes authentication via JSON POST callback and saves credentials', async () => {
    const login = new Login();

    // Drive the callback a beat after run() starts up the server.
    const runPromise = login.run();

    // Grab the internal port by polling briefly.
    const port = await new Promise<number>((resolve) => {
      const check = () => {
        const p = (login as unknown as { port: number }).port;
        if (p > 0) resolve(p);
        else setTimeout(check, 5);
      };
      check();
    });

    await postCallback(port, {
      key: 'my-key',
      secret: 'my-secret',
      state: stateOf(login),
    });

    const result = await runPromise;
    expect(result.success).toBe(true);
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(os.homedir()),
      'my-key:my-secret',
      { mode: 0o600 },
    );
    expect(chmodMock).toHaveBeenCalledWith(
      expect.stringContaining(os.homedir()),
      0o600,
    );
  });

  it('sends a state to the auth page', async () => {
    const login = new Login();
    const runPromise = login.run();
    const port = await waitForPort(login);

    expect(stateOf(login)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { execFile } = jest.requireMock('node:child_process');
    const openedUrl = (execFile as jest.Mock).mock.calls[0][1].at(-1);
    expect(openedUrl).toContain(`&state=${stateOf(login)}`);

    await getCallback(port, `error=done&state=${stateOf(login)}`);
    await runPromise;
  });

  it('ignores callbacks without the expected state and keeps waiting', async () => {
    const login = new Login();
    const runPromise = login.run();
    const port = await waitForPort(login);

    expect(await getCallback(port, 'key=evil&secret=evil')).toBe(400);
    expect(await getCallback(port, 'key=evil&secret=evil&state=wrong')).toBe(
      400,
    );
    expect(await getCallback(port, 'error=aborted')).toBe(400);

    await postCallback(port, {
      key: 'my-key',
      secret: 'my-secret',
      state: stateOf(login),
    });

    const result = await runPromise;
    expect(result.success).toBe(true);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.any(String),
      'my-key:my-secret',
      { mode: 0o600 },
    );
  });

  it('rejects when callback reports an error query param', async () => {
    const login = new Login();
    const runPromise = login.run();

    const port = await new Promise<number>((resolve) => {
      const check = () => {
        const p = (login as unknown as { port: number }).port;
        if (p > 0) resolve(p);
        else setTimeout(check, 5);
      };
      check();
    });

    await getCallback(port, `error=user_denied&state=${stateOf(login)}`);

    const result = await runPromise;
    expect(result.success).toBe(false);
    expect(result.message).toContain('user_denied');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('surfaces a server startup failure when the port is occupied', async () => {
    const port = await findPort();
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(port, '127.0.0.1', r));

    // Force our login server to try to bind to the same port by stubbing listen.
    const login = new Login();
    const origListen = http.Server.prototype.listen;
    const listenSpy = jest
      .spyOn(http.Server.prototype, 'listen')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(function (this: http.Server, ...args: any[]) {
        // Force it to try the occupied port instead of random 0.
        const cb = args[args.length - 1];
        return origListen.call(this, port, '127.0.0.1', cb);
      });

    const result = await login.run();
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to start local server');

    listenSpy.mockRestore();
    await new Promise<void>((r) => blocker.close(() => r()));
  });
});
