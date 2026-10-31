/**
 * Outbound HTTP(S) proxy support, for CI runners that can only reach the
 * internet through a corporate proxy.
 *
 * The proxy comes from --proxy, or from the usual environment variables:
 * HTTPS_PROXY for https URLs, HTTP_PROXY for http URLs, ALL_PROXY for both
 * (lower-case names too). NO_PROXY lists hosts to reach directly; loopback
 * addresses always are.
 *
 * installProxy() replaces Node's global HTTP and HTTPS agents with an agent
 * that picks the proxy per request, so axios, the tunnel download and anything
 * else built on http.request follow it. https URLs go through a CONNECT
 * tunnel. Clients that bypass the global agent (the WebSocket of the live
 * updates) take proxyAgent() explicitly.
 */

import http from 'node:http';
import https from 'node:https';
import { Agent, type AgentConnectOpts } from 'agent-base';
import axios from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import TestingBotError from '../models/testingbot_error';

type Env = NodeJS.ProcessEnv;

export interface ProxySettings {
  /** --proxy: used for every URL not excluded by NO_PROXY. */
  proxy?: string;
  env?: Env;
}

function envValue(env: Env, name: string): string | undefined {
  const value = env[name] ?? env[name.toUpperCase()];
  return value?.trim() || undefined;
}

/** A proxy given as host:port means http://host:port. */
function normalizeProxy(proxy: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(proxy) ? proxy : `http://${proxy}`;
}

function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

/** NO_PROXY: `*`, or hosts / domain suffixes, each optionally with :port. */
function bypassed(url: URL, noProxy: string | undefined): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isLoopback(host)) return true;
  if (!noProxy) return false;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  return noProxy
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((rawEntry) => {
      if (rawEntry === '*') return true;
      let entry = rawEntry.toLowerCase();
      const portMatch = /^(.*):(\d+)$/.exec(entry);
      if (portMatch && !entry.includes('::')) {
        if (portMatch[2] !== port) return false;
        entry = portMatch[1];
      }
      entry = entry.replace(/^\*?\./, '').replace(/^\[|\]$/g, '');
      return host === entry || host.endsWith(`.${entry}`);
    });
}

/** The proxy URL a request to `target` should use, or undefined for direct. */
export function proxyForUrl(
  target: string | URL,
  settings: ProxySettings = {},
): string | undefined {
  const env = settings.env ?? process.env;
  const url = typeof target === 'string' ? new URL(target) : target;
  const proxy =
    settings.proxy ??
    (url.protocol === 'https:'
      ? envValue(env, 'https_proxy')
      : envValue(env, 'http_proxy')) ??
    envValue(env, 'all_proxy');
  if (!proxy || bypassed(url, envValue(env, 'no_proxy'))) return undefined;
  return normalizeProxy(proxy);
}

/** The proxy URL with its password masked, for logs. */
export function redactProxy(proxy: string): string {
  try {
    const url = new URL(normalizeProxy(proxy));
    if (url.password) url.password = '***';
    return url.toString().replace(/\/$/, '');
  } catch {
    return proxy;
  }
}

/** Routes each request through the proxy its URL calls for, or directly. */
class ProxyRoutingAgent extends Agent {
  private readonly proxied = new Map<string, http.Agent>();

  constructor(
    private readonly settings: ProxySettings,
    private readonly direct: http.Agent,
  ) {
    super({ keepAlive: true });
  }

  connect(req: http.ClientRequest, opts: AgentConnectOpts): http.Agent {
    const scheme = opts.secureEndpoint ? 'https:' : 'http:';
    const host = opts.host?.includes(':') ? `[${opts.host}]` : opts.host;
    const proxy = proxyForUrl(
      `${scheme}//${host}:${opts.port}${req.path}`,
      this.settings,
    );
    if (!proxy) return this.direct;

    const key = `${scheme}${proxy}`;
    let agent = this.proxied.get(key);
    if (!agent) {
      agent = opts.secureEndpoint
        ? new HttpsProxyAgent(proxy, { keepAlive: true })
        : new HttpProxyAgent(proxy, { keepAlive: true });
      this.proxied.set(key, agent);
    }
    return agent;
  }
}

let installed: ProxySettings | undefined;
let httpsRouting: http.Agent | undefined;
const originalAgents = { http: http.globalAgent, https: https.globalAgent };

/**
 * Sends the CLI's HTTP(S) traffic through the configured proxy. Returns the
 * proxy (password masked) when one is configured, else changes nothing.
 */
export function installProxy(settings: ProxySettings = {}): string | undefined {
  const env = settings.env ?? process.env;
  const configured =
    settings.proxy?.trim() ||
    envValue(env, 'https_proxy') ||
    envValue(env, 'http_proxy') ||
    envValue(env, 'all_proxy');
  if (!configured) return undefined;

  let protocol: string;
  try {
    protocol = new URL(normalizeProxy(configured)).protocol;
  } catch {
    throw new TestingBotError(`Invalid proxy URL: ${redactProxy(configured)}`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new TestingBotError(
      `Unsupported proxy ${redactProxy(configured)}: only http:// and https:// proxies are supported.`,
    );
  }

  installed = { proxy: settings.proxy?.trim() || undefined, env };
  httpsRouting = new ProxyRoutingAgent(installed, originalAgents.https);
  // http.globalAgent and https.globalAgent are setters on the modules.
  Object.assign(http, {
    globalAgent: new ProxyRoutingAgent(installed, originalAgents.http),
  });
  Object.assign(https, { globalAgent: httpsRouting });
  // axios's own proxy support sends https requests to the proxy without
  // CONNECT, which most proxies refuse; the global agents handle it instead.
  axios.defaults.proxy = false;
  return redactProxy(configured);
}

/** Undoes installProxy(); for tests. */
export function uninstallProxy(): void {
  Object.assign(http, { globalAgent: originalAgents.http });
  Object.assign(https, { globalAgent: originalAgents.https });
  delete axios.defaults.proxy;
  installed = undefined;
  httpsRouting = undefined;
}

/** The agent for clients that bypass the global agent (WebSockets). */
export function proxyAgent(): http.Agent | undefined {
  return httpsRouting;
}

/** The installed proxy for `target`, or undefined when it goes direct. */
export function activeProxyFor(target: string): string | undefined {
  return installed ? proxyForUrl(target, installed) : undefined;
}
