#!/usr/bin/env node
/*
 * Mock of the TestingBot API (and the npm registry) for end-to-end checks of
 * the CLI inside a container. The container maps api.testingbot.com and
 * registry.npmjs.org to 127.0.0.1 and trusts this server's self-signed
 * certificate via NODE_EXTRA_CA_CERTS, so the real, unmodified CLI talks to it.
 *
 * Scenario per process: MOCK_SCENARIO = pass | fail | flaky | matrix
 * Each status poll advances the project one step, so runs finish in a few polls.
 */
'use strict';

const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

// The Maestro output bundle the node uploads (vm packMaestroOutput): a tar of
// <flow>/commands.json, screen-hierarchy/ and screenshots/, served gzip-encoded
// like R2 serves it.
function maestroOutputTar(flowName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-'));
  const flow = path.join(dir, flowName.replace(/\.ya?ml$/, ''));
  fs.mkdirSync(path.join(flow, 'screen-hierarchy'), { recursive: true });
  fs.mkdirSync(path.join(flow, 'screenshots'), { recursive: true });
  fs.writeFileSync(
    path.join(flow, 'commands.json'),
    JSON.stringify([
      {
        artifacts: [
          {
            type: 'SCREEN_HIERARCHY',
            path: 'screen-hierarchy/step-002-tapOnElement.json',
          },
          { type: 'SCREENSHOT', path: 'screenshots/step-002-tapOnElement.png' },
        ],
      },
    ]),
  );
  fs.writeFileSync(
    path.join(flow, 'screen-hierarchy', 'step-002-tapOnElement.json'),
    '{"text":"Pay now"}',
  );
  fs.writeFileSync(
    path.join(flow, 'screenshots', 'step-002-tapOnElement.png'),
    'png',
  );
  const tar = path.join(dir, 'out.tar');
  execFileSync('tar', ['-cf', tar, '-C', dir, path.basename(flow)]);
  const data = fs.readFileSync(tar);
  fs.rmSync(dir, { recursive: true, force: true });
  return data;
}

const SCENARIO = process.env.MOCK_SCENARIO || 'pass';
const LATEST_CLI = process.env.MOCK_LATEST_CLI || '';
// Stretches every run over N times as many polls (to test long-run behaviour).
const SLOW = Math.max(1, Number(process.env.MOCK_SLOW) || 1);
// MOCK_DROP_RUN=before|after: the first POST /run gets no answer (the socket
// is destroyed), with the runs not started (before) or started (after).
let dropRun = process.env.MOCK_DROP_RUN || '';
const log = (...a) => {
  if (process.env.MOCK_LOG)
    fs.appendFileSync(process.env.MOCK_LOG, a.join(' ') + '\n');
};

let nextId = 1000;
const projects = new Map();

const FLOW_NAMES = [
  'login.yaml',
  'checkout.yaml',
  'search.yaml',
  'profile.yaml',
];

function iso(msAgo) {
  return new Date(Date.now() - msAgo).toISOString();
}

function newProject(provider) {
  const id = nextId++;
  const devices =
    provider === 'xcuitest'
      ? [{ deviceName: 'iPhone 16', platformName: 'iOS', version: '18.2' }]
      : SCENARIO === 'matrix' || SCENARIO === 'fail'
        ? [
            { deviceName: 'Pixel 9', platformName: 'Android', version: '15' },
            {
              deviceName: 'Galaxy S24',
              platformName: 'Android',
              version: '14',
            },
          ]
        : [{ deviceName: 'Pixel 9', platformName: 'Android', version: '15' }];
  let flowId = 1;
  const runs = devices.map((cap, r) => ({
    id: id * 10 + r,
    capabilities: cap,
    flows:
      provider === 'maestro'
        ? FLOW_NAMES.map((name, i) => ({
            id: flowId++,
            name,
            order: i,
            attempt: 1,
          }))
        : [],
  }));
  const project = { id, provider, polls: 0, runs, retries: [] };
  projects.set(id, project);
  return project;
}

function flowOutcome(run, flow, runIndex) {
  // Which flows fail, per scenario.
  if (SCENARIO === 'fail' && runIndex === 1 && flow.name === 'checkout.yaml') {
    return { ok: false, error: 'Element with text "Pay now" not found' };
  }
  if (
    SCENARIO === 'flaky' &&
    flow.name === 'search.yaml' &&
    flow.attempt === 1
  ) {
    return { ok: false, error: 'Timed out waiting for search results' };
  }
  return { ok: true };
}

function maestroStatus(project) {
  const p = project.polls;
  const runs = project.runs.map((run, r) => {
    const flows = run.flows.map((flow) => {
      const start = flow.startPoll ?? (1 + flow.order) * SLOW;
      const end = start + (1 + (flow.order % 2)) * SLOW;
      let status = 'WAITING';
      let success = 0;
      const out = {
        id: flow.id,
        name: flow.name,
        status,
        success,
        error_messages: [],
      };
      if (p >= start) {
        out.status = 'READY';
        out.requested_at = iso((p - start + 1) * 23_000);
      }
      if (p >= end) {
        const o = flowOutcome(run, flow, r);
        out.status = o.ok ? 'DONE' : 'FAILED';
        out.success = o.ok ? 1 : 0;
        out.completed_at = iso(0);
        out.requested_at = iso((end - start) * 37_000 + flow.order * 11_000);
        if (!o.ok) out.error_messages = [o.error];
      }
      return out;
    });
    // Latest attempt per name decides the run.
    const latest = new Map();
    for (const f of flows) latest.set(f.name, f);
    const all = [...latest.values()];
    const done = all.every((f) => f.status === 'DONE' || f.status === 'FAILED');
    const anyStarted = flows.some((f) => f.status !== 'WAITING');
    const passed = done && all.every((f) => f.status === 'DONE');
    return {
      id: run.id,
      status: done ? 'DONE' : anyStarted ? 'READY' : 'WAITING',
      capabilities: run.capabilities,
      environment: {
        device: run.capabilities.deviceName,
        version: run.capabilities.version,
      },
      success: passed ? 1 : 0,
      flows,
    };
  });
  const completed = runs.every((r) => r.status === 'DONE');
  return {
    runs,
    completed,
    success: completed && runs.every((r) => r.success === 1),
  };
}

function simpleStatus(project) {
  const p = project.polls;
  const runs = project.runs.map((run, r) => {
    const status = p < 1 ? 'WAITING' : p < 3 ? 'READY' : 'DONE';
    const ok = !(SCENARIO === 'fail' && r === 0);
    return {
      id: run.id,
      status,
      capabilities: run.capabilities,
      environment: {
        name: run.capabilities.deviceName,
        version: run.capabilities.version,
      },
      success: status === 'DONE' ? ok : false,
      ...(status === 'DONE' &&
        !ok && {
          report:
            'com.example.LoginTest#testLogin: expected:<200> but was:<500>',
        }),
    };
  });
  const completed = runs.every((r) => r.status === 'DONE');
  return {
    runs,
    completed,
    success: completed && runs.every((r) => r.success),
  };
}

function send(res, code, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    ...(LATEST_CLI && { 'x-testingbotctl-version': LATEST_CLI }),
    ...headers,
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const DEVICES = [
  {
    deviceName: 'Pixel 9',
    platformName: 'Android',
    version: '15',
    device_type: 'phone',
  },
  {
    deviceName: 'Pixel 9',
    platformName: 'Android',
    version: '14',
    device_type: 'phone',
  },
  {
    deviceName: 'Pixel 8',
    platformName: 'Android',
    version: '14',
    device_type: 'phone',
  },
  {
    deviceName: 'Galaxy S24',
    platformName: 'Android',
    version: '14',
    device_type: 'phone',
  },
  {
    deviceName: 'Pixel Tablet',
    platformName: 'Android',
    version: '14',
    device_type: 'tablet',
  },
  {
    deviceName: 'iPhone 16',
    platformName: 'iOS',
    version: '18.2',
    device_type: 'phone',
  },
  {
    deviceName: 'iPhone 17',
    platformName: 'iOS',
    version: '26.0',
    device_type: 'phone',
  },
  {
    deviceName: 'iPad Pro 13',
    platformName: 'iOS',
    version: '18.2',
    device_type: 'tablet',
  },
];

async function handle(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const body = await readBody(req);
  log(req.method, req.headers.host, url.pathname);

  if (req.headers.host?.startsWith('registry.npmjs.org')) {
    return send(res, 200, {
      name: '@testingbot/cli',
      version: LATEST_CLI || '0.0.1',
    });
  }

  const auth = req.headers.authorization;
  const authed =
    auth &&
    Buffer.from(auth.split(' ')[1] || '', 'base64').toString() === 'key:secret';

  if (url.pathname === '/v1/user') {
    if (!authed) return send(res, 401, { error: 'Unauthorized' });
    return send(res, 200, {
      id: 42,
      first_name: 'Test',
      last_name: 'User',
      plan: 'Team',
      seconds: 123_456,
      max_concurrent: 5,
      max_concurrent_mobile: 3,
      current_vm_concurrency: 2,
      current_physical_concurrency: 1,
    });
  }
  if (url.pathname.startsWith('/v1/browsers/')) {
    return send(res, 200, DEVICES);
  }
  if (url.pathname === '/v1/devices') {
    return send(res, 200, [
      {
        name: 'Pixel 9',
        platform_name: 'Android',
        version: '15',
        available: true,
      },
      {
        name: 'iPhone 16',
        platform_name: 'iOS',
        version: '18.2',
        available: false,
      },
    ]);
  }

  let mo;
  if (
    (mo = url.pathname.match(/^\/assets\/\d+\/\d+\/maestro_output-(.+)\.tar$/))
  ) {
    res.writeHead(200, {
      'content-type': 'application/x-tar',
      'content-encoding': 'gzip',
    });
    return res.end(zlib.gzipSync(maestroOutputTar(decodeURIComponent(mo[1]))));
  }
  if (url.pathname.startsWith('/assets/')) {
    return send(res, 200, `asset ${url.pathname}\n`, {
      'Content-Type': 'application/octet-stream',
    });
  }

  const m = url.pathname.match(
    /^\/v1\/app-automate\/(maestro|espresso|xcuitest)(\/.*)?$/,
  );
  if (!m) return send(res, 404, { error: 'not found' });
  if (!authed) return send(res, 401, { error: 'Unauthorized' });
  const provider = m[1];
  const rest = m[2] || '';

  if (req.method === 'POST' && rest === '/app/checksum')
    return send(res, 200, { app_exists: false });
  if (req.method === 'POST' && rest === '/app') {
    const project = newProject(provider);
    project.started = false;
    return send(res, 200, { id: project.id });
  }

  let mm;
  if ((mm = rest.match(/^\/(\d+)\/tests$/)) && req.method === 'POST') {
    return send(res, 200, { id: Number(mm[1]) });
  }
  if ((mm = rest.match(/^\/(\d+)\/run$/)) && req.method === 'POST') {
    const project = projects.get(Number(mm[1]));
    log('run body', body.toString());
    log('run idempotency-key', req.headers['idempotency-key'] || '-');
    if (dropRun === 'before') {
      dropRun = '';
      log('run dropped before start');
      return req.socket.destroy();
    }
    if (project) project.started = true;
    if (dropRun === 'after') {
      dropRun = '';
      log('run dropped after start');
      return req.socket.destroy();
    }
    return send(res, 200, { success: true });
  }
  if ((mm = rest.match(/^\/(\d+)$/)) && req.method === 'GET') {
    const project = projects.get(Number(mm[1]));
    if (!project) return send(res, 404, { error: 'Project not found' });
    // Uploaded but not started: no runs yet.
    if (project.started === false) {
      return send(res, 200, { runs: [], success: false, completed: false });
    }
    project.polls++;
    return send(
      res,
      200,
      provider === 'maestro' ? maestroStatus(project) : simpleStatus(project),
    );
  }
  if (
    (mm = rest.match(/^\/(\d+)\/(\d+)\/(\d+)\/retry$/)) &&
    req.method === 'POST'
  ) {
    const project = projects.get(Number(mm[1]));
    const run = project && project.runs.find((r) => r.id === Number(mm[2]));
    const flow = run && run.flows.find((f) => f.id === Number(mm[3]));
    if (!flow)
      return send(res, 404, { success: false, error: 'flow not found' });
    const ids = run.flows.map((f) => f.id);
    const retry = {
      id: Math.max(...ids) + 100,
      name: flow.name,
      order: flow.order,
      attempt: flow.attempt + 1,
      startPoll: project.polls + 1,
    };
    run.flows.push(retry);
    return send(res, 200, { success: true, flow: { id: retry.id } });
  }
  if (rest.match(/^\/(\d+)\/(\d+)\/(cancel|stop)$/))
    return send(res, 200, { success: true });
  // One run with its flows' assets, as `--download-artifacts` reads it.
  if ((mm = rest.match(/^\/(\d+)\/(\d+)$/)) && req.method === 'GET') {
    const project = projects.get(Number(mm[1]));
    if (!project) return send(res, 404, { error: 'Project not found' });
    const status = maestroStatus(project);
    const run = status.runs.find((r) => r.id === Number(mm[2]));
    if (!run) return send(res, 404, { error: 'Run not found' });
    const asset = (path) =>
      `https://api.testingbot.com/assets/${run.id}/${path}`;
    return send(res, 200, {
      ...run,
      completed: run.status === 'DONE',
      assets_synced: true,
      report: `<testsuites name="run ${run.id}"/>`,
      flows: run.flows.map((f) => ({
        ...f,
        report: `<testsuite name="${f.name}"/>`,
        assets: {
          logs: { maestro: asset(`${f.id}/maestro.txt`) },
          video: asset(`${f.id}/video.mp4`),
          screenshots: [asset(`${f.id}/s0.png`)],
          maestro_output: asset(
            `${f.id}/maestro_output-${encodeURIComponent(f.name)}.tar`,
          ),
        },
      })),
    });
  }
  if (rest === '' && req.method === 'GET') {
    return send(res, 200, {
      data: [...projects.values()].map((p, i) => ({
        id: p.id,
        name: `Project ${p.id}`,
        created_at: iso((i + 1) * 3_600_000),
        updated_at: iso(0),
        completed: p.polls > 3,
        runs: p.runs.map((r) => r.id),
        flows: p.runs[0].flows.map((f) => ({ id: f.id, name: f.name })),
      })),
      meta: { offset: 0, count: 10, total: projects.size },
    });
  }
  return send(res, 404, { error: `unhandled ${req.method} ${url.pathname}` });
}

https
  .createServer(
    {
      key: fs.readFileSync('/certs/key.pem'),
      cert: fs.readFileSync('/certs/cert.pem'),
    },
    (req, res) => {
      handle(req, res).catch((err) => send(res, 500, { error: String(err) }));
    },
  )
  .listen(443, '127.0.0.1', () => log('mock listening'));
