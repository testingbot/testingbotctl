import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  activeProxyFor,
  installProxy,
  proxyAgent,
  proxyForUrl,
  redactProxy,
  uninstallProxy,
} from '../../src/utils/proxy';

describe('proxyForUrl', () => {
  it('picks HTTPS_PROXY for https and HTTP_PROXY for http, either case', () => {
    const env = {
      HTTPS_PROXY: 'http://secure:3128',
      http_proxy: 'http://plain:3128',
    };
    expect(proxyForUrl('https://api.testingbot.com/v1', { env })).toBe(
      'http://secure:3128',
    );
    expect(proxyForUrl('http://example.com', { env })).toBe(
      'http://plain:3128',
    );
  });

  it('falls back to ALL_PROXY and reads host:port as http://', () => {
    expect(
      proxyForUrl('https://api.testingbot.com', {
        env: { ALL_PROXY: 'corp:8080' },
      }),
    ).toBe('http://corp:8080');
  });

  it('goes direct without a proxy, and always for loopback', () => {
    expect(proxyForUrl('https://api.testingbot.com', { env: {} })).toBe(
      undefined,
    );
    const env = { HTTPS_PROXY: 'http://corp:8080', HTTP_PROXY: 'corp:8080' };
    for (const url of [
      'http://localhost:4444',
      'https://127.0.0.1/',
      'http://[::1]:80/',
    ]) {
      expect(proxyForUrl(url, { env })).toBe(undefined);
    }
  });

  it('honours NO_PROXY hosts, domain suffixes, ports and *', () => {
    const at = (noProxy: string, url: string) =>
      proxyForUrl(url, {
        env: { HTTPS_PROXY: 'http://corp:8080', NO_PROXY: noProxy },
      });
    expect(at('testingbot.com', 'https://api.testingbot.com')).toBe(undefined);
    expect(at('.testingbot.com', 'https://testingbot.com')).toBe(undefined);
    expect(at('*.testingbot.com', 'https://hub.testingbot.com')).toBe(
      undefined,
    );
    expect(at('notestingbot.com', 'https://testingbot.com')).toBe(
      'http://corp:8080',
    );
    expect(at('api.testingbot.com:8443', 'https://api.testingbot.com')).toBe(
      'http://corp:8080',
    );
    expect(at('api.testingbot.com:443', 'https://api.testingbot.com')).toBe(
      undefined,
    );
    expect(at('*', 'https://api.testingbot.com')).toBe(undefined);
  });

  it('uses --proxy for every scheme, still minus NO_PROXY', () => {
    const settings = {
      proxy: 'http://flag:1',
      env: { HTTPS_PROXY: 'http://env:2', NO_PROXY: 'internal.example' },
    };
    expect(proxyForUrl('https://api.testingbot.com', settings)).toBe(
      'http://flag:1',
    );
    expect(proxyForUrl('http://ci.internal.example', settings)).toBe(undefined);
  });
});

describe('redactProxy', () => {
  it('masks the password', () => {
    expect(redactProxy('http://me:secret@corp:8080')).toBe(
      'http://me:***@corp:8080',
    );
    expect(redactProxy('corp:8080')).toBe('http://corp:8080');
  });
});

describe('installProxy', () => {
  afterEach(() => uninstallProxy());

  it('changes nothing when no proxy is configured', () => {
    const before = http.globalAgent;
    expect(installProxy({ env: {} })).toBe(undefined);
    expect(http.globalAgent).toBe(before);
    expect(proxyAgent()).toBe(undefined);
    expect(activeProxyFor('https://api.testingbot.com')).toBe(undefined);
  });

  it('rejects proxies it cannot speak', () => {
    expect(() =>
      installProxy({ proxy: 'socks5://corp:1080', env: {} }),
    ).toThrow(/only http:\/\/ and https:\/\/ proxies/);
  });

  it('reports the proxy with the password masked', () => {
    expect(
      installProxy({ env: { HTTPS_PROXY: 'http://me:secret@corp:8080' } }),
    ).toBe('http://me:***@corp:8080');
    expect(activeProxyFor('https://api.testingbot.com')).toBe(
      'http://me:secret@corp:8080',
    );
    expect(proxyAgent()).toBeDefined();
  });

  describe('through a real proxy', () => {
    let proxy: http.Server;
    let port: number;
    const seen: Array<{ kind: string; target: string; auth?: string }> = [];

    beforeAll(async () => {
      proxy = http.createServer((req, res) => {
        seen.push({
          kind: 'request',
          target: req.url ?? '',
          auth: req.headers['proxy-authorization'],
        });
        res.end('via proxy');
      });
      // Record the CONNECT and refuse it: nothing leaves the machine.
      proxy.on('connect', (req, socket) => {
        seen.push({
          kind: 'connect',
          target: req.url ?? '',
          auth: req.headers['proxy-authorization'],
        });
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      });
      await new Promise<void>((resolve) =>
        proxy.listen(0, '127.0.0.1', resolve),
      );
      port = (proxy.address() as AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise((resolve) => proxy.close(resolve));
    });

    beforeEach(() => {
      seen.length = 0;
    });

    it('sends an http request to the proxy in absolute form', async () => {
      installProxy({ proxy: `http://127.0.0.1:${port}`, env: {} });
      const response = await axios.get('http://example.invalid/apps?x=1');
      expect(response.data).toBe('via proxy');
      expect(seen).toEqual([
        {
          kind: 'request',
          target: 'http://example.invalid/apps?x=1',
          auth: undefined,
        },
      ]);
    });

    it('tunnels https with CONNECT and sends the proxy credentials', async () => {
      installProxy({ proxy: `http://me:p%40ss@127.0.0.1:${port}`, env: {} });
      // The proxy's refusal reaches the caller as its own HTTP response,
      // so a 407 shows up as "Proxy authentication required".
      await expect(
        axios.get('https://api.testingbot.com/v1/user'),
      ).rejects.toMatchObject({ response: { status: 403 } });
      expect(seen).toEqual([
        {
          kind: 'connect',
          target: 'api.testingbot.com:443',
          auth: `Basic ${Buffer.from('me:p@ss').toString('base64')}`,
        },
      ]);
    });

    it('covers bare https.get (the tunnel download) via the global agent', async () => {
      installProxy({ proxy: `http://127.0.0.1:${port}`, env: {} });
      await new Promise<void>((resolve) => {
        https
          .get('https://testingbot.com/tunnel/testingbot-tunnel.jar', () =>
            resolve(),
          )
          .on('error', () => resolve());
      });
      expect(seen.map((s) => s.target)).toEqual(['testingbot.com:443']);
    });

    it('routes the live-updates WebSocket through proxyAgent()', async () => {
      installProxy({ proxy: `http://127.0.0.1:${port}`, env: {} });
      const socket = io('https://hub.testingbot.com', {
        transports: ['websocket'],
        reconnection: false,
        timeout: 2000,
        agent: proxyAgent() as unknown as string,
      });
      await new Promise<void>((resolve) => {
        socket.on('connect_error', () => resolve());
      });
      socket.close();
      expect(seen.map((s) => s.target)).toEqual(['hub.testingbot.com:443']);
    });
  });
});
