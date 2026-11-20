import {
  flakyFlows,
  formatDuration,
  notificationText,
  renderSummary,
  slowestFlows,
  testDurationMs,
} from '../../src/ui/summary';
import type { JsonFlowResult, JsonOutput } from '../../src/utils/json_output';

function flow(
  partial: Partial<JsonFlowResult> & { id: number; name: string },
): JsonFlowResult {
  return {
    runId: 1,
    status: 'DONE',
    passed: true,
    attempt: 1,
    latest: true,
    errors: [],
    ...partial,
  };
}

function maestroOutput(overrides: Partial<JsonOutput> = {}): JsonOutput {
  return {
    provider: 'maestro',
    outcome: 'failed',
    success: false,
    appId: 1234,
    url: 'https://testingbot.com/members/maestro/1234',
    runs: [
      {
        id: 1,
        status: 'DONE',
        passed: false,
        device: { name: 'Pixel 9', platform: 'Android', version: '14' },
        url: 'https://testingbot.com/members/maestro/1234/runs/1',
        flows: [
          flow({
            id: 1,
            name: 'login.yaml',
            durationSeconds: 42,
            startedAt: '2026-11-20T10:00:00Z',
            completedAt: '2026-11-20T10:00:42Z',
          }),
          flow({
            id: 2,
            name: 'checkout.yaml',
            passed: false,
            attempt: 1,
            latest: false,
            status: 'FAILED',
          }),
          flow({
            id: 3,
            name: 'checkout.yaml',
            passed: true,
            attempt: 2,
            durationSeconds: 75,
            startedAt: '2026-11-20T10:01:00Z',
            completedAt: '2026-11-20T10:02:15Z',
          }),
          flow({
            id: 4,
            name: 'search.yaml',
            passed: false,
            status: 'FAILED',
            durationSeconds: 12,
            errors: ['Element not found'],
          }),
        ],
      },
      {
        id: 2,
        status: 'DONE',
        passed: true,
        device: { name: 'iPhone 17', platform: 'iOS', version: '18.2' },
        flows: [flow({ id: 5, runId: 2, name: 'login.yaml' })],
      },
    ],
    ...overrides,
  };
}

const plain = { color: false, hyperlinks: false } as const;

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '1s'],
    [45_000, '45s'],
    [372_000, '6m 12s'],
    [3_725_000, '1h 02m'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('summary insights', () => {
  it('lists flows that only passed on a retry as flaky', () => {
    expect(flakyFlows(maestroOutput())).toEqual(['checkout.yaml']);
  });

  it('ranks the counted attempts by duration, longest first', () => {
    expect(slowestFlows(maestroOutput())).toEqual([
      { name: 'checkout.yaml (Pixel 9)', seconds: 75 },
      { name: 'login.yaml (Pixel 9)', seconds: 42 },
      { name: 'search.yaml (Pixel 9)', seconds: 12 },
    ]);
  });

  it('measures the tests from the first flow start to the last flow end', () => {
    expect(testDurationMs(maestroOutput(), 999_999)).toBe(135_000);
  });

  it('falls back to the command time when flows carry no timestamps', () => {
    const output = maestroOutput();
    for (const run of output.runs) {
      for (const f of run.flows ?? []) {
        delete f.startedAt;
        delete f.completedAt;
      }
    }
    expect(testDurationMs(output, 5000)).toBe(5000);
  });
});

describe('renderSummary', () => {
  it('shows the verdict, a row per device, insights and next steps for a failed Maestro run', () => {
    const text = renderSummary(maestroOutput(), {
      elapsedMs: 1,
      ...plain,
    }).join('\n');
    expect(text).toContain(
      ' FAILED  1 of 4 flows failed on 2 devices · 2m 15s',
    );
    expect(text).toMatch(/✘ Pixel 9 · Android 14\s+2\/3/);
    expect(text).toMatch(/✔ iPhone 17 · iOS 18\.2\s+1\/1/);
    expect(text).toContain('◆ Flaky    checkout.yaml (passed on retry)');
    // Four flows: the live table already shows durations.
    expect(text).not.toContain('Slowest');
    expect(text).toContain('testingbot rerun --id 1234');
    expect(text).toContain(
      'testingbot artifacts --id 1234 --download-artifacts failed',
    );
    expect(text).toContain('https://testingbot.com/members/maestro/1234');
  });

  it('lists the slowest flows once the suite is large enough', () => {
    const output = maestroOutput({ outcome: 'passed', success: true });
    output.runs = [
      {
        ...output.runs[1],
        flows: [5, 80, 30, 12, 61, 7].map((seconds, i) =>
          flow({ id: i + 1, name: `f${i}.yaml`, durationSeconds: seconds }),
        ),
      },
    ];
    const text = renderSummary(output, { elapsedMs: 1, ...plain }).join('\n');
    expect(text).toContain(
      '◷ Slowest  f1.yaml 1m 20s · f4.yaml 1m 01s · f2.yaml 30s',
    );
  });

  it('keeps the slowest flows on one line', () => {
    const output = maestroOutput({ outcome: 'passed', success: true });
    output.runs = [
      {
        ...output.runs[1],
        flows: [50, 80, 30, 12, 61, 7].map((seconds, i) =>
          flow({
            id: i + 1,
            name: `a-rather-long-flow-name-${i}.yaml`,
            durationSeconds: seconds,
          }),
        ),
      },
    ];
    const line = renderSummary(output, {
      elapsedMs: 1,
      columns: 80,
      ...plain,
    }).find((l) => l.includes('Slowest')) as string;
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line).toContain('a-rather-long-flow-name-1.yaml 1m 20s');
  });

  it('does not suggest downloading artifacts that were already downloaded', () => {
    const text = renderSummary(maestroOutput(), {
      elapsedMs: 1,
      artifactsDownloaded: true,
      ...plain,
    }).join('\n');
    expect(text).toContain('testingbot rerun --id 1234');
    expect(text).not.toContain('testingbot artifacts');
  });

  it('only links the dashboard for a passing run', () => {
    const output = maestroOutput({ outcome: 'passed', success: true });
    output.runs = [output.runs[1]];
    const text = renderSummary(output, { elapsedMs: 1, ...plain }).join('\n');
    expect(text).toContain(' PASSED  1 flow passed on 1 device');
    expect(text).not.toContain('rerun');
    expect(text).toContain('↗ Dashboard');
  });

  it('counts runs and links each failed run for Espresso / XCUITest', () => {
    const output: JsonOutput = {
      provider: 'espresso',
      outcome: 'failed',
      success: false,
      appId: 77,
      url: 'https://testingbot.com/members/espresso/77',
      runs: [
        {
          id: 10,
          status: 'DONE',
          passed: false,
          device: { name: 'Pixel 8', platform: 'Android', version: '14' },
          url: 'https://testingbot.com/members/espresso/77/runs/10',
        },
        {
          id: 11,
          status: 'DONE',
          passed: true,
          device: { name: 'Galaxy S24', platform: 'Android', version: '14' },
        },
      ],
    };
    const text = renderSummary(output, { elapsedMs: 65_000, ...plain }).join(
      '\n',
    );
    expect(text).toContain(' FAILED  1 of 2 runs failed on 2 devices · 1m 05s');
    expect(text).toMatch(/✘ Pixel 8 · Android 14\s+failed/);
    expect(text).toMatch(
      /↗ Pixel 8\s+https:\/\/testingbot\.com\/members\/espresso\/77\/runs\/10/,
    );
    expect(text).not.toContain('rerun');
  });

  it('marks runs stopped before they finished as unfinished', () => {
    const output = maestroOutput();
    output.runs[1] = {
      ...output.runs[1],
      status: 'READY',
      passed: false,
      flows: [],
    };
    const text = renderSummary(output, { elapsedMs: 1, ...plain }).join('\n');
    expect(text).toMatch(/✘ iPhone 17 · iOS 18\.2\s+unfinished/);
  });

  it('wraps links in OSC 8 when the terminal supports them', () => {
    const text = renderSummary(maestroOutput(), {
      elapsedMs: 1,
      color: false,
      hyperlinks: true,
    }).join('\n');
    expect(text).toContain(
      '\x1b]8;;https://testingbot.com/members/maestro/1234\x07https://testingbot.com/members/maestro/1234\x1b]8;;\x07',
    );
  });
});

describe('notificationText', () => {
  it('summarises flows', () => {
    expect(notificationText(maestroOutput())).toBe(
      'TestingBot: 1 of 4 flows failed',
    );
  });
});
