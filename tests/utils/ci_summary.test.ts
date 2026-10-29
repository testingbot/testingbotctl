import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  azureAnnotations,
  githubAnnotations,
  publishCiSummary,
  renderMarkdown,
} from '../../src/utils/ci_summary';
import type { JsonOutput } from '../../src/utils/json_output';

jest.mock('../../src/logger');

const flow = (
  id: number,
  name: string,
  passed: boolean,
  extra: { attempt?: number; latest?: boolean; errors?: string[] } = {},
) => ({
  id,
  runId: 10,
  name,
  status: passed ? 'DONE' : 'FAILED',
  passed,
  attempt: extra.attempt ?? 1,
  latest: extra.latest ?? true,
  errors: extra.errors ?? [],
});

const maestro: JsonOutput = {
  provider: 'maestro',
  outcome: 'failed',
  success: false,
  appId: 77,
  url: 'https://testingbot.com/members/maestro/77',
  runs: [
    {
      id: 10,
      status: 'DONE',
      passed: false,
      device: { name: 'Pixel 8', platform: 'Android', version: '14' },
      url: 'https://testingbot.com/members/maestro/77/runs/10',
      flows: [
        flow(1, 'login', true),
        flow(2, 'checkout', false, {
          errors: ['Assertion is false: "Pay | now" is visible\nat step 4'],
        }),
        // A failed first attempt that a retry fixed does not count.
        flow(3, 'search', false, { latest: false }),
        flow(4, 'search', true, { attempt: 2 }),
      ],
    },
  ],
};

const espresso: JsonOutput = {
  provider: 'espresso',
  outcome: 'passed',
  success: true,
  runs: [
    {
      id: 5,
      status: 'DONE',
      passed: true,
      device: { name: 'Pixel 6', platform: 'Android' },
    },
  ],
};

describe('renderMarkdown', () => {
  test('a Maestro run: flows passed per device and the failing flows', () => {
    const md = renderMarkdown(maestro);
    expect(md).toContain('### TestingBot Maestro: ❌ 1 of 1 run(s) failed');
    expect(md).toContain(
      '[Open in TestingBot](https://testingbot.com/members/maestro/77)',
    );
    expect(md).toContain(
      '| ❌ | Pixel 8 (Android 14) | 2 / 3 | [#10](https://testingbot.com/members/maestro/77/runs/10) |',
    );
    expect(md).toContain('<summary>Failures (1)</summary>');
    expect(md).toContain(
      '| [checkout on Pixel 8 (Android 14)](https://testingbot.com/members/maestro/77/runs/10) | Assertion is false: "Pay \\| now" is visible at step 4 |',
    );
    expect(md).not.toContain('search on');
  });

  test('a backslash before a pipe cannot unescape it and break the table', () => {
    const md = renderMarkdown({
      ...maestro,
      runs: [
        {
          ...maestro.runs[0],
          flows: [
            flow(2, 'checkout', false, { errors: ['path C:\\tmp\\| x'] }),
          ],
        },
      ],
    });
    expect(md).toContain('| path C:\\\\tmp\\\\\\| x |');
  });

  test('a passed Espresso run without flows', () => {
    const md = renderMarkdown(espresso);
    expect(md).toContain('### TestingBot Espresso: ✅ passed');
    expect(md).toContain('| ✅ | Pixel 6 | passed | #5 |');
    expect(md).not.toContain('Failures');
  });
});

describe('annotations', () => {
  test('GitHub: one escaped ::error per failed flow', () => {
    expect(githubAnnotations(maestro)).toEqual([
      '::error title=TestingBot%3A checkout on Pixel 8 (Android 14)::Assertion is false: "Pay | now" is visible%0Aat step 4%0Ahttps://testingbot.com/members/maestro/77/runs/10',
    ]);
  });

  test('Azure: one single-line logissue per failed flow', () => {
    expect(azureAnnotations(maestro)).toEqual([
      '##vso[task.logissue type=error]TestingBot: checkout on Pixel 8 (Android 14): Assertion is false: "Pay | now" is visible at step 4 https://testingbot.com/members/maestro/77/runs/10',
    ]);
  });

  test('a failed run without flows is annotated as a run', () => {
    const failed: JsonOutput = {
      ...espresso,
      outcome: 'failed',
      success: false,
      runs: [{ ...espresso.runs[0], passed: false, status: 'FAILED' }],
    };
    expect(githubAnnotations(failed)).toEqual([
      '::error title=TestingBot%3A Run 5 on Pixel 6::Run failed',
    ]);
  });
});

describe('publishCiSummary', () => {
  let dir: string;
  let lines: string[];
  const write = (line: string) => lines.push(line);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-summary-'));
    lines = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('GitHub Actions: appends to the step summary and annotates', async () => {
    const summary = path.join(dir, 'summary.md');
    fs.writeFileSync(summary, 'earlier step\n');
    await publishCiSummary(maestro, {
      env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary },
      write,
    });
    const md = fs.readFileSync(summary, 'utf8');
    expect(md.startsWith('earlier step\n### TestingBot Maestro')).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::error /);
  });

  test('--json keeps stdout clean but still writes the summary file', async () => {
    const summary = path.join(dir, 'summary.md');
    await publishCiSummary(maestro, {
      env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary },
      stdoutReserved: true,
      write,
    });
    expect(fs.existsSync(summary)).toBe(true);
    expect(lines).toEqual([]);
  });

  test('Azure Pipelines: uploads the markdown and logs issues', async () => {
    await publishCiSummary(maestro, {
      env: { TF_BUILD: 'True', AGENT_TEMPDIRECTORY: dir },
      write,
    });
    const file = path.join(dir, 'testingbot-maestro-77.md');
    expect(fs.readFileSync(file, 'utf8')).toContain('TestingBot Maestro');
    expect(lines[0]).toBe(`##vso[task.uploadsummary]${file}`);
    expect(lines[1]).toMatch(/^##vso\[task\.logissue type=error\]/);
  });

  test('does nothing outside CI, when turned off, or without a verdict', async () => {
    const summary = path.join(dir, 'summary.md');
    const gh = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary };
    await publishCiSummary(maestro, { env: {}, write });
    await publishCiSummary(maestro, {
      env: { ...gh, TESTINGBOT_CI_SUMMARY: '0' },
      write,
    });
    await publishCiSummary(
      { ...maestro, outcome: 'started' },
      { env: gh, write },
    );
    expect(fs.existsSync(summary)).toBe(false);
    expect(lines).toEqual([]);
  });

  test('a summary that cannot be written does not throw', async () => {
    await expect(
      publishCiSummary(maestro, {
        env: {
          GITHUB_ACTIONS: 'true',
          GITHUB_STEP_SUMMARY: path.join(dir, 'missing', 'summary.md'),
        },
        write,
      }),
    ).resolves.toBeUndefined();
  });
});
